import Avatar from './Avatar.jsx';
import { conversationTitle } from '../conversation.js';
import { formatTime } from '../time.js';

export default function Sidebar({
  me,
  conversations,
  activeId,
  online,
  typing,
  connected,
  onSelect,
  onNewChat,
  onLogout,
}) {
  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="me">
          <Avatar name={me.username} online={connected} />
          <div>
            <strong>{me.username}</strong>
            <div className="muted small">{connected ? 'Online' : 'Connecting…'}</div>
          </div>
        </div>
        <div className="header-actions">
          <button className="icon-btn" onClick={onNewChat} title="New chat" aria-label="New chat">
            ✏️
          </button>
          <button className="icon-btn" onClick={onLogout} title="Log out" aria-label="Log out">
            ⎋
          </button>
        </div>
      </header>

      <ul className="conversation-list">
        {conversations.length === 0 && (
          <li className="muted small padded">No chats yet. Tap ✏️ to start one.</li>
        )}
        {conversations.map((c) => {
          const title = conversationTitle(c, me);
          const other = !c.isGroup && c.members.find((m) => m.id !== me.id);
          const typers = Object.values(typing[c.id] ?? {});
          return (
            <li key={c.id}>
              <button
                className={`conversation ${c.id === activeId ? 'active' : ''}`}
                onClick={() => onSelect(c.id)}
              >
                <Avatar name={title} group={c.isGroup} online={other && online.has(other.id)} />
                <span className="conversation-text">
                  <span className="row">
                    <strong className="ellipsis">{title}</strong>
                    {c.lastMessageAt && (
                      <span className="muted small">{formatTime(c.lastMessageAt)}</span>
                    )}
                  </span>
                  <span className={`ellipsis small ${typers.length ? 'typing-text' : 'muted'}`}>
                    {typers.length ? 'typing…' : c.preview ?? 'No messages yet'}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
