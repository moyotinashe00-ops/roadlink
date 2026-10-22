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
    recommendations: (id) => request('GET', `/incidents/${id}/recommendations`),
    // No ambulanceId: the server picks the best available one. force: replace a crew that is already on the job.
    assignAmbulance: (id, { ambulanceId, force } = {}) => request('POST', `/incidents/${id}/ambulance`, {
      ...(ambulanceId ? { ambulance_id: ambulanceId } : {}), ...(force ? { force: true } : {}),
    }),
    assignHospital: (id, hospitalId) => request('POST', `/incidents/${id}/hospital`, { hospital_id: hospitalId }),
    close: (id, outcome, note) => request('POST', `/incidents/${id}/close`, { outcome, ...(note ? { note } : {}) }),
    createReport: (report) => request('POST', '/incidents', report),
    // The scene photo needs the login token, so it cannot be a plain <img src>: fetch it and hand back a Blob.
    photo: async (id) => {
      const token = getToken();
      let res;
      try {
        res = await doFetch(`${baseUrl}/api/v1/incidents/${id}/photo`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      } catch {
        throw new ApiError(0, 'NETWORK', 'Cannot reach the RoadLink server. Check the connection.');
      }
      if (!res.ok) throw new ApiError(res.status, 'ERROR', 'Photo not available');
      return res.blob();
    },
    ambulances: () => request('GET', '/ambulances').then((r) => r.ambulances),
    policeUnits: () => request('GET', '/police-units').then((r) => r.police_units),
  };
}
