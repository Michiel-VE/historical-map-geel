// Interface behaviour around the map: side panel, zoom behaviour, base map switch,
// first-visit onboarding, version label.

import { map, flyToOverview, BASEMAPS, savedBasemap, saveBasemap } from './map.js';
import { ZOOM_THRESHOLD, NO_PADDING, store, $, announce } from './core.js';
import {
  addRegionLayers, addDetailLayers, addSelectionLayer, updateLayerVisibilities,
  applyOpacity, clearSelection, resetLayerToggles
} from './layers.js';


// ======================================================================
// Side panel
// ======================================================================

// Collapse / expand the left panel
export function initSidebarToggle() {
  // State lives on #app-container: Tailwind's `rail:` variant styles everything from it
  const app = $('app-container');
  const btn = $('sidebar-toggle');
  if (!app || !btn) return;
  const sync = () => btn.setAttribute('aria-expanded', String(app.dataset.collapsed !== 'true'));
  btn.addEventListener('click', () => {
    app.dataset.collapsed = String(app.dataset.collapsed !== 'true');
    sync();
    setTimeout(() => map.resize(), 300);
  });
  sync();
}

// Accordions: <button data-acc aria-expanded aria-controls="id"> shows/hides #id
// (the panel animates through Tailwind's closed: variant on [hidden])
export function initAccordions() {
  document.querySelectorAll('[data-acc]').forEach(btn => {
    const panel = $(btn.getAttribute('aria-controls'));
    if (!panel) return;

    // Ensure initial state matches aria-expanded without hidden attribute mismatch
    const isOpen = btn.getAttribute('aria-expanded') === 'true';
    panel.hidden = !isOpen;

    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));

      if (open) {
        panel.hidden = false; // Opens immediately, CSS transition slides it down
      } else {
        // Instantly toggle hidden so the slide-up transition triggers right away without delay
        panel.hidden = true;
      }
    });
  });

  // "Over deze kaart" starts open, except on phones where the bottom sheet is short
  const about = $('about-btn');
  if (about && matchMedia('(max-width: 48rem)').matches) about.click();
}

// Overview -> region list. Detail -> opacity slider, layer toggles, overview button.
function updatePanelMode() {
  const detailed = map.getZoom() >= ZOOM_THRESHOLD;
  const app = $('app-container');
  if (app) app.dataset.mode = detailed ? 'detail' : 'overview';   // overview: / detail: variants
}

export function initPanelMode() {
  map.on('zoom', updatePanelMode);
  updatePanelMode();
}

// "Algemeen Overzicht"
export function initOverviewButton() {
  $('btn-reset')?.addEventListener('click', () => {
    clearSelection();
    flyToOverview();
  });
}

// ======================================================================
// Zoom behaviour
// ======================================================================

// Zooming out below the threshold: drop the selection, show all layers again,
// and once the map is idle ease back to a top-down view.
export function initZoomBehaviour() {
  let wasDetailed = map.getZoom() >= ZOOM_THRESHOLD;
  let needsFlatten = false;
  let timer = null;

  map.on('zoom', () => {
    const detailed = map.getZoom() >= ZOOM_THRESHOLD;
    if (wasDetailed && !detailed) {
      clearSelection();
      resetLayerToggles();
      needsFlatten = true;
    }
    if (detailed) needsFlatten = false;   // zoomed back in, keep the 3D view
    wasDetailed = detailed;
  });

  const isFlat = () => Math.abs(map.getPitch()) < 0.5 && Math.abs(map.getBearing()) < 0.5;

  map.on('movestart', () => clearTimeout(timer));

  // If the user interrupts the ease, moveend fires again and we retry
  map.on('moveend', () => {
    clearTimeout(timer);
    if (!needsFlatten) return;
    timer = setTimeout(() => {
      if (!needsFlatten || map.isMoving()) return;
      if (map.getZoom() >= ZOOM_THRESHOLD || isFlat()) { needsFlatten = false; return; }
      map.easeTo({ pitch: 0, bearing: 0, padding: NO_PADDING, duration: 800 });
    }, 200);
  });
}

// ======================================================================
// Base map switcher
// ======================================================================

// Base map switcher: a small two-option control in the bottom-left corner of the map.
//
// map.setStyle() throws away every source and layer we added ourselves, so after each
// switch we add them again (from the data kept in `state`). Click/hover handlers are
// registered per layer id and survive the swap, so they are NOT registered again here.

let current = savedBasemap().id;
let buttons = [];

const syncPressed = () => buttons.forEach(([id, btn]) => btn.setAttribute('aria-pressed', String(id === current)));

function switchTo(basemap) {
  if (basemap.id === current) return;
  current = basemap.id;
  saveBasemap(current);
  syncPressed();
  map.setStyle(basemap.url, { diff: false });
  announce(`Achtergrondkaart: ${basemap.label}`);
}

