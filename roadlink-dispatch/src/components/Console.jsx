import { useEffect, useMemo, useRef, useState } from 'react';
import { needsAction, splitBoard } from '../lib/board.js';
import { chime } from '../lib/alert.js';
import { SEVERITY } from '../lib/format.js';
import { useConsole, useNow } from '../lib/hooks.js';
import { loadMuted, saveMuted } from '../lib/session.js';
import CloseDialog from './CloseDialog.jsx';
import IncidentList from './IncidentList.jsx';
import IncidentPanel from './IncidentPanel.jsx';
import MapView from './MapView.jsx';
import NewReportPanel from './NewReportPanel.jsx';

export default function Console({ api, baseUrl, session, onLogout }) {
  const now = useNow(15000);
  const [muted, setMuted] = useState(loadMuted);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const [tab, setTab] = useState('open');
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [picked, setPicked] = useState(null);
  const [closing, setClosing] = useState(false);
  const [notice, setNotice] = useState(null); // { kind: 'new' | 'ok' | 'error', text }

  const { board, fleet, live, loading, error, refresh, upsert } = useConsole({
    api, baseUrl, token: session.token, onAuthLost: onLogout,
    onNewIncident: (i) => {
      if (!mutedRef.current) chime();
      setNotice({ kind: 'new', text: `New ${(SEVERITY[i.severity] || SEVERITY.minor).label.toLowerCase()} report ${i.reference_number}` });
    },
  });

  const { open, closed } = useMemo(() => splitBoard(board), [board]);
  const selected = selectedId ? board.byId[selectedId] : null;
  const attention = open.filter(needsAction).length;

  // First load: put the most urgent incident in front of the dispatcher without waiting for a click.
  useEffect(() => { if (!selectedId && !creating && open.length) setSelectedId(open[0].id); }, [open, selectedId, creating]);
  useEffect(() => { if (notice && notice.kind !== 'error') { const t = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(t); } return undefined; }, [notice]);

  const onError = useRef((e) => setNotice({ kind: 'error', text: e.message })).current;

  const mapIncidents = useMemo(() => (selected && selected.status === 'closed' ? [...open, selected] : open), [open, selected]);

  async function sendReport(body) {
    const created = await api.createReport(body);
    setCreating(false); setPicked(null);
    await refresh();
    setSelectedId(created.id); setTab('open');
    setNotice({ kind: 'ok', text: `Report ${created.reference_number} sent. The nearest police unit is alerted.` });
  }

  async function closeIncident(outcome, note) {
    try {
      upsert(await api.close(selected.id, outcome, note));
      setClosing(false);
      setNotice({ kind: 'ok', text: `${selected.reference_number} closed.` });
    } catch (e) { onError(e); }
  }

  function toggleMute() { const m = !muted; setMuted(m); saveMuted(m); }
  const bannerText = notice ? notice.text : error;

  return (
    <div className="console">
      <header className="top">
        <div className="top__id">
          <span className="top__mark" aria-hidden="true" />
          <div><h1>Dispatch</h1><p>{session.user.name} &middot; {session.user.role}</p></div>
        </div>
        <div className="top__stats" aria-label="Summary">
          <span><b>{open.length}</b> open</span>
          <span className={attention ? 'stat--alert' : ''}><b>{attention}</b> need action</span>
        </div>
        <div className="top__tools">
          <span className={`pill pill--${live === 'connecting' ? 'connecting' : live}`}><i />{live === 'online' ? 'Live' : live === 'connecting' ? 'Connecting' : 'Offline, polling'}</span>
          <button className="btn btn--primary" onClick={() => { setCreating(true); setPicked(null); setSelectedId(null); }} disabled={creating}>New report</button>
          <button className="btn btn--ghost" onClick={toggleMute} aria-pressed={muted}>{muted ? 'Sound off' : 'Sound on'}</button>
          <button className="btn btn--ghost" onClick={onLogout}>Sign out</button>
        </div>
      </header>

      {bannerText && (
        <div className={`banner banner--${notice ? notice.kind : 'error'}`} role={notice && notice.kind === 'error' || !notice ? 'alert' : 'status'}>
          <span>{bannerText}</span>
          <button className="link" onClick={() => (notice ? setNotice(null) : refresh())}>{notice ? 'Dismiss' : 'Retry'}</button>
        </div>
      )}

      <main className="console__body">
        <IncidentList open={open} closed={closed} tab={tab} onTab={setTab} selectedId={selectedId} onSelect={(id) => { setCreating(false); setSelectedId(id); }} now={now} />
        <MapView incidents={mapIncidents} fleet={fleet} selectedId={selectedId} onSelect={(id) => { setCreating(false); setSelectedId(id); }}
          pickMode={creating} picked={picked} onPick={setPicked} />
        <aside className="console__side">
          {creating ? (
            <NewReportPanel picked={picked} onCancel={() => { setCreating(false); setPicked(null); }} onSubmit={sendReport} />
          ) : selected ? (
            <IncidentPanel api={api} incident={selected} now={now} onUpdated={upsert} onCloseRequest={() => setClosing(true)} onError={onError} />
          ) : (
            <p className="empty">{loading ? 'Loading\u2026' : 'Select an incident, or press New report to enter one a caller phoned in.'}</p>
          )}
        </aside>
      </main>

      {closing && selected && <CloseDialog incident={selected} onConfirm={closeIncident} onCancel={() => setClosing(false)} />}
    </div>
  );
}
