// Keyboard + screen-reader access to the canvas map.
import { map, flyToRegion } from './map.js';
import { ZOOM_THRESHOLD, $, esc, extendBounds, prettyName, announce } from './core.js';
import { CLICKABLE_LAYERS, typeOfLayer, popupFor, selectFeature, soloLayer, clearSelection } from './layers.js';

// Keyboard + screen-reader access to the canvas map.
//  - skip links (top of the page, and one inside the filters)
//  - map canvas: Dutch label + instructions, crosshair, Enter/Space selects what is under it
//  - "Objecten in beeld": a list of the nearest objects (distance + compass direction)
//  - "Alleen" buttons next to the layer checkboxes
//  - announcements when switching between overview and detail view

const MAX_NEARBY = 30;
const PICK_RADIUS_PX = 10;
const COMPASS = ['noord', 'noordoost', 'oost', 'zuidoost', 'zuid', 'zuidwest', 'west', 'noordwest'];

const isDetailed = () => map.getZoom() >= ZOOM_THRESHOLD;
const drawerOpen = () => $('details-drawer')?.hidden === false;

// ---------------------------------------------------------------- map queries
function queryFeatures(geometry) {
  const layers = CLICKABLE_LAYERS.filter(id => map.getLayer(id));
  const seen = new Set();
  // Features split across tiles show up twice: dedupe by layer + unique id (_i)
  return map.queryRenderedFeatures(geometry, { layers }).filter(f => {
    const key = f.layer.id + (f.properties?._i ?? JSON.stringify(f.properties));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compassFrom(from, to) {
  const rad = Math.PI / 180;
  const y = Math.sin((to.lng - from.lng) * rad) * Math.cos(to.lat * rad);
  const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad) -
            Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos((to.lng - from.lng) * rad);
  const deg = (Math.atan2(y, x) / rad + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

// ------------------------------------------------------------- skip links
// Two places: the nav at the top of the page, and a link inside the filters
// (<a data-skip="map"> in index.html). One delegated handler serves both.
function buildSkipLinks() {
  const nav = document.createElement('nav');
  nav.className = 'fixed left-2 top-2 z-[100] flex gap-2';
  nav.setAttribute('aria-label', 'Snelle navigatie');
  // Off-screen until focused (then static, so it takes its place in the flex row)
  const skipClass = 'absolute -left-[999rem] rounded-md bg-primary px-4 py-2.5 text-ui font-semibold text-white no-underline focus:static';
  nav.innerHTML = `
    <a href="#map" data-skip="map" class="${skipClass}">Naar de kaart</a>
    <a href="#search-input" data-skip="search" class="${skipClass}">Naar zoeken</a>`;
  document.body.prepend(nav);

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-skip]');
    if (!a) return;
    e.preventDefault();
    if (a.dataset.skip === 'map') return map.getCanvas().focus();
    const input = $('search-input');
    if (input && !input.disabled) input.focus();
    else announce('Zoeken is nog aan het laden');
  });
}

// ------------------------------------------------------- map keyboard + crosshair
function setupMapKeyboard() {
  const canvas = map.getCanvas();

  const help = document.createElement('div');
  help.id = 'map-help';
  help.className = 'sr-only';
  help.textContent =
    'Pijltjestoetsen verplaatsen de kaart. Plus en min zoomen. Shift met pijltjestoetsen draait en kantelt. ' +
    'Enter of spatie selecteert het object onder het kruisje. Escape sluit de details. ' +
    'Gebruik de lijst Objecten in beeld voor een overzicht van objecten in de buurt.';
  document.body.appendChild(help);

  canvas.setAttribute('aria-label', 'Kaart');
  canvas.setAttribute('aria-describedby', 'map-help');

  const crosshair = document.createElement('div');
  crosshair.className = 'pointer-events-none absolute left-1/2 top-1/2 z-[3] hidden size-10 -translate-x-1/2 -translate-y-1/2 data-[active=true]:block';
  crosshair.setAttribute('aria-hidden', 'true');
  crosshair.innerHTML = `
    <svg viewBox="0 0 40 40" width="40" height="40" class="block size-full forced-colors:[forced-color-adjust:none]">
      <g fill="none" stroke-linecap="round">
        <g stroke="#fff" stroke-width="5"><circle cx="20" cy="20" r="9"/><path d="M20 2v10M20 28v10M2 20h10M28 20h10"/></g>
        <g stroke="#0f172a" stroke-width="2.5"><circle cx="20" cy="20" r="9"/><path d="M20 2v10M20 28v10M2 20h10M28 20h10"/></g>
      </g>
    </svg>`;
  map.getContainer().appendChild(crosshair);

  // Only show the crosshair for keyboard focus, not after a mouse click
  const setCrosshair = (on) => { crosshair.dataset.active = String(on); };
  canvas.addEventListener('focus', () => setCrosshair(canvas.matches(':focus-visible')));
  canvas.addEventListener('blur', () => setCrosshair(false));
  canvas.addEventListener('mousedown', () => setCrosshair(false));

  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pickAtCrosshair();
    } else if (e.key === 'Escape' && drawerOpen()) {
      clearSelection();
      announce('Details gesloten');
    }
  });
}

