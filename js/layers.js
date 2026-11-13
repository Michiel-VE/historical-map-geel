// Everything drawn on the map and the panel that controls it:
//  - selection outline + details drawer
//  - region blobs (overview)
//  - detail layers: parcels, roads, waterways, housing (+ toggles, opacity)
// To add a layer type: add an entry to LAYER_DEFS and a checkbox with
// id="layer-toggle-<type>" in index.html.

import { map, flyToRegion, flyToBounds, flyToOverview } from './map.js';
import {
  state, EMPTY, NO_PADDING, ZOOM_THRESHOLD, FEATURE_PITCH,
  $, isPanelCollapsed, esc, fetchGeoJSON, extendBounds, prettyName, pointerOnHover, announce
} from './core.js';


// ======================================================================
// Selection outline + details drawer
// ======================================================================

// Selection outline: dark casing + cyan line, so it has >= 3:1 contrast on light AND dark areas.
// Add after the detail layers so it draws on top.
export function addSelectionLayer() {
  map.addSource('selected-feature-source', { type: 'geojson', data: highlighted });
  map.addLayer({
    id: 'selected-feature-casing',
    type: 'line',
    source: 'selected-feature-source',
    minzoom: ZOOM_THRESHOLD,
    paint: { 'line-color': '#0f172a', 'line-width': 7, 'line-opacity': 0.9 }
  });
  map.addLayer({
    id: 'selected-feature-outline',
    type: 'line',
    source: 'selected-feature-source',
    minzoom: ZOOM_THRESHOLD,
    paint: { 'line-color': '#00ffff', 'line-width': 3.5, 'line-opacity': 1 }
  });
}

// Remembered so the outline can be redrawn after a base map switch
let highlighted = EMPTY;

function highlightFeature(geometry) {
  highlighted = geometry
    ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry, properties: {} }] }
    : EMPTY;
  map.getSource('selected-feature-source')?.setData(highlighted);
}

// ---- The drawer is a NON-modal dialog: the map stays usable behind it, so no focus trap.
const drawer = $('details-drawer');
if (drawer) {
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'false');
  drawer.setAttribute('aria-labelledby', 'drawer-title');
  drawer.tabIndex = -1;                           // focusable by script, not a tab stop
}

let lastFocus = null;                           // where focus returns when the user closes the drawer

// Programmatic close (layer toggle, zoom out, ...): never touches focus
export function clearSelection() {
  highlightFeature(null);
  if (drawer) drawer.hidden = true;
}

// Explicit close by the user (button / Esc): hand focus back
export function closeDrawer() {
  const target = lastFocus;
  lastFocus = null;
  clearSelection();
  const usable = target && target !== document.body && document.contains(target);
  (usable ? target : map.getCanvas()).focus({ preventScroll: true });
  if (document.activeElement === document.body) map.getCanvas().focus({ preventScroll: true });
  announce('Details gesloten');
}

$('close-drawer-btn')?.addEventListener('click', closeDrawer);
drawer?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); }
});

// Ease to the feature, leaving room for the side panel when it is open
function centerMapOnFeature(lngLat) {
  const panelOpen = !isPanelCollapsed();
  const padding = { ...NO_PADDING };
  if (panelOpen && window.innerWidth > 768) { padding.left = 180; padding.right = 350; }
  map.easeTo({ center: lngLat, pitch: FEATURE_PITCH, padding, duration: 1000 });
}

// opts.focus: true when the selection came from keyboard / list / search -> move focus to the dialog.
// For pointer selections focus stays put and the result is announced instead.
export function showDetails(titleText, rows, lngLat, geometry, { focus = false } = {}) {
  const content = $('drawer-content');
  const title = $('drawer-title');

  if (title) title.textContent = titleText;

  if (content) {
    content.innerHTML = rows
      .filter(r => r.value !== undefined && r.value !== null && r.value !== '')
      .map(r => `
        <div class="flex flex-col rounded-md border border-panel-hover bg-panel-subtle px-3 py-2">
          <dt class="mb-px text-micro font-semibold uppercase tracking-wider text-ink-faint">${esc(r.label)}</dt>
          <dd class="break-words text-sm font-medium text-ink">${esc(r.value)}</dd>
        </div>`)
      .join('');
  }

  if (drawer) drawer.hidden = false;
  if (geometry) highlightFeature(geometry);
  if (lngLat) centerMapOnFeature(lngLat);

  if (focus && drawer) {
    if (!drawer.contains(document.activeElement)) lastFocus = document.activeElement;
    drawer.focus({ preventScroll: true });          // SR reads: "<title>, dialog"
  } else {
    announce(`Details geopend: ${titleText}`);
  }

  document.dispatchEvent(new CustomEvent('feature-selected'));   // used by onboarding
}

