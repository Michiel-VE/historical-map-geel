# Geel 1834

A high-performance, lightweight web application for exploring the historical cadaster, land use, and landscape of Geel in 1834. 

**Live Demo:** [archief.michielve.be](https://archief.michielve.be/)

---

## Performance & Engineering

Built using vanilla JavaScript (ESM) and modern web standards without heavy framework bloat. To handle large historical vector datasets smoothly, the application incorporates several performance optimizations:

* **Off-Thread Parsing:** Heavy GeoJSON datasets are parsed asynchronously via Web Workers, keeping the main thread completely unblocked during startup.
* **Persistent Caching:** Utilizes IndexedDB to cache processed spatial data locally, ensuring near-instant load times on repeat visits.
* **Dynamic Code Splitting:** Non-critical modules (such as the search index) are lazy-loaded only after the primary map canvas and core layers have initialized.
* **GPU Render Constraints:** Strict `minzoom` layer rules and global map zoom limitations prevent unnecessary rendering cycles when zoomed out.
* **Memory Management:** Clean teardown logic on basemap switches to prevent event listener leaks over long sessions.

---

## Tech Stack

* **Mapping:** MapLibre GL JS
* **Build Tool:** Vite
* **Styling:** Tailwind CSS
* **Data Layer:** IndexedDB & Web Workers

---

## Project Structure

```text
src/
├── main.js       # App entry point and execution lifecycle
├── map.js        # MapLibre instance, camera animations, and basemap switcher
├── layers.js     # GeoJSON layer configurations, styling, and interactions
├── core.js       # Shared application state and constants
├── search.js     # Client-side search module (lazy-loaded)
├── cache.js      # IndexedDB caching layer
├── worker.js     # Off-thread background parser worker
└── ui.js         # Sidebar, drawer, panels, and accessibility controls