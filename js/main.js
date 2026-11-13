import '../src/input.css';
import { map } from './map.js';
import { state, loader, loadErrors, showLoadWarning } from './core.js';
import {
  addRegionLayers, initRegionInteractions, discoverRegions, fetchSections, applySections,
  buildRegionList, addDetailLayers, fetchDetails, applyDetailType, initLayerInteractions,
  initOpacitySlider, initLayerToggles, updateLayerVisibilities, addSelectionLayer
} from './layers.js';
import {
  initSidebarToggle, initAccordions, initPanelMode, initOverviewButton, initZoomBehaviour,
  initBasemapSwitcher, initOnboarding, initVersion
} from './ui.js';
import { initA11y } from './a11y.js';

const load = {
  map: loader.task('map', 2),
  regions: loader.task('regions', 1),
  details: loader.task('details', 5),
  search: loader.task('search', 1)
};

initSidebarToggle();
initAccordions();
initOverviewButton();
initVersion();

let layersAdded;
const layersReady = new Promise(resolve => { layersAdded = resolve; });

const regionsP = discoverRegions().then(list => { state.regions = list; return list; });
const sectionsP = regionsP.then(list => (list.length ? fetchSections() : null));
const detailsP = regionsP.then(list => (list.length
  ? fetchDetails(load.details.set, (type) => layersReady.then(() => applyDetailType(type)))
  : null));

[regionsP, sectionsP, detailsP].forEach(p => p.catch(() => { }));

map.on('load', async () => {
  load.map.done();

  addRegionLayers();
  addDetailLayers();
  addSelectionLayer();

  initRegionInteractions();
  initLayerInteractions();
  initOpacitySlider();
  initLayerToggles();
  updateLayerVisibilities();

  initPanelMode();
  initZoomBehaviour();
  initA11y();
  initBasemapSwitcher();

  layersAdded();

  try {
    const regions = await regionsP;
    if (!regions.length) {
      console.warn('[main] No regions found. Run: node tools/build-regions.js');
      loader.fail();
      return;
    }

    applySections(await sectionsP);
    load.regions.done();
    buildRegionList();
    initOnboarding();

    await detailsP;
    load.details.done();

    const { initSearch } = await import('./search.js');
    initSearch();

    load.search.done();
  } catch (err) {
    console.error('[main] loading failed', err);
    loader.fail();
  } finally {
    if (loadErrors.length) showLoadWarning(loadErrors.length);
  }
});