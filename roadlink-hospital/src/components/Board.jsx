import { useEffect, useMemo, useRef, useState } from 'react';
import { groupBoard } from '../lib/board.js';
import { chime } from '../lib/alert.js';
import { useBoard, useNow } from '../lib/hooks.js';
import { loadMuted, saveMuted } from '../lib/session.js';
import IncidentCard from './IncidentCard.jsx';
import DoneRow from './DoneRow.jsx';
import CapacityPanel from './CapacityPanel.jsx';
import TimelineDrawer from './TimelineDrawer.jsx';

const LIVE_LABEL = { online: 'Live', connecting: 'Connecting…', offline: 'Reconnecting — refreshing every 15s' };

export default function Board({ api, baseUrl, session, onLogout }) {
  const [muted, setMuted] = useState(loadMuted);
  const [newIds, setNewIds] = useState(() => new Set());
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);
  const [timelineFor, setTimelineFor] = useState(null);
  const [hospital, setHospital] = useState(null);
  const now = useNow();

  const mutedRef = useRef(muted);
  useEffect(() => { mutedRef.current = muted; saveMuted(muted); }, [muted]);

  const { board, live, loading, error, refresh } = useBoard({
    api, baseUrl, token: session.token, onAuthLost: onLogout,
    onIncoming: (inc) => {
      if (!mutedRef.current) chime();
      setNewIds((s) => new Set(s).add(inc.id));
      setTimeout(() => setNewIds((s) => { const n = new Set(s); n.delete(inc.id); return n; }), 8000);
    },
  });

  useEffect(() => {
    api.hospitals()
      .then((list) => setHospital(list.find((h) => h.id === session.user.hospital_id) || null))
      .catch((e) => setToast(e.message));
  }, [api, session.user.hospital_id]);

  const groups = useMemo(() => groupBoard(board.incidents), [board.incidents]);

  useEffect(() => {
    document.title = groups.incoming.length ? `(${groups.incoming.length}) Incoming — RoadLink Hospital` : 'RoadLink Hospital';
  }, [groups.incoming.length]);

  async function act(fn, id) {
    setBusyId(id);
    try { await fn(id); await refresh(); } catch (e) { setToast(e.message); } finally { setBusyId(null); }
  }

  const card = (i, idx) => (
    <IncidentCard
      key={i.id} incident={i} index={idx} now={now} isNew={newIds.has(i.id)} busy={busyId === i.id}
      onAcknowledge={(id) => act(api.acknowledge, id)} onAdmit={(id) => act(api.admit, id)} onTimeline={setTimelineFor}
    />
  );

  return (
    <div className="shell">
      <header className="top">
        <div className="top__id">
          <span className="top__mark" aria-hidden="true" />
          <div>
            <h1>{hospital ? hospital.name : session.user.name}</h1>
            <p>RoadLink emergency intake</p>
          </div>
        </div>
        <div className="top__tools">
          <span className={`pill pill--${live}`} role="status"><i />{LIVE_LABEL[live]}</span>
          <button className="btn btn--ghost" onClick={() => setMuted(!muted)} aria-pressed={muted}>{muted ? 'Sound off' : 'Sound on'}</button>
          <button className="btn btn--ghost" onClick={onLogout}>Sign out</button>
        </div>
      </header>

      {(toast || error) && (
        <div className="toast" role="alert">
          <span>{toast || error}</span>
          <button className="link" onClick={() => setToast(null)}>Dismiss</button>
        </div>
      )}

      <div className="layout">
        <aside className="side">
          {hospital && <CapacityPanel api={api} hospital={hospital} onError={setToast} />}
          <section className="panel tally" aria-label="Today">
            <h2 className="panel__title">On the board</h2>
            <p><strong>{groups.incoming.length}</strong> inbound</p>
            <p><strong>{groups.preparing.length}</strong> preparing</p>
          </section>
        </aside>

        <main className="columns">
          <section className="col" aria-label="Incoming">
            <h2 className="col__title">Incoming <b>{groups.incoming.length}</b></h2>
            {loading && <p className="muted">Loading…</p>}
            {!loading && groups.incoming.length === 0 && <p className="empty">No patients inbound. This board updates the moment dispatch notifies you.</p>}
            {groups.incoming.map(card)}
          </section>

          <section className="col" aria-label="Preparing">
            <h2 className="col__title">Preparing <b>{groups.preparing.length}</b></h2>
            {!loading && groups.preparing.length === 0 && <p className="empty">Acknowledged patients appear here until they are received.</p>}
            {groups.preparing.map(card)}
          </section>

          <section className="col col--done" aria-label="Recently received">
            <h2 className="col__title">Recently received</h2>
            {groups.done.length === 0 && <p className="empty">Nothing yet.</p>}
            <ul className="donelist">{groups.done.map((i) => <DoneRow key={i.id} incident={i} onTimeline={setTimelineFor} />)}</ul>
          </section>
        </main>
      </div>

      {timelineFor && <TimelineDrawer api={api} incident={timelineFor} onClose={() => setTimelineFor(null)} />}
    </div>
  );
}
