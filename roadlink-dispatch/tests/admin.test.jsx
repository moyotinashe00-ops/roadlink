import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { duration } from '../src/components/AdminConsole.jsx';

vi.mock('socket.io-client', () => ({ io: () => ({ on: () => {}, close: () => {} }) }));
vi.mock('../src/components/MapView.jsx', async () => {
  const React = await vi.importActual('react');
  return { default: () => React.createElement('div', { 'data-testid': 'map' }) };
});

import App from '../src/App.jsx';

let calls;
let db;

const fresh = () => ({
  users: [
    { id: 'u1', name: 'Dispatcher One', email: 'dispatcher@roadlink.zw', phone: null, role: 'dispatcher', is_active: true },
    { id: 'u2', name: 'Crew ADX-1001', email: 'ambulance1@roadlink.zw', phone: null, role: 'ambulance', ambulance_id: 'amb-1', is_active: true },
    { id: 'u3', name: 'Old Officer', email: 'old@roadlink.zw', phone: null, role: 'police', police_unit_id: 'pu-1', is_active: false },
  ],
  ambulances: [
    { id: 'amb-1', plate_number: 'ADX-1001', provider: 'City of Harare', is_active: true, is_available: true, location_updated_at: new Date().toISOString() },
    { id: 'amb-2', plate_number: 'ADX-1002', provider: 'Private', is_active: false, is_available: true, location_updated_at: null },
  ],
  police_units: [{ id: 'pu-1', name: 'Harare Central Traffic', station: 'Central', coverage_area: 'CBD', is_active: true, is_available: false }],
  hospitals: [{ id: 'h-1', name: 'Parirenyatwa Group of Hospitals', contact_number: '+263 4 791631', trauma_bays_total: 8, trauma_bays_free: 5, is_active: true }],
  summary: {
    total_incidents: 12, closed_incidents: 9, avg_report_to_police_on_scene_s: 197, avg_report_to_ambulance_assigned_s: 45,
    avg_ambulance_assigned_to_on_scene_s: null, avg_report_to_hospital_admission_s: 1500,
    by_severity: [{ severity: 'critical', count: 3 }, { severity: 'minor', count: 9 }], by_source: [{ source: 'citizen', count: 10 }, { source: 'dispatcher', count: 2 }],
  },
});

function installFetch() {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace('/api/v1', '') + u.search;
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, path, body });
    const reply = (data, status = 200) => ({ status, ok: status < 400, json: async () => data });
    if (method === 'GET' && path.startsWith('/incidents?')) return reply({ incidents: [] });
    if (method === 'GET' && path === '/ambulances') return reply({ ambulances: [] });
    if (method === 'GET' && path === '/police-units') return reply({ police_units: [] });
    if (method === 'GET' && path === '/admin/users') return reply({ users: db.users });
    if (method === 'GET' && path === '/ambulances?all=1') return reply({ ambulances: db.ambulances });
    if (method === 'GET' && path === '/police-units?all=1') return reply({ police_units: db.police_units });
    if (method === 'GET' && path === '/hospitals?all=1') return reply({ hospitals: db.hospitals });
    if (method === 'GET' && path.startsWith('/admin/reports/summary')) return reply(db.summary);
    if (method === 'POST' && path === '/admin/ambulances') {
      db.ambulances = [...db.ambulances, { id: 'amb-new', ...body, provider: body.provider || '', is_active: true, is_available: true, location_updated_at: null }];
      return reply(db.ambulances.at(-1), 201);
    }
    if (method === 'PATCH' && path.startsWith('/admin/ambulances/')) {
      db.ambulances = db.ambulances.map((a) => (a.id === path.split('/').pop() ? { ...a, ...body } : a));
      return reply({});
    }
    if (method === 'POST' && path === '/admin/users') return reply({ id: 'u-new', ...body }, 201);
    if (method === 'PATCH' && path.startsWith('/admin/users/')) return reply({});
    if (method === 'POST' && path === '/admin/hospitals') return reply({ id: 'h-new', ...body }, 201);
    return reply({ error: { code: 'NOT_MOCKED', message: `No mock for ${method} ${path}` } }, 404);
  }));
}

