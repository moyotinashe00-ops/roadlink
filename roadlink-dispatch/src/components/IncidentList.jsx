import { AMBULANCE_STATE, HOSPITAL_STATE, POLICE_STATE, SEVERITY, STATUS, ageLabel } from '../lib/format.js';
import { needs } from '../lib/board.js';

function Chip({ label, value, missing }) {
  return <span className={`chip ${missing ? 'chip--missing' : 'chip--ok'}`}>{label}: {value}</span>;
}

function Card({ incident, selected, onSelect, now }) {
  const sev = SEVERITY[incident.severity] || SEVERITY.minor;
  const a = incident.assignment || {};
  const n = needs(incident);
  const open = incident.status !== 'closed';
  return (
    <li>
      <button
        className={`inc inc--${sev.tone}${selected ? ' inc--selected' : ''}`}
        onClick={() => onSelect(incident.id)} aria-pressed={selected}
        aria-label={`${incident.reference_number}, ${sev.label}, ${STATUS[incident.status] || incident.status}`}
      >
        <span className="inc__row">
          <strong className="inc__ref">{incident.reference_number}</strong>
          <span className={`badge badge--${sev.tone}`}>{sev.label}</span>
        </span>
        <span className="inc__row inc__meta">
          <span>{STATUS[incident.status] || incident.status}</span>
          <span>{incident.victim_count} {incident.victim_count === 1 ? 'patient' : 'patients'} &middot; {ageLabel(incident.created_at, now)}</span>
        </span>
        {incident.location_label && <span className="inc__place">{incident.location_label}</span>}
        {open && (
          <span className="inc__chips">
            <Chip label="Police" value={a.police ? POLICE_STATE[a.police.state] || a.police.state : 'none'} missing={n.police} />
            <Chip label="Ambulance" value={a.ambulance ? AMBULANCE_STATE[a.ambulance.state] || a.ambulance.state : 'needed'} missing={n.ambulance} />
            <Chip label="Hospital" value={a.hospital ? HOSPITAL_STATE[a.hospital.state] || a.hospital.state : (a.ambulance ? 'needed' : '-')} missing={n.hospital} />
          </span>
        )}
      </button>
    </li>
  );
}

export default function IncidentList({ open, closed, tab, onTab, selectedId, onSelect, now }) {
  const shown = tab === 'open' ? open : closed;
  return (
    <section className="list" aria-label="Incidents">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'open'} className={tab === 'open' ? 'tab tab--on' : 'tab'} onClick={() => onTab('open')}>Open <b>{open.length}</b></button>
        <button role="tab" aria-selected={tab === 'closed'} className={tab === 'closed' ? 'tab tab--on' : 'tab'} onClick={() => onTab('closed')}>Closed <b>{closed.length}</b></button>
      </div>
      {shown.length === 0 ? (
        <p className="empty">{tab === 'open' ? 'No open incidents. New reports appear here the moment they arrive.' : 'Nothing closed yet.'}</p>
      ) : (
        <ul className="list__items">
          {shown.map((i) => <Card key={i.id} incident={i} selected={i.id === selectedId} onSelect={onSelect} now={now} />)}
        </ul>
      )}
    </section>
  );
}
