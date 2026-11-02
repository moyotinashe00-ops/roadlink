import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { incident, recommendations, withAmbulance } from './fixtures.js';

// A controllable stand-in for the Socket.IO connection.
const sock = vi.hoisted(() => {
  const handlers = {};
  return {
    emit: (evt, payload) => (handlers[evt] || []).forEach((h) => h(payload)),
    reset: () => Object.keys(handlers).forEach((k) => delete handlers[k]),
    on: (evt, h) => { (handlers[evt] = handlers[evt] || []).push(h); },
  };
});
vi.mock('socket.io-client', () => ({ io: () => ({ on: (e, h) => sock.on(e, h), close: () => {} }) }));

// Leaflet needs a real layout engine; the map itself is not what these tests check.
vi.mock('../src/components/MapView.jsx', async () => {
  const React = await vi.importActual('react');
  return {
    default: ({ pickMode, onPick }) => React.createElement('div', { 'data-testid': 'map' },
      pickMode ? React.createElement('button', { onClick: () => onPick({ lat: -17.8, lng: 31.05 }) }, 'Drop pin') : null),
  };
});

import App from '../src/App.jsx';

let calls;
let incidents;

function installFetch(routes = {}) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace('/api/v1', '') + u.search;
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, path, body });
    const key = `${method} ${path}`;
    let result;
    if (routes[key]) result = routes[key](body);
    else if (key === 'GET /incidents?status=all&limit=100') result = { incidents };
    else if (key === 'GET /ambulances') result = { ambulances: [] };
    else if (key === 'GET /police-units') result = { police_units: [] };
    else if (/^GET \/incidents\/[^/]+\/recommendations$/.test(key)) result = recommendations();
    else if (/^GET \/incidents\/[^/]+\/timeline$/.test(key)) result = { timeline: [] };
    else result = { error: { code: 'NOT_MOCKED', message: `No mock for ${key}` } };
    const failed = result && result.error;
    return { status: failed ? 404 : 200, ok: !failed, json: async () => result };
  }));
}

const signIn = () => sessionStorage.setItem('roadlink.dispatch.session',
  JSON.stringify({ token: 'tok', user: { name: 'Dispatcher One', role: 'dispatcher' } }));
const posted = (path) => calls.find((c) => c.method === 'POST' && c.path === path);

beforeEach(() => { sock.reset(); sessionStorage.clear(); localStorage.clear(); incidents = [incident()]; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('signing in', () => {
  it('turns away accounts that are not dispatchers or administrators', async () => {
    installFetch({ 'POST /auth/login': () => ({ token: 't', user: { name: 'Officer Moyo', role: 'police' } }) });
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email or phone/i), 'police1@roadlink.zw');
    await user.type(screen.getByLabelText(/password/i), 'ChangeMe123!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('for dispatchers and administrators');
    expect(screen.queryByText(/need action/i)).not.toBeInTheDocument();
  });

  it('lets a dispatcher in and shows the console', async () => {
    installFetch({ 'POST /auth/login': () => ({ token: 't', user: { name: 'Dispatcher One', role: 'dispatcher' } }) });
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email or phone/i), 'dispatcher@roadlink.zw');
    await user.type(screen.getByLabelText(/password/i), 'ChangeMe123!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/need action/i)).toBeInTheDocument();
  });
});

describe('the incident board', () => {
  it('lists the most urgent incident first and opens it', async () => {
    signIn();
    incidents = [
      incident({ id: 'm', reference_number: 'RL-2600010', severity: 'minor' }),
      incident({ id: 'c', reference_number: 'RL-2600011', severity: 'critical' }),
    ];
    installFetch();
    render(<App />);
    const buttons = await screen.findAllByRole('button', { name: /^RL-26000\d+, /i });
    expect(buttons[0]).toHaveAccessibleName(/RL-2600011, Critical/);
    expect(await screen.findByRole('heading', { name: 'RL-2600011' })).toBeInTheDocument();
  });

  it('shows what each open incident still needs', async () => {
    signIn();
    installFetch();
    render(<App />);
    expect(await screen.findByText('Ambulance: needed')).toBeInTheDocument();
    expect(screen.getByText('Police: Alerted')).toBeInTheDocument();
  });

  it('shows closed incidents under their own tab', async () => {
    signIn();
    incidents = [incident(), incident({ id: 'old', reference_number: 'RL-2600005', status: 'closed', closed_at: '2026-10-18T09:00:00Z' })];
    installFetch();
    render(<App />);
    const user = userEvent.setup();
    await screen.findByRole('tab', { name: /closed/i });
    await user.click(screen.getByRole('tab', { name: /closed/i }));
    expect(await screen.findByRole('button', { name: /RL-2600005, .*Closed/ })).toBeInTheDocument();
  });
});

