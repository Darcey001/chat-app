import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, API_URL } from '../api.js';
import Sidebar from './Sidebar.jsx';
import ChatWindow from './ChatWindow.jsx';
import NewChatModal from './NewChatModal.jsx';

export default function ChatLayout({ session, onLogout }) {
  const { user: me, token } = session;
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState({}); // conversationId -> message[]
  const [online, setOnline] = useState(new Set());
  const [typing, setTyping] = useState({}); // conversationId -> { userId: username }
  const [showNewChat, setShowNewChat] = useState(false);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  // Load conversations once
  useEffect(() => {
    api('/api/conversations', { token })
      .then((data) => {
        setConversations(data.conversations);
        setOnline(new Set(data.online));
      })
      .catch(onLogout); // token expired or invalid
  }, [token, onLogout]);

  // Real-time connection
  useEffect(() => {
    const socket = io(API_URL, { auth: { token } });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err) => {
      if (err.message === 'Not signed in') onLogout();
    });

    socket.on('message:new', (message) => {
      setMessages((prev) =>
        prev[message.conversationId]
          ? {
              ...prev,
              [message.conversationId]: prev[message.conversationId].some((m) => m.id === message.id)
                ? prev[message.conversationId]
                : [...prev[message.conversationId], message],
            }
          : prev
      );
      // Move the conversation to the top with its new preview
      setConversations((prev) => {
        const conv = prev.find((c) => c.id === message.conversationId);
        if (!conv) return prev;
        const updated = { ...conv, lastMessage: message.body, lastMessageAt: message.createdAt };
        return [updated, ...prev.filter((c) => c.id !== conv.id)];
      });
      // Someone who just sent a message is no longer typing
      setTyping((prev) => {
        const forConv = { ...(prev[message.conversationId] ?? {}) };
        delete forConv[message.userId];
        return { ...prev, [message.conversationId]: forConv };
      });
    });

    socket.on('conversation:new', (conversation) => {
      setConversations((prev) =>
        prev.some((c) => c.id === conversation.id) ? prev : [conversation, ...prev]
      );
    });

    socket.on('presence', ({ userId, online: isOnline }) => {
      setOnline((prev) => {
        const next = new Set(prev);
        isOnline ? next.add(userId) : next.delete(userId);
        return next;
      });
    });

    socket.on('typing', ({ conversationId, userId, username, isTyping }) => {
      setTyping((prev) => {
        const forConv = { ...(prev[conversationId] ?? {}) };
        if (isTyping) forConv[userId] = username;
        else delete forConv[userId];
        return { ...prev, [conversationId]: forConv };
      });
    });

    return () => socket.disconnect();
  }, [token, onLogout]);

  // Load history the first time a conversation is opened
  useEffect(() => {
    if (!activeId || messages[activeId]) return;
    api(`/api/conversations/${activeId}/messages`, { token }).then((data) =>
      setMessages((prev) => ({ ...prev, [activeId]: data.messages }))
    );
  }, [activeId, messages, token]);

  const sendMessage = useCallback(
    (body) =>
      new Promise((resolve, reject) => {
        socketRef.current.emit('message:send', { conversationId: activeId, body }, (res) =>
          res.error ? reject(new Error(res.error)) : resolve(res.message)
        );
      }),
    [activeId]
  );

  const sendTyping = useCallback(
    (isTyping) => socketRef.current?.emit('typing', { conversationId: activeId, isTyping }),
    [activeId]
  );

  const handleCreated = (conversation) => {
    setConversations((prev) =>
      prev.some((c) => c.id === conversation.id) ? prev : [conversation, ...prev]
    );
    setActiveId(conversation.id);
    setShowNewChat(false);
  };

  const active = conversations.find((c) => c.id === activeId);

  return (
    <div className={`app ${active ? 'has-active' : ''}`}>
      <Sidebar
        me={me}
        conversations={conversations}
        activeId={activeId}
        online={online}
        typing={typing}
        connected={connected}
        onSelect={setActiveId}
        onNewChat={() => setShowNewChat(true)}
        onLogout={onLogout}
      />
      {active ? (
        <ChatWindow
          key={active.id}
          me={me}
          conversation={active}
          messages={messages[active.id]}
          online={online}
          typingUsers={Object.values(typing[active.id] ?? {})}
          onSend={sendMessage}
          onTyping={sendTyping}
          onBack={() => setActiveId(null)}
        />
      ) : (
        <main className="empty-state">
          <h2>Welcome, {me.username} 👋</h2>
          <p className="muted">Pick a conversation or start a new one.</p>
          <button className="primary" onClick={() => setShowNewChat(true)}>
            New chat
          </button>
        </main>
      )}
      {showNewChat && (
        <NewChatModal
          token={token}
          online={online}
          onCreated={handleCreated}
          onClose={() => setShowNewChat(false)}
        />
      )}
    </div>
  );
}
