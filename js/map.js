// The map: base maps, the map instance and camera moves.

import {
  state, store, DEFAULT_CENTER, DEFAULT_ZOOM, OVERVIEW_MAX_ZOOM,
  DETAIL_ENTRY_ZOOM, OVERVIEW_PADDING, NO_PADDING, LOW_END, DETAIL_PITCH
} from './core.js';


// ======================================================================
// Base maps
// ======================================================================

// Two base maps; the visitor's choice is remembered.
export const BASEMAPS = [
  { id: 'liberty',  label: 'Standaard', hint: 'kaart met kleuren, wegen en gebouwen', url: 'https://tiles.openfreemap.org/styles/liberty' },
  { id: 'positron', label: 'Neutraal', hint: 'rustige grijze kaart, de historische lagen vallen meer op', url: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json' }
];
const BASEMAP_KEY = 'geel1834.basemap.v1';
// First visit: the calm Positron style on weak devices (far fewer layers than Liberty)
export const savedBasemap = () => BASEMAPS.find(b => b.id === store.get(BASEMAP_KEY)) || (LOW_END ? BASEMAPS[1] : BASEMAPS[0]);
export const saveBasemap = (id) => store.set(BASEMAP_KEY, id);

// ======================================================================
// Map instance
// ======================================================================

// maplibregl is loaded as a global by the <script> tag in index.html
export const map = new maplibregl.Map({
  container: 'map',
  style: savedBasemap().url,   // Standaard (Liberty) or Neutraal (Positron)
  center: DEFAULT_CENTER,
  zoom: DEFAULT_ZOOM,
  minZoom: 11,                  // Prevents zooming out too far into the world map
  maxZoom: 19,
  pitch: 0,
  bearing: 0,
  maxPitch: LOW_END ? 45 : 55,
  pitchWithRotate: true,
  antialias: !LOW_END,            // cheaper on weak GPUs
  fadeDuration: LOW_END ? 0 : 300,
  // Dutch labels for the canvas and the built-in controls (screen readers)
  locale: {
    'Map.Title': 'Kaart',
    'NavigationControl.ZoomIn': 'Inzoomen',
    'NavigationControl.ZoomOut': 'Uitzoomen',
    'NavigationControl.ResetBearing': 'Draai naar het noorden'
  }
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

// Keywords for layers to hide; add or remove options here as needed
const HIDDEN_LAYER_KEYWORDS = ['poi', ...(LOW_END ? ['building-3d'] : [])];

function removeExtraIcons() {
  const currentStyle = map.getStyle();
  if (!currentStyle || !currentStyle.layers) return;
  for (const layer of currentStyle.layers) {
    if (HIDDEN_LAYER_KEYWORDS.some(keyword => layer.id.includes(keyword))) {
      try {
        map.setLayoutProperty(layer.id, 'visibility', 'none');
      } catch (e) {
        // Ignore layers that do not support visibility changes
      }
    }
  }
}

map.on('style.load', removeExtraIcons);

// Basemap switcher logic with clean teardown and memory management
export function initBasemapSwitcher() {
  const select = document.getElementById('basemap-select');
  if (!select) return;

  select.value = savedBasemap().id;
  select.addEventListener('change', async (e) => {
    const styleId = e.target.value;
    saveBasemap(styleId);
    const basemap = BASEMAPS.find(b => b.id === styleId) || BASEMAPS[0];

    // Changing the style automatically destroys previous layers/sources, freeing GPU memory.
    map.setStyle(basemap.url);

    // Use map.once instead of map.on to prevent accumulating style.load listeners over time.
    map.once('style.load', async () => {
      removeExtraIcons();
      // Dynamically import layers to avoid circular dependency issues
      const { addRegionLayers, addDetailLayers, addSelectionLayer, updateLayerVisibilities, applyOpacity } = await import('./layers.js');
      addRegionLayers();
      addDetailLayers();
      addSelectionLayer();
      updateLayerVisibilities();
      applyOpacity();
    });
  });
}

// ======================================================================
// Camera
// ======================================================================

// Camera that fits the bounds (zoom is undefined if the fit fails)
function fit(bounds, padding) {
  const cam = map.cameraForBounds(bounds, { padding });
  return { center: cam ? cam.center : bounds.getCenter(), zoom: cam?.zoom };
}

// Fly into a region: tilted view, always ends at detail level
export function flyToBounds(bounds) {
  const { center, zoom } = fit(bounds, 80);
  map.flyTo({
    center,
    zoom: Math.min(16, Math.max(zoom ?? 0, DETAIL_ENTRY_ZOOM)),
    pitch: DETAIL_PITCH,
    bearing: -10,
    padding: NO_PADDING,
    duration: 1600
  });
}

export function flyToRegion(name) {
  const bounds = state.regionBounds[name];
  if (bounds) flyToBounds(bounds);
}

// Back to the overview: all regions centred, top-down
export function flyToOverview({ animate = true } = {}) {
  const target = state.overviewBounds
    ? (({ center, zoom }) => ({ center, zoom: Math.min(zoom ?? DEFAULT_ZOOM, OVERVIEW_MAX_ZOOM) }))(
        fit(state.overviewBounds, OVERVIEW_PADDING))
    : { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };

  const camera = { ...target, pitch: 0, bearing: 0, padding: NO_PADDING };
  if (animate) map.flyTo({ ...camera, duration: 1800 });
  else map.jumpTo(camera);
}