// ======================================================================
// Region blobs (overview)
// ======================================================================

export async function discoverRegions() {
  try {
    const res = await fetch('assets/data/regions.json?t=' + Date.now());
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length) return list;
    }
  } catch { /* fall through */ }

  try {
    const res = await fetch('assets/data/');
    if (res.ok) {
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const names = [...doc.querySelectorAll('a')]
        .map(a => decodeURIComponent(a.getAttribute('href') || ''))
        .filter(h => h.endsWith('/') && !h.startsWith('.') && !h.startsWith('/'))
        .map(h => h.replace(/\/$/, '').split('/').pop())
        .filter(Boolean);
      return [...new Set(names)];
    }
  } catch { /* nothing left to try */ }
  return [];
}

// Region blobs (visible BELOW the zoom threshold)
export function addRegionLayers() {
  map.addSource('clusters-source', { type: 'geojson', data: state.clusterData || EMPTY });
  map.addLayer({
    id: 'clusters-fill', type: 'fill', source: 'clusters-source', maxzoom: ZOOM_THRESHOLD,
    paint: { 'fill-color': '#b45309', 'fill-opacity': 0.45 }
  });
  map.addLayer({
    id: 'clusters-outline', type: 'line', source: 'clusters-source', maxzoom: ZOOM_THRESHOLD,
    paint: { 'line-color': '#78350f', 'line-width': 2 }
  });
}

export function initRegionInteractions() {
  pointerOnHover(map, 'clusters-fill');
  map.on('click', 'clusters-fill', (e) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const region = feature.properties.region;
    if (state.regionBounds[region]) {
      flyToRegion(region);
    } else {
      const b = new maplibregl.LngLatBounds();
      extendBounds(b, feature.geometry.coordinates);
      flyToBounds(b);
    }
  });
}

export async function fetchSections() {
  const features = [];
  const regionBounds = {};
  const overall = new maplibregl.LngLatBounds();

  await Promise.all(state.regions.map(async (region) => {
    const data = await fetchGeoJSON(`assets/data/${region}/section.geojson`);
    const bounds = new maplibregl.LngLatBounds();

    (data.features || []).forEach(f => {
      if (!f.geometry) return;
      features.push({ type: 'Feature', properties: { ...f.properties, region }, geometry: f.geometry });
      extendBounds(bounds, f.geometry.coordinates);
    });

    if (bounds.isEmpty()) {
      console.warn(`[regions] ${region}: section.geojson missing or empty, no blob shown`);
      return;
    }
    regionBounds[region] = bounds;
    overall.extend(bounds);
  }));

  return { features, regionBounds, overall };
}

export function applySections({ features, regionBounds, overall }) {
  Object.assign(state.regionBounds, regionBounds);
  state.clusterData = { type: 'FeatureCollection', features };
  map.getSource('clusters-source')?.setData(state.clusterData);

  if (!overall.isEmpty()) {
    state.overviewBounds = overall;
    flyToOverview({ animate: false });
  }
}

const REVEAL_DELAY = [
  '[animation-delay:0ms]', '[animation-delay:50ms]', '[animation-delay:100ms]',
  '[animation-delay:150ms]', '[animation-delay:200ms]', '[animation-delay:250ms]'
];

export function buildRegionList() {
  const list = $('region-list');
  if (!list) return;
  list.innerHTML = '';
  state.regions.filter(r => state.regionBounds[r]).forEach((region, i) => {
    const btn = document.createElement('button');
    btn.className = `flex min-h-10 w-full animate-reveal cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-panel-subtle px-3 py-2 text-left text-sm font-semibold text-primary-dark transition-colors hover:border-line-strong hover:bg-panel-hover active:bg-line motion-reduce:animate-none ${REVEAL_DELAY[Math.min(i, REVEAL_DELAY.length - 1)]}`;
    btn.textContent = prettyName(region);
    btn.addEventListener('click', () => flyToRegion(region));
    list.appendChild(btn);
  });
}

// ======================================================================
// Detail layers
// ======================================================================

