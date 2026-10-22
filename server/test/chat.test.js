import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createDb } from '../src/db.js';
import { createChatServer } from '../src/app.js';
// The same encryption code the browser uses, so these tests exercise real end-to-end encryption
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  backupPrivateKey,
  restorePrivateKey,
  generateConversationKey,
  wrapConversationKey,
  unwrapConversationKey,
  encryptMessage,
  decryptMessage,
} from '../../client/src/crypto.js';

let server;
let db;
let baseUrl;
const sockets = [];

before(async () => {
  db = createDb(':memory:');
  server = createChatServer({ db, jwtSecret: 'test-secret' });
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

/** Signs up the way the browser does: keys are made locally, only the locked backup is sent. */
async function signUp(username, password) {
  const pair = await generateKeyPair();
  const keys = {
    publicKey: await exportPublicKey(pair.publicKey),
    ...(await backupPrivateKey(pair.privateKey, password)),
  };
  const res = await api('/api/auth/register', { method: 'POST', body: { username, password, ...keys } });
  return { ...res, privateKey: pair.privateKey };
}

/** Logs in and unlocks the private key with the password, like the browser does. */
async function logIn(username, password) {
  const { data } = await api('/api/auth/login', { method: 'POST', body: { username, password } });
  return { ...data, privateKey: await restorePrivateKey(data.keyBackup, password) };
}

/** Makes a conversation key and wraps a copy for every member. */
async function wrapForAll(creatorPrivateKey, members) {
  const chatKey = await generateConversationKey();
  const keys = {};
  for (const m of members) {
    keys[m.id] = await wrapConversationKey(chatKey, creatorPrivateKey, await importPublicKey(m.publicKey));
  }
  return { chatKey, keys };
}

async function openKey(conversation, privateKey) {
  return unwrapConversationKey(
    conversation.key,
    privateKey,
    await importPublicKey(conversation.key.creatorPublicKey)
  );
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
const send = (socket, payload) => new Promise((resolve) => socket.emit('message:send', payload, resolve));

test('register validates input, requires keys and rejects duplicate usernames', async () => {
  assert.equal((await signUp('a', 'password1')).status, 400);
  assert.equal((await signUp('amara', 'short')).status, 400);
  const noKeys = await api('/api/auth/register', { method: 'POST', body: { username: 'amara', password: 'password1' } });
  assert.equal(noKeys.status, 400);

  const ok = await signUp('amara', 'password1');
  assert.equal(ok.status, 201);
  assert.ok(ok.data.token);
  assert.ok(ok.data.user.publicKey);

  assert.equal((await signUp('AMARA', 'password1')).status, 409);
});

test('login returns a key backup that only the right password opens', async () => {
  assert.equal((await api('/api/auth/login', { method: 'POST', body: { username: 'amara', password: 'wrong-pass' } })).status, 401);
  const { data } = await api('/api/auth/login', { method: 'POST', body: { username: 'amara', password: 'password1' } });
  assert.equal(data.user.username, 'amara');
  await assert.doesNotReject(restorePrivateKey(data.keyBackup, 'password1'));
  await assert.rejects(restorePrivateKey(data.keyBackup, 'password2'));
});

test('protected routes require a token', async () => {
  assert.equal((await api('/api/conversations')).status, 401);
});

test('two users chat with end-to-end encryption; the server never sees the text', async () => {
  const a = await logIn('amara', 'password1');
  const signup = await signUp('tunde', 'password2');
  const b = { ...signup.data, privateKey: signup.privateKey };

  const sa = await openSocket(a.token);
  const sb = await openSocket(b.token);

  // Amara starts a chat, wrapping the key for both of them
  const { keys } = await wrapForAll(a.privateKey, [a.user, b.user]);
  const newConv = once(sb, 'conversation:new');
  const created = await api('/api/conversations', { method: 'POST', token: a.token, body: { userId: b.user.id, keys } });
  assert.equal(created.status, 201);
  const convId = created.data.conversation.id;

  // Tunde is told about it live, with his own copy of the key
  const tundeConv = await newConv;
  assert.equal(tundeConv.id, convId);
  assert.equal(tundeConv.key.wrappedKey, keys[b.user.id].wrappedKey);
  const tundeKey = await openKey(tundeConv, b.privateKey);
  const amaraKey = await openKey(created.data.conversation, a.privateKey);

  // Starting the same direct chat again returns the existing one
  const again = await api('/api/conversations', { method: 'POST', token: a.token, body: { userId: b.user.id, keys } });
  assert.equal(again.data.conversation.id, convId);

  // Typing indicator reaches the other person
  const typing = once(sb, 'typing');
  sa.emit('typing', { conversationId: convId, isTyping: true });
  assert.deepEqual(await typing, { conversationId: convId, userId: a.user.id, username: 'amara', isTyping: true });

  // An encrypted message is delivered and Tunde can read it
  const secret = 'My test results came back fine 🎉';
  const received = once(sb, 'message:new');
  const ack = await send(sa, { conversationId: convId, ...(await encryptMessage(amaraKey, secret)) });
  assert.ok(ack.message);
  assert.equal(await decryptMessage(tundeKey, await received), secret);

  // Plain-text messages are refused
  const plain = await send(sa, { conversationId: convId, body: 'not encrypted' });
  assert.equal(plain.error, 'Message must be encrypted');

  // The database holds only scrambled data
  const stored = db.prepare('SELECT * FROM messages').all();
  assert.equal(stored.length, 1);
  assert.ok(!JSON.stringify(stored).includes('test results'));

  // History comes back encrypted and decrypts on the client
  const history = await api(`/api/conversations/${convId}/messages`, { token: b.token });
  assert.equal(await decryptMessage(tundeKey, history.data.messages[0]), secret);

  // The chat list preview is encrypted too
  const list = await api('/api/conversations', { token: b.token });
  assert.equal(await decryptMessage(tundeKey, list.data.conversations[0].lastMessage), secret);
});

test('a chat cannot be created without a key for every member', async () => {
  const a = await logIn('amara', 'password1');
  const signup = await signUp('kemi', 'password4');
  const { keys } = await wrapForAll(a.privateKey, [a.user]); // Kemi's copy is missing
  const res = await api('/api/conversations', { method: 'POST', token: a.token, body: { userId: signup.data.user.id, keys } });
  assert.equal(res.status, 400);
});

test('outsiders cannot read or post in a conversation', async () => {
  const a = await logIn('amara', 'password1');
  const c = (await signUp('chidi', 'password3')).data;
  const convId = (await api('/api/conversations', { token: a.token })).data.conversations[0].id;

  assert.equal((await api(`/api/conversations/${convId}/messages`, { token: c.token })).status, 404);

  const sc = await openSocket(c.token);
  const fake = { ciphertext: 'c25lYWt5', iv: 'aXZpdml2aXZpdml2' };
  const res = await send(sc, { conversationId: convId, ...fake });
  assert.equal(res.error, 'Conversation not found');
});

test('group chats include everyone, each with their own key', async () => {
  const a = await logIn('amara', 'password1');
  const users = (await api('/api/users?q=', { token: a.token })).data.users;
  assert.ok(users.every((u) => u.publicKey));
  const { keys } = await wrapForAll(a.privateKey, [a.user, ...users]);
  const res = await api('/api/conversations', {
    method: 'POST',
    token: a.token,
    body: { name: 'Study group', memberIds: users.map((u) => u.id), keys },
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.conversation.isGroup, true);
  assert.deepEqual(res.data.conversation.members.map((m) => m.username), ['amara', 'chidi', 'kemi', 'tunde']);

  // Chidi (logging in on a "new device") can unlock the group key
  const chidi = await logIn('chidi', 'password3');
  const group = (await api('/api/conversations', { token: chidi.token })).data.conversations.find((c) => c.isGroup);
  await assert.doesNotReject(openKey(group, chidi.privateKey));
});

test('sockets without a valid token are refused', async () => {
  await assert.rejects(openSocket('not-a-token'));
});
