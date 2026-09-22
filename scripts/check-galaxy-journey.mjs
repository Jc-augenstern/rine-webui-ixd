import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.IXD_TEST_URL || "http://127.0.0.1:5173";
const output = resolve(process.env.IXD_TEST_OUTPUT || ".tools/galaxy-journey");
await mkdir(output, { recursive: true });
const report = { url: base, checks: [], errors: [], consoleErrors: [], measurements: {} };
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
const check = (name, value = true) => { assert.ok(value, name); report.checks.push(name); };
const watch = page => {
  page.on("pageerror", e => report.errors.push(e.message));
  page.on("console", e => { if (e.type() === "error") report.consoleErrors.push(e.text()); });
};
const login = async page => {
  await page.goto(base);
  await page.locator("#ixd-account").waitFor({ state: "visible" });
  await page.waitForFunction(() => window.rhine?.stats().experience?.phase === "login");
  await page.locator("#ixd-account").fill("ixd-demo");
  await page.locator("#ixd-password").fill("ixd2026");
  await page.locator(".identity-submit").click();
  await page.waitForFunction(() => window.rhine?.stats().experience?.phase === "galaxy");
  await page.waitForTimeout(1700);
};
const stats = page => page.evaluate(() => window.rhine.stats().experience.galaxy);
const rect = async locator => {
  const r = await locator.boundingBox();
  assert.ok(r);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width };
};
const hidden = page => page.locator(".sm-modal").waitFor({ state: "hidden" });
const ready = page => page.locator(".sm-modal.is-ready").waitFor();
const screenshot = (page, name) => page.screenshot({ path: `${output}/${name}.png` });

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  watch(page);
  await login(page);
  const initial = await stats(page);
  check("Live four-layer WebGL sky", initial.renderer === "webgl" && initial.depthLayers === 4);
  check("Bounded sky budget: at most 2600 particles, five draws, one cloud atlas and one flow texture", initial.particles <= 2600 && initial.drawCalls <= 5 && initial.textures === 2);
  check("Every enabled node uses a vector galaxy", await page.locator(".sm-star .sm-galaxy-vector").count() === 12);
  await screenshot(page, "01-galaxy-desktop");

  await page.mouse.move(120, 190);
  await page.waitForTimeout(800);
  const left = await stats(page);
  await screenshot(page, "02-parallax-left");
  await page.mouse.move(1780, 870, { steps: 24 });
  await page.waitForTimeout(800);
  const right = await stats(page);
  report.measurements.parallax = { left: left.parallax, right: right.parallax };
  const delta = Object.fromEntries(Object.keys(left.parallax).map(k => [k, Math.abs(left.parallax[k] - right.parallax[k])]));
  check("Distinct parallax depths; distant stars move least, then clouds, middle and near stars", delta.near > delta.middle && delta.middle > delta.nebula && delta.nebula > delta.far);
  // Beta 0.3 increases the previous .28 camera amplitude to .378 while preserving damping.
  check("Pointer produces stronger but bounded camera travel", Math.abs(right.camera.x - left.camera.x) > 0.55 && Math.abs(right.camera.x - left.camera.x) < 0.8);
  await screenshot(page, "03-parallax-right");

  report.measurements.performance = await page.evaluate(async () => {
    const sample = moving => new Promise(resolve => {
      const frames = []; let previous = performance.now();
      const step = time => {
        if (moving) document.querySelector("#viewport").dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", clientX: innerWidth * (.5 + Math.sin(time * .002) * .4), clientY: innerHeight * (.5 + Math.cos(time * .002) * .35) }));
        frames.push(time - previous); previous = time;
        if (frames.length < 300) requestAnimationFrame(step);
        else { const sorted = frames.slice(30).sort((a,b) => a-b); resolve({ medianMs: sorted[Math.floor(sorted.length*.5)], p95Ms: sorted[Math.floor(sorted.length*.95)] }); }
      };
      requestAnimationFrame(step);
    });
    return { idle: await sample(false), moving: await sample(true) };
  });
  report.measurements.performance.measurement = "requestAnimationFrame intervals, not GPU time";
  check("Desktop remains smooth during pointer interaction (rAF p95 under 33 ms)", report.measurements.performance.moving.p95Ms < 33);

  const ai = page.locator('[data-star="ai"]');
  await ai.hover();
  await page.waitForTimeout(400);
  check("Hover exposes the survey ring", await ai.locator(".sm-galaxy-survey").evaluate(el => Number(getComputedStyle(el).opacity) > .9));
  const start = await rect(ai.locator(".sm-star-glyph"));
  const originalGlyph = await ai.locator(".sm-galaxy-vector").evaluate(el => {
    const clone = el.cloneNode(true);
    // Instance IDs may be remapped when the SVG is cloned for a flight.
    const ids = [...clone.querySelectorAll("[id]")].map(node => node.id);
    let markup = clone.outerHTML;
    ids.forEach((id, index) => { markup = markup.replaceAll(id, `instance-id-${index}`); });
    return markup;
  });
  await ai.click();
  const lock = await rect(page.locator(".sm-voyager"));
  check("Flight starts at the clicked galaxy", Math.hypot(lock.x-start.x, lock.y-start.y) < 18);
  check("Content waits for the approach", !(await page.locator(".sm-modal").evaluate(el => el.classList.contains("is-ready"))));
  // Read actual in-flight geometry before taking screenshots (screenshots take time).
  await page.waitForTimeout(550);
  const flight = await rect(page.locator(".sm-voyager"));
  check("Vector structure visibly grows and travels", flight.width > start.width * 2 && Math.hypot(flight.x-start.x, flight.y-start.y) > 100);
  await screenshot(page, "04-approach");
  await ready(page);
  await page.waitForTimeout(450);
  const destination = await rect(page.locator(".sm-voyager"));
  const arrivedGlyph = await page.locator(".sm-voyager-glyph .sm-galaxy-vector").evaluate(el => {
    const clone = el.cloneNode(true);
    const ids = [...clone.querySelectorAll("[id]")].map(node => node.id);
    let markup = clone.outerHTML;
    ids.forEach((id, index) => { markup = markup.replaceAll(id, `instance-id-${index}`); });
    return markup;
  });
  check("The same vector identity anchors the terminal", arrivedGlyph === originalGlyph);
  check("Data link connects the star and expanded terminal", await page.locator(".sm-focus-link").evaluate(el => el.getBoundingClientRect().width > 100 && Number(getComputedStyle(el).opacity) > .5));
  check("Camera advances substantially", (await stats(page)).camera.z < 7);
  check("Readable terminal is fully unfolded", await page.locator(".sm-terminal").evaluate(el => getComputedStyle(el).clipPath === "inset(0px)" && Number(getComputedStyle(el).opacity) === 1));
  await screenshot(page, "05-linked-detail");
  await page.keyboard.press("Tab");
  check("Keyboard focus stays inside the terminal", await page.evaluate(() => document.querySelector(".sm-terminal").contains(document.activeElement)));
  await page.locator(".sm-close").click();
  await page.waitForTimeout(350);
  const retreat = await rect(page.locator(".sm-voyager"));
  check("Exit travels back instead of hiding immediately", await page.locator(".sm-modal").isVisible() && retreat.width < destination.width && retreat.width > start.width);
  await screenshot(page, "06-retreat");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await hidden(page);
  check("Exit restores origin focus and releases input", await ai.evaluate(el => document.activeElement === el) && !(await page.locator(".sm-home").evaluate(el => el.inert)));
  await page.waitForTimeout(200);
  check("Camera returns to overview", (await stats(page)).camera.z > 9.95);

  await page.locator('[data-star="robotics"]').click();
  await page.waitForTimeout(280);
  const interrupted = await rect(page.locator(".sm-voyager"));
  await page.keyboard.press("Escape");
  const continued = await rect(page.locator(".sm-voyager"));
  check("Early Escape reverses from the current position without a jump", Math.hypot(continued.x-interrupted.x, continued.y-interrupted.y) < 50);
  await hidden(page);
  check("Cancelled approach leaves no stale route or animation", !new URL(page.url()).hash && await page.locator(".sm-voyager").evaluate(el => el.getAnimations().length === 0));
  await ai.click();
  await page.setViewportSize({width:1366,height:768});
  await ready(page);
  await page.waitForTimeout(450);
  check("Resizing during approach keeps a usable detail view", await page.locator(".sm-close").isVisible());
  await screenshot(page, "07-detail-1366");
  await page.locator(".sm-close").click();
  await hidden(page);

  // Lose and restore the actual WebGL context; navigation remains ordinary DOM.
  await page.evaluate(() => {
    window.ixdTestContext = document.querySelector(".galaxy-webgl").getContext("webgl2").getExtension("WEBGL_lose_context");
    window.ixdTestContext.loseContext();
  });
  await page.waitForFunction(() => window.rhine.stats().experience.galaxy.renderer === "static");
  check("Context loss displays the nebula fallback", await page.locator(".galaxy-static-sky").isVisible());
  await page.locator('[data-star="hardware"]').click();
  await ready(page);
  await page.waitForTimeout(450);
  check("Details remain usable without WebGL", await page.locator("#sm-detail-title").innerText() === "智能硬件");
  await screenshot(page, "08-webgl-fallback");
  await page.locator(".sm-close").click();
  await hidden(page);
  await page.evaluate(() => window.ixdTestContext.restoreContext());
  await page.waitForFunction(() => window.rhine.stats().experience.galaxy.renderer === "webgl");
  check("WebGL restoration keeps the scene usable", (await stats(page)).renderer === "webgl");
  await page.close();

  const mobile = await browser.newPage({ viewport: {width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
  watch(mobile);
  await login(mobile);
  await screenshot(mobile, "09-mobile-overview");
  await mobile.locator('[data-star="hardware"]').tap();
  await ready(mobile);
  await mobile.waitForTimeout(450);
  check("Touch opens a distant mobile node", await mobile.locator("#sm-detail-title").innerText() === "智能硬件");
  check("Mobile has no horizontal overflow", await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector(".sm-root").scrollWidth <= document.querySelector(".sm-root").clientWidth + 1));
  check("Mobile terminal leaves the focused galaxy visible", await mobile.locator(".sm-terminal").evaluate(el => el.getBoundingClientRect().top >= 190));
  await screenshot(mobile, "10-mobile-detail");
  await mobile.locator(".sm-close").tap();
  await hidden(mobile);
  check("Mobile return preserves the explored map position", await mobile.locator(".sm-root").evaluate(el => el.scrollTop > 100));
  await mobile.close();

  const reduced = await browser.newPage({ viewport:{width:1366,height:768}, reducedMotion:"reduce" });
  watch(reduced);
  await reduced.addInitScript(() => Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 4 }));
  await login(reduced);
  const reducedStats = await stats(reduced);
  check("Low-capability hardware automatically uses a bounded quality tier", reducedStats.adaptiveLevel >= 1 && reducedStats.width * reducedStats.height <= 1843200);
  await reduced.mouse.move(1200,600);
  await reduced.waitForTimeout(400);
  check("Reduced motion keeps the sky static", (await stats(reduced)).renderedFrames === reducedStats.renderedFrames);
  await reduced.locator('[data-star="ai"]').click();
  await ready(reduced);
  check("Reduced motion has no spatial flight animation", await reduced.locator(".sm-voyager").evaluate(el => el.getAnimations().length === 0));
  await reduced.keyboard.press("Escape");
  await hidden(reduced);
  check("Reduced motion retains instant functional navigation", await reduced.locator('[data-star="ai"]').evaluate(el => document.activeElement === el));
  await reduced.close();
  check("No page exceptions", report.errors.length === 0);
  check("No console errors", report.consoleErrors.length === 0);
} catch (error) {
  report.failure = String(error.stack || error);
  const current = browser.contexts().flatMap(c => c.pages()).at(-1);
  if (current) await screenshot(current, "failure").catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({ passed:report.checks.length, errors:report.errors, consoleErrors:report.consoleErrors, measurements:report.measurements, failure:report.failure, output }, null, 2));
}
