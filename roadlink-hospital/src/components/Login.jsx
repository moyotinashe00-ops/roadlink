import { useState } from 'react';

export default function Login({ onSubmit }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await onSubmit(identifier.trim(), password); } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <main className="login">
      <div className="login__brand">
        <span className="login__mark" aria-hidden="true" />
        <h1>ROADLINK<span>HOSPITAL</span></h1>
        <p>Emergency department intake board</p>
      </div>
      <form className="login__form" onSubmit={submit}>
        <label>Email or phone
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required />
        </label>
        <label>Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn--primary btn--wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
