import { etaRemainingSeconds, formatCountdown } from '../lib/format.js';

const R = 36;
const C = 2 * Math.PI * R;

/** The signature element: a ring that drains toward the ambulance's arrival time. */
export default function EtaRing({ hospital, ambulanceState, now }) {
  if (ambulanceState === 'arrived') {
    return (
      <div className="eta eta--door" role="status" aria-label="Ambulance has arrived">
        <span className="eta__big">AT DOOR</span>
      </div>
    );
  }
  const remaining = etaRemainingSeconds(hospital, now);
  if (remaining === null) {
    return <div className="eta eta--none"><span className="eta__big">ETA —</span></div>;
  }

  const total = hospital.eta_minutes * 60;
  const frac = Math.max(0, Math.min(1, remaining / total));
  const tone = remaining < 0 ? 'late' : remaining < 120 ? 'soon' : 'ok';

  return (
    <div className={`eta eta--${tone}`} role="timer" aria-label={`Estimated arrival ${formatCountdown(remaining)}`}>
      <svg viewBox="0 0 88 88" width="88" height="88" aria-hidden="true">
        <circle className="eta__track" cx="44" cy="44" r={R} />
        <circle
          className="eta__arc" cx="44" cy="44" r={R}
          strokeDasharray={C} strokeDashoffset={C * (1 - frac)}
          transform="rotate(-90 44 44)"
        />
      </svg>
      <div className="eta__center">
        <span className="eta__time">{formatCountdown(remaining)}</span>
        <span className="eta__cap">{remaining < 0 ? 'overdue' : 'to arrival'}</span>
      </div>
    </div>
  );
}
