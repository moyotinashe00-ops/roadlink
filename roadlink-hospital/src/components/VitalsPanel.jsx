import { clock, vitalsRows } from '../lib/format.js';

/** The newest vitals the ambulance crew has recorded for this patient (FR10). */
export default function VitalsPanel({ vitals }) {
  if (!vitals) {
    return <p className="vitals vitals--none" aria-label="Patient vitals">No vitals recorded by the crew yet</p>;
  }
  return (
    <section className="vitals" aria-label="Patient vitals">
      <h4 className="vitals__title">Crew vitals <small>recorded {clock(vitals.recorded_at)}</small></h4>
      <dl className="vitals__grid">
        {vitalsRows(vitals).map((r) => (
          <div key={r.key}>
            <dt>{r.label}</dt>
            <dd>{r.value}{r.unit && <small> {r.unit}</small>}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