function pickAtCrosshair() {
  const { x, y } = map.project(map.getCenter());
  const box = [[x - PICK_RADIUS_PX, y - PICK_RADIUS_PX], [x + PICK_RADIUS_PX, y + PICK_RADIUS_PX]];

  if (!isDetailed()) {                                   // overview: regions
    const hit = map.queryRenderedFeatures(box, { layers: ['clusters-fill'] })[0];
    if (!hit) return announce('Geen gebied onder het kruisje. Verplaats de kaart met de pijltjestoetsen.');
    const region = hit.properties.region;
    announce(`Inzoomen op ${prettyName(region)}`);
    flyToRegion(region);
    return;
  }

  const hit = queryFeatures(box)[0];
  if (!hit) return announce('Geen object onder het kruisje. Verplaats de kaart met de pijltjestoetsen.');
  selectFeature(typeOfLayer(hit.layer.id), hit, map.getCenter(), { focus: true });
}

// ------------------------------------------------------- "Objecten in beeld" list
function buildNearbyList() {
  const host = $('detail-inner');
  if (!host) return;

  // mouse-nav: visually hidden for mouse users, shown once the keyboard is used (or focused)
  const card = document.createElement('div');
  card.id = 'nearby-card';
  card.className = 'mb-4 mouse-nav:sr-only';
  card.innerHTML = `
    <button type="button" id="nearby-toggle"
            class="group/acc flex w-full cursor-pointer items-center justify-between py-0.5 text-left text-ui font-semibold leading-snug text-ink"
            aria-expanded="false" aria-controls="nearby-panel">
      <span>Objecten in beeld</span>
      <span class="size-2 rotate-45 border-b-2 border-r-2 border-ink-soft transition-transform duration-200 group-aria-expanded/acc:-rotate-[135deg]" aria-hidden="true"></span>
    </button>
    <div id="nearby-panel" class="mt-2.5" hidden>
      <p class="mb-2 text-small text-ink-soft">Objecten in het kaartbeeld, dichtstbij eerst.</p>
      <button type="button" id="nearby-refresh"
              class="mb-2 min-h-8 cursor-pointer rounded-md border border-line bg-panel px-3 py-1 text-small font-semibold leading-none text-ink hover:bg-panel-muted">Lijst vernieuwen</button>
      <ul id="nearby-list" aria-label="Objecten in beeld" class="flex max-h-56 list-none flex-col gap-1 overflow-y-auto"></ul>
    </div>`;
  host.insertBefore(card, $('btn-reset'));

  const toggle = $('nearby-toggle');
  const panel = $('nearby-panel');
  const list = $('nearby-list');
  let items = [];

  const fill = () => {
    const c = map.getCenter();
    items = queryFeatures().map(f => {
      const type = typeOfLayer(f.layer.id);
      const b = new maplibregl.LngLatBounds();
      extendBounds(b, f.geometry.coordinates);
      const mid = b.isEmpty() ? null : b.getCenter();
      return { f, type, mid, title: popupFor(type, f.properties || {}).title, d: mid ? mid.distanceTo(c) : Infinity };
    }).sort((a, b) => a.d - b.d).slice(0, MAX_NEARBY);

    list.innerHTML = items.length
      ? items.map((it, i) => {
          const where = !it.mid ? '' : it.d < 15
            ? 'onder het kruisje'
            : `ca. ${Math.round(it.d / 10) * 10} m ${compassFrom(c, it.mid)}`;
          return `<li><button type="button" data-i="${i}"
              class="flex w-full cursor-pointer flex-col rounded-md border border-line bg-panel px-2.5 py-2 text-left hover:bg-panel-subtle">
            <span class="text-sm font-semibold text-ink">${esc(it.title)}</span>
            ${where ? `<span class="mt-0.5 text-xs text-ink-soft">${esc(where)}</span>` : ''}
          </button></li>`;
        }).join('')
      : '<li class="py-1 text-small text-ink-soft">Geen objecten in beeld. Zoom in of verplaats de kaart.</li>';

    announce(items.length ? `${items.length} objecten in beeld` : 'Geen objecten in beeld');
  };

  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
    if (open) fill();
  });

  $('nearby-refresh').addEventListener('click', fill);

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-i]');
    if (!btn) return;
    const it = items[Number(btn.dataset.i)];
    if (it) selectFeature(it.type, it.f, it.mid || map.getCenter(), { focus: true });
  });

  // Leaving the detail view hides the whole card: collapse it so it starts fresh next time
  map.on('zoomend', () => {
    if (!isDetailed() && toggle.getAttribute('aria-expanded') === 'true') toggle.click();
  });
}

