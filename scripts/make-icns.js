// Generates icon.icns from icon.png using png2icons (pure JS, runs from
// Windows). Used by build:mac so the produced .app shows our blue
// thumbtack instead of the default Electron diamond.
const fs = require('node:fs');
const path = require('node:path');
const png2icons = require('png2icons');

const root = path.join(__dirname, '..');
const src = path.join(root, 'icon.png');
const out = path.join(root, 'icon.icns');

const png = fs.readFileSync(src);
const icns = png2icons.createICNS(png, png2icons.BILINEAR, 0);
if (!icns) {
  console.error('icns generation failed');
  process.exit(1);
}
fs.writeFileSync(out, icns);
console.log('wrote ' + out + ' (' + icns.length + ' bytes)');
