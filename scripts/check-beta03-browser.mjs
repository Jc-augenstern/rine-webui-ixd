import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// This checker observes natural product time. It does not seek the startup,
// authorization, Welcome or portal timelines while asserting continuity.
const plan = {
  startup: ['cold preparation approximately three seconds', 'permission/connection/progress together', 'no small loading logo flash', 'no prelogin ID CONFIRMED', 'overlapping logo travel and form appearance'],
  password: ['pointer and keyboard reveal/hide', 'value and edit continuity', 'eye does not submit', 'wrong and correct credentials'],
  continuity: ['active ring recovery', 'overlap with Welcome', 'one persistent visible Logo across Welcome and bridge', 'same live galaxy canvas'],
  regression: ['12 stable distinct presets', 'five flight/detail/return journeys', 'dormant stars', 'early Escape', 'replay', 'skip', 'resize', 'narrow viewport', 'reduced motion', 'no WebGL'],
  flow: ['camera-frozen isolation', 'old refraction/decorative trail absent', 'same-seed input/control', 'existing-particle trajectories', 'old-region inertia', 'dwell/leave damping', 'bounded repeated inputs'],
  evidence: ['natural frame observations', 'screenshots', 'four separately recorded and visually reviewed browser clips'],
};
if (process.argv.includes('--plan')) {
  console.log(JSON.stringify({ plan, status: 'Plan only; --plan does not execute browser tests.' }, null, 2));
  process.exit(0);
}

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.IXD_TEST_URL || 'http://127.0.0.1:5173';
const output = resolve(process.env.IXD_TEST_OUTPUT || '.tools/beta03-browser');
const production = process.env.IXD_TEST_MODE === 'production';
const groups = new Set((process.env.IXD_TEST_GROUPS || 'ui,regression,flow,geometry').split(','));
const requestedViewport = /^(\d+)x(\d+)(?:@([\d.]+))?$/.exec(process.env.IXD_TEST_VIEWPORT || '1920x1080@1');
assert.ok(requestedViewport, 'IXD_TEST_VIEWPORT must be WIDTHxHEIGHT@DPR');
const viewport = { width: Number(requestedViewport[1]), height: Number(requestedViewport[2]) };
const deviceScaleFactor = Number(requestedViewport[3] || 1);
// Selectors are centralized while the product branches converge. Missing
// required controls fail the check; they are never silently counted as passes.
const selectors = {
  preparation: '#loading.startup-preparation', preparationTitle: '.preparation-access', progress: '#loading .preparation-track i', loadingLogo: '#loading .loading-mark',
  bootLogo: '.boot-logo', login: '.identity-access', password: '#ixd-password',
  passwordToggle: '.identity-password-toggle',
  sharedLogo: '.ixd-shared-logo', welcome: '.welcome', ring: '.scan',
  ...JSON.parse(process.env.IXD_BETA03_SELECTORS || '{}'),
};
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const report = { url: base, browser: browser.version(), platform: process.platform, production, groups: [...groups], viewport, deviceScaleFactor, plan, checks: [], errors: [], consoleErrors: [], expectedDiagnostics: [], measurements: {}, visualReviewRequired: true };
const check = (name, condition) => { assert.ok(condition, name); report.checks.push(name); };
const state = (page) => page.evaluate(() => window.rhine.stats().experience);
const phase = (page, value) => page.waitForFunction(value => window.rhine?.stats().experience?.phase === value, value, { timeout: 30000 });
const shot = (page, name) => page.screenshot({ path: resolve(output, `${name}.png`) });
const watch = (page, noWebGL = false) => {
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (noWebGL && /Error creating WebGL context/.test(m.text())) report.expectedDiagnostics.push(m.text());
    else report.consoleErrors.push(m.text());
  });
};
async function installObservation(page) {
  await page.addInitScript(({ selectors }) => {
    const ids = new WeakMap(); let nextId = 1, previous = -100;
    window.beta03Frames = [];
    window.beta03Observe = true;
    function geometry(element) {
      if (!element) return null;
      if (!ids.has(element)) ids.set(element, nextId++);
      const rect = element.getBoundingClientRect();
      let opacity = 1, hidden = false;
      for (let node = element; node instanceof Element; node = node.parentElement) {
        const style = getComputedStyle(node);
        opacity *= Number(style.opacity);
        if (style.display === 'none' || style.visibility === 'hidden' || node.hasAttribute('hidden')) hidden = true;
      }
      return { id: ids.get(element), x: rect.x, y: rect.y, width: rect.width, height: rect.height, opacity, visible: !hidden && opacity > .01 && rect.width > 0 && rect.height > 0 };
    }
    const select = name => document.querySelector(selectors[name]);
    function frame(time) {
      if (!window.beta03Observe) return;
      // Avoid changing test overhead with 144/240 Hz displays.
      if (time - previous >= 15) {
        previous = time;
        const experience = window.rhine?.stats().experience;
        const preparation = select('preparation'), ring = select('ring');
        const auth = document.querySelector('.auth-status');
        const logos = [...document.querySelectorAll(selectors.sharedLogo)].map(geometry);
        const progress = select('progress');
        const progressStyle = progress ? getComputedStyle(progress) : null;
        window.beta03Frames.push({
          time, phase: experience?.phase ?? null, bootTime: experience?.bootTime ?? null,
          preparation: geometry(preparation), preparationText: preparation?.textContent?.trim(), preparationColor: preparation ? getComputedStyle(preparation).backgroundColor : null,
          preparationTitle: geometry(select('preparationTitle')),
          progress: geometry(progress), progressTransform: progressStyle ? `${progressStyle.transform}|${progressStyle.width}` : null,
          loadingLogo: geometry(select('loadingLogo')), bootLogo: geometry(select('bootLogo')),
          login: geometry(select('login')), welcome: geometry(select('welcome')), logos,
          preloginIdVisible: Boolean(geometry(auth)?.visible && /ID\s+CONFIRMED/i.test(auth.textContent)),
          ring: geometry(ring), ringShape: [...(ring?.querySelectorAll('path') || [])].slice(0, 4).map(p => p.getAttribute('d')).join('|'),
          galaxyCanvasId: geometry(document.querySelector('.galaxy-webgl'))?.id ?? null,
        });
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }, { selectors });
}
async function collect(page, name) {
  const frames = await page.evaluate(() => window.beta03Frames || []);
  await writeFile(resolve(output, `${name}-frames.json`), JSON.stringify(frames));
  return frames;
}
async function fillCredentials(page, password = 'ixd2026') {
  await page.locator('#ixd-account').waitFor({ state: 'visible' });
  await phase(page, 'login');
  await page.locator('#ixd-account').fill('ixd-demo');
  await page.locator(selectors.password).fill(password);
}
async function enter(page) {
  await page.goto(base); await fillCredentials(page); await page.locator('.identity-submit').click(); await phase(page, 'galaxy');
}
async function terminalReady(page) {
  await page.locator('.sm-modal.is-ready').waitFor();
  await page.waitForFunction(() => { const el = document.querySelector('.sm-terminal'); if (!el) return false; const css = getComputedStyle(el); return Number(css.opacity) > .995 && css.clipPath === 'inset(0px)'; });
}
const closed = page => page.locator('.sm-modal').waitFor({ state: 'hidden' });
const signature = locator => locator.evaluate(el => el.outerHTML);

async function startupAndPassword(page) {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('#ixd-account').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(700);
  const frames = await collect(page, 'startup');
  const preparation = frames.filter(f => f.preparation?.visible);
  check('Cold startup presents a measurable preparation screen', preparation.length >= 10);
  const duration = preparation.at(-1).time - preparation[0].time;
  report.measurements.preparationVisibleMs = duration;
  check('Normal foreground preparation lasts approximately three seconds', duration >= 2750 && duration <= 3800);
  const completeText = preparation.filter(f => f.time >= preparation[0].time + 900);
  check('Preparation finishes the preserved letter reveal with ACCESS PERMISSION REQUIRED', completeText.length > 5 && completeText.every(f => /ACCESS\s+PERMISSION\s+REQUIRED/.test(f.preparationText)));
  check('Letter reveal keeps its container horizontally centered', preparation.filter(f => f.preparationTitle?.visible).every(f => Math.abs(f.preparationTitle.x + f.preparationTitle.width / 2 - page.viewportSize().width / 2) < 3));
  check('Preparation keeps connection copy visible', preparation.filter(f => /CONNECTING\s+TO\s+INTERNAL\s+DATABASE/.test(f.preparationText)).length >= preparation.length * .9);
  check('Preparation keeps its progress indicator visible', preparation.filter(f => f.progress?.visible).length >= preparation.length * .9);
  check('Preparation progress actually advances', new Set(preparation.map(f => f.progressTransform).filter(Boolean)).size >= 5);
  check('Cold startup never flashes the old small loading Logo', !frames.some(f => f.loadingLogo?.visible));
  check('Prelogin ID CONFIRMED is absent from visible frames', !frames.some(f => f.preloginIdVisible));
  const dynamicLogo = frames.find(f => f.bootLogo?.visible);
  check('Preparation finishes before dynamic Logo begins', dynamicLogo && dynamicLogo.time >= preparation.at(-1).time - 40);
  const overlaps = frames.filter((f, i) => i > 0 && f.login?.visible && f.bootLogo?.visible && frames[i - 1].bootLogo && Math.abs(f.bootLogo.x - frames[i - 1].bootLogo.x) > .15);
  report.measurements.logoFormOverlapMs = overlaps.length > 1 ? overlaps.at(-1).time - overlaps[0].time : 0;
  check('Logo leftward movement overlaps visible login entrance', overlaps.length >= 3);
  await shot(page, '01-login');

  await fillCredentials(page, 'beta03-eye');
  const input = page.locator(selectors.password), toggle = page.locator(selectors.passwordToggle);
  await toggle.waitFor({ state: 'visible' });
  check('Password eye is an explicit non-submit button', await toggle.getAttribute('type') === 'button');
  for (let i = 0; i < 4; i++) {
    await toggle.click();
    check(`Password eye pointer toggle ${i + 1} preserves value`, await input.inputValue() === 'beta03-eye');
    check(`Password eye pointer toggle ${i + 1} sets the expected input type`, await input.getAttribute('type') === (i % 2 ? 'password' : 'text'));
    check(`Password eye pointer toggle ${i + 1} does not submit`, (await state(page)).phase === 'login');
  }
  await toggle.focus(); await page.keyboard.press('Space');
  check('Keyboard Space activates reveal', await input.getAttribute('type') === 'text');
  await page.keyboard.press('Enter');
  check('Keyboard Enter hides without submitting', await input.getAttribute('type') === 'password' && (await state(page)).phase === 'login');
  await input.focus(); await input.press('End'); await page.keyboard.type('-more');
  check('Typing continues after repeated visibility changes', await input.inputValue() === 'beta03-eye-more');
  await page.locator('.identity-submit').click(); await phase(page, 'login');
  check('Wrong credentials still produce ACCESS DENIED', /ACCESS DENIED/.test(await page.locator('#identity-feedback').innerText()));
  check('Failed login clears the password', await input.inputValue() === '');
  check('Password returns to concealed state after an error', await input.getAttribute('type') === 'password');
  await shot(page, '02-password-error');
}

async function authorizationContinuity(page) {
  await fillCredentials(page);
  await page.locator(selectors.password).press('Enter');
  await phase(page, 'welcome'); await shot(page, '03-welcome');
  await phase(page, 'bridge');
  await page.evaluate(() => { window.beta03PortalCanvas = document.querySelector('.galaxy-webgl'); });
  await page.waitForTimeout(700); await shot(page, '04-portal');
  await phase(page, 'galaxy'); await page.waitForTimeout(400);
  const frames = await collect(page, 'authorization');
  const authorized = frames.filter(f => ['authorized', 'handoff'].includes(f.phase) && f.ring?.visible);
  check('Existing authorization ring remains present', authorized.length > 5);
  const end = authorized.at(-1).time;
  const closing = authorized.filter(f => f.time >= end - 700);
  check('Ring geometry actively changes through its final segment', new Set(closing.map(f => f.ringShape)).size >= 5);
  const phases = frames.map(f => f.phase).filter((p, i, all) => i === 0 || p !== all[i - 1]);
  report.measurements.phases = phases;
  check('Ring recovery hands off to Welcome and the existing portal', phases.join('>').includes('authorized>handoff>welcome>bridge>galaxy'));
  const handoff = frames.filter(f => f.phase === 'handoff');
  report.measurements.ringHandoffMs = handoff.length > 1 ? handoff.at(-1).time - handoff[0].time : 0;
  check('Ring recovery has a short continuous measured duration', report.measurements.ringHandoffMs >= 450 && report.measurements.ringHandoffMs <= 1200);
  const transition = frames.filter(f => ['welcome', 'bridge'].includes(f.phase));
  const firstVisible = transition.findIndex(f => f.logos.some(l => l.visible));
  check('Shared Logo appears during Welcome', firstVisible >= 0 && transition[firstVisible].phase === 'welcome');
  const visibleSpan = transition.slice(firstVisible).filter(f => f.logos.some(l => l.visible));
  check('Shared Logo is a single persistent DOM element', new Set(visibleSpan.flatMap(f => f.logos.filter(l => l.visible).map(l => l.id))).size === 1);
  check('There are no simultaneous shared Logo duplicates', transition.every(f => f.logos.filter(l => l.visible).length <= 1));
  const bridgeStart = transition.find(f => f.phase === 'bridge')?.time;
  const crossing = transition.filter(f => f.time >= bridgeStart - 200 && f.time <= bridgeStart + 750);
  check('Shared Logo remains visible through Welcome/portal handoff', crossing.length > 5 && crossing.every(f => f.logos.some(l => l.visible)));
  const centers = crossing.map(f => { const l = f.logos.find(l => l.visible); return { time: f.time, x: l.x + l.width / 2, y: l.y + l.height / 2, width: l.width }; });
  report.measurements.sharedLogoHandoff = centers;
  check('Shared Logo has no sudden geometric jump', centers.every((v, i) => i === 0 || Math.hypot(v.x - centers[i - 1].x, v.y - centers[i - 1].y) < 80 + (v.time - centers[i - 1].time) * .6));
  check('Shared Logo size changes continuously', centers.every((v, i) => i === 0 || Math.max(v.width, centers[i - 1].width) / Math.max(1, Math.min(v.width, centers[i - 1].width)) < 1.3 + (v.time - centers[i - 1].time) / 300));
  check('Portal and home use the identical live canvas', await page.evaluate(() => document.querySelector('.galaxy-webgl') === window.beta03PortalCanvas));
  check('Home input is enabled after portal completion', await page.locator('.sm-home').evaluate(el => !el.inert));
  await shot(page, '05-home');
  await page.evaluate(() => { window.beta03Observe = false; });
}

async function nodeRegression(page) {
  check('All twelve enabled nodes remain present', await page.locator('.sm-star').count() === 12);
  check('All six reserved nodes remain present', await page.locator('.sm-empty').count() === 6);
  const presets = await page.locator('.sm-star .sm-node-visual').evaluateAll(nodes => nodes.map(el => ({ preset: el.dataset.visualPreset, motion: el.dataset.motionPreset, seed: el.dataset.visualSeed, svg: el.querySelector('svg')?.outerHTML })));
  check('Twelve purpose-specific stable presets remain', presets.length === 12 && new Set(presets.map(p => p.preset)).size === 12 && presets.every(p => p.motion && p.seed));
  check('Twelve vector structures remain distinct', new Set(presets.map(p => p.svg)).size === 12);
  for (const id of ['ai', 'robotics', 'xr', 'portfolio', 'join']) {
    const node = page.locator(`[data-star="${id}"]`), origin = await signature(node.locator('.sm-galaxy-vector'));
    await node.click(); await page.waitForTimeout(220);
    check(`${id}: flight retains the origin vector`, await signature(page.locator('.sm-voyager-glyph .sm-galaxy-vector')) === origin);
    await terminalReady(page);
    check(`${id}: opened detail retains the origin vector`, await signature(page.locator('.sm-voyager-glyph .sm-galaxy-vector')) === origin);
    await shot(page, `node-${id}`); await page.keyboard.press('Escape'); await closed(page);
    check(`${id}: return restores focus and identity`, await node.evaluate(el => document.activeElement === el) && await signature(node.locator('.sm-galaxy-vector')) === origin);
  }
  await page.locator('[data-star="ai"]').click(); await page.waitForTimeout(120); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await closed(page);
  check('Early repeated Escape releases modal input', await page.locator('.sm-home').evaluate(el => !el.inert));
  await page.locator('.sm-empty').first().click(); check('Reserved stars do not open detail', await page.locator('.sm-modal').isHidden());
  await page.locator('.sm-tools [data-action="replay"]').click(); await page.locator('#ixd-account').waitFor({ state: 'visible' });
  check('Replay resets the password and its type', await page.locator(selectors.password).inputValue() === '' && await page.locator(selectors.password).getAttribute('type') === 'password');
  await fillCredentials(page); await page.locator('.identity-submit').click(); await phase(page, 'bridge'); await page.locator('.ixd-portal-skip').click(); await phase(page, 'galaxy');
  check('Portal skip releases the input and hides its overlay', await page.locator('.sm-home').evaluate(el => !el.inert) && await page.locator('.ixd-portal').isHidden());
}

async function variants() {
  for (const mode of ['resize', 'narrow', 'reduced', 'no-webgl']) {
    const page = await browser.newPage({ viewport: mode === 'narrow' ? { width: 390, height: 844 } : { width: 1366, height: 768 }, deviceScaleFactor: mode === 'narrow' ? 2 : 1.25, reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
    watch(page, mode === 'no-webgl');
    if (mode === 'no-webgl') await page.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /^(webgl2?|experimental-webgl)$/.test(type) ? null : original.call(this, type, ...args); }; });
    await page.goto(base); await fillCredentials(page); await page.locator('.identity-submit').click();
    if (mode === 'resize') { await phase(page, 'welcome'); await page.setViewportSize({ width: 1536, height: 864 }); await phase(page, 'bridge'); await page.setViewportSize({ width: 1280, height: 720 }); }
    await phase(page, 'galaxy');
    check(`${mode}: home remains usable`, await page.locator('.sm-home').evaluate(el => !el.inert));
    check(`${mode}: no horizontal document overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (mode === 'reduced') check('Reduced motion uses the abbreviated portal', (await state(page)).bridgeDuration < .5);
    if (mode === 'no-webgl') {
      check('Unavailable WebGL produces explicit static fallback', (await state(page)).galaxy.renderer === 'static');
      const before = (await state(page)).galaxy.flow.steps;
      await page.mouse.move(800, 400); await page.waitForTimeout(350);
      check('Static fallback does not spend frames advancing the flow solver', (await state(page)).galaxy.flow.steps === before);
    }
    await page.locator('[data-star="join"]').click(); await terminalReady(page); await shot(page, `${mode}-detail`); await page.keyboard.press('Escape'); await closed(page);
    check(`${mode}: detail returns cleanly`, await page.locator('.sm-home').evaluate(el => !el.inert));
    await page.close();
  }
}

async function geometryChecks(page) {
  const box = await page.locator('.galaxy-webgl').boundingBox(); assert.ok(box);
  const captures = [];
  for (const [label, x, y] of [['top-left', .015, .015], ['top-right', .985, .015], ['bottom-right', .985, .985], ['bottom-left', .015, .985]]) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 18 }); await page.waitForTimeout(700);
    const stats = (await state(page)).galaxy;
    await shot(page, `parallax-${label}`); captures.push({ label, stats });
    const p = Object.fromEntries(Object.entries(stats.parallax).map(([key, value]) => [key, Math.abs(value)]));
    check(`${label}: far moves less than cloud, middle, and near layers`, p.far < p.nebula && p.nebula < p.middle && p.middle < p.near);
    check(`${label}: live canvas continues covering the viewport`, await page.locator('.galaxy-webgl').evaluate(el => { const r = el.getBoundingClientRect(); return r.left <= 1 && r.top <= 1 && r.right >= innerWidth - 1 && r.bottom >= innerHeight - 1; }));
  }
  report.measurements.parallaxCorners = captures;
  await page.locator('.sm-tools [data-action="settings"]').click(); await page.locator('.terminal-modal').waitFor();
  await page.locator('[data-pref="reduced"]').check();
  let reduced = (await state(page)).galaxy;
  check('Enabling reduced motion clears old flow state', reduced.reduced && reduced.flow.energy === 0 && reduced.flow.maxDisplacementPx === 0);
  await page.locator('[data-pref="reduced"]').uncheck();
  await page.locator('[data-action="close-modal"]').click(); await page.locator('.terminal-modal').waitFor({ state: 'hidden' });
  await page.mouse.move(-20, -20); await page.waitForTimeout(300);
  reduced = (await state(page)).galaxy;
  check('Disabling reduced motion does not resurrect old disturbance', !reduced.reduced && reduced.flow.energy === 0 && reduced.flow.maxDisplacementPx === 0);
}

async function startupRecoveryChecks() {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } }); watch(page); await installObservation(page);
  await page.goto(base); await phase(page, 'login');
  await page.reload({ waitUntil: 'domcontentloaded' }); await phase(page, 'login');
  const warm = await collect(page, 'warm-cache');
  const preparation = warm.filter(f => f.preparation?.visible);
  const warmDuration = preparation.at(-1).time - preparation[0].time;
  report.measurements.warmPreparationVisibleMs = warmDuration;
  check('Warm reload preserves the full three-second preparation', warmDuration >= 2750 && warmDuration <= 3800);
  check('Warm reload does not reintroduce the old small Logo', !warm.some(f => f.loadingLogo?.visible));
  await page.close();

  const dark = await browser.newPage({ viewport: { width: 1366, height: 768 } }); watch(dark); await installObservation(dark);
  await dark.addInitScript(() => { localStorage.setItem('rhine-settings', JSON.stringify({ colorTheme: 'dark' })); });
  await dark.goto(base); await phase(dark, 'login');
  const darkFrames = await collect(dark, 'dark-startup');
  const darkPreparation = darkFrames.filter(f => f.preparation?.visible);
  check('Saved dark theme is honored during preparation', darkPreparation.length > 5 && darkPreparation.every(f => { const rgb = f.preparationColor.match(/[\d.]+/g)?.slice(0, 3).map(Number); return rgb?.length === 3 && Math.max(...rgb) < 80; }));
  await shot(dark, 'dark-login'); await dark.close();

  const recovery = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const blockedRequests = []; let intentionallyBlocked = true;
  recovery.on('pageerror', error => { if (intentionallyBlocked) report.expectedDiagnostics.push(error.message); else report.errors.push(error.message); });
  recovery.on('console', message => { if (message.type() === 'error') { if (intentionallyBlocked) report.expectedDiagnostics.push(message.text()); else report.consoleErrors.push(message.text()); } });
  const modulePattern = url => url.pathname === '/src/main.ts' || /^\/assets\/index-[^/]+\.js$/.test(url.pathname);
  await recovery.route(modulePattern, route => { blockedRequests.push(route.request().url()); return route.abort('failed'); });
  await recovery.goto(base, { waitUntil: 'domcontentloaded' });
  await recovery.locator('.preparation-retry').waitFor({ state: 'visible', timeout: 16000 });
  check('An unavailable startup module leaves readable preparation and recovery', blockedRequests.length > 0 && await recovery.locator(selectors.preparation).isVisible() && /资源|连接|重试/.test(await recovery.locator('.preparation-state').innerText()));
  await shot(recovery, 'module-unavailable-recovery');
  await recovery.unroute(modulePattern); intentionallyBlocked = false;
  await recovery.locator('.preparation-retry').click(); await phase(recovery, 'login');
  check('Reload recovery starts a working fresh login after resources return', await recovery.locator('#ixd-account').isVisible() && await recovery.locator(selectors.password).inputValue() === '');
  await recovery.close();
}

const debug = (page, options) => page.evaluate(options => window.rhine.debugGalaxy(options), options);
function particleDelta(before, after) {
  const byId = new Map(before.map(p => [p.id, p]));
  const records = after.filter(p => byId.has(p.id)).map(p => {
    const old = byId.get(p.id);
    return { id: p.id, displacementPx: Math.hypot(p.position.x - old.position.x, p.position.y - old.position.y), speedPx: Math.hypot(p.velocity.x, p.velocity.y), baseline: p.baseline, before: old.position, after: p.position };
  });
  return { records, count: records.length, changed: records.filter(p => p.displacementPx > .1).length, maxDisplacementPx: Math.max(0, ...records.map(p => p.displacementPx)), meanDisplacementPx: records.reduce((sum, p) => sum + p.displacementPx, 0) / Math.max(1, records.length) };
}
async function screenshotDifference(page, before, after, region) {
  return page.evaluate(async ({ before, after, region }) => {
    const decode = async data => { const image = new Image(); image.src = data; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height }; };
    const a = await decode(before), b = await decode(after), dpr = a.width / innerWidth;
    let sum = 0, count = 0, changed = 0, farSum = 0, farCount = 0;
    for (let y = 0; y < a.height; y += 2) for (let x = 0; x < a.width; x += 2) {
      const i = (y * a.width + x) * 4;
      const delta = (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])) / 3;
      const distance = Math.hypot(x / dpr - region.x, y / dpr - region.y);
      if (distance < region.radius) { sum += delta; count++; if (delta > 3) changed++; }
      else if (distance > region.radius * 2) { farSum += delta; farCount++; }
    }
    return { localMean: sum / count, localChangedFraction: changed / count, farMean: farSum / Math.max(1, farCount) };
  }, { before: `data:image/png;base64,${before.toString('base64')}`, after: `data:image/png;base64,${after.toString('base64')}`, region });
}
async function flowChecks(page) {
  if (production) { report.measurements.flow = { excluded: 'DEV-only isolation is run separately; production navigation still covered.' }; return; }
  check('DEV isolation controls are available', await page.evaluate(() => typeof window.rhine?.debugGalaxy === 'function'));
  const host = await page.locator('.galaxy-webgl').boundingBox();
  assert.ok(host, 'A real WebGL canvas is required for the flow isolation check');
  const region = { x: host.x + host.width * .38, y: host.y + host.height * .55, radius: Math.min(330, host.width * .34) };
  const probe = { x: region.x - host.x, y: region.y - host.y };
  const sample = async () => { const result = await debug(page, { particles: true, probe }); return { time: Date.now(), flow: result.galaxy?.flow, particles: result.particles, sample: result.flowSample ?? result.sample, camera: result.galaxy?.camera }; };
  await page.mouse.move(-25, -25);
  await debug(page, { freezeCamera: true, freezeTime: true, resetFlow: true });
  // The renderer updates projected CSS baselines in its next frame. Sample
  // after the requested frozen camera has actually been rendered.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const css = await page.addStyleTag({ content: '.sm-root{visibility:hidden!important}' });
  const measurement = report.measurements.flow = { viewport: page.viewportSize(), region, units: 'CSS pixels, y-down; velocity CSS px/s' };
  try {
    const initial = await sample();
    measurement.initial = initial;
    check('Cloud layer uses persistent advected material state', initial.flow?.materialState === 'advected-reference-map');
    check('Old refraction and decorative trails are disabled', initial.flow.oldRefraction === false && initial.flow.decorativeTrails === false);
    check('Fixed existing particle IDs can be tracked', Array.isArray(initial.particles) && initial.particles.length >= 8);
    const rest = await page.screenshot({ path: resolve(output, 'flow-rest.png') });
    await page.waitForTimeout(1200);
    const control = await sample();
    measurement.control = control;
    const controlImage = await page.screenshot({ path: resolve(output, 'flow-control-no-input.png') });
    await debug(page, { resetFlow: true });
    const reset = await sample();
    measurement.reset = reset;
    check('Reset preserves the original particle IDs and baselines', initial.particles.every((p, i) => p.id === reset.particles[i]?.id && JSON.stringify(p.baseline) === JSON.stringify(reset.particles[i]?.baseline)));
    const halfWidth = Math.min(190, host.width * .22);
    for (let i = 0; i <= 30; i++) { await page.mouse.move(region.x - halfWidth + 2 * halfWidth * i / 30, region.y); await page.waitForTimeout(16); }
    const pushed = await sample();
    measurement.pushed = pushed;
    const active = await page.screenshot({ path: resolve(output, 'flow-after-push.png') });
    const inputDelta = particleDelta(reset.particles, pushed.particles);
    const noInputDelta = particleDelta(initial.particles, control.particles);
    const pixels = await screenshotDifference(page, controlImage, active, region);
    check('The simulation advances from previous frames', pushed.flow.steps > reset.flow.steps && pushed.flow.injectionCount > reset.flow.injectionCount);
    check('Input moves already-existing particles beyond the no-input control', inputDelta.changed >= 2 && inputDelta.maxDisplacementPx > noInputDelta.maxDisplacementPx + .5);
    check('Cloud material visibly changes with camera and scene time frozen', pixels.localMean > .25 && pixels.localChangedFraction > .015);
    check('Frozen camera stays at the same position', Math.hypot(pushed.camera.x - reset.camera.x, pushed.camera.y - reset.camera.y, pushed.camera.z - reset.camera.z) < .001);
    const stopped = [];
    let elapsed = 0;
    for (const target of [200, 600, 1200]) { await page.waitForTimeout(target - elapsed); elapsed = target; const snapshot = await sample(); stopped.push({ requestedWaitMs: target, afterStopMs: snapshot.time - pushed.time, ...snapshot, particleDelta: particleDelta(pushed.particles, snapshot.particles) }); }
    check('Existing particles continue moving after the pointer stops', stopped[0].particleDelta.maxDisplacementPx > .1 && stopped[1].particleDelta.maxDisplacementPx > .1);
    check('Old input velocity does not keep injecting indefinitely', stopped[2].flow.injectionCount <= stopped[1].flow.injectionCount + 1);
    await page.screenshot({ path: resolve(output, 'flow-dwell-inertia.png') });
    await page.mouse.move(-25, -25);
    await page.waitForTimeout(200); const afterLeave = await sample();
    check('Pointer exit preserves simulated motion instead of resetting', afterLeave.flow.steps > stopped[2].flow.steps && particleDelta(reset.particles, afterLeave.particles).maxDisplacementPx > .1);
    await page.waitForTimeout(3800); const restored = await sample();
    check('Motion energy is bounded and decays after input stops', Number.isFinite(restored.flow.energy) && restored.flow.energy < Math.max(pushed.flow.energy, ...stopped.map(s => s.flow.energy)));
    await page.screenshot({ path: resolve(output, 'flow-restored.png') });
    const restorePixels = await screenshotDifference(page, rest, await page.screenshot(), region);
    Object.assign(measurement, { stopped, afterLeave, restored, inputDelta, noInputDelta, pixels, restorePixels });
  } finally { await css.evaluate(el => el.remove()); await debug(page, { freezeCamera: false, freezeTime: false }); }
}

let current;
try {
  current = await browser.newPage({ viewport, deviceScaleFactor });
  watch(current); await installObservation(current);
  if (groups.has('ui')) { await startupAndPassword(current); await authorizationContinuity(current); }
  else { await enter(current); await current.evaluate(() => { window.beta03Observe = false; }); }
  if (groups.has('regression')) { await nodeRegression(current); await variants(); await startupRecoveryChecks(); }
  if (groups.has('flow')) await flowChecks(current);
  if (groups.has('geometry')) await geometryChecks(current);
  check('No page exceptions', report.errors.length === 0);
  check('No unexpected console errors', report.consoleErrors.length === 0);
} catch (error) {
  report.failure = String(error.stack || error);
  if (current) { await shot(current, 'failure').catch(() => {}); report.failureState = await state(current).catch(() => null); await collect(current, 'failure').catch(() => {}); }
  process.exitCode = 1;
} finally {
  await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({ checks: report.checks.length, failure: report.failure, errors: report.errors, consoleErrors: report.consoleErrors, output }, null, 2));
}
