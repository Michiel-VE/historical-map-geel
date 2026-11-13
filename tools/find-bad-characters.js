const fs = require('fs');
const path = require('path');

const results = {};

(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (p.endsWith('.geojson')) {
      const text = fs.readFileSync(p, 'utf8');
      for (const w of text.match(/[\p{L}.]*\uFFFD[\p{L}.]*/gu) || []) {
        if (!results[w]) {
          results[w] = { count: 0, files: new Set() };
        }
        results[w].count += 1;
        results[w].files.add(p);
      }
    }
  }
})('assets/data');

const rows = Object.entries(results)
  .sort((a, b) => b[1].count - a[1].count)
  .map(([Name, { count: Count, files }]) => ({
    Count,
    Name,
    File: Array.from(files).join(', ')
  }));

console.table(rows);