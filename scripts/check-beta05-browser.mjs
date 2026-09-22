import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = resolve(process.env.IXD_TEST_OUTPUT || '.tools/beta05-browser');
const base = process.env.IXD_TEST_URL || 'http://127.0.0.1:5173';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const report = { checks: [], errors: [], themes: [], startup: {}, journeys: [] };
const check = (name, value) => { assert.ok(value, name); report.checks.push(name); };
const phase = (p, phase) => p.waitForFunction(phase => window.rhine?.stats().experience?.phase === phase, phase);
const watch = p => { p.on('pageerror', e => report.errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); }); };
async function login(p) {
  await phase(p, 'login'); await p.locator('#ixd-account').fill('ixd-demo'); await p.locator('#ixd-password').fill('ixd2026');
  await p.locator('.identity-submit').click(); await phase(p, 'galaxy');
}
async function observe(p) {
  await p.addInitScript(() => {
    window.b5 = { frames: [], tracking: false, glyph: null, journey: [] };
    const ids = new WeakMap(); let nextId = 1;
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, size: r.width }; };
    function tick() {
      const s = window.rhine?.stats().experience, loading = document.querySelector('#loading');
      if (loading && !loading.hidden) {
        const letters = [...loading.querySelectorAll('.boot-phrase-letter')];
        const phrase = loading.querySelector('.boot-phrase');
        window.b5.frames.push({ t: performance.now() - Number(loading.dataset.startedAt), elapsed: s?.preparationElapsed,
          opacity: Number(getComputedStyle(loading).opacity), count: phrase?.hidden ? 0 : letters.filter(l => !l.hidden).length,
          phrase: phrase ? rect(phrase) : null, dark: document.documentElement.dataset.darkSurface,
          bar: new DOMMatrixReadOnly(getComputedStyle(loading.querySelector('.preparation-track i')).transform).a,
          background: getComputedStyle(document.querySelector('#boot-background')).opacity });
      }
      if (window.b5.tracking && window.b5.glyph) {
        const glyph = window.b5.glyph, modal = document.querySelector('.sm-modal');
        let opacity = 1;
        for (let el = glyph; el; el = el.parentElement) { const css = getComputedStyle(el); opacity *= Number(css.opacity); if (css.display === 'none' || css.visibility === 'hidden') opacity = 0; }
        window.b5.journey.push({ t: performance.now(), phase: modal.dataset.journey, rect: rect(glyph), opacity,
          connected: glyph.isConnected, copies: document.querySelectorAll(`.sm-node-visual[data-visual-seed="${glyph.dataset.visualSeed}"]`).length,
          line: getComputedStyle(glyph.querySelector('.gg-line')).strokeWidth,
          loops: glyph.getAnimations({ subtree: true }).filter(a => a instanceof CSSAnimation).map(a => {
            const target = a.effect.target; if (!ids.has(target)) ids.set(target, nextId++);
            return { key: `${ids.get(target)}:${a.animationName}`, time: Number(a.currentTime) };
          }),
          ready: modal.classList.contains('is-ready'), terminalOpacity: Number(getComputedStyle(modal.querySelector('.sm-terminal')).opacity) });
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}
async function journey(p, id, { early = false, resize = false, mouse = false } = {}) {
  const button = p.locator(`[data-star="${id}"]`);
  await p.evaluate(id => { window.b5.glyph = document.querySelector(`[data-star="${id}"] .sm-node-visual`); window.b5.journey = []; window.b5.tracking = true; }, id);
  await button.click();
  // A second synthetic click must not enqueue another flight.
  await button.dispatchEvent('click');
  if (resize === true) { await p.waitForTimeout(200); await p.setViewportSize({ width: 1440, height: 900 }); }
  if (early) await p.waitForTimeout(140);
  else { await p.locator('.sm-modal.is-ready').waitFor(); await p.waitForTimeout(440); }
  if (resize === 'detail') await p.setViewportSize({ width: 1280, height: 800 });
  if (mouse && !early) await p.locator('.sm-close').click();
  else { await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); }
  if (resize === 'exit') { await p.waitForTimeout(200); await p.setViewportSize({ width: 1024, height: 768 }); }
  await p.locator('.sm-modal').waitFor({ state: 'hidden' }); await p.waitForTimeout(85);
  const data = await p.evaluate(id => {
    window.b5.tracking = false;
    return { frames: window.b5.journey, same: window.b5.glyph === document.querySelector(`[data-star="${id}"] .sm-node-visual`),
      focus: document.activeElement === document.querySelector(`[data-star="${id}"]`), inert: document.querySelector('.sm-home').inert };
  }, id);
  const label = `${id}/${report.journeys.length}`;
  check(`${label}: same single connected visible artwork throughout`, data.same && data.frames.every(f => f.connected && f.copies === 1 && f.opacity > .99));
  check(`${label}: focus and home input restored`, data.focus && !data.inert);
  const enter = data.frames.filter(f => f.phase === 'entering'), detail = data.frames.filter(f => f.phase === 'detail');
  if (!early && !resize && enter.length > 3 && detail.length) {
    const start = enter[0].rect, end = detail[0].rect, dx = end.x - start.x, dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    check(`${label}: opening uses one straight path to the final layout`, enter.every(f => Math.abs((f.rect.x - start.x) * dy - (f.rect.y - start.y) * dx) / Math.max(1, length) < 1.5));
    check(`${label}: terminal starts only after arrival`, enter.every(f => !f.ready && f.terminalOpacity < .01));
    check(`${label}: terminal does not move the arrived star`, detail.every(f => Math.hypot(f.rect.x - end.x, f.rect.y - end.y) < 1));
  }
  const last = data.frames.findLastIndex(f => f.phase === 'leaving');
  if (last >= 0 && data.frames[last + 1]) {
    const a = data.frames[last], b = data.frames[last + 1];
    const gap = Math.hypot(a.rect.x - b.rect.x, a.rect.y - b.rect.y);
    check(`${label}: return handoff has continuous position and size`, gap < 1.5 && Math.abs(a.rect.size - b.rect.size) < 1.5);
    check(`${label}: return handoff retains stroke width`, Math.abs(parseFloat(a.line) - parseFloat(b.line)) < .01);
    check(`${label}: CSS loop phases survive the handoff`, a.loops.every(loop => { const next = b.loops.find(l => l.key === loop.key); return next && Math.abs(next.time - loop.time) <= b.t - a.t + 25; }));
  }
  report.journeys.push({ id, early, resize, mouse, ...data });
}
try {
  for (const [system, saved] of [['light', null], ['dark', null], ['dark', 'light'], ['light', 'dark']]) {
    const p = await browser.newPage({ viewport: { width: 1366, height: 768 }, colorScheme: system }); watch(p); await observe(p);
    await p.addInitScript(saved => localStorage.setItem('rhine-settings', JSON.stringify({ ...(saved ? { colorTheme: saved } : {}), sound: false, music: false, soundVolume: .23 })), saved);
    let release; const barrier = new Promise(r => release = r);
    const modules = url => url.pathname === '/src/main.ts' || /^\/assets\/index-[^/]+\.js$/.test(url.pathname);
    await p.route(modules, async route => { await barrier; await route.continue(); });
    await p.goto(base, { waitUntil: 'commit' }); await p.locator('#loading').waitFor();
    const initial = await p.evaluate(() => ({ dark: document.documentElement.dataset.darkSurface, color: getComputedStyle(document.body).backgroundColor }));
    const expected = saved !== 'light'; check(`${system}/${saved}: critical HTML has correct theme before JS`, initial.dark === String(expected) && initial.color === (expected ? 'rgb(17, 23, 34)' : 'rgb(238, 242, 248)'));
    release(); await phase(p, 'login');
    const frames = await p.evaluate(() => window.b5.frames);
    check(`${system}/${saved}: no theme flash throughout preparation`, frames.every(f => f.dark === String(expected)));
    report.themes.push({ system, saved, initial });
    if (saved === 'light') {
      await login(p); await p.locator('.sm-tools [data-action="settings"]').click();
      check('Saved light selection agrees with rendered theme', await p.locator('[data-color-theme="light"]').getAttribute('aria-pressed') === 'true');
      await p.locator('[data-action="reset-theme"]').click();
      check('Restore theme default selects dark without clearing other preferences', await p.evaluate(() => { const pref = JSON.parse(localStorage.getItem('rhine-settings')); return pref.colorTheme === 'dark' && pref.soundVolume === .23 && !pref.sound; }));
      check('Settings selected dark matches actual render', await p.locator('[data-color-theme="dark"]').getAttribute('aria-pressed') === 'true' && await p.evaluate(() => document.documentElement.dataset.darkSurface === 'true'));
      await p.locator('[data-color-theme="light"]').click();
      check('Manual light remains available and saved', await p.evaluate(() => JSON.parse(localStorage.getItem('rhine-settings')).colorTheme === 'light'));
    }
    await p.close();
  }
  const p = await browser.newPage({ viewport: { width: 1920, height: 1080 } }); watch(p); await observe(p);
  await p.goto(base); await phase(p, 'login');
  const frames = await p.evaluate(() => window.b5.frames);
  const full = frames.find(f => f.count === 26 && f.bar >= .9999), faded = frames.findLast(f => f.elapsed != null);
  const partial = frames.filter(f => f.count > 0 && f.count < 26);
  check('Full text and unchanged progress complete together near 1500 ms', full && Math.abs(full.elapsed - 1.5) < .035 && partial.every(f => f.bar < 1));
  check('Letter cells reserve the complete phrase width throughout typing', partial.every(f => Math.abs(f.phrase.x - full.phrase.x) < .5 && Math.abs(f.phrase.size - full.phrase.size) < .5));
  check('Fade holds all letters and full bar; background stays visible', frames.filter(f => f.elapsed > 1.5).every(f => f.count === 26 && f.bar === 1 && f.background === '1'));
  const stats = await p.evaluate(() => window.rhine.stats().experience);
  check('Foreground fade adds 500 ms before Logo completion signal', stats.preparationCompletedDuration >= 2 && stats.preparationCompletedDuration < 2.035 && faded.opacity < .02);
  report.startup = { filledAt: full.elapsed, completedAt: stats.preparationCompletedDuration, fadeMs: (stats.preparationCompletedDuration - full.elapsed) * 1000, frames };
  await login(p);
  for (let i = 0; i < 3; i++) for (const id of ['visual', 'robotics']) await journey(p, id, { mouse: i % 2 === 0 });
  const ids = await p.locator('[data-star]').evaluateAll(nodes => nodes.map(n => n.dataset.star));
  for (const id of ids.filter(id => !['visual', 'robotics'].includes(id))) await journey(p, id);
  await journey(p, 'visual', { early: true }); await journey(p, 'visual');
  await journey(p, 'robotics', { resize: true });
  await p.setViewportSize({ width: 390, height: 844 }); await journey(p, 'visual'); await journey(p, 'robotics', { early: true });
  // Exercise phase-preserving fallback independently of Element.moveBefore.
  await p.evaluate(() => { Element.prototype.moveBefore = undefined; }); await journey(p, 'salon');
  await p.setViewportSize({ width: 1440, height: 900 });
  await journey(p, 'visual', { resize: 'detail' }); await journey(p, 'robotics', { resize: 'exit' });
  check('All normal and edge journeys have no runtime/console errors', report.errors.length === 0);
  await p.close();
} catch (e) { report.failure = e.stack; process.exitCode = 1; }
finally { await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2)); await browser.close(); console.log(JSON.stringify({ checks: report.checks.length, failure: report.failure, errors: report.errors, output }, null, 2)); }
