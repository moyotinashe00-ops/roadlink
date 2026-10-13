// Thin client for RoadLink Core. Errors always carry the server's stable `code`.
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function createApi({ baseUrl, getToken = () => null, onUnauthorized = () => {}, fetchImpl }) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));

  async function request(method, path, body) {
    const headers = { Accept: 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await doFetch(`${baseUrl}/api/v1${path}`, {
        method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Cannot reach the RoadLink server. Check the connection.');
    }
    if (res.status === 204) return null;

    let data = null;
    try { data = await res.json(); } catch { /* non-JSON error body */ }

    if (!res.ok) {
      // A 401 while holding a token means the session expired or the account was disabled.
      if (res.status === 401 && token) onUnauthorized();
      throw new ApiError(res.status, data?.error?.code || 'ERROR', data?.error?.message || `Request failed (${res.status})`);
    }
    return data;
  }

  return {
    login: (identifier, password) => request('POST', '/auth/login', { identifier, password }),
    listIncidents: (status = 'all', limit = 100) => request('GET', `/incidents?status=${status}&limit=${limit}`).then((r) => r.incidents),
    timeline: (id) => request('GET', `/incidents/${id}/timeline`).then((r) => r.timeline),
    acknowledge: (id) => request('POST', `/incidents/${id}/hospital/acknowledge`),
    admit: (id) => request('POST', `/incidents/${id}/hospital/admit`),
    hospitals: () => request('GET', '/hospitals').then((r) => r.hospitals),
    updateCapacity: (trauma_bays_free, trauma_bays_total) =>
      request('PATCH', '/hospitals/me/capacity', trauma_bays_total === undefined ? { trauma_bays_free } : { trauma_bays_free, trauma_bays_total }),
  };
}
