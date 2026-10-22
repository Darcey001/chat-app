import { useCallback, useState } from 'react';
import AuthForm from './components/AuthForm.jsx';
import ChatLayout from './components/ChatLayout.jsx';

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

  const handleAuth = useCallback((data) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    setSession(data);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  return session ? (
    <ChatLayout session={session} onLogout={logout} />
  ) : (
    <AuthForm onAuth={handleAuth} />
  );
}
