// Shared building blocks with no map dependency: constants, state, helpers,
// the screen reader announcer and the loading coordinator.

import { getCachedGeoJSON, setCachedGeoJSON } from './cache.js';

// ======================================================================
// Constants (change behaviour here)
// ======================================================================

export const DEFAULT_CENTER = [4.963, 51.102];
export const DEFAULT_ZOOM = 11.8;

// Level of detail:
//   below ZOOM_THRESHOLD  -> region blobs
//   at/above              -> detail layers (parcels, roads, ...)
export const ZOOM_THRESHOLD = 12.8;
export const OVERVIEW_MAX_ZOOM = ZOOM_THRESHOLD - 0.5;  // overview never zooms past this
export const DETAIL_ENTRY_ZOOM = ZOOM_THRESHOLD + 0.4;  // flying into a region ends at least here
export const OVERVIEW_PADDING = 100;

export const NO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };
export const EMPTY = { type: 'FeatureCollection', features: [] };

// Rough "weak device" heuristic (<= 4 logical cores or <= 4 GB RAM). Used to lower
// the GPU load: flatter camera pitch, no antialiasing, no 3D buildings, calmer basemap.
// Override with ?lite=1 (force on) or ?lite=0 (force off) in the URL.
export const LOW_END = (() => {
  try {
    const q = new URLSearchParams(location.search).get('lite');
    if (q === '1') return true;
    if (q === '0') return false;
    return (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  } catch { return false; }
})();
export const DETAIL_PITCH = LOW_END ? 30 : 50;    // camera tilt when flying into a region / parcel
export const FEATURE_PITCH = LOW_END ? 35 : 55;   // camera tilt when a feature is selected

// ======================================================================
// Shared runtime state (filled in by layers.js)
// ======================================================================

export const state = {
  regions: [],          // ['larum', 'zammel', ...] from regions.json
  regionBounds: {},     // regionBounds[name] = LngLatBounds (from section.geojson)
  clusterData: null,    // region blobs FeatureCollection (kept so they survive a base map switch)
  overviewBounds: null, // bounds of ALL regions together
  dataStore: {},        // dataStore[type] = merged FeatureCollection of all regions
  appliedTypes: new Set() // types already pushed into their map source (survives a base map switch)
};

// ======================================================================
// Helpers
// ======================================================================

export const $ = (id) => document.getElementById(id);

// The side panel state lives on #app-container as data-collapsed (Tailwind's `rail:` variant reads it)
export const isPanelCollapsed = () => $('app-container')?.dataset.collapsed === 'true';

// ---- Data loading: limited parallelism, retry with backoff, visible failures ----
//
// Every data file goes through fetchGeoJSON. A file that still fails after all retries is
// recorded in `loadErrors` (so the UI can tell the visitor) instead of silently becoming an
// empty layer. A 404 is NOT an error: a region simply may not have e.g. waterways.

const MAX_PARALLEL = 8;          // concurrent data requests (the basemap needs bandwidth too)
const FETCH_RETRIES = 3;         // extra attempts: waits 0.5s, 1s, 2s

export const loadErrors = [];    // URLs that failed for good

let running = 0;
const queue = [];

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const { task, resolve, reject } = queue.shift();
    running++;
    task().then(resolve, reject).finally(() => { running--; pump(); });
  }
}

const schedule = (task) => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); pump(); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Instantiate Web Worker for off-thread parsing
const worker = new Worker(new URL('./data.worker.js', import.meta.url), { type: 'module' });
const pendingRequests = new Map();

worker.onmessage = (e) => {
  const { url, data, error } = e.data;
  const resolver = pendingRequests.get(url);
  if (resolver) {
    pendingRequests.delete(url);
    if (error) resolver.reject(new Error(error));
    else resolver.resolve(data);
  }
};

function fetchViaWorker(url) {
  return new Promise((resolve, reject) => {
    pendingRequests.set(url, { resolve, reject });
    worker.postMessage({ url });
  });
}

async function fetchWithRetry(url) {
  // 1. Check IndexedDB cache first
  const cached = await getCachedGeoJSON(url);
  if (cached) return cached;

  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const data = await fetchViaWorker(url);
      // 2. Save successful result to IndexedDB cache
      setCachedGeoJSON(url, data);
      return data;
    } catch (err) {
      if (attempt === FETCH_RETRIES) {
        loadErrors.push(url);
        console.error(`[data] giving up on ${url}`, err);
        return EMPTY;
      }
      await sleep(500 * 2 ** attempt);
    }
  }
  return EMPTY;
}

export const fetchGeoJSON = (url) => schedule(() => fetchWithRetry(url));

// Visible warning when some data files could not be loaded (otherwise parcels just go missing)
export function showLoadWarning(count) {
  if (document.getElementById('load-warning')) return;
  const el = document.createElement('div');
  el.id = 'load-warning';
  el.setAttribute('role', 'alert');
  el.className = 'area-map pointer-events-none z-30 flex items-end justify-center p-3 pb-20 md:p-6 md:pb-24';
  el.innerHTML = `
    <div class="pointer-events-auto flex max-w-[34rem] items-center gap-3 rounded-card border border-line bg-panel p-3 text-sm text-ink shadow-float">
      <span>Een deel van de kaartgegevens kon niet geladen worden (${count} ${count === 1 ? 'bestand' : 'bestanden'}). Sommige percelen ontbreken mogelijk.</span>
      <button type="button" data-reload class="min-h-8 shrink-0 cursor-pointer rounded-md bg-primary px-3 py-1 text-small font-semibold text-white hover:bg-primary-hover">Opnieuw laden</button>
      <button type="button" data-close aria-label="Sluiten" title="Sluiten" class="size-7 shrink-0 cursor-pointer rounded-full bg-panel-hover text-lg leading-none text-ink-soft hover:bg-panel-muted">&times;</button>
    </div>`;
  el.querySelector('[data-reload]').addEventListener('click', () => location.reload());
  el.querySelector('[data-close]').addEventListener('click', () => el.remove());
  (document.getElementById('app-container') || document.body).appendChild(el);
}

