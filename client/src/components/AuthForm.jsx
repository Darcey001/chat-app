import { useState } from 'react';
import { api } from '../api.js';
import {
  generateKeyPair,
  exportPublicKey,
  backupPrivateKey,
  restorePrivateKey,
} from '../crypto.js';
import { savePrivateKey } from '../keystore.js';

export default function AuthForm({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const isLogin = mode === 'login';

  async function register() {
    // Keys are made here in the browser. Only the public key and a
    // password-locked copy of the private key are sent to the server.
    setStatus('Creating your encryption keys…');
    const pair = await generateKeyPair();
    const publicKey = await exportPublicKey(pair.publicKey);
    const backup = await backupPrivateKey(pair.privateKey, password);
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: { username, password, publicKey, ...backup },
    });
    // Re-import as non-extractable before storing it in this browser
    return { data, privateKey: await restorePrivateKey(backup, password) };
  }

  async function login() {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    setStatus('Unlocking your messages…');
    return { data, privateKey: await restorePrivateKey(data.keyBackup, password) };
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setStatus('Please wait…');
    try {
      const { data, privateKey } = isLogin ? await login() : await register();
      await savePrivateKey(data.user.id, privateKey);
      onAuth({ user: data.user, token: data.token }, privateKey);
    } catch (err) {
      setError(err.message || 'Could not unlock your encryption keys');
    } finally {
      setStatus('');
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h1 className="brand">Chatter</h1>
        <p className="muted">{isLogin ? 'Welcome back' : 'Create your account'}</p>

        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            minLength={isLogin ? undefined : 8}
            required
          />
        </label>

        {error && <p className="error" role="alert">{error}</p>}

        <button className="primary" disabled={!!status}>
          {status || (isLogin ? 'Log in' : 'Sign up')}
        </button>

        <p className="muted small">🔒 Your messages are end-to-end encrypted.</p>

        <p className="muted small">
          {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              setMode(isLogin ? 'register' : 'login');
              setError('');
            }}
          >
            {isLogin ? 'Sign up' : 'Log in'}
          </button>
        </p>
      </form>
    </div>
  );
}