describe('patient vitals', () => {
  it('shows the crew\'s latest vitals on an incident that has them', async () => {
    signIn();
    incidents = [withAmbulance('onScene', {
      latest_vitals: { pulse_bpm: 130, systolic_bp: 88, diastolic_bp: null, spo2_percent: 91, consciousness: 'pain', recorded_at: '2026-10-18T08:10:00.000Z' },
    })];
    installFetch();
    render(<App />);
    const panel = await screen.findByRole('region', { name: /patient vitals/i });
    expect(within(panel).getByText('130')).toBeInTheDocument();
    expect(within(panel).getByText('91')).toBeInTheDocument();
    expect(within(panel).getByText('Responds to pain')).toBeInTheDocument();
    expect(within(panel).getAllByText('—').length).toBe(1); // incomplete blood pressure is shown as missing, not as a number
  });

  it('shows nothing when no vitals have been recorded', async () => {
    signIn();
    incidents = [withAmbulance('enRoute', { latest_vitals: null })];
    installFetch();
    render(<App />);
    await screen.findByRole('heading', { name: 'RL-2600001' });
    expect(screen.queryByRole('region', { name: /patient vitals/i })).not.toBeInTheDocument();
  });
});

describe('alerting police by hand', () => {
  const none = () => incident({ status: 'reported', assignment: { police: null, ambulance: null, hospital: null } });

  it('offers units when nobody was alerted, and alerts the one the dispatcher picks', async () => {
    signIn();
    incidents = [none()];
    installFetch({ 'POST /incidents/inc-1/police': () => incident({ updated_at: '2026-10-18T08:05:00Z', assignment: { police: { unit_id: 'pu-2', name: 'Avondale Traffic', state: 'notified' }, ambulance: null, hospital: null } }) });
    render(<App />);
    expect(await screen.findByText(/no police unit is alerted/i)).toBeInTheDocument();
    const row = (await screen.findByText('Avondale Traffic')).closest('li');
    expect(within(row).getByText('busy')).toBeInTheDocument();
    await userEvent.setup().click(within(row).getByRole('button', { name: 'Alert' }));
    await waitFor(() => expect(posted('/incidents/inc-1/police').body).toEqual({ police_unit_id: 'pu-2' }));
    expect(await screen.findByText(/waiting for the unit to accept/i)).toBeInTheDocument();
  });

  it('lets the server pick the nearest unit', async () => {
    signIn();
    incidents = [none()];
    installFetch({ 'POST /incidents/inc-1/police': () => incident({ updated_at: '2026-10-18T08:05:00Z' }) });
    render(<App />);
    await userEvent.setup().click(await screen.findByRole('button', { name: /alert nearest/i }));
    await waitFor(() => expect(posted('/incidents/inc-1/police').body).toEqual({}));
  });

  it('can change a unit that has not answered, without offering the unit already alerted', async () => {
    signIn();
    installFetch();
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change' }));
    expect(await screen.findByText('Avondale Traffic')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem').filter((li) => li.textContent.includes('Traffic') && li.querySelector('button'));
    expect(rows.some((li) => li.textContent.includes('Harare Central Traffic') && li.querySelector('.rec__nums'))).toBe(false);
  });

  it('does not let the dispatcher take a unit that has already accepted', async () => {
    signIn();
    incidents = [withAmbulance('assigned')]; // its police unit is "accepted"
    installFetch();
    render(<App />);
    await screen.findByText('Harare Central Traffic');
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /alert nearest/i })).not.toBeInTheDocument();
  });
});

