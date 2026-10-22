import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import { conversationTitle } from '../conversation.js';
import { formatClock } from '../time.js';

const TYPING_TIMEOUT_MS = 2000;

export default function ChatWindow({
  me,
  conversation,
  messages,
  online,
  typingUsers,
  onSend,
  onTyping,
  onBack,
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const bottomRef = useRef(null);
  const typingTimer = useRef(null);
  const isTyping = useRef(false);

  const title = conversationTitle(conversation, me);
  const other = !conversation.isGroup && conversation.members.find((m) => m.id !== me.id);
  const subtitle = conversation.isGroup
    ? conversation.members.map((m) => (m.id === me.id ? 'You' : m.username)).join(', ')
    : other && online.has(other.id)
      ? 'Online'
      : 'Offline';

  // Keep the newest message in view
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length, typingUsers.length]);

  // Stop "typing…" when leaving the conversation
  useEffect(
    () => () => {
      clearTimeout(typingTimer.current);
      if (isTyping.current) onTyping(false);
    },
    [onTyping]
  );

  function handleChange(e) {
    setDraft(e.target.value);
    if (!isTyping.current) {
      isTyping.current = true;
      onTyping(true);
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      isTyping.current = false;
      onTyping(false);
    }, TYPING_TIMEOUT_MS);
  }

  async function submit(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    setError('');
    clearTimeout(typingTimer.current);
    isTyping.current = false;
    try {
      await onSend(body);
    } catch (err) {
      setError(err.message);
      setDraft(body);
    }
  }

  return (
    <main className="chat">
      <header className="chat-header">
        <button className="icon-btn back" onClick={onBack} aria-label="Back to chats">
          ←
        </button>
        <Avatar name={title} group={conversation.isGroup} online={other && online.has(other.id)} />
        <div className="ellipsis">
          <strong>{title}</strong>
          <div className="muted small ellipsis">{subtitle}</div>
        </div>
      </header>

      <div className="messages">
        <p className="e2e-note">
          🔒 Messages are end-to-end encrypted. No one outside this chat, not even the server,
          can read them.
        </p>
        {!messages && <p className="muted center">Loading…</p>}
        {messages?.length === 0 && <p className="muted center">Say hello 👋</p>}
        {messages?.map((m, i) => {
          const mine = m.userId === me.id;
          const showName = conversation.isGroup && !mine && messages[i - 1]?.userId !== m.userId;
          return (
            <div key={m.id} className={`bubble-row ${mine ? 'mine' : ''}`}>
              <div className="bubble">
                {showName && <div className="sender">{m.username}</div>}
                <span className="body">{m.body}</span>
                <span className="time">{formatClock(m.createdAt)}</span>
              </div>
            </div>
          );
        })}
        {typingUsers.length > 0 && (
          <div className="typing-indicator muted small">
            {typingUsers.join(', ')} {typingUsers.length > 1 ? 'are' : 'is'} typing
            <span className="dots"><span /><span /><span /></span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p className="error composer-error" role="alert">{error}</p>}
      <form className="composer" onSubmit={submit}>
        <input
          value={draft}
          onChange={handleChange}
          placeholder="Type a message"
          maxLength={2000}
          autoFocus
          aria-label="Message"
        />
        <button className="primary send" disabled={!draft.trim()} aria-label="Send">
          ➤
        </button>
      </form>
    </main>
  );
}
