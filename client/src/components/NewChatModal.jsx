import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { generateConversationKey, importPublicKey, wrapConversationKey } from '../crypto.js';
import Avatar from './Avatar.jsx';

/**
 * Creates a fresh key for the new chat and encrypts a copy of it for every member
 * (including me), so only the members can ever read the messages.
 */
async function keysForMembers(privateKey, members) {
  const chatKey = await generateConversationKey();
  const keys = {};
  for (const member of members) {
    keys[member.id] = await wrapConversationKey(
      chatKey,
      privateKey,
      await importPublicKey(member.publicKey)
    );
  }
  return keys;
}

export default function NewChatModal({ me, token, privateKey, online, onCreated, onClose }) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [groupMode, setGroupMode] = useState(false);
  const [selected, setSelected] = useState([]); // user objects
  const [groupName, setGroupName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Search users as you type (with a short delay)
  useEffect(() => {
    const t = setTimeout(() => {
      api(`/api/users?q=${encodeURIComponent(query)}`, { token })
        .then((data) => setUsers(data.users))
        .catch((err) => setError(err.message));
    }, 200);
    return () => clearTimeout(t);
  }, [query, token]);

  // Close with Escape
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function create(body, members) {
    setBusy(true);
    setError('');
    try {
      const keys = await keysForMembers(privateKey, [me, ...members]);
      const data = await api('/api/conversations', { method: 'POST', token, body: { ...body, keys } });
      onCreated(data.conversation);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const startDirect = (user) => create({ userId: user.id }, [user]);

  function createGroup(e) {
    e.preventDefault();
    create({ name: groupName, memberIds: selected.map((u) => u.id) }, selected);
  }

  const isSelected = (id) => selected.some((u) => u.id === id);
  const toggle = (user) =>
    setSelected((prev) =>
      isSelected(user.id) ? prev.filter((u) => u.id !== user.id) : [...prev, user]
    );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="New chat" onClick={(e) => e.stopPropagation()}>
        <header className="row">
          <h3>{groupMode ? 'New group' : 'New chat'}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="tabs">
          <button className={!groupMode ? 'tab active' : 'tab'} onClick={() => setGroupMode(false)}>
            Direct message
          </button>
          <button className={groupMode ? 'tab active' : 'tab'} onClick={() => setGroupMode(true)}>
            Group
          </button>
        </div>

        <input
          placeholder="Search people"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        <ul className="user-list">
          {users.length === 0 && (
            <li className="muted small padded">No one found. Ask a friend to sign up!</li>
          )}
          {users.map((u) => (
            <li key={u.id}>
              <button
                className={`user-row ${isSelected(u.id) ? 'selected' : ''}`}
                onClick={() => (groupMode ? toggle(u) : startDirect(u))}
                disabled={busy}
              >
                <Avatar name={u.username} online={online.has(u.id)} />
                <span>{u.username}</span>
                {groupMode && <span className="check">{isSelected(u.id) ? '✓' : ''}</span>}
              </button>
            </li>
          ))}
        </ul>

        {groupMode && (
          <form className="group-form" onSubmit={createGroup}>
            <input
              placeholder="Group name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              maxLength={50}
              required
            />
            <button className="primary" disabled={busy || selected.length === 0 || !groupName.trim()}>
              Create group ({selected.length})
            </button>
          </form>
        )}

        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
