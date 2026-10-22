/**
 * End-to-end encryption helpers, built on the browser's Web Crypto API.
 *
 * How it works:
 * 1. Every user has an ECDH key pair (P-256), created in their own browser at sign-up.
 *    The public key goes to the server; the private key never leaves the device unencrypted.
 * 2. So you can log in on another device, the private key is backed up to the server
 *    encrypted with a key derived from your password (PBKDF2, 600,000 rounds).
 * 3. Every conversation has its own random AES-256-GCM key. The person who starts the chat
 *    "wraps" (encrypts) that key separately for each member, using ECDH between their own
 *    private key and the member's public key.
 * 4. Messages are encrypted with the conversation key before they are sent.
 *    The server only ever stores and forwards scrambled bytes.
 *
 * Works in modern browsers and in Node 20+ (used by the tests).
 */

const subtle = globalThis.crypto.subtle;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const PBKDF2_ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------- base64 helpers ----------

export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// ---------- user key pairs ----------

/** Creates a new identity key pair. The private key is extractable only so it can be backed up. */
export function generateKeyPair() {
  return subtle.generateKey(ECDH, true, ['deriveKey']);
}

export async function exportPublicKey(publicKey) {
  return toBase64(await subtle.exportKey('spki', publicKey));
}

export function importPublicKey(b64) {
  return subtle.importKey('spki', fromBase64(b64), ECDH, true, []);
}

async function passwordKey(password, salt) {
  const base = await subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Encrypts the private key with the user's password, so it can be stored on the server. */
export async function backupPrivateKey(privateKey, password) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const pkcs8 = await subtle.exportKey('pkcs8', privateKey);
  const encrypted = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    await passwordKey(password, salt),
    pkcs8
  );
  return { encryptedPrivateKey: toBase64(encrypted), keySalt: toBase64(salt), keyIv: toBase64(iv) };
}

/** Unlocks a backed-up private key. The result can't be exported again. Throws on a wrong password. */
export async function restorePrivateKey({ encryptedPrivateKey, keySalt, keyIv }, password) {
  const pkcs8 = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(keyIv) },
    await passwordKey(password, fromBase64(keySalt)),
    fromBase64(encryptedPrivateKey)
  );
  return subtle.importKey('pkcs8', pkcs8, ECDH, false, ['deriveKey']);
}

// ---------- conversation keys ----------

/** A shared AES key between me and another user, worked out from my private key and their public key. */
function sharedWrappingKey(myPrivateKey, theirPublicKey) {
  return subtle.deriveKey(
    { name: 'ECDH', public: theirPublicKey },
    myPrivateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function generateConversationKey() {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/**
 * Encrypts a conversation key for one member.
 * Only that member (with their private key) and the creator can unwrap it.
 */
export async function wrapConversationKey(conversationKey, creatorPrivateKey, memberPublicKey) {
  const iv = randomBytes(12);
  const raw = await subtle.exportKey('raw', conversationKey);
  const wrapped = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    await sharedWrappingKey(creatorPrivateKey, memberPublicKey),
    raw
  );
  return { wrappedKey: toBase64(wrapped), iv: toBase64(iv) };
}

/** Recovers the conversation key from what the creator wrapped for me. */
export async function unwrapConversationKey({ wrappedKey, iv }, myPrivateKey, creatorPublicKey) {
  const raw = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) },
    await sharedWrappingKey(myPrivateKey, creatorPublicKey),
    fromBase64(wrappedKey)
  );
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// ---------- messages ----------

export async function encryptMessage(conversationKey, text) {
  const iv = randomBytes(12);
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    conversationKey,
    encoder.encode(text)
  );
  return { ciphertext: toBase64(ciphertext), iv: toBase64(iv) };
}

/** Returns the plain text, or throws if the message was tampered with or the key is wrong. */
export async function decryptMessage(conversationKey, { ciphertext, iv }) {
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) },
    conversationKey,
    fromBase64(ciphertext)
  );
  return decoder.decode(plain);
}
