import { test } from 'node:test';
import assert from 'node:assert/strict';
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
} from '../src/crypto.js';

/** Simulates signing up: makes keys and a password-protected backup. */
async function newUser(password) {
  const pair = await generateKeyPair();
  const publicKey = await exportPublicKey(pair.publicKey);
  const backup = await backupPrivateKey(pair.privateKey, password);
  return { publicKey, backup, privateKey: await restorePrivateKey(backup, password) };
}

test('a private key backup only opens with the right password', async () => {
  const pair = await generateKeyPair();
  const backup = await backupPrivateKey(pair.privateKey, 'correct horse');
  await assert.doesNotReject(restorePrivateKey(backup, 'correct horse'));
  await assert.rejects(restorePrivateKey(backup, 'wrong password'));
});

test('members can read a chat, outsiders cannot', async () => {
  const amara = await newUser('amara-pass');
  const tunde = await newUser('tunde-pass');
  const chidi = await newUser('chidi-pass');

  // Amara starts a chat with Tunde and wraps the chat key for both of them
  const chatKey = await generateConversationKey();
  const forTunde = await wrapConversationKey(chatKey, amara.privateKey, await importPublicKey(tunde.publicKey));
  const forAmara = await wrapConversationKey(chatKey, amara.privateKey, await importPublicKey(amara.publicKey));

  const sent = await encryptMessage(chatKey, 'Hi Tunde! 👋🏾');
  assert.ok(!sent.ciphertext.includes('Tunde'), 'ciphertext must not contain the text');

  // Tunde unwraps with his own private key and Amara's public key
  const amaraPub = await importPublicKey(amara.publicKey);
  const tundeKey = await unwrapConversationKey(forTunde, tunde.privateKey, amaraPub);
  assert.equal(await decryptMessage(tundeKey, sent), 'Hi Tunde! 👋🏾');

  // Amara can read it on another device too
  const amaraKey = await unwrapConversationKey(forAmara, amara.privateKey, amaraPub);
  assert.equal(await decryptMessage(amaraKey, sent), 'Hi Tunde! 👋🏾');

  // Chidi intercepts the wrapped key but can't open it
  await assert.rejects(unwrapConversationKey(forTunde, chidi.privateKey, amaraPub));
});

test('tampered messages are rejected', async () => {
  const key = await generateConversationKey();
  const msg = await encryptMessage(key, 'transfer 10 euros');
  const bytes = Buffer.from(msg.ciphertext, 'base64');
  bytes[0] ^= 1;
  await assert.rejects(decryptMessage(key, { ...msg, ciphertext: bytes.toString('base64') }));
});

test('the same text encrypts differently every time', async () => {
  const key = await generateConversationKey();
  const a = await encryptMessage(key, 'hello');
  const b = await encryptMessage(key, 'hello');
  assert.notEqual(a.ciphertext, b.ciphertext);
});
