import { useCallback, useEffect, useState } from 'react';
import {
  AMBULANCE_STATE, COMMITTED, HOSPITAL_STATE, POLICE_STATE, SEVERITY, STATUS, ageLabel, clock, distanceLabel, vitalsRows,
} from '../lib/format.js';

const eventLabel = (e) => {
  const t = String(e || '').replace(/^incident_/, '').replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** The newest vitals the ambulance crew has recorded (also what the receiving hospital sees). */
function Vitals({ vitals }) {
  return (
    <section className="vitals" aria-label="Patient vitals">
      <h4 className="vitals__title">Crew vitals <small>recorded {clock(vitals.recorded_at)}</small></h4>
      <dl className="vitals__grid">
        {vitalsRows(vitals).map((r) => (
          <div key={r.key}><dt>{r.label}</dt><dd>{r.value}{r.unit && <small> {r.unit}</small>}</dd></div>
        ))}
      </dl>
    </section>
  );
}

function Photo({ api, incidentId }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let made = null;
    let cancelled = false;
    api.photo(incidentId).then((blob) => { if (!cancelled) { made = URL.createObjectURL(blob); setUrl(made); } }).catch(() => setFailed(true));
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [api, incidentId]);
  if (failed) return <p className="muted">A photo was attached but could not be loaded.</p>;
  return url ? <img className="photo" src={url} alt="Scene, sent by the reporter" /> : <p className="muted">Loading photo&hellip;</p>;
}

function Timeline({ api, incidentId, version }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.timeline(incidentId).then(setRows).catch(() => setRows([])); }, [api, incidentId, version]);
  if (!rows) return <p className="muted">Loading&hellip;</p>;
  return (
    <ol className="timeline">
      {rows.map((r) => (
        <li key={r.id}>
          <time>{clock(r.created_at)}</time>
          <div><strong>{eventLabel(r.event)}</strong><small>{r.actor_name || r.actor_role}{r.note ? `: ${r.note}` : ''}</small></div>
        </li>
      ))}
    </ol>
  );
}

function Section({ title, tone, children, aside }) {
  return (
    <section className={`sect${tone ? ` sect--${tone}` : ''}`}>
      <header><h3>{title}</h3>{aside}</header>
      {children}
    </section>
  );
}