describe('sending an ambulance', () => {
  it('assigns the ambulance the dispatcher picks', async () => {
    signIn();
    installFetch({ 'POST /incidents/inc-1/ambulance': () => withAmbulance('assigned', { updated_at: '2026-10-18T08:05:00Z', assignment: { ...withAmbulance().assignment, ambulance: { ambulance_id: 'amb-2', plate_number: 'ADX-1002', state: 'assigned', eta_minutes: 9 } } }) });
    render(<App />);
    const user = userEvent.setup();
    const row = (await screen.findByText('ADX-1002')).closest('li');
    expect(within(row).getByText('old position')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(posted('/incidents/inc-1/ambulance').body).toEqual({ ambulance_id: 'amb-2' }));
    expect(await screen.findByText('Dispatched')).toBeInTheDocument();
  });

  it('lets the server choose when asked to auto-assign', async () => {
    signIn();
    installFetch({ 'POST /incidents/inc-1/ambulance': () => withAmbulance('assigned', { updated_at: '2026-10-18T08:05:00Z' }) });
    render(<App />);
    await userEvent.setup().click(await screen.findByRole('button', { name: /auto-assign best/i }));
    await waitFor(() => expect(posted('/incidents/inc-1/ambulance').body).toEqual({}));
  });

  it('will not replace a crew that is already transporting unless the dispatcher confirms a breakdown', async () => {
    signIn();
    incidents = [withAmbulance('transporting')];
    installFetch({ 'POST /incidents/inc-1/ambulance': () => withAmbulance('assigned', { updated_at: '2026-10-18T08:05:00Z' }) });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Replace' }));
    const assign = (await screen.findByText('ADX-1002')).closest('li');
    expect(within(assign).getByRole('button', { name: 'Assign' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /auto-assign best/i })).toBeDisabled();

    await user.click(screen.getByRole('checkbox'));
    await user.click(within(assign).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(posted('/incidents/inc-1/ambulance').body).toEqual({ ambulance_id: 'amb-2', force: true }));
  });

  it('tells the dispatcher plainly when no ambulance is free', async () => {
    signIn();
    installFetch({ 'GET /incidents/inc-1/recommendations': () => ({ ambulances: [], hospitals: [] }) });
    render(<App />);
    expect(await screen.findByText(/no ambulance is available/i)).toBeInTheDocument();
  });
});

describe('choosing a hospital', () => {
  it('assigns a hospital once an ambulance is on the way, and flags a full one', async () => {
    signIn();
    incidents = [withAmbulance('enRoute')];
    installFetch({ 'POST /incidents/inc-1/hospital': () => withAmbulance('enRoute', { updated_at: '2026-10-18T08:05:00Z', assignment: { ...withAmbulance().assignment, hospital: { hospital_id: 'h-1', name: 'Parirenyatwa Group of Hospitals', state: 'notified', eta_minutes: 8 } } }) });
    render(<App />);
    const full = (await screen.findByText('Avenues Clinic')).closest('li');
    expect(within(full).getByText('full')).toBeInTheDocument();
    expect(within(full).getByText(/numbers 3 h old: phone to confirm/i)).toBeInTheDocument();
    const row = screen.getByText('Parirenyatwa Group of Hospitals').closest('li');
    await userEvent.setup().click(within(row).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(posted('/incidents/inc-1/hospital').body).toEqual({ hospital_id: 'h-1' }));
  });

  it('asks for an ambulance first', async () => {
    signIn();
    installFetch();
    render(<App />);
    expect(await screen.findByText(/assign an ambulance first/i)).toBeInTheDocument();
  });
});

