import { useMemo, useRef, useState } from 'react';
import { createApi } from './lib/api.js';
import { clearSession, loadSession, saveSession } from './lib/session.js';
import Login from './components/Login.jsx';
import Console from './components/Console.jsx';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function App() {
  const [session, setSession] = useState(loadSession);

  const sessionRef = useRef(session);
  sessionRef.current = session;

  const logout = () => { clearSession(); setSession(null); };
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  const api = useMemo(() => createApi({
    baseUrl: BASE_URL,
    getToken: () => (sessionRef.current ? sessionRef.current.token : null),
    onUnauthorized: () => logoutRef.current(),
  }), []);

  async function login(identifier, password) {
    const res = await api.login(identifier, password);
    // The same login endpoint serves every role; this console is for the control room only.
    if (res.user.role !== 'dispatcher' && res.user.role !== 'admin') {
      throw new Error('This console is for dispatchers and administrators.');
    }
    const s = { token: res.token, user: res.user };
    saveSession(s);
    setSession(s);
  }

  if (!session) return <Login onSubmit={login} />;
  return <Console api={api} baseUrl={BASE_URL} session={session} onLogout={logout} />;
}
