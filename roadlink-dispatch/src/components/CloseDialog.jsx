import { useState } from 'react';
import { OUTCOMES } from '../lib/format.js';

export default function CloseDialog({ incident, onConfirm, onCancel }) {
  const admitted = incident.status === 'admitted';
  const [outcome, setOutcome] = useState(admitted ? 'completed' : 'no_transport');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try { await onConfirm(outcome, note.trim()); } finally { setBusy(false); }
  }

  return (
    <div className="scrim" role="presentation">
      <form className="dialog" role="dialog" aria-modal="true" aria-label={`Close ${incident.reference_number}`} onSubmit={submit}>
        <h2>Close {incident.reference_number}</h2>
        <p className="muted">Closing frees the ambulance and the police unit. The timeline stays for review.</p>
        <fieldset className="outcomes">
          <legend>How did it end?</legend>
          {OUTCOMES.map((o) => {
            const blocked = o.value === 'completed' && !admitted;
            return (
              <label key={o.value} className={`outcome${blocked ? ' outcome--off' : ''}`}>
                <input type="radio" name="outcome" value={o.value} checked={outcome === o.value} disabled={blocked} onChange={() => setOutcome(o.value)} />
                <span><b>{o.label}</b><small>{blocked ? 'Needs the hospital to confirm admission first' : o.hint}</small></span>
              </label>
            );
          })}
        </fieldset>
        <label className="field">Note (optional)
          <textarea rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>Keep open</button>
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Closing\u2026' : 'Close incident'}</button>
        </div>
      </form>
    </div>
  );
}
