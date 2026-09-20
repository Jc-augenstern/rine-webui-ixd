import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { palette, lightSurfaces, darkSurfaces, opticalSurfaces } from '../src/palette.ts';

const luminance = hex => {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
let minimum = Infinity;
for (const mode of [0, 1]) {
  for (const text of ['ink', 'muted', 'accent']) for (const surface of ['paper', 'panel', 'field']) {
    const ratio = contrast(palette[text][mode], palette[surface][mode]);
    minimum = Math.min(minimum, ratio);
    assert(ratio >= 4.5, `${mode}/${text}/${surface}: ${ratio}`);
  }
  assert(contrast(palette.onAccent[mode], palette.accent[mode]) >= 4.5);
}
// Embedded source materials must all have a runtime replacement in both themes.
for (const file of ['archive-cassette', 'archive-assembly']) {
  const bytes = await readFile(`public/assets/${file}.glb`);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  for (const material of gltf.materials) {
    const name = material.name.replace(/\.\d+$/, '');
    assert(lightSurfaces[name] || opticalSurfaces[name], `Missing light material: ${name}`);
    assert(darkSurfaces[name] || opticalSurfaces[name], `Missing dark material: ${name}`);
  }
}
const manifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
assert.equal(manifest.background_color, palette.paper[0]);
assert.equal(manifest.theme_color, palette.paper[0]);
assert((await readFile('index.html', 'utf8')).includes(`name="theme-color" content="${palette.paper[0]}"`));
console.log(`Palette passed: minimum text contrast ${minimum.toFixed(2)}:1; both GLBs covered; PWA colors match.`);