const formatArea = (ha, a, ca) => {
  const h = parseInt(ha, 10) || 0, aa = parseInt(a, 10) || 0, c = parseInt(ca, 10) || 0;
  const parts = [];
  if (h > 0) parts.push(`${h} ha`);
  if (aa > 0) parts.push(`${aa} a`);
  if (c > 0 || !parts.length) parts.push(`${c} ca`);
  return parts.join(' ');
};

const LAYER_DEFS = [
  {
    type: 'parcels',
    layers: [
      {
        id: 'parcels-fill', type: 'fill', paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.5 },
        opacity: { prop: 'fill-opacity', factor: 0.6 }
      },
      {
        id: 'parcels-outline', type: 'line', paint: { 'line-color': '#b45309', 'line-width': 1 },
        opacity: { prop: 'line-opacity', factor: 1 }
      }
    ],
    clickable: ['parcels-fill'],
    popup(p) {
      const rows = [
        { label: 'Gehucht', value: p.GEHUCHT || 'N/A' },
        { label: 'Eigenaar', value: p.EIGENAAR ? String(p.EIGENAAR).replace(/,/g, ' ') : 'Onbekend' },
        { label: 'Beroep', value: p.BEROEP || 'N/A' },
        { label: 'Soort landgebruik', value: `${p.SOORT || 'N/A'}${p.KLASSE ? ` (Klasse ${p.KLASSE})` : ''}` },
        { label: 'Oppervlakte', value: p.GROOTTE || formatArea(p.ha, p.a, p.ca) },
        { label: 'Artikel', value: p.ARTIKEL || p.ARTIKELNR || 'N/A' },
        { label: 'Door', value: p.DOOR || 'N/A' }
      ];
      if (p.Belasting) rows.push({ label: 'Belasting', value: `BEF ${p.Belasting}` });
      if (p.Gebouwen) rows.push({ label: 'Gebouwen', value: p.Gebouwen });
      const nr = [p.SECTIE, p.PERCEELNR].filter(Boolean).join(' ') || p['Nr.'] || p.nummer || p.id || 'N/A';
      return { title: `Perceel ${nr}`, rows };
    }
  },
  {
    type: 'roads',
    layers: [
      {
        id: 'roads-line', type: 'line',
        paint: { 'line-color': '#475569', 'line-width': 3, 'line-dasharray': [2, 1] },
        opacity: { prop: 'line-opacity', factor: 1 }
      }
    ],
    clickable: ['roads-line'],
    popup: (p) => ({
      title: p.naam || p.name || p.straatnaam || 'Historische Weg',
      rows: [{ label: 'Naam', value: p.naam || 'Onbekend' }]
    })
  },
  {
    type: 'waterways',
    layers: [
      {
        id: 'waterways-fill', type: 'fill', filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': '#0284c7', 'fill-opacity': 0.6 },
        opacity: { prop: 'fill-opacity', factor: 0.6 }
      },
      {
        id: 'waterways-line', type: 'line', paint: { 'line-color': '#0369a1', 'line-width': 3 },
        opacity: { prop: 'line-opacity', factor: 1 }
      }
    ],
    clickable: ['waterways-fill', 'waterways-line'],
    popup: (p) => ({
      title: p.WATERLOPEN || 'Waterloop',
      rows: [{ label: 'Naam', value: p.Naam || 'Onbekend' }]
    })
  },
  {
    type: 'housing',
    layers: [
      {
        id: 'housing-fill', type: 'fill', paint: { 'fill-color': '#e11d48', 'fill-opacity': 0.6 },
        opacity: { prop: 'fill-opacity', factor: 0.6 }
      },
      {
        id: 'housing-outline', type: 'line', paint: { 'line-color': '#9f1239', 'line-width': 1.5 },
        opacity: { prop: 'line-opacity', factor: 1 }
      }
    ],
    clickable: ['housing-fill'],
    popup: (p) => ({
      title: 'Gebouw',
      rows: [
        { label: 'Type', value: 'Gebouw' },
        { label: 'Eigenaar', value: (p.Eigenaars ? String(p.Eigenaars) : p.EIGENAAR ? String(p.EIGENAAR) : 'Onbekend').replace(/,/g, ' ') }
      ]
    })
  }
];

export const popupFor = (type, props) => LAYER_DEFS.find(d => d.type === type).popup(props);

