import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';

export default function NewChatModal({ token, online, onCreated, onClose }) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [groupMode, setGroupMode] = useState(false);
  const [selected, setSelected] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [error, setError] = useState('');

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

  async function startDirect(userId) {
    try {
      const data = await api('/api/conversations', { method: 'POST', token, body: { userId } });
      onCreated(data.conversation);
    } catch (err) {
      setError(err.message);
    }
  }

  async function createGroup(e) {
    e.preventDefault();
    try {
      const data = await api('/api/conversations', {
        method: 'POST',
        token,
        body: { name: groupName, memberIds: selected },
      });
      onCreated(data.conversation);
    } catch (err) {
      setError(err.message);
    }
  }

  const toggle = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

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
                className={`user-row ${selected.includes(u.id) ? 'selected' : ''}`}
                onClick={() => (groupMode ? toggle(u.id) : startDirect(u.id))}
              >
                <Avatar name={u.username} online={online.has(u.id)} />
                <span>{u.username}</span>
                {groupMode && <span className="check">{selected.includes(u.id) ? '✓' : ''}</span>}
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
            <button className="primary" disabled={selected.length === 0 || !groupName.trim()}>
              Create group ({selected.length})
            </button>
          </form>
        )}

        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
