import { useEffect, useRef, useState } from 'react';
import EtaRing from './EtaRing.jsx';
import { AMBULANCE_STATE, SEVERITY, clock } from '../lib/format.js';

export default function IncidentCard({ incident, now, index, isNew, busy, onAcknowledge, onAdmit, onTimeline }) {
  const sev = SEVERITY[incident.severity] || SEVERITY.minor;
  const hospital = incident.assignment.hospital;
  const amb = incident.assignment.ambulance;
  const police = incident.assignment.police;
  const patients = incident.verified_victim_count ?? incident.victim_count;

  // Two-step "admitted" so a mis-click can't close the loop for the dispatcher by accident.
  const [confirming, setConfirming] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const armAdmit = () => {
    setConfirming(true);
    timer.current = setTimeout(() => setConfirming(false), 4000);
  };

  return (
    <article className={`card card--${sev.tone}${isNew ? ' card--new' : ''}`} style={{ '--i': index }}>
      <header className="card__head">
        <div>
          <h3 className="card__ref">{incident.reference_number}</h3>
          <span className="card__time">Notified {clock(hospital.assigned_at)}</span>
        </div>
        <span className={`badge badge--${sev.tone}`}>{sev.label}</span>
      </header>

      <div className="card__body">
        <EtaRing hospital={hospital} ambulanceState={amb && amb.state} now={now} />
        <dl className="facts">
          <div>
            <dt>Patients</dt>
            <dd>{patients}{incident.verified_victim_count != null && <small> confirmed by police</small>}</dd>
          </div>
          <div>
            <dt>Ambulance</dt>
            <dd>{amb ? <>{amb.plate_number} <small>{AMBULANCE_STATE[amb.state] || amb.state}</small></> : 'Not yet assigned'}</dd>
          </div>
          {police && ['onScene', 'cleared'].includes(police.state) && (
            <div><dt>Police</dt><dd>On scene <small>{police.name}</small></dd></div>
          )}
        </dl>
      </div>

      {incident.description && <p className="card__note">{incident.description}</p>}
      {incident.hazard_notes && <p className="card__hazard"><strong>Hazard:</strong> {incident.hazard_notes}</p>}

      <footer className="card__actions">
        {hospital.state === 'notified' && (
          <button className="btn btn--primary" disabled={busy} onClick={() => onAcknowledge(incident.id)}>
            Acknowledge &amp; prepare
          </button>
        )}
        {hospital.state === 'acknowledged' && (
          confirming
            ? <button className="btn btn--confirm" disabled={busy} onClick={() => { setConfirming(false); onAdmit(incident.id); }}>Confirm: patient received</button>
            : <button className="btn btn--primary" disabled={busy} onClick={armAdmit}>Mark admitted</button>
        )}
        <button className="btn btn--ghost" onClick={() => onTimeline(incident)}>Timeline</button>
      </footer>
    </article>
  );
}
