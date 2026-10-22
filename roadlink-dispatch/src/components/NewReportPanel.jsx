import { useState } from 'react';
import { SEVERITY } from '../lib/format.js';

/**
 * A report phoned in by a caller. The map stays clickable beside this panel: the dispatcher clicks the
 * place the caller describes, so the report carries real coordinates marked as approximate.
 */
export default function NewReportPanel({ picked, onCancel, onSubmit }) {
  const [severity, setSeverity] = useState('serious');
  const [victims, setVictims] = useState(1);
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!picked) { setError('Click the map to mark where the accident is.'); return; }
    setBusy(true); setError(null);
    try {
      await onSubmit({
        lat: picked.lat, lng: picked.lng, severity, victim_count: Number(victims), description,
        location_accuracy: 'approximate',
        ...(label.trim() ? { location_label: label.trim() } : {}),
        ...(phone.trim() ? { reporter_phone: phone.trim() } : {}),
      });
    } catch (err) {
      setError(err.message); setBusy(false);
    }
  }

  return (
    <form className="panel panel--form" onSubmit={submit} aria-label="New report">
      <header className="panel__head">
        <h2>New report</h2>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
      </header>

      <p className={`pickhint${picked ? ' pickhint--done' : ''}`}>
        {picked ? `Location set: ${picked.lat.toFixed(5)}, ${picked.lng.toFixed(5)}. Click the map again to move it.` : 'Click the map where the caller says the accident is.'}
      </p>

      <fieldset className="sevpick">
        <legend>How serious?</legend>
        {Object.entries(SEVERITY).map(([key, s]) => (
          <label key={key} className={`sev sev--${s.tone}${severity === key ? ' sev--on' : ''}`}>
            <input type="radio" name="severity" value={key} checked={severity === key} onChange={() => setSeverity(key)} />
            {s.label}
          </label>
        ))}
      </fieldset>

      <label className="field">People hurt
        <input type="number" min="0" max="500" value={victims} onChange={(e) => setVictims(e.target.value)} />
      </label>
      <label className="field">Place, as the caller describes it
        <input value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Samora Machel Ave near Harare Gardens" />
      </label>
      <label className="field">What happened
        <textarea rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="field">Caller's phone
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+263 77 123 4567" />
      </label>

      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn--primary btn--wide" disabled={busy}>{busy ? 'Sending\u2026' : 'Send to police'}</button>
    </form>
  );
}
