import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { Server } from 'socket.io';
import { createStore } from './store.js';
import { requireAuth, signToken, verifyToken } from './auth.js';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const MAX_MESSAGE_LENGTH = 2000;

/**
 * Builds the HTTP server, REST API and Socket.IO server.
 * Kept separate from index.js so the tests can start it on a random port.
 */
export function createChatServer({ db, jwtSecret, clientOrigin = '*', staticDir }) {
  const store = createStore(db);
  const app = express();
  app.use(cors({ origin: clientOrigin }));
  app.use(express.json());

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: clientOrigin } });

  // userId -> number of open connections (a user may have several tabs open)
  const online = new Map();
  const onlineUserIds = () => [...online.keys()];

  // ---------- REST API ----------

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body ?? {};
    if (!USERNAME_RE.test(username ?? '')) {
      return res
        .status(400)
        .json({ error: 'Username must be 3–20 letters, numbers or underscores' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (store.findUserByUsername(username)) {
      return res.status(409).json({ error: 'That username is taken' });
    }
    const user = store.createUser(username, await bcrypt.hash(password, 10));
    res.status(201).json({ user, token: signToken(user, jwtSecret) });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body ?? {};
    const row = username && store.findUserByUsername(username);
    if (!row || !(await bcrypt.compare(password ?? '', row.password_hash))) {
      return res.status(401).json({ error: 'Wrong username or password' });
    }
    const user = { id: row.id, username: row.username };
    res.json({ user, token: signToken(user, jwtSecret) });
  });

  const auth = requireAuth(jwtSecret);

  app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

  app.get('/api/users', auth, (req, res) => {
    const q = String(req.query.q ?? '').trim();
    res.json({ users: store.searchUsers(q, req.user.id), online: onlineUserIds() });
  });

  app.get('/api/conversations', auth, (req, res) => {
    res.json({ conversations: store.listConversations(req.user.id), online: onlineUserIds() });
  });

  // Start a one-to-one chat ({ userId }) or a group ({ name, memberIds })
  app.post('/api/conversations', auth, (req, res) => {
    const { userId, name, memberIds } = req.body ?? {};

    if (userId !== undefined) {
      const otherId = Number(userId);
      if (otherId === req.user.id || !store.userIdsExist([otherId])) {
        return res.status(400).json({ error: 'Pick another user to chat with' });
      }
      const existing = store.findDirectConversation(req.user.id, otherId);
      if (existing) return res.json({ conversation: store.getConversation(existing.id) });
      const conversation = store.createConversation({
        isGroup: false,
        memberIds: [req.user.id, otherId],
      });
      announceConversation(conversation);
      return res.status(201).json({ conversation });
    }

    const groupName = String(name ?? '').trim();
    const ids = Array.isArray(memberIds) ? memberIds.map(Number) : [];
    if (!groupName || groupName.length > 50) {
      return res.status(400).json({ error: 'Group name must be 1–50 characters' });
    }
    if (ids.length < 1 || !store.userIdsExist(ids)) {
      return res.status(400).json({ error: 'Add at least one valid member' });
    }
    const conversation = store.createConversation({
      name: groupName,
      isGroup: true,
      memberIds: [req.user.id, ...ids],
    });
    announceConversation(conversation);
    res.status(201).json({ conversation });
  });

  app.get('/api/conversations/:id/messages', auth, (req, res) => {
    const id = Number(req.params.id);
    if (!store.isMember(id, req.user.id)) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const before = req.query.before ? Number(req.query.before) : undefined;
    res.json({ messages: store.listMessages(id, { before }) });
  });

  // Unknown API routes get a JSON 404 rather than the React page
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // In production, the server also serves the built React app (client/dist),
  // so the whole project runs as a single web service.
  if (staticDir) {
    app.use(express.static(staticDir));
    app.get('*', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  // ---------- Real-time (Socket.IO) ----------

  const userRoom = (userId) => `user:${userId}`;
  const convRoom = (conversationId) => `conversation:${conversationId}`;

  /** Puts every member's open sockets into the new room and tells them about it. */
  function announceConversation(conversation) {
    for (const member of conversation.members) {
      io.in(userRoom(member.id)).socketsJoin(convRoom(conversation.id));
      io.to(userRoom(member.id)).emit('conversation:new', conversation);
    }
  }

  // Every socket must send its JWT when connecting
  io.use((socket, next) => {
    const user = verifyToken(socket.handshake.auth?.token, jwtSecret);
    if (!user) return next(new Error('Not signed in'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const { user } = socket.data;
    socket.join(userRoom(user.id));
    for (const id of store.conversationIdsFor(user.id)) socket.join(convRoom(id));

    online.set(user.id, (online.get(user.id) ?? 0) + 1);
    if (online.get(user.id) === 1) io.emit('presence', { userId: user.id, online: true });

    socket.on('message:send', ({ conversationId, body } = {}, ack = () => {}) => {
      const text = String(body ?? '').trim();
      if (!text) return ack({ error: 'Message is empty' });
      if (text.length > MAX_MESSAGE_LENGTH) return ack({ error: 'Message is too long' });
      if (!store.isMember(Number(conversationId), user.id)) {
        return ack({ error: 'Conversation not found' });
      }
      const message = store.addMessage(Number(conversationId), user.id, text);
      io.to(convRoom(message.conversationId)).emit('message:new', message);
      ack({ message });
    });

    socket.on('typing', ({ conversationId, isTyping } = {}) => {
      if (!store.isMember(Number(conversationId), user.id)) return;
      socket.to(convRoom(Number(conversationId))).emit('typing', {
        conversationId: Number(conversationId),
        userId: user.id,
        username: user.username,
        isTyping: !!isTyping,
      });
    });

    socket.on('disconnect', () => {
      const left = (online.get(user.id) ?? 1) - 1;
      if (left > 0) return online.set(user.id, left);
      online.delete(user.id);
      io.emit('presence', { userId: user.id, online: false });
    });
  });

  return { app, httpServer, io };
}
