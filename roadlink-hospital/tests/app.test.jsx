import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { incident } from './fixtures.js';

// A controllable stand-in for the Socket.IO connection.
const sock = vi.hoisted(() => {
  const handlers = {};
  return {
    handlers,
    emit: (evt, payload) => (handlers[evt] || []).forEach((h) => h(payload)),
    reset: () => Object.keys(handlers).forEach((k) => delete handlers[k]),
    socket: { on: (evt, cb) => { (handlers[evt] = handlers[evt] || []).push(cb); }, close: () => {} },
  };
});
vi.mock('socket.io-client', () => ({ io: () => sock.socket }));

import App from '../src/App.jsx';

const HOSP = { id: 'h1', name: 'Harare Central Hospital', trauma_bays_total: 6, trauma_bays_free: 3, capacity_updated_at: new Date().toISOString() };
const USER = { id: 'u1', name: 'Harare Central ED Desk', role: 'hospital', hospital_id: 'h1' };

/** Tiny in-memory RoadLink Core. */
let server; let calls;
function setupServer(over = {}) {
  server = { incidents: [], hospital: { ...HOSP }, user: USER, failCapacity: false, expireSession: false, ...over };
  calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = url.replace('http://localhost:3000/api/v1', '');
    const method = init.method || 'GET';
    calls.push({ method, path, auth: init.headers && init.headers.Authorization, body: init.body ? JSON.parse(init.body) : undefined });
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    const err = (status, code, message) => ({ ok: false, status, json: async () => ({ error: { code, message } }) });

    if (path === '/auth/login') return ok({ token: 'tok', user: server.user });
    if (server.expireSession && path.startsWith('/incidents')) return err(401, 'UNAUTHORIZED', 'expired');
    if (path.startsWith('/incidents?')) return ok({ incidents: server.incidents });
    if (path === '/hospitals') return ok({ hospitals: [server.hospital] });
    if (path === '/hospitals/me/capacity') {
      if (server.failCapacity) return err(409, 'BAD_CAPACITY', 'Free bays cannot exceed total bays');
      server.hospital = { ...server.hospital, trauma_bays_free: init.body ? JSON.parse(init.body).trauma_bays_free : 0 };
      return ok(server.hospital);
    }
    const m = path.match(/^\/incidents\/([^/]+)\/hospital\/(acknowledge|admit)$/);
    if (m) {
      const inc = server.incidents.find((i) => i.id === m[1]);
      inc.assignment.hospital.state = m[2] === 'acknowledge' ? 'acknowledged' : 'admitted';
      if (m[2] === 'admit') inc.status = 'admitted';
      return ok(inc);
    }
    if (path.match(/^\/incidents\/[^/]+\/timeline$/)) {
      return ok({ timeline: [{ id: 1, event: 'incident_created', actor_role: 'citizen', created_at: new Date().toISOString() }, { id: 2, event: 'hospital_notified', actor_name: 'Dispatcher One', note: 'Harare Central Hospital', created_at: new Date().toISOString() }] });
    }
    return err(404, 'NOT_FOUND', 'unexpected ' + path);
  });
}

async function signIn(user = userEvent.setup()) {
  render(<App />);
  await user.type(screen.getByLabelText(/email or phone/i), 'hospital2@roadlink.zw');
  await user.type(screen.getByLabelText(/password/i), 'secret');
  await user.click(screen.getByRole('button', { name: /sign in/i }));
  return user;
}

beforeEach(() => { sessionStorage.clear(); sock.reset(); });

describe('sign in', () => {
  it('lets hospital staff in and loads their board', async () => {
    setupServer({ incidents: [incident()] });
    await signIn();
    expect(await screen.findByText('Harare Central Hospital')).toBeInTheDocument();
    expect(calls.find((c) => c.path.startsWith('/incidents?')).auth).toBe('Bearer tok');
  });

  it('refuses other roles and does not keep their session', async () => {
    setupServer({ user: { ...USER, role: 'police' } });
    await signIn();
    expect(await screen.findByRole('alert')).toHaveTextContent(/hospital emergency-department staff/i);
    expect(sessionStorage.length).toBe(0);
    expect(screen.queryByText(/incoming/i)).not.toBeInTheDocument();
  });

  it('is sent back to sign-in when the session expires mid-use', async () => {
    setupServer({ incidents: [], expireSession: true });
    await signIn();
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });
});

describe('the intake workflow', () => {
  it('shows an inbound patient, acknowledges it, then confirms admission in two steps', async () => {
    const inc = incident({ severity: 'critical', verified_victim_count: 3, hazard_notes: 'Fuel spill' });
    setupServer({ incidents: [inc] });
    const user = await signIn();

    const card = (await screen.findByText(inc.reference_number)).closest('article');
    expect(within(card).getByText('Critical')).toBeInTheDocument();
    expect(within(card).getByText(/confirmed by police/i)).toBeInTheDocument();
    expect(within(card).getByText(/Fuel spill/)).toBeInTheDocument();
    expect(within(card).getByText('ADX-1001')).toBeInTheDocument();
    expect(within(card).getByRole('timer')).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: /acknowledge/i }));
    expect(calls.some((c) => c.method === 'POST' && c.path === `/incidents/${inc.id}/hospital/acknowledge`)).toBe(true);

    const preparing = await screen.findByRole('region', { name: /preparing/i });
    const admit = await within(preparing).findByRole('button', { name: /mark admitted/i });
    await user.click(admit);
    expect(calls.some((c) => c.path.endsWith('/admit'))).toBe(false); // first click only arms it
    await user.click(await within(preparing).findByRole('button', { name: /confirm: patient received/i }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === `/incidents/${inc.id}/hospital/admit`)).toBe(true));
    const done = await screen.findByRole('region', { name: /recently received/i });
    await waitFor(() => expect(within(done).getByText(inc.reference_number)).toBeInTheDocument());
  });

  it('shows "AT DOOR" once the ambulance has arrived', async () => {
    setupServer({ incidents: [incident({ ambulance: { state: 'arrived' } })] });
    await signIn();
    expect(await screen.findByText('AT DOOR')).toBeInTheDocument();
  });

  it('surfaces a server refusal instead of failing silently', async () => {
    const inc = incident();
    setupServer({ incidents: [inc] });
    const user = await signIn();
    const card = (await screen.findByText(inc.reference_number)).closest('article');
    globalThis.fetch.mockImplementationOnce(async () => ({ ok: true, status: 200, json: async () => ({ incidents: [inc] }) })); // keep the list call happy
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init = {}) =>
      (init.method === 'POST' ? { ok: false, status: 409, json: async () => ({ error: { code: 'BAD_STATE', message: 'Already acknowledged' } }) } : original(url, init)));
    await user.click(within(card).getByRole('button', { name: /acknowledge/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Already acknowledged');
  });
});

