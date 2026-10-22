import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, API_URL } from '../api.js';
import {
  importPublicKey,
  unwrapConversationKey,
  encryptMessage,
  decryptMessage,
} from '../crypto.js';
import Sidebar from './Sidebar.jsx';
import ChatWindow from './ChatWindow.jsx';
import NewChatModal from './NewChatModal.jsx';

const UNREADABLE = '🔒 Unable to decrypt this message';

export default function ChatLayout({ session, privateKey, onLogout }) {
  const { user: me, token } = session;
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState({}); // conversationId -> decrypted message[]
  const [online, setOnline] = useState(new Set());
  const [typing, setTyping] = useState({}); // conversationId -> { userId: username }
  const [showNewChat, setShowNewChat] = useState(false);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const keysRef = useRef(new Map()); // conversationId -> Promise<CryptoKey>
  const conversationsRef = useRef([]);
  conversationsRef.current = conversations;

  /** Unlocks (once) the conversation key that was wrapped for me. */
  const keyFor = useCallback(
    (conversation) => {
      if (!keysRef.current.has(conversation.id)) {
        const promise = importPublicKey(conversation.key.creatorPublicKey).then((creatorKey) =>
          unwrapConversationKey(conversation.key, privateKey, creatorKey)
        );
        promise.catch(() => keysRef.current.delete(conversation.id)); // allow a retry
        keysRef.current.set(conversation.id, promise);
      }
      return keysRef.current.get(conversation.id);
    },
    [privateKey]
  );

  const decryptOne = useCallback(
    async (conversation, encrypted) => {
      try {
        return await decryptMessage(await keyFor(conversation), encrypted);
      } catch {
        return UNREADABLE;
      }
    },
    [keyFor]
  );

  /** Adds a readable `preview` of the last message for the chat list. */
  const withPreview = useCallback(
    async (conversation) => ({
      ...conversation,
      preview: conversation.lastMessage
        ? await decryptOne(conversation, conversation.lastMessage)
        : null,
    }),
    [decryptOne]
  );

  // Load conversations once
  useEffect(() => {
    api('/api/conversations', { token })
      .then(async (data) => {
        setConversations(await Promise.all(data.conversations.map(withPreview)));
        setOnline(new Set(data.online));
      })
      .catch(onLogout); // token expired or invalid
  }, [token, onLogout, withPreview]);

  // Real-time connection
  useEffect(() => {
    const socket = io(API_URL, { auth: { token } });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err) => {
      if (err.message === 'Not signed in') onLogout();
    });

    socket.on('message:new', async (encrypted) => {
      const conv = conversationsRef.current.find((c) => c.id === encrypted.conversationId);
      if (!conv) return;
      const message = { ...encrypted, body: await decryptOne(conv, encrypted) };

      setMessages((prev) => {
        const list = prev[message.conversationId];
        if (!list || list.some((m) => m.id === message.id)) return prev;
        const next = [...list, message].sort((x, y) => x.id - y.id);
        return { ...prev, [message.conversationId]: next };
      });
      // Move the conversation to the top with its new preview
      setConversations((prev) => {
        const current = prev.find((c) => c.id === message.conversationId);
        if (!current) return prev;
        const updated = { ...current, preview: message.body, lastMessageAt: message.createdAt };
        return [updated, ...prev.filter((c) => c.id !== current.id)];
      });
      // Someone who just sent a message is no longer typing
      setTyping((prev) => {
        const forConv = { ...(prev[message.conversationId] ?? {}) };
        delete forConv[message.userId];
        return { ...prev, [message.conversationId]: forConv };
      });
    });

    socket.on('conversation:new', async (conversation) => {
      const ready = await withPreview(conversation);
      setConversations((prev) =>
        prev.some((c) => c.id === ready.id) ? prev : [ready, ...prev]
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
  }, [token, onLogout, decryptOne, withPreview]);

  const active = conversations.find((c) => c.id === activeId);

  // Load and decrypt history the first time a conversation is opened
  useEffect(() => {
    if (!active || messages[active.id]) return;
    let cancelled = false;
    api(`/api/conversations/${active.id}/messages`, { token }).then(async (data) => {
      const decrypted = await Promise.all(
        data.messages.map(async (m) => ({ ...m, body: await decryptOne(active, m) }))
      );
      if (!cancelled) setMessages((prev) => ({ ...prev, [active.id]: decrypted }));
    });
    return () => {
      cancelled = true;
    };
  }, [active, messages, token, decryptOne]);

  const sendMessage = useCallback(
    async (body) => {
      const encrypted = await encryptMessage(await keyFor(active), body);
      return new Promise((resolve, reject) => {
        socketRef.current.emit(
          'message:send',
          { conversationId: active.id, ...encrypted },
          (res) => (res.error ? reject(new Error(res.error)) : resolve(res.message))
        );
      });
    },
    [active, keyFor]
  );

  const sendTyping = useCallback(
    (isTyping) => socketRef.current?.emit('typing', { conversationId: activeId, isTyping }),
    [activeId]
  );

  const handleCreated = async (conversation) => {
    const ready = await withPreview(conversation);
    setConversations((prev) =>
      prev.some((c) => c.id === ready.id) ? prev : [ready, ...prev]
    );
    setActiveId(ready.id);
    setShowNewChat(false);
  };

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
          <p className="muted small">🔒 Messages are end-to-end encrypted.</p>
          <button className="primary" onClick={() => setShowNewChat(true)}>
            New chat
          </button>
        </main>
      )}
      {showNewChat && (
        <NewChatModal
          me={me}
          token={token}
          privateKey={privateKey}
          online={online}
          onCreated={handleCreated}
          onClose={() => setShowNewChat(false)}
        />
      )}
    </div>
  );
}