// Put our own layers back on the fresh style
function restoreOverlays() {
  if (map.getSource('clusters-source')) return;   // style still has them: nothing to do
  addRegionLayers();
  addDetailLayers();
  addSelectionLayer();
  updateLayerVisibilities();   // respect the layer checkboxes
  applyOpacity();              // respect the opacity slider
}

class BasemapControl {
  onAdd() {
    this.el = document.createElement('div');
    // Not given the `maplibregl-ctrl` class on purpose: MapLibre's own button CSS would
    // out-rank our utilities. These classes replace what that class would have given us.
    this.el.className = 'pointer-events-auto clear-both float-left mb-2.5 ml-2.5 inline-flex gap-0.5 rounded-[10px] bg-panel p-[3px] shadow-control';
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', 'Achtergrondkaart');

    buttons = BASEMAPS.map(b => {
      const btn = document.createElement('button');
      btn.type = 'button';
      // aria-pressed marks the selected map: dark fill + check mark, so it is not colour alone
      btn.className = 'min-h-9 min-w-[60px] cursor-pointer rounded-[7px] bg-transparent px-3.5 text-[13px] font-semibold text-primary-dark transition-colors hover:bg-panel-muted active:bg-line focus-visible:outline-focus-map motion-reduce:transition-none [@media(pointer:coarse)]:min-h-11 aria-pressed:bg-primary-dark aria-pressed:text-white aria-pressed:before:mr-1.5 aria-pressed:before:content-["✓"] aria-pressed:hover:bg-primary aria-pressed:active:bg-primary-dark forced-colors:aria-pressed:outline forced-colors:aria-pressed:outline-2';
      btn.textContent = b.label;
      btn.title = b.hint[0].toUpperCase() + b.hint.slice(1);
      btn.setAttribute('aria-label', `${b.label}, ${b.hint}`);   // starts with the visible text
      btn.addEventListener('click', () => switchTo(b));
      this.el.appendChild(btn);
      return [b.id, btn];
    });
    syncPressed();
    return this.el;
  }
  onRemove() { this.el.remove(); }
}

// Call once, after the first set of layers has been added
export function initBasemapSwitcher() {
  map.addControl(new BasemapControl(), 'bottom-left');
  map.on('style.load', restoreOverlays);
}

// ======================================================================
// Onboarding
// ======================================================================

// First-visit onboarding, two small pieces:
//  1. Hint banner over the map (contextual: overview vs detail).
//     Fades out once the user opens a feature's details, or dismisses it.
//  2. Layer-controls tip inside the panel: a checklist of the three controls
//     (layer name, checkbox, slider). Each step ticks off and slides away when
//     the user does it; when all are done (or "Begrepen" is pressed) the whole
//     card closes like a drawer. Progress is remembered per step.
// A "?" button in the panel header brings both back on demand.

const HINT_KEY = 'geel1834.onboarding.v1';
const LAYERS_KEY = 'geel1834.onboarding.layers.v1';   // 'done' or e.g. 'label,box'
const SHOW_DELAY_MS = 1200;
const STEP_DONE_MS = 700;    // how long a ticked step stays visible before sliding away
const CLOSE_MS = 450;        // matches the CSS collapse transition

const MESSAGES = {
  overview: 'Klik op een <strong class="font-semibold text-accent">gebied</strong> op de kaart om in te zoomen.',
  detail: 'Klik op een <strong class="font-semibold text-accent">perceel, weg of waterloop</strong> voor details.'
};

const STEPS = [
  { id: 'label', name: 'Alleen', text: 'Toon één laag. Nog eens klikken brengt alles terug.' },
  { id: 'box', name: 'Vakje', text: 'Vink aan of uit om één laag te wisselen.' },
  { id: 'slider', name: 'Zichtbaarheid', text: 'Open dit blok en maak de historische laag doorzichtiger.' }
];

const POINTER_ICON = `
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M5 3l14 7-6 2-2 6z"/>
  </svg>`;

const currentMode = () => (map.getZoom() >= ZOOM_THRESHOLD ? 'detail' : 'overview');

// ---------------------------------------------------------------- hint banner
let hint, textEl, active = false, mode = null;

