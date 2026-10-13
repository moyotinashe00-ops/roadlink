import { useEffect, useState } from 'react';
import { clock } from '../lib/format.js';

/** HOS-05: staff keep the free-bay count current; the dispatcher's hospital ranking reads it. */
export default function CapacityPanel({ api, hospital, onError }) {
  const [free, setFree] = useState(hospital.trauma_bays_free);
  const [total, setTotal] = useState(hospital.trauma_bays_total);
  const [stamp, setStamp] = useState(hospital.capacity_updated_at);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFree(hospital.trauma_bays_free); setTotal(hospital.trauma_bays_total); setStamp(hospital.capacity_updated_at);
  }, [hospital]);

  async function save(nextFree, nextTotal) {
    const prev = { free, total };
    setFree(nextFree); setTotal(nextTotal); setSaving(true); // optimistic
    try {
      const r = await api.updateCapacity(nextFree, nextTotal);
      setStamp(r.capacity_updated_at);
    } catch (e) {
      setFree(prev.free); setTotal(prev.total);
      onError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel capacity" aria-label="Trauma bay capacity">
      <h2 className="panel__title">Trauma bays</h2>
      <div className="pips" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => <span key={i} className={i < free ? 'pip pip--free' : 'pip'} />)}
      </div>
      <p className="capacity__readout">
        <strong data-testid="free-count">{free}</strong> free <span>of {total}</span>
      </p>
      {free === 0 && <p className="capacity__warn">No free bays — the dispatcher will rank this hospital last.</p>}

      <div className="steppers">
        <div className="stepper">
          <span>Free</span>
          <button className="btn btn--round" aria-label="One fewer free bay" disabled={saving || free <= 0} onClick={() => save(free - 1, total)}>−</button>
          <button className="btn btn--round" aria-label="One more free bay" disabled={saving || free >= total} onClick={() => save(free + 1, total)}>+</button>
        </div>
        <div className="stepper">
          <span>Total</span>
          <button className="btn btn--round" aria-label="One fewer total bay" disabled={saving || total <= free} onClick={() => save(free, total - 1)}>−</button>
          <button className="btn btn--round" aria-label="One more total bay" disabled={saving} onClick={() => save(free, total + 1)}>+</button>
        </div>
      </div>
      <p className="muted">Updated {clock(stamp)}</p>
    </section>
  );
}
