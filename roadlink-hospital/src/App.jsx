import { useMemo, useRef, useState } from 'react';
import { createApi } from './lib/api.js';
import { clearSession, loadSession, saveSession } from './lib/session.js';
import Login from './components/Login.jsx';
import Board from './components/Board.jsx';

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
    // The same login endpoint serves every role; this portal is for ED staff only.
    if (res.user.role !== 'hospital') throw new Error('This portal is for hospital emergency-department staff.');
    const s = { token: res.token, user: res.user };
    saveSession(s);
    setSession(s);
  }

  if (!session) return <Login onSubmit={login} />;
  return <Board api={api} baseUrl={BASE_URL} session={session} onLogout={logout} />;
}
