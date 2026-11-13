import { map } from './map.js';
import { state, DETAIL_ENTRY_ZOOM, DETAIL_PITCH, NO_PADDING, $, esc, extendBounds } from './core.js';
import { showDetails, popupFor } from './layers.js';


// Parcel search: one box, searches owner, parcel number, hamlet, profession,
// residence, land use and article number. Everything runs in memory.

const MAX_RESULTS = 20;
const MIN_CHARS = 2;
const DEBOUNCE_MS = 80;


const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const clean = (v) => (v == null || String(v).trim() === '-' ? '' : String(v).trim());

let index = [];

function buildIndex() {
  let skipped = 0;

  index = (state.dataStore.parcels?.features || [])
    .filter(f => f.geometry)
    .map(f => {
      const p = f.properties || {};
      const bounds = new maplibregl.LngLatBounds();
      extendBounds(bounds, f.geometry.coordinates);

      // No usable coordinates: skip this parcel (toArray() would throw on empty bounds)
      if (bounds.isEmpty()) {
        skipped++;
        console.warn('[search] parcel without usable geometry, skipped:', p);
        return null;
      }

      const section = clean(p.SECTIE), nr = clean(p.PERCEELNR);
      const label = [section, nr].filter(Boolean).join(' ');   // "D 1"
      const owner = clean(p.EIGENAAR);
      const hay = [owner, p.GEHUCHT, p.BEROEP, p.WOONPLAATS, p.SOORT, p.ARTIKELNR, label].map(clean).join(' ');

      return {
        props: p,
        geometry: f.geometry,
        bbox: bounds.toArray(),
        label,
        owner,
        sub: [clean(p.GEHUCHT), clean(p.SOORT), clean(p.GROOTTE)].filter(Boolean).join(' · '),
        code: fold(section + nr).replace(/\s+/g, ''),   // "d1"
        ownerKey: fold(owner),
        hay: fold(hay)
      };
    })
    .filter(Boolean);   // drop the skipped (null) entries, otherwise search() crashes on them

  console.log(`[search] indexed ${index.length} parcels, skipped ${skipped}`);
}

function search(query) {
  const q = fold(query).trim();
  if (q.length < MIN_CHARS) return { top: [], total: 0 };

  const tokens = q.split(/\s+/);
  const codeQ = q.replace(/\s+/g, '');
  const buckets = [[], [], []];

  for (const it of index) {
    if (it.code === codeQ) buckets[0].push(it);
    else if (tokens.every(t => it.hay.includes(t))) buckets[it.ownerKey.startsWith(tokens[0]) ? 1 : 2].push(it);
  }

  // "D 12" / "d12" is clearly a parcel number: skip the noisy text matches
  const looksLikeCode = /^[a-z]{1,3}\s*\d+[a-z]*(\/\d+)?$/.test(q);
  if (looksLikeCode && buckets[0].length) { buckets[1] = []; buckets[2] = []; }

  const top = [];
  let total = 0;
  for (const b of buckets) {
    total += b.length;
    for (const it of b) if (top.length < MAX_RESULTS) top.push(it);
  }
  return { top, total };
}

// Fly to a parcel and open its details. Uses easeTo (not flyTo) so a long trip
// never zooms out past the detail threshold, which would clear the selection.
function choose(item) {
  const cam = map.cameraForBounds(item.bbox, { padding: 80, maxZoom: 18 });
  const [[w, s], [e, n]] = item.bbox;
  map.easeTo({
    center: cam ? cam.center : [(w + e) / 2, (s + n) / 2],
    zoom: Math.max(cam?.zoom ?? 0, DETAIL_ENTRY_ZOOM),
    pitch: DETAIL_PITCH,
    bearing: -10,
    padding: NO_PADDING,
    duration: 1200
  });
  const { title, rows } = popupFor('parcels', item.props);
  showDetails(title, rows, null, item.geometry, { focus: true });   // null: we already move the camera
}

export function initSearch() {
  const input = $('search-input');
  const list = $('search-results');
  const status = $('search-status');
  if (!input || !list) return;

  buildIndex();
  input.disabled = false;
  input.placeholder = 'Zoek op eigenaar of perceel (bv. Daems, D 12)';

  // ARIA 1.2 combobox: the input keeps focus, the active option is referenced
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'search-results');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-label', 'Zoek op eigenaar of perceel');
  list.setAttribute('aria-label', 'Zoekresultaten');

  let hits = [];
  let active = -1;
  let timer = null;

  const setActive = (i) => {
    active = i;
    // aria-selected drives the highlight (Tailwind's aria-selected: variant)
    [...list.children].forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
    if (i >= 0) input.setAttribute('aria-activedescendant', `sr-opt-${i}`);
    else input.removeAttribute('aria-activedescendant');
    list.children[i]?.scrollIntoView({ block: 'nearest' });
  };

  const render = (query) => {
    const { top, total } = search(query);
    hits = top;
    active = -1;

    list.innerHTML = top.map((it, i) => `
      <li role="option" id="sr-opt-${i}" aria-selected="false" data-i="${i}"
          class="mb-0.5 cursor-pointer rounded-lg px-3 py-2.5 transition-colors last:mb-0 hover:bg-panel-hover aria-selected:bg-panel-hover">
        <span class="block text-sm font-semibold text-ink">${esc(it.owner || 'Onbekend')}</span>
        <span class="mt-0.5 block text-xs text-ink-faint">Perceel ${esc(it.label || '?')}${it.sub ? ' · ' + esc(it.sub) : ''}</span>
      </li>`).join('');
    list.hidden = !top.length;
    input.setAttribute('aria-expanded', String(!list.hidden));
    input.removeAttribute('aria-activedescendant');

    if (!status) return;
    if (query.trim().length < MIN_CHARS) status.textContent = '';
    else if (!total) status.textContent = 'Geen resultaten';
    else status.textContent = total > top.length
      ? `${top.length} van ${total} resultaten getoond, typ meer om te verfijnen`
      : `${total} ${total === 1 ? 'resultaat' : 'resultaten'}`;
  };

  const pick = (i) => {
    const item = hits[i];
    if (!item) return;
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.blur();
    choose(item);
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => render(input.value), DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (hits.length) setActive((active + 1) % hits.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (hits.length) setActive((active - 1 + hits.length) % hits.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(active >= 0 ? active : 0); }
    else if (e.key === 'Escape') { input.value = ''; render(''); }
  });

  input.addEventListener('focus', () => {
    if (hits.length) { list.hidden = false; input.setAttribute('aria-expanded', 'true'); }
  });

  // mousedown, not click: the input would lose focus and hide the list first
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); pick(Number(li.dataset.i)); }
  });
}