import { useCallback, useEffect, useState } from 'react';
import AuthForm from './components/AuthForm.jsx';
import ChatLayout from './components/ChatLayout.jsx';
import { loadPrivateKey, deletePrivateKey } from './keystore.js';

const STORAGE_KEY = 'chatter-session';

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession] = useState(loadSession);
  const [privateKey, setPrivateKey] = useState(null);
  const [checkingKey, setCheckingKey] = useState(!!session);

  const logout = useCallback(() => {
    setSession((current) => {
      if (current) deletePrivateKey(current.user.id);
      return null;
    });
    localStorage.removeItem(STORAGE_KEY);
    setPrivateKey(null);
  }, []);

  // After a page reload, find this user's private key in the browser.
  // Without it nothing can be decrypted, so they need to log in again.
  useEffect(() => {
    if (!session || privateKey) return setCheckingKey(false);
    let cancelled = false;
    loadPrivateKey(session.user.id).then((key) => {
      if (cancelled) return;
      if (key) setPrivateKey(key);
      else logout();
      setCheckingKey(false);
    });
    return () => {
      cancelled = true;
    };
  }, [session, privateKey, logout]);

  const handleAuth = useCallback((data, key) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    setPrivateKey(key);
    setSession(data);
  }, []);

  if (checkingKey) return <div className="auth-page muted">Unlocking…</div>;

  return session && privateKey ? (
    <ChatLayout session={session} privateKey={privateKey} onLogout={logout} />
  ) : (
    <AuthForm onAuth={handleAuth} />
  );
}