describe('closing an incident', () => {
  it('only allows "completed" after the hospital has admitted the patient', async () => {
    signIn();
    incidents = [withAmbulance('transporting')];
    installFetch({ 'POST /incidents/inc-1/close': () => incident({ status: 'closed', updated_at: '2026-10-18T09:00:00Z', closed_at: '2026-10-18T09:00:00Z' }) });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Close incident' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: /completed/i })).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/note/i), 'Scene handed to police');
    await user.click(within(dialog).getByRole('button', { name: 'Close incident' }));
    await waitFor(() => expect(posted('/incidents/inc-1/close').body).toEqual({ outcome: 'no_transport', note: 'Scene handed to police' }));
    expect(await screen.findByText(/RL-2600001 closed/)).toBeInTheDocument();
  });

  it('defaults to "completed" once the patient is admitted', async () => {
    signIn();
    incidents = [withAmbulance('arrived', { status: 'admitted' })];
    installFetch();
    render(<App />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Close incident' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: /completed/i })).toBeChecked();
  });
});

describe('a phoned-in report', () => {
  it('needs a place on the map, then sends the report as approximate', async () => {
    signIn();
    installFetch({
      'POST /incidents': () => ({ id: 'inc-new', reference_number: 'RL-2600009' }),
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New report' }));

    await user.click(screen.getByRole('button', { name: /send to police/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/click the map/i);

    await user.click(screen.getByRole('button', { name: 'Drop pin' }));
    expect(screen.getByText(/location set: -17.80000, 31.05000/i)).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/people hurt/i));
    await user.type(screen.getByLabelText(/people hurt/i), '3');
    await user.type(screen.getByLabelText(/caller's phone/i), '+263 77 555 0101');
    await user.click(screen.getByRole('button', { name: /send to police/i }));

    await waitFor(() => expect(posted('/incidents').body).toEqual({
      lat: -17.8, lng: 31.05, severity: 'serious', victim_count: 3, description: '',
      location_accuracy: 'approximate', reporter_phone: '+263 77 555 0101',
    }));
    expect(await screen.findByText(/RL-2600009 sent/)).toBeInTheDocument();
  });
});

describe('review fixes', () => {
  it('does not say the unit is still being waited for once the incident is closed', async () => {
    signIn();
    incidents = [withAmbulance('enRoute', { status: 'closed', closed_at: '2026-10-18T08:30:00Z', assignment: { ...withAmbulance().assignment, police: { unit_id: 'pu-1', name: 'ZRP Harare Central', state: 'notified' } } })];
    installFetch();
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: /closed/i }));
    await user.click(await screen.findByRole('button', { name: /RL-2600001, /i }));
    await screen.findByRole('heading', { name: 'RL-2600001' });
    expect(screen.queryByText(/waiting for the unit to accept/i)).not.toBeInTheDocument();
  });

  it('still says it while the incident is open and the unit has not accepted', async () => {
    signIn();
    incidents = [incident()];
    installFetch();
    render(<App />);
    await screen.findByRole('heading', { name: 'RL-2600001' });
    expect(screen.getByText(/waiting for the unit to accept/i)).toBeInTheDocument();
  });

  it('warns loudly when no ambulance was assigned in time, live and on the panel', async () => {
    signIn();
    incidents = [incident()];
    installFetch();
    render(<App />);
    await screen.findByRole('heading', { name: 'RL-2600001' });
    expect(screen.queryByTestId('ambulance-overdue')).not.toBeInTheDocument();

    act(() => sock.emit('incident:update', { event: 'ambulance_unassigned_alert', incident: incident({ ambulance_alert_at: '2026-10-18T08:03:00Z' }) }));
    expect(await screen.findByTestId('ambulance-overdue')).toHaveTextContent(/no ambulance has been assigned/i);
    expect(screen.getByText(/RL-2600001 still has no ambulance/i)).toBeInTheDocument();
    expect(screen.getByText('Ambulance: OVERDUE')).toBeInTheDocument();
  });

  it('shows what the citizens reported next to what the police confirmed', async () => {
    signIn();
    incidents = [incident({ severity: 'serious', reported_severity: 'critical', severity_confirmed: true })];
    installFetch();
    render(<App />);
    expect(await screen.findByTestId('severity-provenance')).toHaveTextContent(/confirmed by police at the scene.*citizens reported critical/i);
  });

  it('says nothing about confirmation when nobody has confirmed the severity', async () => {
    signIn();
    incidents = [incident({ reported_severity: 'serious', severity_confirmed: false })];
    installFetch();
    render(<App />);
    await screen.findByRole('heading', { name: 'RL-2600001' });
    expect(screen.queryByTestId('severity-provenance')).not.toBeInTheDocument();
  });

  it('uses one word for the worst severity', async () => {
    signIn();
    incidents = [incident({ severity: 'fatal' })];
    installFetch();
    render(<App />);
    expect(await screen.findByRole('button', { name: /RL-2600001, Fatal,/ })).toBeInTheDocument();
    expect(screen.queryByText('Fatalities')).not.toBeInTheDocument();
  });
});

describe('changing your own password (FR15)', () => {
  async function open() {
    signIn();
    installFetch({ 'POST /auth/change-password': () => null });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Password' }));
    return { user, dialog: await screen.findByRole('dialog', { name: /change password/i }) };
  }

  it('sends the current and the new password and confirms', async () => {
    const { user, dialog } = await open();
    await user.type(within(dialog).getByLabelText('Current password'), 'old-password-1');
    await user.type(within(dialog).getByLabelText('New password'), 'a-much-better-1');
    await user.type(within(dialog).getByLabelText('New password again'), 'a-much-better-1');
    await user.click(within(dialog).getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(posted('/auth/change-password').body).toEqual({ current_password: 'old-password-1', new_password: 'a-much-better-1' }));
    expect(await screen.findByText('Password changed.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /change password/i })).not.toBeInTheDocument();
  });

  it('refuses a short password, a mismatch, and an unchanged password without calling the server', async () => {
    const { user, dialog } = await open();
    const cur = within(dialog).getByLabelText('Current password');
    const n1 = within(dialog).getByLabelText('New password');
    const n2 = within(dialog).getByLabelText('New password again');
    const go = () => user.click(within(dialog).getByRole('button', { name: 'Change password' }));
    await user.type(cur, 'old-password-1'); await user.type(n1, 'short'); await user.type(n2, 'short'); await go();
    expect(await within(dialog).findByText(/at least 8 characters/i)).toBeInTheDocument();
    await user.clear(n1); await user.clear(n2); await user.type(n1, 'long-enough-1'); await user.type(n2, 'different-2'); await go();
    expect(await within(dialog).findByText(/do not match/i)).toBeInTheDocument();
    await user.clear(n1); await user.clear(n2); await user.type(n1, 'old-password-1'); await user.type(n2, 'old-password-1'); await go();
    expect(await within(dialog).findByText(/different from the current/i)).toBeInTheDocument();
    expect(posted('/auth/change-password')).toBeUndefined();
  });

  it('shows the server\'s reason when the current password is wrong', async () => {
    signIn();
    installFetch({ 'POST /auth/change-password': () => ({ __status: 400, error: { code: 'BAD_REQUEST', message: 'Current password is incorrect' } }) });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Password' }));
    const dialog = await screen.findByRole('dialog', { name: /change password/i });
    await user.type(within(dialog).getByLabelText('Current password'), 'nope-nope-1');
    await user.type(within(dialog).getByLabelText('New password'), 'a-much-better-1');
    await user.type(within(dialog).getByLabelText('New password again'), 'a-much-better-1');
    await user.click(within(dialog).getByRole('button', { name: 'Change password' }));
    expect(await within(dialog).findByText(/current password is incorrect/i)).toBeInTheDocument();
  });
});

describe('live updates', () => {
  it('shows a new report the moment it arrives and says so', async () => {
    signIn();
    installFetch();
    render(<App />);
    await screen.findByRole('button', { name: /RL-2600001, /i });
    act(() => sock.emit('incident:new', { event: 'incident_created', incident: incident({ id: 'live', reference_number: 'RL-2600042', severity: 'critical' }) }));
    expect(await screen.findByRole('button', { name: /RL-2600042, Critical/ })).toBeInTheDocument();
    expect(screen.getByText(/new critical report RL-2600042/i)).toBeInTheDocument();
  });

  it('says when the live connection is down', async () => {
    signIn();
    installFetch();
    render(<App />);
    await screen.findByText(/need action/i);
    act(() => sock.emit('disconnect'));
    expect(await screen.findByText(/offline, polling/i)).toBeInTheDocument();
  });

  it('signs out when the live connection reports an expired session', async () => {
    signIn();
    installFetch();
    render(<App />);
    await screen.findByText(/need action/i);
    act(() => sock.emit('auth:expired'));
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });
});
