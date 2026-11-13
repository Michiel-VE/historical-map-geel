// Scans assets/data/* and writes assets/data/regions.json
// Every sub-folder that contains a section.geojson counts as a region.
// Usage (from project root):  node tools/build-regions.js
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'assets', 'data');

const regions = fs.readdirSync(dataDir, { withFileTypes: true })
  .filter(d => d.isDirectory() && fs.existsSync(path.join(dataDir, d.name, 'section.geojson')))
  .map(d => d.name)
  .sort();

fs.writeFileSync(path.join(dataDir, 'regions.json'), JSON.stringify(regions, null, 2) + '\n');
console.log(`regions.json written: ${regions.join(', ') || '(none)'}`);