function buildHint() {
  hint = document.createElement('div');
  hint.id = 'onboarding-hint';
  hint.setAttribute('role', 'status');          // polite live region, never steals focus
  hint.dataset.visible = 'false';               // data-[visible=true]: classes below do the fading
  hint.className = 'flex w-max max-w-[min(28rem,100%)] items-center gap-2.5 rounded-full bg-primary py-2 pl-2.5 pr-2 text-sm font-medium leading-snug text-slate-50 shadow-float invisible pointer-events-none opacity-0 transition-[opacity,visibility] duration-[600ms] data-[visible=true]:pointer-events-auto data-[visible=true]:visible data-[visible=true]:animate-hint-in data-[visible=true]:opacity-100 data-[visible=true]:duration-300 drawer-open:pointer-events-none drawer-open:opacity-0 motion-reduce:animate-none motion-reduce:transition-none';
  hint.innerHTML = `
    <span class="grid size-7 shrink-0 animate-pulse-ring place-items-center rounded-full bg-accent text-primary motion-reduce:animate-none">${POINTER_ICON}</span>
    <span data-text class="pr-1 transition-opacity duration-100"></span>
    <button type="button" data-close aria-label="Tip sluiten" title="Tip sluiten"
      class="size-7 shrink-0 cursor-pointer rounded-full bg-transparent text-xl leading-none text-inherit opacity-75 transition-[background-color,opacity] hover:bg-white/15 hover:opacity-100 focus-visible:outline-accent">&times;</button>`;
  textEl = hint.querySelector('[data-text]');
  hint.querySelector('[data-close]').addEventListener('click', () => hide(true));

  // Static host in index.html: it overlays the map cell, centres the banner,
  // and sits before the footer so the footer stays last in tab order.
  ($('onboarding-host') || document.body).appendChild(hint);
}

function render() {
  const next = currentMode();
  if (next === mode) return;
  mode = next;
  textEl.classList.add('opacity-0');
  setTimeout(() => {
    textEl.innerHTML = MESSAGES[mode];
    textEl.classList.remove('opacity-0');
  }, 120);
}

function show() {
  if (active) return;
  active = true;
  mode = null;
  render();
  textEl.innerHTML = MESSAGES[mode];
  hint.dataset.visible = 'true';
}

function hide(persist) {            // CSS fades it out
  active = false;
  hint.dataset.visible = 'false';
  if (persist) store.set(HINT_KEY, 'done');
}

// ------------------------------------------------------------ layers checklist
let tip, stepsEl, tipActive = false, tipPending = false, tipFresh = false;
let doneSteps = new Set();

// data-done / data-gone drive the tick and the slide-away (group/step variants)
const stepHTML = (s) => `
  <div data-step="${s.id}" data-done="false" data-gone="false"
       class="group/step grid grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity] duration-[400ms] ease-smooth data-[gone=true]:grid-rows-[0fr] data-[gone=true]:opacity-0 motion-reduce:transition-none">
    <div class="flex min-h-0 items-start gap-2.5 overflow-hidden pb-2.5">
      <span class="relative mt-px size-[1.125rem] shrink-0 rounded-full border-2 border-accent bg-transparent transition-[background-color,border-color,transform] duration-[250ms] after:absolute after:left-[0.3125rem] after:top-px after:h-[0.5625rem] after:w-[0.3125rem] after:rotate-45 after:scale-0 after:border-b-2 after:border-r-2 after:border-white after:transition-transform after:delay-[50ms] after:duration-[250ms] after:content-[''] group-data-[done=true]/step:scale-110 group-data-[done=true]/step:border-success group-data-[done=true]/step:bg-success group-data-[done=true]/step:after:scale-100" aria-hidden="true"></span>
      <span data-copy class="flex flex-col text-small leading-snug text-ink-soft transition-opacity duration-[250ms] group-data-[done=true]/step:opacity-60"><strong class="font-semibold text-accent-ink">${s.name}</strong><span>${s.text}</span></span>
    </div>
  </div>`;

function loadDone() {
  const v = store.get(LAYERS_KEY);
  if (v === 'done') return new Set(STEPS.map(s => s.id));
  return new Set((v || '').split(',').filter(id => STEPS.some(s => s.id === id)));
}

