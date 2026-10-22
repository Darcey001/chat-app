import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createDb } from '../src/db.js';
import { createChatServer } from '../src/app.js';

let server;
let baseUrl;
const sockets = [];

before(async () => {
  server = createChatServer({ db: createDb(':memory:'), jwtSecret: 'test-secret' });
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${server.httpServer.address().port}`;
});

after(async () => {
  sockets.forEach((s) => s.close());
  server.io.close();
});

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

function openSocket(token) {
  return new Promise((resolve, reject) => {
    const s = connect(baseUrl, { auth: { token }, transports: ['websocket'] });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));

test('register validates input and rejects duplicate usernames', async () => {
  assert.equal((await api('/api/auth/register', { method: 'POST', body: { username: 'a', password: 'password1' } })).status, 400);
  assert.equal((await api('/api/auth/register', { method: 'POST', body: { username: 'amara', password: 'short' } })).status, 400);

  const ok = await api('/api/auth/register', { method: 'POST', body: { username: 'amara', password: 'password1' } });
  assert.equal(ok.status, 201);
  assert.ok(ok.data.token);

  const dup = await api('/api/auth/register', { method: 'POST', body: { username: 'AMARA', password: 'password1' } });
  assert.equal(dup.status, 409);
});

test('login works with the right password only', async () => {
  assert.equal((await api('/api/auth/login', { method: 'POST', body: { username: 'amara', password: 'wrong-pass' } })).status, 401);
  const ok = await api('/api/auth/login', { method: 'POST', body: { username: 'amara', password: 'password1' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.username, 'amara');
});

test('protected routes require a token', async () => {
  assert.equal((await api('/api/conversations')).status, 401);
});

test('two users can chat in real time, with typing indicators and history', async () => {
  const a = (await api('/api/auth/login', { method: 'POST', body: { username: 'amara', password: 'password1' } })).data;
  const b = (await api('/api/auth/register', { method: 'POST', body: { username: 'tunde', password: 'password2' } })).data;

  const sa = await openSocket(a.token);
  const sb = await openSocket(b.token);

  // Amara starts a direct chat; Tunde is told about it live
  const newConv = once(sb, 'conversation:new');
  const created = await api('/api/conversations', { method: 'POST', token: a.token, body: { userId: b.user.id } });
  assert.equal(created.status, 201);
  const convId = created.data.conversation.id;
  assert.equal((await newConv).id, convId);

  // Starting the same direct chat again returns the existing one
  const again = await api('/api/conversations', { method: 'POST', token: a.token, body: { userId: b.user.id } });
  assert.equal(again.data.conversation.id, convId);

  // Typing indicator reaches the other person
  const typing = once(sb, 'typing');
  sa.emit('typing', { conversationId: convId, isTyping: true });
  assert.deepEqual(await typing, { conversationId: convId, userId: a.user.id, username: 'amara', isTyping: true });

  // Message is delivered to both sides
  const received = once(sb, 'message:new');
  const ack = await new Promise((resolve) => sa.emit('message:send', { conversationId: convId, body: 'Hi Tunde!' }, resolve));
  assert.equal(ack.message.body, 'Hi Tunde!');
  assert.equal((await received).body, 'Hi Tunde!');

  // Empty messages are rejected
  const bad = await new Promise((resolve) => sa.emit('message:send', { conversationId: convId, body: '   ' }, resolve));
  assert.ok(bad.error);

  // History is saved
  const history = await api(`/api/conversations/${convId}/messages`, { token: b.token });
  assert.deepEqual(history.data.messages.map((m) => m.body), ['Hi Tunde!']);

  // Conversation list shows the last message
  const list = await api('/api/conversations', { token: b.token });
  assert.equal(list.data.conversations[0].lastMessage, 'Hi Tunde!');
});

test('outsiders cannot read or post in a conversation', async () => {
  const a = (await api('/api/auth/login', { method: 'POST', body: { username: 'amara', password: 'password1' } })).data;
  const c = (await api('/api/auth/register', { method: 'POST', body: { username: 'chidi', password: 'password3' } })).data;
  const convId = (await api('/api/conversations', { token: a.token })).data.conversations[0].id;

  assert.equal((await api(`/api/conversations/${convId}/messages`, { token: c.token })).status, 404);

  const sc = await openSocket(c.token);
  const res = await new Promise((resolve) => sc.emit('message:send', { conversationId: convId, body: 'sneaky' }, resolve));
  assert.equal(res.error, 'Conversation not found');
});

test('group chats include everyone', async () => {
  const a = (await api('/api/auth/login', { method: 'POST', body: { username: 'amara', password: 'password1' } })).data;
  const users = (await api('/api/users?q=', { token: a.token })).data.users;
  const res = await api('/api/conversations', {
    method: 'POST',
    token: a.token,
    body: { name: 'Study group', memberIds: users.map((u) => u.id) },
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.conversation.isGroup, true);
  assert.deepEqual(res.data.conversation.members.map((m) => m.username), ['amara', 'chidi', 'tunde']);
});

test('sockets without a valid token are refused', async () => {
  await assert.rejects(openSocket('not-a-token'));
});