describe('patient vitals', () => {
  const VITALS = { pulse_bpm: 118, systolic_bp: 100, diastolic_bp: 65, spo2_percent: 94, consciousness: 'voice', recorded_at: new Date().toISOString() };

  it('shows the crew\'s latest vitals on the incoming card', async () => {
    const inc = incident({ latest_vitals: VITALS });
    setupServer({ incidents: [inc] });
    await signIn();
    const card = (await screen.findByText(inc.reference_number)).closest('article');
    const panel = within(card).getByRole('region', { name: /patient vitals/i });
    expect(within(panel).getByText('118')).toBeInTheDocument();
    expect(within(panel).getByText('100/65')).toBeInTheDocument();
    expect(within(panel).getByText('94')).toBeInTheDocument();
    expect(within(panel).getByText('Responds to voice')).toBeInTheDocument();
  });

  it('says so when no vitals have been recorded yet', async () => {
    const inc = incident({ latest_vitals: null });
    setupServer({ incidents: [inc] });
    await signIn();
    const card = (await screen.findByText(inc.reference_number)).closest('article');
    expect(within(card).getByText(/no vitals recorded by the crew yet/i)).toBeInTheDocument();
  });

  it('updates the card live when the crew records new vitals', async () => {
    const inc = incident({ latest_vitals: null });
    setupServer({ incidents: [inc] });
    await signIn();
    const card = (await screen.findByText(inc.reference_number)).closest('article');
    expect(within(card).getByText(/no vitals recorded/i)).toBeInTheDocument();

    act(() => sock.emit('incident:update', { event: 'vitals_recorded', incident: { ...inc, latest_vitals: VITALS } }));
    await waitFor(() => expect(within(card).getByText('118')).toBeInTheDocument());
    expect(within(card).queryByText(/no vitals recorded/i)).not.toBeInTheDocument();
  });
});

describe('live updates', () => {
  it('adds a card the instant dispatch notifies the hospital, and removes it if reassigned', async () => {
    setupServer({ incidents: [] });
    await signIn();
    expect(await screen.findByText(/no patients inbound/i)).toBeInTheDocument();

    const fresh = incident({ severity: 'serious' });
    act(() => sock.emit('incident:update', { event: 'hospital_notified', incident: fresh }));
    expect(await screen.findByText(fresh.reference_number)).toBeInTheDocument();
    await waitFor(() => expect(document.title).toMatch(/^\(1\) Incoming/));

    act(() => sock.emit('incident:unassigned', { incident_id: fresh.id }));
    await waitFor(() => expect(screen.queryByText(fresh.reference_number)).not.toBeInTheDocument());
    await waitFor(() => expect(document.title).toBe('RoadLink Hospital'));
  });

  it('shows the polling-fallback notice when the socket drops, and recovers when it returns', async () => {
    setupServer({ incidents: [] });
    await signIn();
    act(() => sock.emit('connect'));
    expect(await screen.findByText('Live')).toBeInTheDocument();
    act(() => sock.emit('disconnect'));
    expect(await screen.findByText(/reconnecting/i)).toBeInTheDocument();
    act(() => sock.emit('connect'));
    expect(await screen.findByText('Live')).toBeInTheDocument();
  });
});

describe('trauma bay capacity', () => {
  it('updates the free count and tells the server', async () => {
    setupServer();
    const user = await signIn();
    expect(await screen.findByTestId('free-count')).toHaveTextContent('3');
    await user.click(screen.getByRole('button', { name: /one more free bay/i }));
    await waitFor(() => expect(screen.getByTestId('free-count')).toHaveTextContent('4'));
    expect(calls.find((c) => c.path === '/hospitals/me/capacity').body).toEqual({ trauma_bays_free: 4, trauma_bays_total: 6 });
  });

  it('rolls back and explains when the server rejects the change', async () => {
    setupServer({ failCapacity: true });
    const user = await signIn();
    await screen.findByTestId('free-count');
    await user.click(screen.getByRole('button', { name: /one fewer free bay/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot exceed total/i);
    expect(screen.getByTestId('free-count')).toHaveTextContent('3');
  });
});

describe('timeline', () => {
  it('opens the audit trail for an incident', async () => {
    const inc = incident();
    setupServer({ incidents: [inc] });
    const user = await signIn();
    const card = (await screen.findByText(inc.reference_number)).closest('article');
    await user.click(within(card).getByRole('button', { name: /timeline/i }));
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByText('Reported')).toBeInTheDocument();
    expect(within(drawer).getByText('Hospital notified')).toBeInTheDocument();
    expect(within(drawer).getByText(/Dispatcher One/)).toBeInTheDocument();
  });
});
