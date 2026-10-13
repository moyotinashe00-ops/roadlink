import { SEVERITY, clock } from '../lib/format.js';

export default function DoneRow({ incident, onTimeline }) {
  const sev = SEVERITY[incident.severity] || SEVERITY.minor;
  const patients = incident.verified_victim_count ?? incident.victim_count;
  return (
    <li className="done">
      <span className={`dot dot--${sev.tone}`} aria-hidden="true" />
      <span className="done__ref">{incident.reference_number}</span>
      <span className="done__meta">{patients} patient{patients === 1 ? '' : 's'} · {sev.label}</span>
      <span className="done__time">{clock(incident.updated_at)}</span>
      <button className="link" onClick={() => onTimeline(incident)}>Timeline</button>
    </li>
  );
}