export default function IncidentPanel({ api, incident, now, onUpdated, onCloseRequest, onError }) {
  const open = incident.status !== 'closed';
  const a = incident.assignment || {};
  const sev = SEVERITY[incident.severity] || SEVERITY.minor;
  const ambId = a.ambulance?.ambulance_id;
  const hospId = a.hospital?.hospital_id;
  const policeId = a.police?.unit_id;
  // Once a unit has accepted or arrived it cannot be taken away; before that the dispatcher may change it.
  const canChangePolice = open && (!a.police || ['notified', 'cleared'].includes(a.police.state));
  const committed = !!a.ambulance && COMMITTED.includes(a.ambulance.state);

  const [recs, setRecs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [choosingPolice, setChoosingPolice] = useState(false);
  const [breakdown, setBreakdown] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);

  const loadRecs = useCallback(async () => {
    try { setRecs(await api.recommendations(incident.id)); } catch (e) { onError(e); }
  }, [api, incident.id, onError]);

  useEffect(() => { setReplacing(false); setBreakdown(false); setShowTimeline(false); setChoosingPolice(false); }, [incident.id]);
  useEffect(() => { if (open) loadRecs(); else setRecs(null); }, [open, incident.id, ambId, hospId, policeId, loadRecs]);

  async function act(fn) {
    setBusy(true);
    try { onUpdated(await fn()); setReplacing(false); setBreakdown(false); setChoosingPolice(false); } catch (e) { onError(e); } finally { setBusy(false); }
  }
  const assignAmbulance = (ambulanceId) => act(() => api.assignAmbulance(incident.id, { ambulanceId, force: committed }));
  const assignPolice = (policeUnitId) => act(() => api.assignPolice(incident.id, policeUnitId));
  const assignHospital = (hospitalId) => act(() => api.assignHospital(incident.id, hospitalId));

  const choosingAmbulance = open && (!a.ambulance || replacing);
  const blocked = busy || (committed && !breakdown);

  return (
    <div className="panel" aria-label={`Incident ${incident.reference_number}`}>
      <header className="panel__head">
        <div>
          <h2>{incident.reference_number}</h2>
          <p className="muted">{STATUS[incident.status] || incident.status} &middot; reported {ageLabel(incident.created_at, now)} ago</p>
        </div>
        <span className={`badge badge--${sev.tone}`}>{sev.label}</span>
      </header>

      <dl className="facts">
        <div><dt>Patients</dt><dd>{incident.victim_count}</dd></div>
        <div><dt>Reports merged</dt><dd>{incident.report_count || 1}</dd></div>
        <div className="facts__wide"><dt>Location</dt><dd>{incident.location_label || `${incident.lat.toFixed(5)}, ${incident.lng.toFixed(5)}`}
          <small>{incident.location_accuracy === 'approximate' ? ' approximate' : ' GPS'}</small></dd></div>
        {incident.reporter_phone && (
          <div className="facts__wide"><dt>Caller</dt><dd><a href={`tel:${incident.reporter_phone.replace(/\s/g, '')}`}>{incident.reporter_phone}</a></dd></div>
        )}
        {incident.case_reference && <div className="facts__wide"><dt>Police case</dt><dd>{incident.case_reference}</dd></div>}
      </dl>
      {incident.description && <p className="desc">{incident.description}</p>}
      {incident.hazard_notes && <p className="hazard"><b>Hazard:</b> {incident.hazard_notes}</p>}
      {incident.latest_vitals && <Vitals vitals={incident.latest_vitals} />}
      {incident.has_photo && <Photo api={api} incidentId={incident.id} />}

      <Section title="Police" tone={a.police ? 'ok' : 'bad'}
        aside={canChangePolice && a.police && !choosingPolice && <button className="btn btn--ghost" onClick={() => setChoosingPolice(true)}>Change</button>}>
        {a.police ? (
          <p className="assigned"><strong>{a.police.name || 'Police unit'}</strong><span className="state">{POLICE_STATE[a.police.state] || a.police.state}</span></p>
        ) : (
          <p className="warn">No police unit is alerted. Choose one below, or phone the nearest station.</p>
        )}
        {a.police?.state === 'notified' && <p className="muted">Waiting for the unit to accept.</p>}
        {canChangePolice && (choosingPolice || !a.police) && (
          <>
            <div className="recs__top">
              <span className="muted">Police units, available first</span>
              <button className="btn btn--primary" disabled={busy} onClick={() => assignPolice(undefined)}>Alert nearest</button>
            </div>
            {!recs ? <p className="muted">Loading&hellip;</p> : (
              <ul className="recs">
                {(recs.police || []).filter((p) => p.id !== policeId).map((p) => (
                  <li key={p.id} className="rec">
                    <div><strong>{p.name}</strong>
                      {!p.is_available && <span className="tag tag--warn">busy</span>}
                      {p.location_stale && <span className="tag tag--warn">old position</span>}</div>
                    <div className="rec__nums"><span>{distanceLabel(p.distance_m)}</span><span>{p.eta_minutes} min</span></div>
                    <button className="btn" disabled={busy} onClick={() => assignPolice(p.id)}>Alert</button>
                  </li>
                ))}
              </ul>
            )}
            {choosingPolice && <button className="btn btn--ghost" onClick={() => setChoosingPolice(false)}>Keep current unit</button>}
          </>
        )}
      </Section>

      <Section title="Ambulance" tone={a.ambulance ? 'ok' : (open ? 'bad' : undefined)}
        aside={open && a.ambulance && !replacing && <button className="btn btn--ghost" onClick={() => setReplacing(true)}>Replace</button>}>
        {a.ambulance && (
          <p className="assigned">
            <strong>{a.ambulance.plate_number}</strong>
            <span className="state">{AMBULANCE_STATE[a.ambulance.state] || a.ambulance.state}</span>
            {a.ambulance.eta_minutes != null && a.ambulance.state !== 'arrived' && <span className="eta">ETA {a.ambulance.eta_minutes} min</span>}
          </p>
        )}
        {choosingAmbulance && (
          <>
            {committed && (
              <label className="confirm">
                <input type="checkbox" checked={breakdown} onChange={(e) => setBreakdown(e.target.checked)} />
                <span>The crew is already {AMBULANCE_STATE[a.ambulance.state].toLowerCase()}. Replace only if the vehicle has broken down.</span>
              </label>
            )}
            <div className="recs__top">
              <span className="muted">Available ambulances, closest first</span>
              <button className="btn btn--primary" disabled={blocked} onClick={() => assignAmbulance(undefined)}>Auto-assign best</button>
            </div>
            {!recs ? <p className="muted">Loading&hellip;</p> : recs.ambulances.length === 0 ? (
              <p className="warn">No ambulance is available right now.</p>
            ) : (
              <ul className="recs">
                {recs.ambulances.map((r) => (
                  <li key={r.id} className="rec">
                    <div><strong>{r.plate_number}</strong><small>{r.provider}</small>
                      {r.location_stale && <span className="tag tag--warn">old position</span>}</div>
                    <div className="rec__nums"><span>{distanceLabel(r.distance_m)}</span><span>{r.eta_minutes} min</span></div>
                    <button className="btn" disabled={blocked} onClick={() => assignAmbulance(r.id)}>Assign</button>
                  </li>
                ))}
              </ul>
            )}
            {replacing && <button className="btn btn--ghost" onClick={() => { setReplacing(false); setBreakdown(false); }}>Keep current ambulance</button>}
          </>
        )}
      </Section>

      <Section title="Hospital" tone={a.hospital ? 'ok' : (open && a.ambulance ? 'bad' : undefined)}>
        {a.hospital && (
          <p className="assigned">
            <strong>{a.hospital.name}</strong>
            <span className="state">{HOSPITAL_STATE[a.hospital.state] || a.hospital.state}</span>
            {a.hospital.phone && <a className="eta" href={`tel:${a.hospital.phone.replace(/\s/g, '')}`}>{a.hospital.phone}</a>}
          </p>
        )}
        {open && !a.ambulance && <p className="muted">Assign an ambulance first; the hospital ETA depends on it.</p>}
        {open && a.ambulance && (
          <>
            <p className="muted">{a.hospital ? 'Change hospital' : 'Hospitals, closest with free trauma bays first'}</p>
            {!recs ? <p className="muted">Loading&hellip;</p> : (
              <ul className="recs">
                {recs.hospitals.filter((h) => h.id !== hospId).map((h) => (
                  <li key={h.id} className="rec">
                    <div><strong>{h.name}</strong>
                      <small>{h.trauma_bays_free} of {h.trauma_bays_total} trauma bays free</small>
                      {!h.has_capacity && <span className="tag tag--bad">full</span>}
                      {h.capacity_stale && <span className="tag tag--warn">old numbers</span>}</div>
                    <div className="rec__nums"><span>{distanceLabel(h.distance_m)}</span><span>{h.eta_minutes} min</span></div>
                    <button className="btn" disabled={busy} onClick={() => assignHospital(h.id)}>Assign</button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Section>

      <Section title="Timeline" aside={<button className="btn btn--ghost" onClick={() => setShowTimeline((v) => !v)}>{showTimeline ? 'Hide' : 'Show'}</button>}>
        {showTimeline && <Timeline api={api} incidentId={incident.id} version={incident.updated_at} />}
      </Section>

      {open && <button className="btn btn--danger btn--wide" onClick={onCloseRequest}>Close incident</button>}
    </div>
  );
}
