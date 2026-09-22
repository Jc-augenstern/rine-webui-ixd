import type { GalaxyVisualPreset, StarVisualIdentity } from "../data/star-map";
import "./galaxy-glyph.css";

type Point = readonly [number, number];
type Random = () => number;
const n = (value: number) => value.toFixed(2);

function seeded(seed: number): Random {
  let state = (seed * 1709 + 2026) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function path(d: string, className = "gg-line", extra = "") {
  return `<path class="${className}" d="${d}" ${extra}/>`;
}

function core(x: number, y: number, radius = 2.1, className = "") {
  return `<g class="gg-core-group ${className}"><circle class="gg-aura" cx="${x}" cy="${y}" r="${radius * 3.5}"/><circle class="gg-corona" cx="${x}" cy="${y}" r="${radius * 1.8}"/><circle class="gg-core" cx="${x}" cy="${y}" r="${radius}"/></g>`;
}

/** A layer has authored resting, hover and detail poses, never a random shape. */
function layer(className: string, body: string, hover: string, open: string, delay = 0) {
  return `<g class="gg-part ${className}" style="--gg-hover:${hover};--gg-open:${open};--gg-delay:${delay}ms">${body}</g>`;
}

function particles(random: Random, count: number, position: (t: number, i: number) => Point, spread = 2.5) {
  return `<g class="gg-dust">${Array.from({ length: count }, (_, i) => {
    const [x, y] = position((i + random() * .65) / count, i);
    return `<circle cx="${n(x + (random() - .5) * spread)}" cy="${n(y + (random() - .5) * spread)}" r="${n(.35 + random() * .55)}" opacity="${n(.25 + random() * .65)}"/>`;
  }).join("")}</g>`;
}

function signal(d: string, delay = 0, returnTrip = false) {
  return path(d, `gg-signal${returnTrip ? " gg-signal-return" : ""}`, `pathLength="100" style="--gg-pulse-delay:${delay}s"`);
}

function neural(random: Random) {
  const branches = [
    { p: [-32, -22] as Point, d: "M-4 2 -32-22 -12-38", hover: "translate(-2px,-2px)", open: "translate(-9px,-7px)" },
    { p: [27, -27] as Point, d: "M-4 2 27-27 42-11", hover: "translate(2px,-2px)", open: "translate(8px,-7px)" },
    { p: [35, 19] as Point, d: "M-4 2 35 19 24 38", hover: "translate(3px,1px)", open: "translate(9px,7px)" },
    { p: [-24, 31] as Point, d: "M-4 2 -24 31 -42 12", hover: "translate(-2px,2px)", open: "translate(-8px,8px)" },
  ];
  return path("M-32-22 27-27 35 19 -24 31Z M-32-22 35 19", "gg-line gg-faint") +
    branches.map((b, i) => layer("gg-network-branch", path(b.d) + signal(b.d, i * -.34) + core(...b.p, i % 2 ? 2.3 : 2.8) + particles(random, 8, t => [b.p[0] * t, b.p[1] * t], 6), b.hover, b.open, i * 30)).join("") +
    core(-4, 2, 3.3) + path("M-12-44v5M-46 12h5M44-12h5M24 39v6", "gg-line gg-tick");
}

function mechanism(random: Random) {
  const top = path("M-49 8A49 30-18 0 1 32-32M38-26 44-19M47-12 51-5", "gg-line gg-strong") +
    path("M-38 3 -25-17 -7-17 3-30 22-30", "gg-line gg-joint") +
    `<circle class="gg-joint-dot" cx="-25" cy="-17" r="2.5"/>` + core(-17, -9, 3.3) + core(38, -25, 1.3);
  const bottom = path("M49-8A49 30-18 0 1-32 32M-38 26 -44 19M-47 12 -51 5", "gg-line gg-strong") +
    path("M38-3 25 17 7 17 -3 30 -22 30", "gg-line gg-joint") +
    `<circle class="gg-joint-dot" cx="25" cy="17" r="2.5"/>` + core(17, 9, 3.3) + core(-38, 25, 1.3);
  return layer("gg-machine-top", top, "translate(0,-2px) rotate(-4deg)", "translate(-4px,-10px) rotate(-10deg)") +
    layer("gg-machine-bottom", bottom, "translate(0,2px) rotate(4deg)", "translate(4px,10px) rotate(10deg)", 45) +
    path("M-17-9 17 9", "gg-line gg-bridge") + signal("M-17-9 17 9") +
    particles(random, 26, t => { const a = t * Math.PI * 2; return [Math.cos(a) * 39, Math.sin(a) * 17]; }, 3);
}

function echoes(random: Random) {
  const arcs = ["M-25 14A18 18 0 1 1 5-10", "M-35 20A30 30 0 1 1 16-19", "M-42 29A43 43 0 1 1 25-32"];
  return arcs.map((d, i) => layer(`gg-echo gg-echo-${i}`, path(d, "gg-line gg-wave") + signal(d, i * -.35), `translate(${i + 1}px,${-i}px) scale(${1 + i * .025})`, `translate(${i * 4}px,${-i * 2}px) scale(${1 + i * .07})`, i * 55)).join("") +
    layer("gg-echo-interference", path("M-4-35A34 34 0 0 1 27 27M4-23A23 23 0 0 1 20 19", "gg-line gg-faint"), "translate(3px,1px)", "translate(11px,2px)") +
    path("M5 9Q23 8 33 0L55 0", "gg-line gg-guide") +
    particles(random, 26, t => { const a = -.6 + t * 4; return [-8 + Math.cos(a) * 34, 2 + Math.sin(a) * 34]; }, 5) + core(-8, 2, 3.2);
}

function arms(random: Random) {
  const armPaths = ["M-5 5C-33-3-35-30-11-40C7-46 31-37 38-22", "M-5 5C17-14 40-3 42 14C44 34 20 43 7 36", "M-5 5C3 25-18 35-34 23C-46 14-46 0-40-8"];
  const curves: ((t: number) => Point)[] = [
    t => { const a = 2.8 + t * 3.3, r = 8 + t * 35; return [-3 + Math.cos(a) * r, 2 + Math.sin(a) * r * .85]; },
    t => { const a = 4.4 + t * 3.2, r = 7 + t * 39; return [-3 + Math.cos(a) * r, 2 + Math.sin(a) * r * .75]; },
    t => { const a = .4 + t * 3.1, r = 6 + t * 32; return [-3 + Math.cos(a) * r, 2 + Math.sin(a) * r * .65]; },
  ];
  return armPaths.map((d, i) => layer(`gg-arm gg-arm-${i}`, path(d, "gg-ribbon") + path(d, "gg-line gg-arm-spine") + particles(random, 27 - i * 5, curves[i], 5 + i), `rotate(${[-4, 4, -6][i]}deg) scale(1.035)`, `rotate(${[-9, 9, -13][i]}deg) scale(${[1.12, 1.08, 1.16][i]})`, i * 45)).join("") + core(-5, 5, 3);
}

function gate(random: Random) {
  const rings = [
    { d: "M-33-36C-8-49 23-32 29-4C35 25 16 45-9 36C-35 27-55-22-33-36Z", hover: "translate(-3px,0)", open: "translate(-9px,0) scale(1.17)" },
    { d: "M-12-31C11-42 35-24 37 1C39 25 25 35 5 27C-18 18-30-20-12-31Z", hover: "translate(1px,-1px)", open: "translate(3px,-1px) scale(1.05)" },
    { d: "M6-23C24-29 42-12 42 7C42 22 30 26 18 17C5 8-7-16 6-23Z", hover: "translate(4px,-2px)", open: "translate(12px,-3px) scale(.97)" },
  ];
  return path("M-33-36 6-23M29-4 42 7M-9 36 18 17", "gg-line gg-faint gg-depth-rails") +
    rings.map((ring, i) => layer(`gg-depth-ring gg-depth-ring-${i}`, path(ring.d, "gg-line gg-ring") + path(ring.d, "gg-line gg-ring-segment", `pathLength="100" stroke-dasharray="${9 + i * 3} ${23 + i * 5}"`), ring.hover, ring.open, i * 55)).join("") +
    particles(random, 18, t => [t * 38 - 18, t * 5 - 1], 8) + core(22, -2, 2.4) + path("M-3-2H45", "gg-line gg-faint");
}

function lattice(random: Random) {
  const modules = [
    { p: [-32, -25] as Point, d: "M0 0 -15 0 -15-25 -32-25", shift: [-5, -6] },
    { p: [32, -19] as Point, d: "M0 0 14 0 14-19 32-19", shift: [6, -4] },
    { p: [26, 30] as Point, d: "M0 0 0 16 26 16 26 30", shift: [4, 6] },
    { p: [-32, 23] as Point, d: "M0 0 -12 0 -12 23 -32 23", shift: [-6, 4] },
  ];
  return modules.map((m, i) => {
    const [x, y] = m.p;
    return layer("gg-lattice-module", path(m.d) + signal(m.d, -.4 * i) +
      path(`M${x} ${y - 8}l7 4v8l-7 4-7-4v-8Z M${x - 7} ${y - 4}l7 4 7-4M${x} ${y}v8`, "gg-line gg-facet") + core(x, y, 1.3),
      `translate(${m.shift[0] * .35}px,${m.shift[1] * .35}px)`, `translate(${m.shift[0]}px,${m.shift[1]}px)`, i * 30);
  }).join("") + path("M0-10 9-5V5L0 10-9 5V-5Z", "gg-line gg-strong") + core(0, 0, 2.5) + particles(random, 18, t => [t * 84 - 42, Math.sin(t * 12) * 29], 4);
}

function ixdCore(random: Random) {
  // Original IXD frame and cross paths, uniformly normalized around their
  // existing center. No invented replacement logo or wordmark.
  const originalPaths = `<g transform="translate(-52.87 -47.8) scale(.0676)">${path("M454 880 L309 735 Q280 706 309 677 L752 234 Q782 204 812 234 L1255 677 Q1285 706 1255 736 L812 1178 Q782 1208 752 1178 L616 1038", "gg-line gg-logo-frame")}${path("M321 998 L682 637 M877 782 L1235 424 M324 418 L794 888 M788 545 L1244 1002", "gg-line gg-logo-strokes")}${path("M1156 411 L1274 377 Q1286 374 1282 388 L1249 505 Q1246 517 1237 508 L1152 426 Q1142 416 1156 411Z", "gg-logo-arrow")}</g>`;
  return layer("gg-core-frame", originalPaths, "scale(1.055)", "scale(1.18)") +
    layer("gg-core-axes", path("M-47 0H-36M36 0H48M0-46V-36M0 36V47", "gg-line gg-faint") + path("M-42 6 0 48 44 4", "gg-line gg-faint"), "scale(1.06)", "scale(1.21)", 70) +
    particles(random, 15, t => { const a = t * Math.PI * 2; return [Math.cos(a) * 30, Math.sin(a) * 30]; }, 3) + core(0, 0, 2.8);
}

function protostar(random: Random) {
  const shells = ["M-1-36C-17-46-38-27-34-9C-47 5-34 31-14 34C-6 38 1 37 8 33", "M4-35C24-36 33-25 32-11C47 0 39 21 29 24C28 36 17 40 8 33"];
  return shells.map((d, i) => layer(`gg-shell gg-shell-${i}`, path(d, "gg-shell-haze") + path(d, "gg-line gg-shell-edge") + particles(random, 21, t => { const a = (i ? -1.5 : 1.6) + t * 3; return [Math.cos(a) * (31 + Math.sin(t * 17) * 3), Math.sin(a) * 34]; }, 5), `translate(${i ? 2 : -2}px,0)`, `translate(${i ? 10 : -10}px,${i ? -3 : 3}px) rotate(${i ? 10 : -10}deg)`, i * 50)).join("") +
    path("M-20-11C-10-24 12-18 17-4C25 11 8 22-9 17", "gg-line gg-faint") + core(0, 0, 4.2) + path("M-10 0H10M0-10V10", "gg-line gg-faint");
}

function comet(random: Random) {
  const ascent = "M-42 37Q-6 30 17-3T40-39";
  return layer("gg-comet-trajectory", path(ascent, "gg-line gg-faint") + path("M-37 27 -34 34M-24 22 -19 29M-10 13 -4 20M6 1 12 6M20-14 27-11", "gg-line gg-tick"), "translate(0,0)", "translate(-3px,5px) scale(1.06)") +
    layer("gg-comet-tail", path("M28-25Q5 14-37 27M28-25Q9 10-29 18M28-25Q9 1-17 5", "gg-line gg-comet-stream") + particles(random, 30, t => [28 - t * 60, -25 + 55 * t - t * t * 7], 7), "translate(1px,-2px)", "translate(7px,-10px)") +
    layer("gg-comet-head", core(28, -25, 3.3) + path("M21-25H35M28-32V-18", "gg-line gg-faint"), "translate(1px,-2px)", "translate(7px,-10px)");
}

function exchange(random: Random) {
  const d = "M-28 15Q-12-32 8-22Q41-15 28 21Q1 39-28 15Z";
  return layer("gg-exchange-network", path(d, "gg-line gg-faint") + signal("M-28 15Q-12-32 8-22", 0) + signal("M8-22Q41-15 28 21", -.65) + signal("M28 21Q1 39-28 15", -1.3, true) + particles(random, 15, t => [t * 59 - 30, Math.sin(t * 7) * 25], 4), "scale(1.055)", "scale(1.19)") +
    layer("gg-exchange-star", core(-28, 15, 3.1), "translate(-1px,1px)", "translate(-5.3px,2.8px)") +
    layer("gg-exchange-star", core(8, -22, 2.9), "translate(0,-1px)", "translate(1.5px,-4.2px)", 40) +
    layer("gg-exchange-star", core(28, 21, 2.7), "translate(1px,1px)", "translate(5.3px,4px)", 80);
}

function prisms(random: Random) {
  const shards = [
    { d: "M-34-18-18-28-11 4-27 13Z M-34-18-23-5-27 13M-23-5-18-28M-23-5-11 4", hover: "translate(-2px,1px) rotate(-4deg)", open: "translate(-8px,3px) rotate(-10deg)" },
    { d: "M-7-38 14-29 20 8-2 19Z M-7-38 6-7-2 19M6-7 14-29M6-7 20 8", hover: "translate(0,-2px)", open: "translate(0,-8px)" },
    { d: "M27-15 41-4 32 29 14 19Z M27-15 29 8 14 19M29 8 41-4M29 8 32 29", hover: "translate(2px,1px) rotate(4deg)", open: "translate(8px,3px) rotate(10deg)" },
  ];
  return shards.map((s, i) => layer(`gg-prism gg-prism-${i}`, path(s.d, "gg-prism-fill") + path(s.d, "gg-line gg-facet"), s.hover, s.open, i * 40)).join("") +
    path("M-34 28Q-5 44 37 36", "gg-line gg-faint") + particles(random, 14, t => [t * 60 - 31, 31 + Math.sin(t * Math.PI) * 5], 4) + core(6, -7, 1.8);
}

function beacon(random: Random) {
  const outer = "M34 13A36 36 0 1 1 7-35";
  const inner = "M24 9A25 25 0 1 1 5-24";
  return layer("gg-beacon-arc", path(outer, "gg-line gg-strong") + path(inner, "gg-line gg-faint") + particles(random, 22, t => { const a = .45 + t * 4.45; return [Math.cos(a) * 36, Math.sin(a) * 36]; }, 3), "rotate(-5deg) scale(1.025)", "rotate(-12deg) scale(1.1)") +
    layer("gg-beacon-guide", path("M0 0 18-17 39-37", "gg-line gg-beacon-path", 'stroke-dasharray="3 5"') + signal("M39-37 18-17 0 0", -.2) + path("M27-38 39-37 40-25", "gg-line") + core(23, -22, 1.3) + core(39, -37, 1.6), "translate(2px,-2px)", "translate(8px,-8px)", 50) + core(0, 0, 2.7);
}

const structures: Record<Exclude<GalaxyVisualPreset, `dormant-${string}`>, (random: Random) => string> = {
  "neural-cluster": neural, "binary-mechanism": mechanism, "echo-nebula": echoes,
  "asymmetric-arms": arms, "spatial-gate": gate, "lattice-satellites": lattice,
  "ixd-core": ixdCore, "protostar-shell": protostar, "ascent-comet": comet,
  "exchange-stars": exchange, "prism-shards": prisms, "open-beacon": beacon,
};

const dormantStructures = {
  "dormant-arc": path("M-20 8A22 18-25 1 1 16-15", "gg-line") + core(-2, 1, 1.3),
  "dormant-pair": path("M-16 10 15-9", "gg-line", 'stroke-dasharray="2 6"') + core(-16, 10, 1.5) + core(15, -9, 1),
  "dormant-shard": path("M-7-22 17-2 5 20-13 4Z M-7-22 2-1 5 20M2-1 17-2", "gg-line") + core(2, -1, .9),
};

function markup(identity: StarVisualIdentity, dormant: boolean) {
  const body = dormant
    ? dormantStructures[identity.visualPreset as keyof typeof dormantStructures] ?? dormantStructures["dormant-arc"]
    : structures[identity.visualPreset as keyof typeof structures](seeded(identity.visualSeed));
  // No SVG ids, masks or URL references: cloning navigation markup for flight
  // keeps exact particle coordinates without collisions between visible copies.
  return `<span class="sm-node-visual${dormant ? " sm-node-dormant" : ""}" data-preset="${identity.visualPreset}" data-visual-preset="${identity.visualPreset}" data-motion-preset="${identity.motionPreset}" data-visual-seed="${identity.visualSeed}">
    ${dormant ? "" : '<span class="sm-galaxy-haze gg-haze"></span>'}
    <svg class="sm-galaxy-vector gg-vector" viewBox="-64 -64 128 128" aria-hidden="true" focusable="false">${body}${dormant ? "" : '<g class="sm-galaxy-survey gg-hover-survey"><path class="gg-line gg-faint" d="M-53-25V-33H-45M45-33H53V-25M53 25V33H45M-45 33H-53V25"/></g>'}</svg>
  </span>`;
}

/** Stable identity is reused without re-seeding at navigation, flight and detail. */
export function galaxyGlyph(node: StarVisualIdentity | number = 1): string {
  // Numeric calls remain supported for the existing non-node growth trajectory.
  const identity: StarVisualIdentity = typeof node === "number"
    ? { visualPreset: "open-beacon", motionPreset: "beacon-guide", visualSeed: node }
    : node;
  return markup(identity, identity.motionPreset === "dormant");
}

/** The caller retains enabled=false and the existing non-navigation semantics. */
export function dormantGlyph(node: StarVisualIdentity): string {
  return markup(node, true);
}

export const surveyMarkup = `<svg class="sm-survey" viewBox="-90 -90 180 180" aria-hidden="true">
  <circle r="73" pathLength="1" class="sm-survey-circle"/>
  <circle r="82" stroke-dasharray=".4 6"/>
  <path d="M-88 0H-65M65 0H88M0-88V-65M0 65V88M-58-58l7 7M58 58l-7-7M-58 58l7-7M58-58l-7 7"/>
  <path d="M-42-73H-25M42 73H25"/>
</svg>`;
