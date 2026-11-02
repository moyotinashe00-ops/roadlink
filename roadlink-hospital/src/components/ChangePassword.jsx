import { useState } from 'react';

/** FR15: staff change their own password. The server checks the current one and wants at least 8 characters. */
export default function ChangePassword({ api, onDone, onCancel }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (next.length < 8) return setError('The new password needs at least 8 characters.');
    if (next !== again) return setError('The two new passwords do not match.');
    if (next === current) return setError('Choose a password different from the current one.');
    setBusy(true);
    try {
      await api.changePassword(current, next);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scrim" role="presentation">
      <form className="dialog" role="dialog" aria-modal="true" aria-label="Change password" onSubmit={submit}>
        <h2>Change password</h2>
        <label className="field">Current password
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label className="field">New password
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </label>
        <label className="field">New password again
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
        </label>
        {error && <p className="warn" role="alert">{error}</p>}
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Saving\u2026' : 'Change password'}</button>
        </div>
      </form>
    </div>
  );
}
