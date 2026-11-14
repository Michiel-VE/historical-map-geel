// fix-bad.js
const fs = require('fs'), path = require('path');
const FIX = {
  'Andr�': 'André',
  'Sali�n': 'Saliën',
  'Beaupr�': 'Beaupré',
  'Douairi�re': 'Douairière',
  'Mar�chal': 'Maréchal',
  'André A. R. Vercammen': 'André A.R. Vercammen'
  // add the rest from the list above
};
(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (p.endsWith('.geojson')) {
      let t = fs.readFileSync(p, 'utf8');
      for (const [bad, good] of Object.entries(FIX)) t = t.split(bad).join(good);
      fs.writeFileSync(p, t, 'utf8');
    }
  }
})('public/assets/data');