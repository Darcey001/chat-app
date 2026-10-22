/**
 * All database queries live here, so routes and socket handlers stay small.
 */
export function createStore(db) {
  const conversationSummary = db.prepare(`
    SELECT c.id, c.name, c.is_group AS isGroup,
           m.body AS lastMessage, m.created_at AS lastMessageAt
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
    LEFT JOIN messages m ON m.id = (
      SELECT id FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1
    )
    ORDER BY COALESCE(m.created_at, c.created_at) DESC
  `);

  const membersOf = db.prepare(`
    SELECT u.id, u.username
    FROM conversation_members cm JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ?
    ORDER BY u.username
  `);

  return {
    createUser(username, passwordHash) {
      const info = db
        .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
        .run(username, passwordHash);
      return { id: Number(info.lastInsertRowid), username };
    },

    findUserByUsername(username) {
      return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    },

    searchUsers(query, excludeUserId) {
      return db
        .prepare(
          `SELECT id, username FROM users
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

    getMembers(conversationId) {
      return membersOf.all(conversationId);
    },

    getConversation(conversationId) {
      const c = db
        .prepare('SELECT id, name, is_group AS isGroup FROM conversations WHERE id = ?')
        .get(conversationId);
      if (!c) return null;
      return { ...c, isGroup: !!c.isGroup, members: membersOf.all(c.id) };
    },

    listConversations(userId) {
      return conversationSummary.all(userId).map((c) => ({
        ...c,
        isGroup: !!c.isGroup,
        members: membersOf.all(c.id),
      }));
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

    createConversation({ name = null, isGroup, memberIds }) {
      const tx = db.transaction(() => {
        const info = db
          .prepare('INSERT INTO conversations (name, is_group) VALUES (?, ?)')
          .run(name, isGroup ? 1 : 0);
        const id = Number(info.lastInsertRowid);
        const addMember = db.prepare(
          'INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)'
        );
        for (const userId of new Set(memberIds)) addMember.run(id, userId);
        return id;
      });
      return this.getConversation(tx());
    },

    userIdsExist(ids) {
      if (ids.length === 0) return true;
      const placeholders = ids.map(() => '?').join(',');
      const row = db
        .prepare(`SELECT COUNT(*) AS n FROM users WHERE id IN (${placeholders})`)
        .get(...ids);
      return row.n === new Set(ids).size;
    },

    addMessage(conversationId, userId, body) {
      const info = db
        .prepare('INSERT INTO messages (conversation_id, user_id, body) VALUES (?, ?, ?)')
        .run(conversationId, userId, body);
      return this.getMessage(Number(info.lastInsertRowid));
    },

    getMessage(id) {
      return db
        .prepare(
          `SELECT m.id, m.conversation_id AS conversationId, m.body, m.created_at AS createdAt,
                  u.id AS userId, u.username
           FROM messages m JOIN users u ON u.id = m.user_id
           WHERE m.id = ?`
        )
        .get(id);
    },

    /** Newest `limit` messages, optionally older than message id `before` (for paging). */
    listMessages(conversationId, { before, limit = 50 } = {}) {
      const rows = db
        .prepare(
          `SELECT m.id, m.conversation_id AS conversationId, m.body, m.created_at AS createdAt,
                  u.id AS userId, u.username
           FROM messages m JOIN users u ON u.id = m.user_id
           WHERE m.conversation_id = ? AND (? IS NULL OR m.id < ?)
           ORDER BY m.id DESC LIMIT ?`
        )
        .all(conversationId, before ?? null, before ?? null, limit);
      return rows.reverse();
    },

    conversationIdsFor(userId) {
      return db
        .prepare('SELECT conversation_id AS id FROM conversation_members WHERE user_id = ?')
        .all(userId)
        .map((r) => r.id);
    },
  };
}