function buildLayersTip() {
  const host = $('detail-inner');
  if (!host) return;
  tip = document.createElement('div');
  tip.id = 'layers-tip';
  tip.setAttribute('role', 'note');
  tip.hidden = true;
  tip.dataset.closing = 'false';      // true = collapsed like a drawer (data-[closing=true]: classes)
  tip.className = 'mb-3 grid grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity,margin] duration-[400ms] ease-smooth closed:hidden data-[closing=true]:mb-0 data-[closing=true]:grid-rows-[0fr] data-[closing=true]:opacity-0 motion-reduce:transition-none';
  tip.innerHTML = `
    <div class="min-h-0 overflow-hidden">
      <div class="rounded-lg border border-l-4 border-accent-light border-l-accent bg-accent-wash px-3.5 py-3">
        <div class="mb-2.5 text-sm font-bold text-ink">Tip: stel de kaart naar wens in</div>
        <div data-steps aria-live="polite"></div>
        <button type="button" data-ok
          class="mt-0.5 min-h-8 cursor-pointer rounded-md bg-primary px-3.5 py-1 text-small font-semibold text-white transition-colors hover:bg-primary-hover focus-visible:outline-accent">Begrepen</button>
      </div>
    </div>`;
  stepsEl = tip.querySelector('[data-steps]');

  // Keep the "Naar de kaart" skip link as the first stop in the filters
  const skip = host.querySelector('[data-skip]');
  if (skip) skip.after(tip);
  else host.prepend(tip);

  tip.querySelector('[data-ok]').addEventListener('click', () => closeTip(true));

  // Each control completes its own step
  const controls = $('detail-controls');
  controls.addEventListener('input', (e) => {
    if (e.target.id === 'opacity-slider') completeStep('slider');
  });
  controls.addEventListener('change', (e) => {
    if (e.target.matches('input[type="checkbox"]')) completeStep('box');
  });
  controls.addEventListener('click', (e) => {
    if (e.target.closest('[data-solo]')) completeStep('label');   // "Alleen" has no change event
  });
}

// Opens like a drawer: start collapsed, then let the CSS transition expand it
function openTip(fresh) {
  if (!tip) return;
  doneSteps = fresh ? new Set() : loadDone();
  tipPending = false;
  tipFresh = false;
  if (doneSteps.size >= STEPS.length) return;

  stepsEl.innerHTML = STEPS.filter(s => !doneSteps.has(s.id)).map(stepHTML).join('');
  tipActive = true;
  tip.hidden = false;
  tip.dataset.closing = 'true';
  void tip.offsetHeight;             // commit the collapsed state
  tip.dataset.closing = 'false';
}

// Closes like a drawer
function closeTip(persist) {
  if (!tip) return;
  tipActive = false;
  tipPending = false;
  tip.dataset.closing = 'true';
  if (persist) store.set(LAYERS_KEY, 'done');
  setTimeout(() => { if (!tipActive) tip.hidden = true; }, CLOSE_MS);
}

function completeStep(id) {
  if (!tipActive || doneSteps.has(id)) return;
  const row = stepsEl.querySelector(`[data-step="${id}"]`);
  if (!row) return;

  doneSteps.add(id);
  const last = doneSteps.size === STEPS.length;
  store.set(LAYERS_KEY, last ? 'done' : [...doneSteps].join(','));

  row.dataset.done = 'true';
  row.querySelector('[data-copy]').insertAdjacentHTML('beforeend', '<span class="sr-only"> Gedaan</span>');

  setTimeout(() => {
    row.dataset.gone = 'true';                          // slides away
    if (last && tipActive) closeTip(false);             // all done: drawer closes
    setTimeout(() => row.remove(), CLOSE_MS);
  }, STEP_DONE_MS);
}

// ---------------------------------------------------------------- help button
function buildHelpButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'help-btn';
  btn.className = 'ml-auto mr-2 size-8 shrink-0 cursor-pointer rounded-full border border-line bg-panel-hover text-ui font-bold leading-none text-ink-soft transition-colors hover:bg-panel-muted hover:text-ink-strong focus-visible:outline-accent rail:hidden';
  btn.textContent = '?';
  btn.setAttribute('aria-label', 'Toon uitleg');
  btn.title = 'Toon uitleg';
  btn.addEventListener('click', () => {
    if (active || tipActive) {
      hide(false);
      closeTip(false);
    } else {
      show();
      if (currentMode() === 'detail') openTip(true);
      else { tipPending = true; tipFresh = true; }   // opens once the detail controls appear
    }
  });
  const header = $('panel-header');
  if (header) header.insertBefore(btn, $('sidebar-toggle'));
  else document.body.appendChild(btn);
}

// ----------------------------------------------------------------------- init
export function initOnboarding() {
  buildHint();
  buildLayersTip();
  buildHelpButton();

  tipPending = store.get(LAYERS_KEY) !== 'done';

  map.on('zoom', () => {
    if (active) render();
    if (tipPending && currentMode() === 'detail') openTip(tipFresh);
  });

  // Dispatched by details.js whenever a feature is opened (click or search)
  document.addEventListener('feature-selected', () => { if (active) hide(true); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && active) hide(true);
  });

  if (store.get(HINT_KEY) !== 'done') setTimeout(show, SHOW_DELAY_MS);
  if (tipPending && currentMode() === 'detail') openTip(false);
}

// ======================================================================
// Version label
// ======================================================================

// Shows the app version (from the `version` file) in the panel footer
export function initVersion() {
  const el = document.getElementById('app-version');
  if (!el) return;
  el.textContent = `Versie ${__APP_VERSION__}`;
  el.classList.add('animate-reveal', 'motion-reduce:animate-none');
}