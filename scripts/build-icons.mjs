// Rasterize the existing shared vector mark; no alternate logo or generated art.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ixdMark } from "../src/ixd-mark.ts";
import { palette } from "../src/palette.ts";
const {default:sharp}=await import(process.env.SHARP_MODULE ? pathToFileURL(resolve(process.env.SHARP_MODULE)).href : 'sharp');
const mark=ixdMark('ixd-app').replace('<svg ', '<svg x="76" y="48" width="360" height="416" ');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${palette.paper[0]}"/>${mark}</svg>`;
await mkdir('public/icons',{recursive:true});
await writeFile('public/icons/app-icon.svg',svg);
await writeFile('public/favicon.svg',svg);
for(const [name,size] of [['apple-touch-icon',180],['icon-192',192],['icon-512',512],['icon-maskable-512',512]])
  await sharp(Buffer.from(svg)).resize(size,size).png().toFile(`public/icons/${name}.png`);
console.log('Shared IXD mark exported to the favicon and four home-screen icons.');
