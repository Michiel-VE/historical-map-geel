// cache.js
import pkg from '../package.json';

const CURRENT_DB_NAME = `geel1834_cache_${pkg.version}`;
const STORE_NAME = 'geojson';

// Automatically delete old version databases to prevent storage buildup
async function cleanupOldDatabases() {
  if (typeof indexedDB.databases === 'function') {
    try {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name && db.name.startsWith('geel1834_cache_') && db.name !== CURRENT_DB_NAME) {
          indexedDB.deleteDatabase(db.name);
        }
      }
    } catch {
      // Ignore if unsupported or blocked
    }
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    cleanupOldDatabases();

    const req = indexedDB.open(CURRENT_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.result);
  });
}

export async function getCachedGeoJSON(url) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(url);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setCachedGeoJSON(url, data) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data, url);
  } catch {
    // Ignore storage errors
  }
}