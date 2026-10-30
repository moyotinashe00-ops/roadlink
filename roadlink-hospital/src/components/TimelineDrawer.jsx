import { useEffect, useState } from 'react';
import { clock } from '../lib/format.js';

const LABELS = {
  incident_created: 'Reported', duplicate_report_merged: 'Another report merged', police_notified: 'Police alerted',
  police_accepted: 'Police accepted', police_declined: 'Police declined', police_on_scene: 'Police on scene',
  scene_updated: 'Scene details updated', scene_cleared: 'Scene cleared', case_reference_recorded: 'Police case recorded',
  ambulance_assigned: 'Ambulance assigned', ambulance_reassigned: 'Ambulance changed', ambulance_en_route: 'Ambulance en route',
  ambulance_on_scene: 'Ambulance on scene', ambulance_transporting: 'Transporting patient', vitals_recorded: 'Patient vitals recorded',
  ambulance_arrived_at_hospital: 'Ambulance at hospital', hospital_notified: 'Hospital notified',
  hospital_reassigned: 'Hospital changed', police_escalated: 'Police: next unit alerted', police_assigned: 'Police unit assigned',
  police_unresponsive: 'No police response', incident_closed_no_transport: 'Closed: no transport', hospital_acknowledged: 'Hospital acknowledged', patient_admitted: 'Patient admitted',
  incident_closed_completed: 'Closed', incident_closed_false_alarm: 'Closed — false alarm', incident_closed_cancelled: 'Closed — cancelled',
};

export default function TimelineDrawer({ api, incident, onClose }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.timeline(incident.id).then((r) => alive && setRows(r)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [api, incident.id]);

  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-label={`Timeline for ${incident.reference_number}`} onClick={(e) => e.stopPropagation()}>
        <header className="drawer__head">
          <h2>{incident.reference_number}</h2>
          <button className="btn btn--ghost" onClick={onClose}>Close</button>
        </header>
        {error && <p className="error">{error}</p>}
        {!rows && !error && <p className="muted">Loading…</p>}
        {rows && (
          <ol className="timeline">
            {rows.map((r) => (
              <li key={r.id}>
                <time>{clock(r.created_at)}</time>
                <div>
                  <strong>{LABELS[r.event] || r.event}</strong>
                  <small>{r.actor_name || r.actor_role}{r.note ? ` · ${r.note}` : ''}</small>
                </div>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}
