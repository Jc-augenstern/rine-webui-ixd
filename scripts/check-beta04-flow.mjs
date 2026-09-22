// Deterministic solver checks. Run with: node --experimental-strip-types scripts/check-beta04-flow.mjs
// Browser footage is still required: this checks transport, not artistic quality.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { GalaxyInteraction } from '../src/galaxy/galaxy-interaction.ts';
const rect = { left: 0, top: 0, width: 1920, height: 1080 };
const mapping = { pointer: { x: 0, y: 0 }, focus: 0, target: { x: .5, y: .5 } };
const results = [], checks = [];
function check(name, condition) { checks.push({ name, pass: !!condition }); assert.ok(condition, name); }
function sectionMetrics(section) {
  const total = section.reduce((a, p) => a + p.wakeEnergy, 0);
  const mean = section.reduce((a, p) => a + p.normal * p.wakeEnergy, 0) / total;
  const rms = Math.sqrt(section.reduce((a, p) => a + (p.normal - mean) ** 2 * p.wakeEnergy, 0) / total);
  let sum = 0, low, high;
  for (const p of section) { sum += p.wakeEnergy; if (low === undefined && sum >= total * .1) low = p.normal; if (high === undefined && sum >= total * .9) high = p.normal; }
  return { width80: high - low, rms, mean, energy: total, center: section.find(p => p.normal === 0) };
}
function straight(speed, eventHz, renderHz, low = false) {
  const flow = new GalaxyInteraction(); flow.setLowQuality(low); flow.reset(0); flow.update(0, rect, true, false, mapping, 0);
  const duration = 1000 / speed, crossing = 500 / speed, ages = [.1, .3, .8, 1.5];
  const samples = []; let event = 0, next = 0;
  for (let frame = 1; frame <= (duration + 4) * renderHz; frame++) {
    const t = frame / renderHz;
    while (event / eventHz <= Math.min(t, duration) + 1e-9) { const et = event / eventHz; flow.record(400 + speed * et, 550, false, et * 1000); event++; }
    flow.update(1 / renderHz, rect, true, false, mapping, t * 1000);
    if (next < ages.length && t + 1e-9 >= crossing + ages[next]) {
      samples.push({ age: t - crossing, ...sectionMetrics(flow.section(900, 550, 1, 0)), state: flow.stats() }); next++;
    }
  }
  const result = { speed, eventHz, renderHz, low, samples, final: flow.stats(), remote: flow.sample(900, 180) };
  flow.dispose(); results.push(result); return result;
}
const fast = straight(1000, 120, 60), slow = straight(250, 120, 60);
check('same-age fast ribbon starts substantially narrower', fast.samples[0].width80 < slow.samples[0].width80 * .7);
for (const [name, run] of [['fast', fast], ['slow', slow]]) {
  check(`${name}: historical section spreads after the pointer passed`, run.samples[2].width80 > run.samples[0].width80 * 1.25);
  check(`${name}: transported age increases`, run.samples[2].center.age > run.samples[0].center.age + .35);
  check(`${name}: four-second recovery bounded`, run.final.maxDisplacementPx < 4 && run.final.maxSpeedPx < .5);
  check(`${name}: remote material stays still`, Math.hypot(run.remote.x, run.remote.y) < .01);
  check(`${name}: exact 1000px arc consumed once`, Math.abs(run.final.depositedArcLengthPx - 1000) < .01 && run.final.pendingSegments === 0);
}
for (const [speed, e, r, base] of [[1000, 30, 30, fast], [1000, 240, 120, fast], [1000, 30, 120, fast], [1000, 240, 30, fast], [250, 30, 30, slow]]) {
  const run = straight(speed, e, r);
  check(`${speed}px/s ${e}event/${r}render: conserved impulse`, Math.abs(run.final.depositedImpulse / base.final.depositedImpulse - 1) < .002);
  check(`${speed}px/s ${e}event/${r}render: same-age profiles`, run.samples.every((s, i) => Math.abs(s.rms / base.samples[i].rms - 1) < .035));
}
const low = straight(1000, 120, 60, true);
check('low quality keeps historical spreading and bounded recovery', low.samples[2].width80 > low.samples[0].width80 * 1.2 && low.final.maxDisplacementPx < 4);

