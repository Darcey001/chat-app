/**
 * All database queries live here, so routes and socket handlers stay small.
 * Note: message bodies and conversation keys are encrypted in the browser —
 * this file only ever handles scrambled data.
 */
export function createStore(db) {
  const membersOf = db.prepare(`
    SELECT u.id, u.username, u.public_key AS publicKey
    FROM conversation_members cm JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ?
    ORDER BY u.username
  `);

  /** A conversation as one particular member sees it, including their own copy of the key. */
  const conversationForUser = db.prepare(`
    SELECT c.id, c.name, c.is_group AS isGroup, c.created_at AS createdAt,
           creator.public_key AS creatorPublicKey,
           cm.wrapped_key AS wrappedKey, cm.wrapped_key_iv AS wrappedKeyIv,
           m.ciphertext AS lastCiphertext, m.iv AS lastIv, m.created_at AS lastMessageAt
    FROM conversations c
    JOIN users creator ON creator.id = c.creator_id
    JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
    LEFT JOIN messages m ON m.id = (
      SELECT id FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1
    )
    WHERE (? IS NULL OR c.id = ?)
    ORDER BY COALESCE(m.created_at, c.created_at) DESC
  `);

  const shape = (row) => ({
    id: row.id,
    name: row.name,
    isGroup: !!row.isGroup,
    members: membersOf.all(row.id),
    key: { wrappedKey: row.wrappedKey, iv: row.wrappedKeyIv, creatorPublicKey: row.creatorPublicKey },
    lastMessage: row.lastCiphertext ? { ciphertext: row.lastCiphertext, iv: row.lastIv } : null,
    lastMessageAt: row.lastMessageAt,
  });

  const messageSelect = `
    SELECT m.id, m.conversation_id AS conversationId, m.ciphertext, m.iv,
           m.created_at AS createdAt, u.id AS userId, u.username
    FROM messages m JOIN users u ON u.id = m.user_id`;

  return {
    createUser({ username, passwordHash, publicKey, encryptedPrivateKey, keySalt, keyIv }) {
      const info = db
        .prepare(
          `INSERT INTO users (username, password_hash, public_key, encrypted_private_key, key_salt, key_iv)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(username, passwordHash, publicKey, encryptedPrivateKey, keySalt, keyIv);
      return { id: Number(info.lastInsertRowid), username, publicKey };
    },

    findUserByUsername(username) {
      return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    },

    searchUsers(query, excludeUserId) {
      return db
        .prepare(
          `SELECT id, username, public_key AS publicKey FROM users
           WHERE username LIKE ? AND id != ?
           ORDER BY username LIMIT 20`
        )
        .all(`%${query}%`, excludeUserId);
    },

    isMember(conversationId, userId) {
      return !!db
        .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
        .get(conversationId, userId);
    },

    /** The conversation as seen by `userId` (null if they aren't a member). */
    getConversation(conversationId, userId) {
      const row = conversationForUser.get(userId, conversationId, conversationId);
      return row ? shape(row) : null;
    },

    listConversations(userId) {
      return conversationForUser.all(userId, null, null).map(shape);
    },

    memberIds(conversationId) {
      return db
        .prepare('SELECT user_id AS id FROM conversation_members WHERE conversation_id = ?')
        .all(conversationId)
        .map((r) => r.id);
    },

    /** Returns the existing one-to-one chat between two users, if any. */
    findDirectConversation(userA, userB) {
      return db
        .prepare(
          `SELECT c.id FROM conversations c
           JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
           JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
           WHERE c.is_group = 0`
        )
        .get(userA, userB);
    },

    /** `keys` maps each member's user id to { wrappedKey, iv }. */
    createConversation({ name = null, isGroup, creatorId, keys }) {
      const tx = db.transaction(() => {
        const info = db
          .prepare('INSERT INTO conversations (name, is_group, creator_id) VALUES (?, ?, ?)')
          .run(name, isGroup ? 1 : 0, creatorId);
        const id = Number(info.lastInsertRowid);
        const addMember = db.prepare(
          `INSERT INTO conversation_members (conversation_id, user_id, wrapped_key, wrapped_key_iv)
           VALUES (?, ?, ?, ?)`
        );
        for (const [userId, k] of keys) addMember.run(id, userId, k.wrappedKey, k.iv);
        return id;
      });
      return tx();
    },

    userIdsExist(ids) {
      if (ids.length === 0) return true;
      const placeholders = ids.map(() => '?').join(',');
      const row = db
        .prepare(`SELECT COUNT(*) AS n FROM users WHERE id IN (${placeholders})`)
        .get(...ids);
      return row.n === new Set(ids).size;
    },

    addMessage(conversationId, userId, { ciphertext, iv }) {
      const info = db
        .prepare('INSERT INTO messages (conversation_id, user_id, ciphertext, iv) VALUES (?, ?, ?, ?)')
        .run(conversationId, userId, ciphertext, iv);
      return db.prepare(`${messageSelect} WHERE m.id = ?`).get(Number(info.lastInsertRowid));
    },

    /** Newest `limit` messages, optionally older than message id `before` (for paging). */
    listMessages(conversationId, { before, limit = 50 } = {}) {
      return db
        .prepare(
          `${messageSelect}
           WHERE m.conversation_id = ? AND (? IS NULL OR m.id < ?)
           ORDER BY m.id DESC LIMIT ?`
        )
        .all(conversationId, before ?? null, before ?? null, limit)
        .reverse();
    },

    conversationIdsFor(userId) {
      return db
        .prepare('SELECT conversation_id AS id FROM conversation_members WHERE user_id = ?')
        .all(userId)
        .map((r) => r.id);
    },
  };
}