// Extends a LngLatBounds with any (nested) GeoJSON coordinates array
export function extendBounds(bounds, coords) {
  if (!Array.isArray(coords)) return;   // e.g. a GeometryCollection has no `coordinates`
  if (typeof coords[0] === 'number') {
    if (Number.isFinite(coords[0]) && Number.isFinite(coords[1])) bounds.extend([coords[0], coords[1]]);
  } else {
    coords.forEach(c => extendBounds(bounds, c));
  }
}

export const esc = (v) => String(v).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// "de_zegge" -> "De zegge"
export const prettyName = (name) => {
  const t = name.replace(/[_-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function pointerOnHover(map, layerId) {
  map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
}

// localStorage can throw (private mode, blocked cookies): never let that break the map
export const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, v) { try { localStorage.setItem(key, v); } catch { /* ignore */ } }
};

// ======================================================================
// Screen reader announcer
// ======================================================================

// One polite live region for the whole app. announce('text') -> read by screen readers.
let region;

function ensure() {
  if (region) return region;
  region = document.createElement('div');
  region.id = 'sr-announcer';
  region.className = 'sr-only';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  document.body.appendChild(region);
  return region;
}
ensure();   // create at load so assistive tech has registered it before the first message

export function announce(message) {
  const el = ensure();
  el.textContent = '';                                   // clear so repeated messages are re-read
  setTimeout(() => { el.textContent = message; }, 50);
}

// ======================================================================
// Loading coordinator
// ======================================================================

const SHOW_DELAY_MS = 120;
const TRICKLE_MS = 300;
const TRICKLE_CAP = 0.9;
const FAILSAFE_MS = 45000;

const tasks = new Map();   // name -> { weight, value }
let bar = null;
let displayed = 0;
let finished = false;
let trickleTimer = null, showTimer = null, failsafeTimer = null;

function createBar() {
  bar = document.createElement('div');
  bar.id = 'load-bar';
  bar.className = 'group/bar area-map pointer-events-none z-40 h-[0.1875rem] self-start overflow-hidden bg-accent/15 opacity-0 transition-opacity duration-300 data-[state=active]:opacity-100 data-[state=done]:opacity-0 data-[state=done]:delay-[250ms] data-[state=done]:duration-[400ms] data-[error=true]:bg-danger/15';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Kaartgegevens laden');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', '0');
  bar.innerHTML = '<div class="relative inset-0 p-8 origin-left scale-x-[var(--p,0)] animate-shimmer bg-progress bg-[length:200%_100%] transition-transform duration-[400ms] ease-smooth motion-reduce:animate-none group-data-[error=true]/bar:animate-none group-data-[error=true]/bar:bg-danger group-data-[error=true]/bar:bg-none"></div>';
  (document.getElementById('app-container') || document.body).appendChild(bar);

  showTimer = setTimeout(() => { bar.dataset.state = 'active'; }, SHOW_DELAY_MS);
  trickleTimer = setInterval(() => {
    if (displayed < TRICKLE_CAP) {
      displayed += (TRICKLE_CAP - displayed) * 0.05;
      paint();
    }
  }, TRICKLE_MS);
  failsafeTimer = setTimeout(finishAll, FAILSAFE_MS);
}

function realProgress() {
  let weight = 0, value = 0;
  tasks.forEach(t => { weight += t.weight; value += t.weight * t.value; });
  return weight ? value / weight : 0;
}

function paint() {
  if (!bar) return;
  bar.style.setProperty('--p', displayed.toFixed(3));
  bar.setAttribute('aria-valuenow', String(Math.round(displayed * 100)));
}

function complete() {
  finished = true;
  displayed = 1;
  paint();
  clearInterval(trickleTimer);
  clearTimeout(showTimer);
  clearTimeout(failsafeTimer);
  if (bar.dataset.state === 'active') {
    bar.dataset.state = 'done';
    setTimeout(() => bar.remove(), 900);
  } else {
    bar.remove();
  }
}

function sync() {
  if (finished || !bar) return;
  displayed = Math.max(displayed, realProgress());

  const pending = [...tasks].filter(([, t]) => t.value < 1).map(([name]) => name);
  if (pending.length) document.body.dataset.loading = pending.join(' ');
  else delete document.body.dataset.loading;
  document.getElementById('app-container')?.setAttribute('aria-busy', pending.length ? 'true' : 'false');

  paint();
  if (!pending.length) complete();
}

function finishAll() {
  tasks.forEach(t => { t.value = 1; });
  sync();
}

export const loader = {
  task(name, weight = 1) {
    if (!bar) createBar();
    const t = { weight, value: 0 };
    tasks.set(name, t);
    return {
      set(v) { t.value = Math.min(1, Math.max(t.value, v)); sync(); },
      done() { t.value = 1; sync(); }
    };
  },
  fail() {
    if (!bar || finished) return;
    bar.dataset.error = 'true';
    bar.dataset.state = 'active';
    finishAll();
  },
  finishAll
};