// Add detail layers with strict `minzoom: ZOOM_THRESHOLD` applied to prevent unnecessary GPU rendering when zoomed out
export function addDetailLayers() {
  LAYER_DEFS.forEach(def => {
    const data = state.appliedTypes.has(def.type) ? state.dataStore[def.type] : EMPTY;
    map.addSource(`${def.type}-source`, { type: 'geojson', data });
    def.layers.forEach(({ opacity, ...spec }) => {
      map.addLayer({ ...spec, source: `${def.type}-source`, minzoom: ZOOM_THRESHOLD });
    });
  });
}

export async function fetchDetails(onProgress = () => { }, onTypeReady = () => { }) {
  const total = LAYER_DEFS.length * state.regions.length;
  let loaded = 0;

  await Promise.all(LAYER_DEFS.map(async (def) => {
    const parts = await Promise.all(state.regions.map(async (region) => {
      const features = (await fetchGeoJSON(`assets/data/${region}/${def.type}.geojson`)).features || [];
      onProgress(++loaded / total);
      return features;
    }));
    const all = parts.flat();
    all.forEach((f, i) => { (f.properties ||= {})._i = i; });
    state.dataStore[def.type] = { type: 'FeatureCollection', features: all };
    onTypeReady(def.type);
  }));
}

export function applyDetailType(type) {
  state.appliedTypes.add(type);
  map.getSource(`${type}-source`)?.setData(state.dataStore[type] || EMPTY);
}

function originalGeometry(type, feature) {
  const i = feature.properties?._i;
  return (i != null ? state.dataStore[type]?.features[i]?.geometry : null) ?? feature.geometry;
}

const TYPE_BY_LAYER = Object.fromEntries(
  LAYER_DEFS.flatMap(d => d.clickable.map(id => [id, d.type])));
export const CLICKABLE_LAYERS = Object.keys(TYPE_BY_LAYER);
export const typeOfLayer = (layerId) => TYPE_BY_LAYER[layerId];

export function selectFeature(type, feature, lngLat, opts) {
  const { title, rows } = popupFor(type, feature.properties || {});
  showDetails(title, rows, lngLat, originalGeometry(type, feature), opts);
}

export function initLayerInteractions() {
  LAYER_DEFS.forEach(def => def.clickable.forEach(layerId => {
    pointerOnHover(map, layerId);
    map.on('click', layerId, (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const { title, rows } = def.popup(feature.properties || {});
      showDetails(title, rows, e.lngLat, originalGeometry(def.type, feature));
    });
  }));
}

export function applyOpacity() {
  const slider = $('opacity-slider');
  if (!slider) return;
  const v = slider.value / 100;
  slider.setAttribute('aria-valuetext', `${slider.value}% zichtbaar`);
  const out = $('opacity-value');
  if (out) out.textContent = `${slider.value}%`;
  LAYER_DEFS.forEach(def => def.layers.forEach(l => {
    if (map.getLayer(l.id)) map.setPaintProperty(l.id, l.opacity.prop, v * l.opacity.factor);
  }));
}

export function initOpacitySlider() {
  $('opacity-slider')?.addEventListener('input', applyOpacity);
  applyOpacity();
}

const toggleOf = (type) => $(`layer-toggle-${type}`);
const allToggles = () => LAYER_DEFS.map(d => toggleOf(d.type)).filter(Boolean);

export function updateLayerVisibilities() {
  LAYER_DEFS.forEach(def => {
    const cb = toggleOf(def.type);
    const visibility = (cb ? cb.checked : true) ? 'visible' : 'none';
    def.layers.forEach(l => {
      if (map.getLayer(l.id)) map.setLayoutProperty(l.id, 'visibility', visibility);
    });
  });
}

export function soloLayer(type) {
  const id = `layer-toggle-${type}`;
  const boxes = allToggles();
  const onlyThis = boxes.every(cb => cb.checked === (cb.id === id));
  boxes.forEach(cb => { cb.checked = onlyThis || cb.id === id; });
  clearSelection();
  updateLayerVisibilities();
  const name = document.querySelector(`label[for="${id}"]`)?.textContent.trim() ?? type;
  announce(onlyThis ? 'Alle lagen zichtbaar' : `Alleen ${name} zichtbaar`);
}

export function initLayerToggles() {
  LAYER_DEFS.forEach(def => {
    const cb = toggleOf(def.type);
    if (!cb) return;

    cb.addEventListener('change', () => {
      clearSelection();
      updateLayerVisibilities();
    });
  });
}

export function resetLayerToggles() {
  const boxes = allToggles();
  if (boxes.every(cb => cb.checked)) return;
  boxes.forEach(cb => { cb.checked = true; });
  updateLayerVisibilities();
}