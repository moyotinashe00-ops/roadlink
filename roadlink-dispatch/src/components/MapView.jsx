import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { SEVERITY } from '../lib/format.js';

const HARARE = [-17.8292, 31.0522];
const STALE_MS = 10 * 60 * 1000;

// Tooltips are built as DOM text, never as HTML: descriptions and names come from the public.
const tip = (text) => { const el = document.createElement('span'); el.textContent = text; return el; };

const incidentIcon = (severity, selected) => L.divIcon({
  className: '', iconSize: [30, 30], iconAnchor: [15, 15],
  html: `<span class="pin pin--${(SEVERITY[severity] || SEVERITY.minor).tone}${selected ? ' pin--sel' : ''}"></span>`,
});
const fleetIcon = (kind, available, stale) => L.divIcon({
  className: '', iconSize: [24, 24], iconAnchor: [12, 12],
  html: `<span class="veh veh--${kind}${available ? '' : ' veh--busy'}${stale ? ' veh--stale' : ''}">${kind === 'ambulance' ? '+' : 'P'}</span>`,
});

/**
 * Live map: incidents (coloured by severity), ambulances and police units, and a pin the dispatcher drops
 * when entering a phoned-in report. All state comes from props; the map only draws it.
 */
export default function MapView({ incidents, fleet, selectedId, onSelect, pickMode, picked, onPick }) {
  const host = useRef(null);
  const map = useRef(null);
  const layers = useRef({});
  const fitted = useRef(false);
  const handlers = useRef({});
  handlers.current = { onSelect, onPick, pickMode };

  useEffect(() => {
    const m = L.map(host.current, { center: HARARE, zoom: 12, zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
    layers.current = { incidents: L.layerGroup().addTo(m), fleet: L.layerGroup().addTo(m), picked: L.layerGroup().addTo(m) };
    m.on('click', (e) => { if (handlers.current.pickMode) handlers.current.onPick({ lat: e.latlng.lat, lng: e.latlng.lng }); });
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const g = layers.current.incidents;
    if (!g) return;
    g.clearLayers();
    incidents.forEach((i) => {
      const marker = L.marker([i.lat, i.lng], { icon: incidentIcon(i.severity, i.id === selectedId), zIndexOffset: i.id === selectedId ? 1000 : 0 });
      marker.bindTooltip(tip(`${i.reference_number}: ${(SEVERITY[i.severity] || SEVERITY.minor).label}`));
      marker.on('click', () => handlers.current.onSelect(i.id));
      marker.addTo(g);
    });
    if (!fitted.current && incidents.length && map.current) {
      fitted.current = true;
      map.current.fitBounds(L.latLngBounds(incidents.map((i) => [i.lat, i.lng])), { padding: [60, 60], maxZoom: 15 });
    }
  }, [incidents, selectedId]);

  useEffect(() => {
    const g = layers.current.fleet;
    if (!g) return;
    g.clearLayers();
    const draw = (list, kind) => list.filter((r) => r.lat != null && r.lng != null).forEach((r) => {
      const stale = !r.location_updated_at || Date.now() - new Date(r.location_updated_at).getTime() > STALE_MS;
      const m = L.marker([r.lat, r.lng], { icon: fleetIcon(kind, r.is_available, stale), zIndexOffset: -100 });
      m.bindTooltip(tip(`${r.plate_number || r.name}${r.is_available ? ' (available)' : ' (busy)'}${stale ? ', old position' : ''}`));
      m.addTo(g);
    });
    draw(fleet.ambulances, 'ambulance');
    draw(fleet.police, 'police');
  }, [fleet]);

  useEffect(() => {
    const g = layers.current.picked;
    if (!g) return;
    g.clearLayers();
    if (picked) L.marker([picked.lat, picked.lng], { icon: incidentIcon('serious', true) }).addTo(g);
  }, [picked]);

  useEffect(() => {
    const i = incidents.find((x) => x.id === selectedId);
    if (i && map.current) map.current.flyTo([i.lat, i.lng], Math.max(map.current.getZoom(), 14), { duration: 0.6 });
    // Only when the selection changes: not on every live update to the same incident.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return <div ref={host} className={`map${pickMode ? ' map--pick' : ''}`} role="region" aria-label="Map of incidents and vehicles" />;
}