// Long back-and-forth input with a curved centerline. This checks finite history,
// no renewed forcing after leave/disable, then genuine decay of persistent state.
const f = new GalaxyInteraction(); f.reset(0); f.update(0, rect, true, false, mapping, 0);
let peakSpeed = 0, peakOffset = 0, maxPending = 0, beforeLeave;
for (let frame = 0; frame <= 600; frame++) {
  const t = frame / 60; f.record(960 + 300 * Math.sin(t * 4), 540 + 110 * Math.sin(t * 7), false, t * 1000);
  f.update(frame ? 1 / 60 : 0, rect, true, false, mapping, t * 1000);
  const s = f.stats(); peakSpeed = Math.max(peakSpeed, s.maxSpeedPx); peakOffset = Math.max(peakOffset, s.maxDisplacementPx);
  maxPending = Math.max(maxPending, s.pendingSegments);
}
beforeLeave = f.stats(); const positionAtLeave = f.sample(1000, 540); f.leave(10000);
for (let frame = 601; frame <= 960; frame++) f.update(1 / 60, rect, true, false, mapping, frame / 60 * 1000);
const rest = f.stats();
check('repeated crossing caps velocity and displacement', peakSpeed <= 210.001 && peakOffset <= 115.001);
check('trajectory buffer remains bounded', maxPending <= beforeLeave.segmentCapacity);
check('leave consumes no stale input impulse', rest.depositedImpulse === beforeLeave.depositedImpulse && rest.pendingSegments === 0);
check('six-second recovery after repeated crossing', rest.maxDisplacementPx < 1 && rest.maxSpeedPx < .05);
for (let frame = 961; frame <= 1020; frame++) { f.record(800 + frame % 40 * 8, 530, false, frame / 60 * 1000); f.update(1 / 60, rect, false, false, mapping, frame / 60 * 1000); }
check('disabled interaction does not inject', f.stats().depositedImpulse === rest.depositedImpulse);
const stress = { peakSpeed, peakOffset, beforeLeave, positionAtLeave, rest }; f.dispose();

const edge = new GalaxyInteraction(); edge.reset(0); edge.update(0, rect, true, false, mapping, 0);
// All samples, including the initial point, arrive before the next simulation RAF.
for (let i = 0; i <= 6; i++) edge.record(700 + i * 20, 450, false, i * 2);
edge.leave(12); const drained = edge.stats();
check('same-task fast path then leave drains the whole real path', Math.abs(drained.depositedArcLengthPx - 120) < .001 && drained.pendingSegments === 0);
for (let frame = 1; frame <= 90; frame++) edge.update(1 / 60, rect, true, false, mapping, frame / 60 * 1000);
check('drained input is never replayed on following frames', edge.stats().depositedImpulse === drained.depositedImpulse);
const edgeBeforePause = edge.sample(760, 450), stepsBeforePause = edge.stats().steps;
edge.pause(); edge.update(1 / 60, rect, true, false, mapping, 60000);
const edgeAfterPause = edge.sample(760, 450);
check('long hidden pause resumes with one bounded fixed step', edge.stats().steps - stepsBeforePause === 1 && Math.hypot(edgeAfterPause.x - edgeBeforePause.x, edgeAfterPause.y - edgeBeforePause.y) < 2);
check('pause and resume do not inject stale pointer motion', edge.stats().depositedImpulse === drained.depositedImpulse);
edge.pause(); const stepsBeforeHugeDt = edge.stats().steps;
edge.update(60, rect, true, false, mapping, 120000);
check('a literal sixty-second resume delta is capped at four simulation steps', edge.stats().steps - stepsBeforeHugeDt === 4 && Number.isFinite(edge.stats().maxDisplacementPx) && edge.stats().maxSpeedPx <= 210);
edge.dispose();
await mkdir('.tools/beta04-flow', { recursive: true });
await writeFile('.tools/beta04-flow/solver-check.json', JSON.stringify({ checks, results, stress }, null, 2));
console.log(JSON.stringify({ checks: checks.length, passed: checks.filter(c => c.pass).length, fast: fast.samples.map(s => s.width80), slow: slow.samples.map(s => s.width80), peakSpeed, peakOffset, restOffset: rest.maxDisplacementPx }));
