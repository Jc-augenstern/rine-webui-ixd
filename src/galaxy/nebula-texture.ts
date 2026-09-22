import { CanvasTexture, SRGBColorSpace, LinearFilter } from "three";
import { seededRandom } from "./star-field";

// A deterministic, locally generated cloud atlas. The costly fractal work runs
// once, never per frame; WebGL and the context-loss fallback share the same sky.
let atlas: HTMLCanvasElement | undefined;
const hash = (x: number, y: number) => {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};
const noise = (x: number, y: number) => {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
};
const fbm = (x: number, y: number, octaves = 5) => {
  let value = 0, amplitude = 0.5;
  for (let i = 0; i < octaves; i++) {
    value += noise(x, y) * amplitude;
    x = x * 2.07 + 17.1; y = y * 2.03 + 9.2; amplitude *= 0.5;
  }
  return value;
};

export function nebulaAtlas(): HTMLCanvasElement {
  if (atlas) return atlas;
  const canvas = document.createElement("canvas");
  canvas.width = 1280; canvas.height = 768;
  const context = canvas.getContext("2d")!;
  const pixels = context.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const px = x / canvas.width * 2 - 1;
      const py = y / canvas.height * 1.4 - 0.7;
      const warp = fbm(px * 2.4 + 31, py * 3.2 + 9, 3);
      const fine = fbm(px * 8 + warp * 2.8 + 13, py * 9 + warp * 2 + 27);
      const curl = fbm(px * 3.2 + fine * 1.7 + 6, py * 4.2 + 14, 4);
      const river = py + px * 0.50 - 0.09 * Math.sin(px * 4) + (warp - 0.45) * 0.48;
      const band = Math.exp(-river * river * 14);
      const light = Math.pow(Math.max(0, fine * 1.8 - 0.36), 1.6);
      const rift = river + (curl - 0.46) * 0.39 + 0.025;
      const dust = Math.exp(-rift * rift * 520) * (0.48 + curl * 0.45);
      const cloud = band * light * (1 - dust) * 1.25;
      const warm = Math.exp(-((px - 0.35) ** 2 * 13 + (py + 0.12) ** 2 * 19));
      const violet = Math.exp(-((px + 0.34) ** 2 * 4 + (py - 0.35) ** 2 * 10));
      const veil = Math.exp(-river * river * 3) * curl;
      const i = (y * canvas.width + x) * 4;
      pixels.data[i] = 3 + veil * 9 + cloud * (65 + warm * 104 + violet * 37);
      pixels.data[i + 1] = 6 + veil * 13 + cloud * (132 - warm * 28 - violet * 28);
      pixels.data[i + 2] = 15 + veil * 30 + cloud * (225 - warm * 87);
      pixels.data[i + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  const random = seededRandom(26121);
  // Unresolved, far-away starlight is baked in. It adds no GPU particles/calls.
  for (let i = 0; i < 3400; i++) {
    const x = random() * canvas.width, y = random() * canvas.height;
    const px = x / canvas.width * 2 - 1, py = y / canvas.height * 1.4 - 0.7;
    const band = Math.exp(-((py + px * 0.5) ** 2) * 10);
    const alpha = (0.05 + random() * 0.37) * (0.3 + band * 0.7);
    context.fillStyle = `rgba(185,207,255,${alpha})`;
    context.fillRect(x, y, random() < 0.95 ? 0.65 : 1.1, 0.65);
  }
  atlas = canvas;
  return canvas;
}

export function createNebulaTexture() {
  const texture = new CanvasTexture(nebulaAtlas());
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}
