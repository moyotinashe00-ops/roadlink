import { useCallback, useEffect, useState } from 'react';
import { ageLabel } from '../lib/format.js';

const TABS = [['summary', 'Summary'], ['users', 'Users'], ['ambulances', 'Ambulances'], ['police', 'Police units'], ['hospitals', 'Hospitals']];
const ROLES = ['dispatcher', 'police', 'ambulance', 'hospital', 'admin'];

/** 197 -> "3 min 17 s". No data yet (nothing has reached that stage) -> a plain message, never "0". */
export const duration = (s) => (s == null ? 'no data yet' : s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`);

function Toggle({ row, label, onChange }) {
  return (
    <button className="btn btn--ghost" aria-label={`${row.is_active ? 'Disable' : 'Enable'} ${label}`} onClick={() => onChange(!row.is_active)}>
      {row.is_active ? 'Disable' : 'Enable'}
    </button>
  );
}
const State = ({ active, children }) => <span className={`state${active ? '' : ' state--off'}`}>{active ? children : 'Disabled'}</span>;

function Kpi({ label, value }) {
  return <div className="kpi"><span>{label}</span><b>{value}</b></div>;
}

function SummaryTab({ api, onError }) {
  const [days, setDays] = useState(30);
  const [s, setS] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setS(null);
    api.summary(new Date(Date.now() - days * 86400000).toISOString()).then((r) => { if (!cancelled) setS(r); }).catch(onError);
    return () => { cancelled = true; };
  }, [api, days, onError]);

  return (
    <section>
      <div className="admin__bar">
        <h2>How fast is the response?</h2>
        <label className="field field--inline">Period
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select>
        </label>
      </div>
      {!s ? <p className="muted">Loading&hellip;</p> : (
        <>
          <div className="kpis">
            <Kpi label="Incidents" value={s.total_incidents} />
            <Kpi label="Closed" value={s.closed_incidents} />
            <Kpi label="Report to police on scene" value={duration(s.avg_report_to_police_on_scene_s)} />
            <Kpi label="Report to ambulance assigned" value={duration(s.avg_report_to_ambulance_assigned_s)} />
            <Kpi label="Ambulance assigned to on scene" value={duration(s.avg_ambulance_assigned_to_on_scene_s)} />
            <Kpi label="Report to hospital admission" value={duration(s.avg_report_to_hospital_admission_s)} />
          </div>
          <p className="muted">Averages of the incidents that reached each stage, measured from the time the report was received.</p>
          <div className="split">
            <div><h3>By severity</h3><ul className="plain">{s.by_severity.map((r) => <li key={r.severity}><span>{r.severity}</span><b>{r.count}</b></li>)}</ul></div>
            <div><h3>By how it was reported</h3><ul className="plain">{s.by_source.map((r) => <li key={r.source}><span>{r.source}</span><b>{r.count}</b></li>)}</ul></div>
          </div>
        </>
      )}
    </section>
  );
}

function UsersTab({ api, data, run }) {
  const empty = { name: '', role: 'dispatcher', email: '', phone: '', password: '', link: '' };
  const [f, setF] = useState(empty);
  const [error, setError] = useState(null);
  const [resetFor, setResetFor] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value, ...(k === 'role' ? { link: '' } : {}) });

  const linkOptions = f.role === 'hospital' ? data.hospitals.map((h) => [h.id, h.name])
    : f.role === 'police' ? data.police.map((p) => [p.id, p.name])
      : f.role === 'ambulance' ? data.ambulances.map((a) => [a.id, a.plate_number]) : null;
  const linkKey = { hospital: 'hospital_id', police: 'police_unit_id', ambulance: 'ambulance_id' }[f.role];
  const linkedName = (u) => (u.hospital_id ? data.hospitals.find((h) => h.id === u.hospital_id)?.name
    : u.police_unit_id ? data.police.find((p) => p.id === u.police_unit_id)?.name
      : u.ambulance_id ? data.ambulances.find((a) => a.id === u.ambulance_id)?.plate_number : '') || '';

  async function submit(e) {
    e.preventDefault();
    if (!f.email.trim() && !f.phone.trim()) return setError('Give an email or a phone number to sign in with.');
    if (f.password.length < 8) return setError('The password needs at least 8 characters.');
    if (linkOptions && !f.link) return setError(`Choose which ${f.role === 'ambulance' ? 'ambulance' : f.role === 'police' ? 'police unit' : 'hospital'} this account belongs to.`);
    setError(null);
    const body = { name: f.name.trim(), role: f.role, password: f.password,
      ...(f.email.trim() ? { email: f.email.trim() } : {}), ...(f.phone.trim() ? { phone: f.phone.trim() } : {}), ...(linkKey ? { [linkKey]: f.link } : {}) };
    if (await run(() => api.createUser(body), `Account created for ${body.name}.`)) setF(empty);
    return undefined;
  }

  return (
    <section>
      <h2>Accounts</h2>
      <table className="adm-table">
        <thead><tr><th>Name</th><th>Role</th><th>Signs in with</th><th>Belongs to</th><th>Status</th><th /></tr></thead>
        <tbody>
          {data.users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td><td>{u.role}</td><td>{u.email || u.phone}</td><td>{linkedName(u)}</td>
              <td><State active={u.is_active}>Active</State></td>
              <td className="adm-actions">
                <Toggle row={u} label={u.name} onChange={(v) => run(() => api.updateUser(u.id, { is_active: v }), `${u.name} ${v ? 'enabled' : 'disabled'}.`)} />
                {resetFor === u.id ? (
                  <span className="inline-form">
                    <input type="password" aria-label={`New password for ${u.name}`} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                    <button className="btn" disabled={newPassword.length < 8} onClick={async () => { if (await run(() => api.updateUser(u.id, { password: newPassword }), `Password changed for ${u.name}.`)) { setResetFor(null); setNewPassword(''); } }}>Save</button>
                  </span>
                ) : <button className="btn btn--ghost" aria-label={`Reset password for ${u.name}`} onClick={() => { setResetFor(u.id); setNewPassword(''); }}>Reset password</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="admin__form" onSubmit={submit} aria-label="New account">
        <h3>New account</h3>
        <label className="field">Name<input value={f.name} onChange={set('name')} required minLength={2} /></label>
        <label className="field">Role<select value={f.role} onChange={set('role')}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
        {linkOptions && (
          <label className="field">{f.role === 'hospital' ? 'Hospital' : f.role === 'police' ? 'Police unit' : 'Ambulance'}
            <select value={f.link} onChange={set('link')}><option value="">Choose&hellip;</option>{linkOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
          </label>
        )}
        <label className="field">Email<input type="email" value={f.email} onChange={set('email')} /></label>
        <label className="field">Phone<input type="tel" value={f.phone} onChange={set('phone')} placeholder="+263 77 123 4567" /></label>
        <label className="field">Password (8+ characters)<input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn--primary">Create account</button>
      </form>
    </section>
  );
}

function SimpleForm({ title, fields, onSubmit }) {
  const blank = Object.fromEntries(fields.map((f) => [f.key, '']));
  const [v, setV] = useState(blank);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    try { setError(null); if (await onSubmit(v)) setV(blank); } catch (err) { setError(err.message); }
  }
  return (
    <form className="admin__form" onSubmit={submit} aria-label={title}>
      <h3>{title}</h3>
      {fields.map((f) => (
        <label key={f.key} className="field">{f.label}
          <input type={f.type || 'text'} step={f.type === 'number' ? 'any' : undefined} value={v[f.key]} required={f.required}
            onChange={(e) => setV({ ...v, [f.key]: e.target.value })} placeholder={f.placeholder} />
        </label>
      ))}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn--primary">Add</button>
    </form>
  );
}

function AmbulancesTab({ api, data, run }) {
  return (
    <section>
      <h2>Ambulances</h2>
      <table className="adm-table">
        <thead><tr><th>Plate</th><th>Provider</th><th>State</th><th>Last position</th><th /></tr></thead>
        <tbody>
          {data.ambulances.map((a) => (
            <tr key={a.id}>
              <td>{a.plate_number}</td><td>{a.provider}</td>
              <td><State active={a.is_active}>{a.is_available ? 'Available' : 'On a job'}</State></td>
              <td>{a.location_updated_at ? `${ageLabel(a.location_updated_at, Date.now())} ago` : 'none'}</td>
              <td className="adm-actions"><Toggle row={a} label={a.plate_number} onChange={(v) => run(() => api.updateAmbulance(a.id, { is_active: v }), `${a.plate_number} ${v ? 'enabled' : 'disabled'}.`)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <SimpleForm title="New ambulance" fields={[{ key: 'plate_number', label: 'Number plate', required: true, placeholder: 'ADX-1005' }, { key: 'provider', label: 'Provider' }]}
        onSubmit={(v) => run(() => api.createAmbulance({ plate_number: v.plate_number.trim(), ...(v.provider.trim() ? { provider: v.provider.trim() } : {}) }), `Ambulance ${v.plate_number.trim()} added.`)} />
    </section>
  );
}

function PoliceTab({ api, data, run }) {
  return (
    <section>
      <h2>Police units</h2>
      <table className="adm-table">
        <thead><tr><th>Unit</th><th>Station</th><th>Coverage</th><th>State</th><th /></tr></thead>
        <tbody>
          {data.police.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td><td>{p.station}</td><td>{p.coverage_area}</td>
              <td><State active={p.is_active}>{p.is_available ? 'Available' : 'On a job'}</State></td>
              <td className="adm-actions"><Toggle row={p} label={p.name} onChange={(v) => run(() => api.updatePoliceUnit(p.id, { is_active: v }), `${p.name} ${v ? 'enabled' : 'disabled'}.`)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <SimpleForm title="New police unit" fields={[{ key: 'name', label: 'Unit name', required: true }, { key: 'station', label: 'Station' }, { key: 'coverage_area', label: 'Area it covers' }]}
        onSubmit={(v) => run(() => api.createPoliceUnit({ name: v.name.trim(), ...(v.station.trim() ? { station: v.station.trim() } : {}), ...(v.coverage_area.trim() ? { coverage_area: v.coverage_area.trim() } : {}) }), `${v.name.trim()} added.`)} />
    </section>
  );
}

function HospitalsTab({ api, data, run }) {
  return (
    <section>
      <h2>Hospitals</h2>
      <table className="adm-table">
        <thead><tr><th>Hospital</th><th>Phone</th><th>Trauma bays</th><th>State</th><th /></tr></thead>
        <tbody>
          {data.hospitals.map((h) => (
            <tr key={h.id}>
              <td>{h.name}</td><td>{h.contact_number}</td><td>{h.trauma_bays_free} free of {h.trauma_bays_total}</td>
              <td><State active={h.is_active}>Active</State></td>
              <td className="adm-actions"><Toggle row={h} label={h.name} onChange={(v) => run(() => api.updateHospital(h.id, { is_active: v }), `${h.name} ${v ? 'enabled' : 'disabled'}.`)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <SimpleForm title="New hospital"
        fields={[{ key: 'name', label: 'Name', required: true }, { key: 'lat', label: 'Latitude', type: 'number', required: true, placeholder: '-17.8292' }, { key: 'lng', label: 'Longitude', type: 'number', required: true, placeholder: '31.0522' },
          { key: 'contact_number', label: 'Phone' }, { key: 'trauma_bays_total', label: 'Trauma bays (total)', type: 'number' }, { key: 'trauma_bays_free', label: 'Trauma bays (free now)', type: 'number' }]}
        onSubmit={(v) => {
          const total = Number(v.trauma_bays_total || 0); const free = Number(v.trauma_bays_free || 0);
          if (free > total) throw new Error('Free bays cannot be more than the total.');
          return run(() => api.createHospital({ name: v.name.trim(), lat: Number(v.lat), lng: Number(v.lng), trauma_bays_total: total, trauma_bays_free: free, ...(v.contact_number.trim() ? { contact_number: v.contact_number.trim() } : {}) }), `${v.name.trim()} added.`);
        }} />
      <p className="muted">To find coordinates, right-click the place in Google Maps and copy the two numbers shown.</p>
    </section>
  );
}

export default function AdminConsole({ api, onError, onNotice }) {
  const [tab, setTab] = useState('summary');
  const [data, setData] = useState({ users: [], ambulances: [], police: [], hospitals: [] });
  const load = useCallback(async () => {
    try {
      const [users, ambulances, police, hospitals] = await Promise.all([api.adminUsers(), api.adminAmbulances(), api.adminPoliceUnits(), api.adminHospitals()]);
      setData({ users, ambulances, police, hospitals });
    } catch (e) { onError(e); }
  }, [api, onError]);
  useEffect(() => { load(); }, [load]);

  // Run a change, reload the lists, and say what happened. Returns true on success so forms know to clear.
  const run = async (fn, doneText) => {
    try { await fn(); await load(); onNotice(doneText); return true; } catch (e) { onError(e); return false; }
  };

  return (
    <div className="admin">
      <nav className="admin__tabs" role="tablist" aria-label="Administration">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'tab tab--on' : 'tab'} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>
      {tab === 'summary' && <SummaryTab api={api} onError={onError} />}
      {tab === 'users' && <UsersTab api={api} data={data} run={run} />}
      {tab === 'ambulances' && <AmbulancesTab api={api} data={data} run={run} />}
      {tab === 'police' && <PoliceTab api={api} data={data} run={run} />}
      {tab === 'hospitals' && <HospitalsTab api={api} data={data} run={run} />}
    </div>
  );
}
