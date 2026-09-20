import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const base = process.env.IXD_TEST_URL || "http://127.0.0.1:5173";
const output = resolve(process.env.IXD_TEST_OUTPUT || ".tools/ixd-browser");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "msedge",
  headless: true,
});
const report = {
  url: base,
  errors: [],
  consoleErrors: [],
  checks: [],
  phases: [],
  sizes: [],
};
const check = (name, value = true) => {
  assert.ok(value, name);
  report.checks.push(name);
};
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  const phase = (value) =>
    page.waitForFunction(
      (value) => window.rhine?.stats().experience?.phase === value,
      value,
      { timeout: 20000 },
    );
  const shot = (name) => page.screenshot({ path: `${output}/${name}.png` });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.rhine?.stats().ready);
  await page.evaluate(() => {
    window.ixdPhaseLog = [];
    const host = document.querySelector("#viewport");
    const observer = new MutationObserver(() =>
      window.ixdPhaseLog.push({
        phase: host.dataset.experience,
        time: performance.now(),
      }),
    );
    observer.observe(host, {
      attributes: true,
      attributeFilter: ["data-experience"],
    });
  });
  await page.waitForTimeout(2600);
  await shot("01-opening");
  await phase("login");
  await page.waitForTimeout(700);
  await shot("02-login");
  await page.waitForTimeout(9000);
  check(
    "Login waits longer than eight seconds",
    await page.evaluate(
      () => window.rhine.stats().experience.phase === "login",
    ),
  );
  await page.locator("#ixd-account").fill("ixd-demo");
  await page.locator("#ixd-password").fill("wrong-password");
  await page.locator(".identity-submit").click();
  await phase("authenticating");
  await phase("login");
  check(
    "Wrong credentials rejected",
    (await page.locator("#identity-feedback").innerText()).includes(
      "ACCESS DENIED",
    ),
  );
  check(
    "Password cleared after error",
    (await page.locator("#ixd-password").inputValue()) === "",
  );
  await shot("03-invalid-identity");
  await page.locator("#ixd-password").fill("ixd2026");
  await page.locator("#ixd-password").press("Enter");
  await phase("authenticating");
  await shot("04-authenticating");
  await phase("confirmed");
  await shot("05-confirmed");
  await phase("authorized");
  await page.waitForTimeout(400);
  await shot("06-authorized");
  await phase("welcome");
  await page.waitForTimeout(550);
  await shot("07-welcome");
  await phase("galaxy");
  await page.waitForTimeout(1400);
  await shot("08-star-map");
  check(
    "Six direction stars",
    (await page.locator(".sm-star-direction").count()) === 6,
  );
  check(
    "Six function stars",
    (await page.locator(".sm-star-function").count()) === 6,
  );
  check("Six reserved stars", (await page.locator(".sm-empty").count()) === 6);
  check(
    "Chinese motto",
    (await page.locator(".sm-motto").innerText()) === "让灵感漫步于星辰大海",
  );
  const positions = [];
  await page.mouse.move(100, 180);
  await page.waitForTimeout(450);
  positions.push(
    await page.evaluate(() => window.rhine.stats().experience.galaxy.camera),
  );
  await page.mouse.move(1800, 900);
  await page.waitForTimeout(600);
  positions.push(
    await page.evaluate(() => window.rhine.stats().experience.galaxy.camera),
  );
  check("Pointer changes camera", positions[0].x !== positions[1].x);
  for (const id of [
    "ai",
    "robotics",
    "interaction",
    "visual",
    "xr",
    "hardware",
    "core",
    "project",
    "competition",
    "salon",
    "portfolio",
    "join",
  ]) {
    const star = page.locator(`[data-star="${id}"]`);
    await star.hover();
    await page.waitForTimeout(240);
    check(
      `Hover ${id}`,
      await star
        .locator(".sm-star-hover")
        .evaluate(
          (el) =>
            Number(getComputedStyle(el).opacity) > 0.5 &&
            getComputedStyle(el).visibility === "visible",
        ),
    );
    await star.click();
    await page.locator(".sm-modal.is-ready").waitFor();
    check(
      `Detail ${id}`,
      (await page.locator(".sm-modal").getAttribute("data-active-star")) === id,
    );
    if (
      ["ai", "robotics", "interaction", "visual", "xr", "hardware"].includes(id)
    ) {
      check(
        `${id} exact content categories`,
        (await page.locator(".sm-detail-scroll").innerText()).includes(
          "学习关键词",
        ) &&
          (await page.locator(".sm-detail-scroll").innerText()).includes(
            "典型项目",
          ),
      );
    }
    if (id === "ai") {
      await page.waitForTimeout(500);
      await shot("09-direction-detail");
      check(
        "Camera approaches focused star",
        await page.evaluate(
          () => window.rhine.stats().experience.galaxy.camera.z < 9,
        ),
      );
    }
    if (id === "competition") {
      check(
        "Competition orbit has six nodes",
        (await page.locator(".sm-orbits li").count()) === 6,
      );
      await shot("10-competition");
    }
    await page.keyboard.press("Escape");
    if (id === "ai") await page.keyboard.press("Escape");
    await page.locator(".sm-modal").waitFor({ state: "hidden" });
    check(
      `Focus restored ${id}`,
      await star.evaluate((el) => document.activeElement === el),
    );
  }
  await page.locator(".sm-empty").first().hover();
  await page.locator(".sm-empty").first().click();
  check(
    "Reserved star cannot open",
    await page.locator(".sm-modal").isHidden(),
  );
  await page.locator('[data-growth="3"]').click();
  await page.locator(".sm-modal.is-ready").waitFor();
  check(
    "Growth path details",
    (await page.locator("#sm-detail-title").innerText()).includes("参与比赛"),
  );
  await page.locator(".sm-close").click();
  await page.locator(".sm-modal").waitFor({ state: "hidden" });
  for (const size of [
    { width: 2560, height: 1440 },
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(350);
    await page.locator(".sm-root").evaluate((el) => el.scrollTo(0, 0));
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth > innerWidth,
      map:
        document.querySelector(".sm-root").scrollWidth >
        document.querySelector(".sm-root").clientWidth + 2,
    }));
    check(
      `No horizontal overflow ${size.width}x${size.height}`,
      !overflow.document && !overflow.map,
    );
    report.sizes.push({
      ...size,
      overflow,
      stats: await page.evaluate(() => window.rhine.stats().experience.galaxy),
    });
    await shot(`size-${size.width}x${size.height}`);
    if (size.height === 390) {
      await page.mouse.move(400, 240);
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(250);
      check(
        "Short landscape scroll reaches lower stars",
        await page.locator(".sm-root").evaluate((el) => el.scrollTop > 0),
      );
      await shot("size-844x390-scrolled");
    }
    await page.locator('[data-star="hardware"]').click();
    await page.locator(".sm-modal.is-ready").waitFor();
    check(
      `Details usable ${size.width}x${size.height}`,
      await page.locator(".sm-close").isVisible(),
    );
    await page.locator(".sm-close").click();
    await page.locator(".sm-modal").waitFor({ state: "hidden" });
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.locator('.sm-tools [data-action="settings"]').click();
  await page.locator(".terminal-modal").waitFor();
  await page.locator('[data-pref="superPerformance"]').check();
  check(
    "Performance mode remains available",
    await page.locator('[data-pref="superPerformance"]').isChecked(),
  );
  await page.locator('[data-pref="reduced"]').check();
  check(
    "Reduced motion reaches galaxy",
    await page.evaluate(() => window.rhine.stats().experience.galaxy.reduced),
  );
  await page.locator('[data-action="close-modal"]').click();
  await page.locator(".terminal-modal").waitFor({ state: "hidden" });
  await page.locator('.sm-tools [data-action="replay"]').click();
  await phase("login");
  check(
    "Replay returns to login without session reuse",
    (await page.locator("#ixd-password").inputValue()) === "",
  );
  report.phases = await page.evaluate(() => window.ixdPhaseLog);
  const success = report.phases.map((x) => x.phase).join(" > ");
  check(
    "Full login phase order",
    success.includes(
      "authenticating > confirmed > authorized > welcome > galaxy",
    ),
  );
  check("No runtime errors", report.errors.length === 0);
  check("No console errors", report.consoleErrors.length === 0);
  report.storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  check(
    "No auth storage",
    ![...report.storage.local, ...report.storage.session].some((key) =>
      /password|credential|token|ixd-auth/i.test(key),
    ),
  );
} catch (error) {
  report.failure = String(error.stack || error);
  const failedPage = browser.contexts()[0]?.pages()[0];
  if (failedPage) {
    await failedPage
      .screenshot({ path: `${output}/failure.png` })
      .catch(() => {});
    report.failureState = await failedPage
      .evaluate(() => ({
        stats: window.rhine?.stats(),
        text: document.body.innerText.slice(-3000),
      }))
      .catch(() => null);
  }
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(
    JSON.stringify(
      {
        passed: report.checks.length,
        errors: report.errors,
        consoleErrors: report.consoleErrors,
        output,
        failure: report.failure,
      },
      null,
      2,
    ),
  );
}
