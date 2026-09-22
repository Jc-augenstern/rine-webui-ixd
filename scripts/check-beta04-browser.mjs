import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// This checker observes natural product time. It does not seek the startup,
// authorization, Welcome or portal timelines while asserting continuity.
const plan = {
  startup: ['cold preparation approximately 1.5 seconds', 'permission/connection/progress together', 'no small loading logo flash', 'no prelogin ID CONFIRMED', 'overlapping logo travel and form appearance'],
  password: ['pointer and keyboard reveal/hide', 'value and edit continuity', 'eye does not submit', 'wrong and correct credentials'],
  continuity: ['300 ms local reference flicker with no remaining ring', 'one persistent terminal background from initial HTML through login and replay', 'one persistent visible Logo across Welcome and bridge', 'same live galaxy canvas'],
  regression: ['12 stable distinct presets', 'five flight/detail/return journeys', 'dormant stars', 'early Escape', 'replay', 'skip', 'resize', 'narrow viewport', 'reduced motion', 'no WebGL'],
  evidence: ['natural frame observations', 'screenshots', 'separate startup and local flicker recordings; actual source timestamps required for 33 ms states'],
};
if (process.argv.includes('--plan')) {
  console.log(JSON.stringify({ plan, status: 'Plan only; --plan does not execute browser tests.' }, null, 2));
  process.exit(0);
}

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.IXD_TEST_URL || 'http://127.0.0.1:5173';
const output = resolve(process.env.IXD_TEST_OUTPUT || '.tools/beta04-browser');
const production = process.env.IXD_TEST_MODE === 'production';
const groups = new Set((process.env.IXD_TEST_GROUPS || 'ui,regression,dark').split(','));
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
  sharedLogo: '.ixd-shared-logo', welcome: '.welcome', ring: '.scan', background: '#boot-background',
  ...JSON.parse(process.env.IXD_BETA04_SELECTORS || '{}'),
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
    const ids = new WeakMap(); let nextId = 1;
    window.beta04Frames = [];
    window.beta04Observe = true;
    const colorCanvas = document.createElement('canvas'); colorCanvas.width = colorCanvas.height = 1;
    const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true });
    const colorMean = css => { colorContext.clearRect(0,0,1,1); colorContext.fillStyle = css; colorContext.fillRect(0,0,1,1); const p = colorContext.getImageData(0,0,1,1).data; return (p[0]+p[1]+p[2])/3; };
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
    function appearance(element) {
      if (!element) return null;
      const css = getComputedStyle(element);
      return { ...geometry(element), color: css.color, background: css.backgroundColor, backgroundImage: css.backgroundImage, transform: css.transform, clipPath: css.clipPath };
    }
    function frame(time) {
      if (window.beta04Observe) {
        const experience = window.rhine?.stats().experience;
        const preparation = select('preparation'), ring = select('ring');
        const auth = document.querySelector('.auth-status');
        const logos = [...document.querySelectorAll(selectors.sharedLogo)].map(geometry);
        const progress = select('progress');
        const progressStyle = progress ? getComputedStyle(progress) : null;
        let flashInkMix = null;
        if (experience?.phase === 'handoff') {
          const root = getComputedStyle(document.documentElement), ink = colorMean(root.getPropertyValue('--theme-ink')), panel = colorMean(root.getPropertyValue('--theme-panel'));
          const text = document.querySelector('.welcome-heading');
          if(text)flashInkMix = (colorMean(getComputedStyle(text).color)-panel)/(ink-panel);
        }
        window.beta04Frames.push({
          time, phase: experience?.phase ?? null, phaseAge: experience?.phaseAge ?? null, bootTime: experience?.bootTime ?? null,
          background: appearance(select('background')), backgroundCount: document.querySelectorAll(selectors.background).length,
          themeDark: document.documentElement.dataset.darkSurface === 'true',
          preparation: geometry(preparation), preparationText: preparation?.textContent?.trim(), preparationColor: preparation ? getComputedStyle(preparation).backgroundColor : null,
          preparationTitle: geometry(select('preparationTitle')),
          progress: geometry(progress), progressTransform: progressStyle ? `${progressStyle.transform}|${progressStyle.width}` : null,
          loadingLogo: geometry(select('loadingLogo')), bootLogo: geometry(select('bootLogo')),
          login: geometry(select('login')), welcome: geometry(select('welcome')), logos,
          heading: appearance(document.querySelector('.welcome-heading')), flashPanel: appearance(document.querySelector('.welcome-panel')),
          flashInkMix,
          company: appearance(document.querySelector('.welcome-company')), database: appearance(document.querySelector('.welcome-database')),
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
  const frames = await page.evaluate(() => window.beta04Frames || []);
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

function checkTerminalBackground(frames, label) {
  const states = frames.filter(f => f.preparation?.visible || ['intro','login-enter','login'].includes(f.phase));
  check(`${label}: one actual terminal background node persists`, states.length > 5 && states.every(f => f.backgroundCount === 1 && f.background?.id) && new Set(states.map(f => f.background.id)).size === 1);
  check(`${label}: terminal background remains visible beneath preparation and Logo`, states.every(f => f.background.visible && f.background.opacity > .98));
  check(`${label}: shared gradient is present from the preparation stage`, states.filter(f => f.preparation?.visible).every(f => /gradient/.test(f.background.backgroundImage)));
  check(`${label}: preparation does not paint an independent opaque surface`, states.filter(f => f.preparation?.visible).every(f => f.preparationColor === 'rgba(0, 0, 0, 0)'));
}

async function startupAndPassword(page) {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('#ixd-account').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(700);
  const frames = await collect(page, 'startup');
  const preparation = frames.filter(f => f.preparation?.visible);
  check('Cold startup presents a measurable preparation screen', preparation.length >= 10);
  const duration = preparation.at(-1).time - preparation[0].time;
  report.measurements.preparationVisibleMs = duration;
  check('Normal foreground preparation lasts approximately 1.5 seconds', duration >= 1420 && duration <= 1700);
  checkTerminalBackground(frames, 'Cold startup');
  const configuration = await state(page);
  check('Preparation has the authored 1.5-second duration', configuration.preparationDuration === 1.5);
  check('Login entrance retains its 0.72-second duration', configuration.loginEntranceDuration === .72);
  const intro = frames.filter(f => f.phase === 'intro');
  const loginEntrance = frames.filter(f => f.phase === 'login-enter');
  report.measurements.introVisibleMs = intro.at(-1).time - intro[0].time;
  check('Dynamic Logo retains its original approximately 2.84-second drawing', report.measurements.introVisibleMs >= 2660 && report.measurements.introVisibleMs <= 3100);
  report.measurements.loginEntranceMs = loginEntrance.at(-1).time - loginEntrance[0].time;
  check('Logo and login entrance retain their original approximately 0.72-second motion', report.measurements.loginEntranceMs >= 600 && report.measurements.loginEntranceMs <= 950);
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

  await fillCredentials(page, 'beta04-eye');
  const input = page.locator(selectors.password), toggle = page.locator(selectors.passwordToggle);
  await toggle.waitFor({ state: 'visible' });
  check('Password eye is an explicit non-submit button', await toggle.getAttribute('type') === 'button');
  for (let i = 0; i < 4; i++) {
    await toggle.click();
    check(`Password eye pointer toggle ${i + 1} preserves value`, await input.inputValue() === 'beta04-eye');
    check(`Password eye pointer toggle ${i + 1} sets the expected input type`, await input.getAttribute('type') === (i % 2 ? 'password' : 'text'));
    check(`Password eye pointer toggle ${i + 1} does not submit`, (await state(page)).phase === 'login');
  }
  await toggle.focus(); await page.keyboard.press('Space');
  check('Keyboard Space activates reveal', await input.getAttribute('type') === 'text');
  await page.keyboard.press('Enter');
  check('Keyboard Enter hides without submitting', await input.getAttribute('type') === 'password' && (await state(page)).phase === 'login');
  await input.focus(); await input.press('End'); await page.keyboard.type('-more');
  check('Typing continues after repeated visibility changes', await input.inputValue() === 'beta04-eye-more');
  await page.locator('.identity-submit').click(); await phase(page, 'login');
  check('Wrong credentials still produce ACCESS DENIED', /ACCESS DENIED/.test(await page.locator('#identity-feedback').innerText()));
  check('Failed login clears the password', await input.inputValue() === '');
  check('Password returns to concealed state after an error', await input.getAttribute('type') === 'password');
  await shot(page, '02-password-error');
}

async function authorizationContinuity(page, prefix = '') {
  await fillCredentials(page);
  await page.locator(selectors.password).press('Enter');
  await phase(page, 'welcome'); await shot(page, prefix + '03-welcome');
  await phase(page, 'bridge');
  await page.evaluate(() => { window.beta04PortalCanvas = document.querySelector('.galaxy-webgl'); });
  await page.waitForTimeout(700); await shot(page, prefix + '04-portal');
  await phase(page, 'galaxy'); await page.waitForTimeout(400);
  const frames = await collect(page, prefix + 'authorization');
  const authorized = frames.filter(f => f.phase === 'authorized' && f.ring?.visible);
  check('Existing authorization ring remains present', authorized.length > 5);
  const end = authorized.at(-1).time;
  const closing = authorized.filter(f => f.time >= end - 700);
  check('Authorization body retains its animated ring geometry', new Set(closing.map(f => f.ringShape)).size >= 5);
  const phases = frames.map(f => f.phase).filter((p, i, all) => i === 0 || p !== all[i - 1]);
  report.measurements.phases = phases;
  check('Local Welcome flicker leads to the existing portal', phases.join('>').includes('authorized>handoff>welcome>bridge>galaxy'));
  const handoff = frames.filter(f => f.phase === 'handoff');
  report.measurements.ringHandoffMs = handoff.length > 1 ? handoff.at(-1).time - handoff[0].time : 0;
  check('Local reference flicker lasts approximately 300 ms', report.measurements.ringHandoffMs >= 240 && report.measurements.ringHandoffMs <= 340);
  check('Welcome flicker contains no visible remnants of the authorization ring', handoff.length >= 12 && handoff.every(f => !f.ring?.visible));
  check('Welcome flicker is confined to a local rectangle', handoff.filter(f => f.flashPanel?.visible).every(f => f.flashPanel.width < viewport.width * .6 && f.flashPanel.height < viewport.height * .8));
  const flashStates = handoff.map(f => ({ ageMs: f.phaseAge * 1000, heading: f.heading, panel: f.flashPanel, inkMix: f.flashInkMix }));
  report.measurements.welcomeFlash = flashStates;
  check('Natural flash samples include distinct full, faint and background-matched states', new Set(flashStates.map(f => `${f.heading?.color}|${f.heading?.opacity}|${f.panel?.opacity}`)).size >= 4);
  const referenceStates = [[0,1,0],[100/3,0,0],[200/3,.28,.2],[100,0,1],[500/3,1,0],[200,0,0],[700/3,0,.25]];
  for(let i=0;i<referenceStates.length;i++){
    const [start,panel,ink] = referenceStates[i], end = referenceStates[i+1]?.[0] ?? 300;
    const samples = flashStates.filter(f => f.ageMs >= start+2 && f.ageMs < end-2);
    check(`Reference flicker state ${i+1} is observed at its natural relative time`, samples.length > 0);
    check(`Reference flicker state ${i+1} preserves measured panel and ink mixtures`, samples.every(f => Math.abs(f.panel.opacity-panel) < .025 && Math.abs(f.inkMix-ink) < .025));
  }
  const welcomeFrames = frames.filter(f => f.phase === 'welcome');
  for(const name of ['company','database']) check(`${name} has one gentle reveal without repeated flashing`, welcomeFrames.every((f,i) => i === 0 || f[name].opacity + .01 >= welcomeFrames[i-1][name].opacity));
  check('The shared terminal background survives authorization and flicker', new Set(frames.filter(f => ['authorized','handoff','welcome'].includes(f.phase)).map(f => f.background?.id)).size === 1);
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
  check('Portal and home use the identical live canvas', await page.evaluate(() => document.querySelector('.galaxy-webgl') === window.beta04PortalCanvas));
  check('Home input is enabled after portal completion', await page.locator('.sm-home').evaluate(el => !el.inert));
  await shot(page, prefix + '05-home');
  await page.evaluate(() => { window.beta04Observe = false; });
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
  await page.evaluate(() => { window.beta04ReplayBackground = document.querySelector('#boot-background'); window.beta04Frames = []; window.beta04Observe = true; });
  await page.locator('.sm-tools [data-action="replay"]').click(); await phase(page, 'login');
  const replay = await collect(page, 'replay');
  const replayPreparation = replay.filter(f => f.preparation?.visible);
  const replayDuration = replayPreparation.at(-1).time - replayPreparation[0].time;
  report.measurements.replayPreparationMs = replayDuration;
  check('Replay preserves the 1.5-second preparation', replayDuration >= 1420 && replayDuration <= 1700);
  checkTerminalBackground(replay, 'Replay');
  check('Replay reuses the original terminal background DOM node', await page.evaluate(() => document.querySelector('#boot-background') === window.beta04ReplayBackground));
  check('Replay resets the password and its type', await page.locator(selectors.password).inputValue() === '' && await page.locator(selectors.password).getAttribute('type') === 'password');
  await fillCredentials(page); await page.locator('.identity-submit').click(); await phase(page, 'bridge'); await page.locator('.ixd-portal-skip').click(); await phase(page, 'galaxy');
  check('Portal skip releases the input and hides its overlay', await page.locator('.sm-home').evaluate(el => !el.inert) && await page.locator('.ixd-portal').isHidden());
  await page.evaluate(() => { window.beta04Observe = false; });
}

async function variants() {
  for (const mode of ['resize', 'narrow', 'reduced', 'no-webgl']) {
    const page = await browser.newPage({ viewport: mode === 'narrow' ? { width: 390, height: 844 } : { width: 1366, height: 768 }, deviceScaleFactor: mode === 'narrow' ? 2 : 1.25, reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
    watch(page, mode === 'no-webgl');
    await installObservation(page);
    if (mode === 'no-webgl') await page.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /^(webgl2?|experimental-webgl)$/.test(type) ? null : original.call(this, type, ...args); }; });
    await page.goto(base); await fillCredentials(page); await page.locator('.identity-submit').click();
    if (mode === 'resize') { await phase(page, 'welcome'); await page.setViewportSize({ width: 1536, height: 864 }); await phase(page, 'bridge'); await page.setViewportSize({ width: 1280, height: 720 }); }
    await phase(page, 'galaxy');
    check(`${mode}: home remains usable`, await page.locator('.sm-home').evaluate(el => !el.inert));
    check(`${mode}: no horizontal document overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (mode === 'reduced') {
      check('Reduced motion uses the abbreviated portal', (await state(page)).bridgeDuration < .5);
      const reducedFrames = await collect(page, 'reduced');
      check('Reduced motion skips the flicker phase completely', reducedFrames.every(f => f.phase !== 'handoff'));
      check('Reduced motion has no visible local flash rectangle', reducedFrames.filter(f => ['welcome','bridge'].includes(f.phase)).every(f => !f.flashPanel?.visible));
    }
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
  check('Warm reload preserves the full 1.5-second preparation', warmDuration >= 1420 && warmDuration <= 1700);
  checkTerminalBackground(warm, 'Warm reload');
  check('Warm reload does not reintroduce the old small Logo', !warm.some(f => f.loadingLogo?.visible));
  await page.close();

  const dark = await browser.newPage({ viewport: { width: 1366, height: 768 } }); watch(dark); await installObservation(dark);
  await dark.addInitScript(() => { localStorage.setItem('rhine-settings', JSON.stringify({ colorTheme: 'dark' })); });
  await dark.goto(base); await phase(dark, 'login');
  const darkFrames = await collect(dark, 'dark-startup');
  const darkPreparation = darkFrames.filter(f => f.preparation?.visible);
  check('Saved dark theme is honored during preparation', darkPreparation.length > 5 && darkPreparation.every(f => f.themeDark && /gradient/.test(f.background.backgroundImage)));
  checkTerminalBackground(darkFrames, 'Saved dark theme');
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

let current;
try {
  current = await browser.newPage({ viewport, deviceScaleFactor });
  watch(current); await installObservation(current);
  if (groups.size === 1 && groups.has('dark')) {
    await current.addInitScript(() => localStorage.setItem('rhine-settings',JSON.stringify({colorTheme:'dark'})));
    await current.goto(base); await phase(current,'login'); await authorizationContinuity(current,'dark-');
  }
  else if (groups.has('startup')) await startupAndPassword(current);
  else if (groups.has('ui')) { await startupAndPassword(current); await authorizationContinuity(current); }
  else { await enter(current); await current.evaluate(() => { window.beta04Observe = false; }); }
  if (groups.has('regression')) { await nodeRegression(current); await variants(); await startupRecoveryChecks(); }
  if (groups.has('dark') && groups.size > 1) {
    const dark = await browser.newPage({viewport,deviceScaleFactor});watch(dark);await installObservation(dark);
    await dark.addInitScript(() => localStorage.setItem('rhine-settings',JSON.stringify({colorTheme:'dark'})));
    await dark.goto(base);await phase(dark,'login');await authorizationContinuity(dark,'dark-');await dark.close();
  }
  if (groups.has('geometry')) await geometryChecks(current);
  if (production) {
    report.measurements.servedScripts = await current.locator('script[src]').evaluateAll(elements => elements.map(element => element.src));
    check('Production does not expose the DEV galaxy mutation interface', await current.evaluate(() => !('debugGalaxy' in window.rhine)));
  }
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
