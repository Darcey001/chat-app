import Database from 'better-sqlite3';

// Bump this when the table layout changes. Version 2 added end-to-end encryption.
const SCHEMA_VERSION = 2;

/**
 * Opens (or creates) the SQLite database and makes sure the tables exist.
 * Pass ':memory:' for an in-memory database (used by the tests).
 */
export function createDb(file = 'chat.db') {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Older databases stored messages as plain text; they can't be converted, so start fresh.
  if (db.pragma('user_version', { simple: true }) < SCHEMA_VERSION) {
    db.exec(`
      DROP TABLE IF EXISTS messages;
      DROP TABLE IF EXISTS conversation_members;
      DROP TABLE IF EXISTS conversations;
      DROP TABLE IF EXISTS users;
    `);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      username              TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      password_hash         TEXT    NOT NULL,
      public_key            TEXT    NOT NULL,  -- ECDH public key (base64 SPKI)
      encrypted_private_key TEXT    NOT NULL,  -- private key, encrypted in the browser with the user's password
      key_salt              TEXT    NOT NULL,
      key_iv                TEXT    NOT NULL,
      created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT,                       -- only used for group chats
      is_group   INTEGER NOT NULL DEFAULT 0,
      creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Each member gets their own copy of the conversation key, encrypted just for them
    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      wrapped_key     TEXT    NOT NULL,
      wrapped_key_iv  TEXT    NOT NULL,
      PRIMARY KEY (conversation_id, user_id)
    );

    -- The server only ever sees encrypted message bodies
    CREATE TABLE IF NOT EXISTS messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ciphertext      TEXT    NOT NULL,
      iv              TEXT    NOT NULL,
      created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages (conversation_id, id);
  `);

  return db;
}