// ---------------------------------------------------------- "Alleen" buttons
function addSoloButtons() {
  document.querySelectorAll('[data-layer-row]').forEach(row => {
    const cb = row.querySelector('input[type="checkbox"]');
    const label = row.querySelector('label');
    if (!cb || !label) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'min-h-7 shrink-0 cursor-pointer rounded-md px-2 py-1 text-small font-semibold leading-none text-ink-soft hover:bg-panel-hover hover:text-ink-strong forced-colors:border forced-colors:border-[ButtonText]';
    btn.dataset.solo = '';              // hook for the onboarding checklist
    btn.textContent = 'Alleen';
    btn.setAttribute('aria-label', `Toon alleen ${label.textContent.trim()}`);
    btn.addEventListener('click', () => soloLayer(cb.id.replace('layer-toggle-', '')));
    row.appendChild(btn);
  });
}

// ----------------------------------------------------------- mode announcements
function announceModeChanges() {
  let detailed = isDetailed();
  map.on('zoomend', () => {
    if (isDetailed() === detailed) return;
    detailed = isDetailed();
    announce(detailed
      ? 'Detailweergave. Percelen, wegen, waterlopen en gebouwen zijn te selecteren. Lagen en de lijst Objecten in beeld zijn beschikbaar.'
      : 'Overzicht. Kies een gebied om in te zoomen.');
  });
}

// Keyboard-only UI (the nearby list) is shown only while the user is navigating by keyboard.
// For everyone else it stays in the page, visually hidden, so screen readers can still reach it.
function trackInputModality() {
  const root = document.documentElement;
  document.addEventListener('keydown', (e) => { if (e.key === 'Tab') root.classList.add('kbd-nav'); });
  document.addEventListener('pointerdown', () => root.classList.remove('kbd-nav'));
}

export function initA11y() {
  trackInputModality();
  buildSkipLinks();
  setupMapKeyboard();
  buildNearbyList();
  addSoloButtons();
  announceModeChanges();
}