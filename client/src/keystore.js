/**
 * Keeps each user's unlocked private key in this browser's IndexedDB.
 * The key is stored as a non-extractable CryptoKey, so page scripts can use it
 * but can't read out its raw bytes.
 */

const DB_NAME = 'chatter-keys';
const STORE = 'keys';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export function savePrivateKey(userId, key) {
  return run('readwrite', (store) => store.put(key, String(userId)));
}

export async function loadPrivateKey(userId) {
  try {
    return (await run('readonly', (store) => store.get(String(userId)))) ?? null;
  } catch {
    return null; // e.g. private browsing with storage disabled
  }
}

export function deletePrivateKey(userId) {
  return run('readwrite', (store) => store.delete(String(userId))).catch(() => {});
}