const signIn = (role) => sessionStorage.setItem('roadlink.dispatch.session', JSON.stringify({ token: 'tok', user: { name: 'Someone', role } }));
const sent = (method, path) => calls.find((c) => c.method === method && c.path === path);
const openAdmin = async (tabName) => {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Admin' }));
  if (tabName) await user.click(await screen.findByRole('tab', { name: tabName }));
  return user;
};

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); db = fresh(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('who sees the admin screens', () => {
  it('shows the Admin button to administrators only', async () => {
    signIn('dispatcher'); installFetch();
    const { unmount } = render(<App />);
    await screen.findByText(/need action/i);
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
    unmount();

    signIn('admin'); installFetch();
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Admin' })).toBeInTheDocument();
  });
});

describe('summary', () => {
  it('turns seconds into readable times, and says so when a stage has no data yet', () => {
    expect(duration(45)).toBe('45 s');
    expect(duration(197)).toBe('3 min 17 s');
    expect(duration(1500)).toBe('25 min 00 s');
    expect(duration(null)).toBe('no data yet');
  });

  it('shows how fast the response is', async () => {
    signIn('admin'); installFetch();
    render(<App />);
    await openAdmin();
    const police = (await screen.findByText('Report to police on scene')).closest('.kpi');
    expect(within(police).getByText('3 min 17 s')).toBeInTheDocument();
    expect(within(screen.getByText('Ambulance assigned to on scene').closest('.kpi')).getByText('no data yet')).toBeInTheDocument();
    expect(screen.getByText('Report to hospital admission').closest('.kpi')).toHaveTextContent('25 min 00 s');
  });

  it('asks for the period the administrator chooses', async () => {
    signIn('admin'); installFetch();
    render(<App />);
    const user = await openAdmin();
    await screen.findByText('Report to police on scene');
    await user.selectOptions(screen.getByLabelText('Period'), '7');
    await waitFor(() => expect(calls.filter((c) => c.path.startsWith('/admin/reports/summary')).length).toBeGreaterThanOrEqual(2));
  });
});

describe('ambulances', () => {
  it('adds an ambulance', async () => {
    signIn('admin'); installFetch();
    render(<App />);
    const user = await openAdmin('Ambulances');
    await user.type(await screen.findByLabelText('Number plate'), 'ZIM-2001');
    await user.type(screen.getByLabelText('Provider'), 'Test Provider');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(sent('POST', '/admin/ambulances').body).toEqual({ plate_number: 'ZIM-2001', provider: 'Test Provider' }));
    expect(await screen.findByText('ZIM-2001')).toBeInTheDocument();
    expect(await screen.findByText(/Ambulance ZIM-2001 added/)).toBeInTheDocument();
  });

  it('switches an ambulance off and shows switched-off ones so they can be switched back on', async () => {
    signIn('admin'); installFetch();
    render(<App />);
    const user = await openAdmin('Ambulances');
    await user.click(await screen.findByRole('button', { name: 'Disable ADX-1001' }));
    await waitFor(() => expect(sent('PATCH', '/admin/ambulances/amb-1').body).toEqual({ is_active: false }));
    expect(await screen.findByRole('button', { name: 'Enable ADX-1001' })).toBeInTheDocument();
    // ADX-1002 was already switched off, and is still listed
    await user.click(screen.getByRole('button', { name: 'Enable ADX-1002' }));
    await waitFor(() => expect(sent('PATCH', '/admin/ambulances/amb-2').body).toEqual({ is_active: true }));
  });
});

describe('accounts', () => {
  it('lists who each account belongs to and which are disabled', async () => {
    signIn('admin'); installFetch();
    render(<App />);
    await openAdmin('Users');
    const crew = (await screen.findByText('Crew ADX-1001')).closest('tr');
    expect(within(crew).getByText('ADX-1001')).toBeInTheDocument();
    const old = screen.getByText('Old Officer').closest('tr');
    expect(within(old).getByText('Disabled')).toBeInTheDocument();
    expect(within(old).getByText('Harare Central Traffic')).toBeInTheDocument();
  });

  it('will not create a hospital account without choosing the hospital, or a short password', async () => {
    signIn('admin'); installFetch();
    render(<App />);
    const user = await openAdmin('Users');
    await user.type(await screen.findByLabelText('Name'), 'Desk Nurse');
    await user.selectOptions(screen.getByLabelText('Role'), 'hospital');
    await user.type(screen.getByLabelText('Email'), 'nurse@hosp.zw');
    await user.type(screen.getByLabelText(/Password/), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 8 characters/);

    await user.clear(screen.getByLabelText(/Password/));
    await user.type(screen.getByLabelText(/Password/), 'longenough1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Choose which hospital/);
    expect(sent('POST', '/admin/users')).toBeUndefined();

    await user.selectOptions(screen.getByLabelText('Hospital'), 'h-1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(sent('POST', '/admin/users').body).toEqual({ name: 'Desk Nurse', role: 'hospital', email: 'nurse@hosp.zw', password: 'longenough1', hospital_id: 'h-1' }));
  });

  it('disables an account and changes a password', async () => {
    signIn('admin'); installFetch();
    render(<App />);
    const user = await openAdmin('Users');
    await user.click(await screen.findByRole('button', { name: 'Disable Dispatcher One' }));
    await waitFor(() => expect(sent('PATCH', '/admin/users/u1').body).toEqual({ is_active: false }));

    await user.click(screen.getByRole('button', { name: 'Reset password for Crew ADX-1001' }));
    const box = screen.getByLabelText('New password for Crew ADX-1001');
    await user.type(box, 'newpass123');
    await user.click(within(box.closest('.inline-form')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent('PATCH', '/admin/users/u2').body).toEqual({ password: 'newpass123' }));
  });
});

describe('hospitals', () => {
  it('adds a hospital with its coordinates and bays, and refuses more free bays than total', async () => {
    signIn('admin'); installFetch();
    render(<App />);
    const user = await openAdmin('Hospitals');
    await user.type(await screen.findByLabelText('Name'), 'Mbuya Nehanda Clinic');
    await user.type(screen.getByLabelText('Latitude'), '-17.81');
    await user.type(screen.getByLabelText('Longitude'), '31.04');
    await user.type(screen.getByLabelText('Trauma bays (total)'), '4');
    await user.type(screen.getByLabelText('Trauma bays (free now)'), '6');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/more than the total/);
    expect(sent('POST', '/admin/hospitals')).toBeUndefined();

    await user.clear(screen.getByLabelText('Trauma bays (free now)'));
    await user.type(screen.getByLabelText('Trauma bays (free now)'), '3');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(sent('POST', '/admin/hospitals').body).toEqual({ name: 'Mbuya Nehanda Clinic', lat: -17.81, lng: 31.04, trauma_bays_total: 4, trauma_bays_free: 3 }));
  });
});
