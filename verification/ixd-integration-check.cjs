async page => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  await page.setViewportSize({ width: 1440, height: 900 });
  const shot = async (time, name) => {
    await page.goto(`http://127.0.0.1:5173/?time=${time}&freeze=1`);
    await page.waitForFunction(() => window.rhine?.stats().ready && !document.querySelector('#loading'), { timeout: 30000 });
    await page.screenshot({ path: `verification/${name}.png` });
  };
  await shot(5.4, 'ixd-in-page-drawing');
  const drawing = await page.locator('.boot-logo [data-stroke=frame]').evaluate(el => Number(el.style.strokeDashoffset));
  assert(drawing > 0 && drawing < 1, 'Partial reveal is rendered on the boot clock');
  await shot(7.4, 'ixd-in-page-auth');
  const box = await page.locator('.boot-logo').evaluate(el => {
    const s = getComputedStyle(el); return { width: s.width, height: s.height, left: s.left, top: s.top };
  });
  assert(box.width === '296px' && box.height === '177px' && box.left === '518px' && box.top === '462px', 'Original logo geometry retained');
  assert(await page.locator('.boot-logo [data-letter]').evaluateAll(els => els.every(el => el.style.opacity === '1')), 'IXD letters finish');
  assert(await page.locator('.boot-logo svg').getAttribute('preserveAspectRatio') === 'xMidYMid meet', 'No logo distortion');
  await shot(20.5, 'ixd-in-page-welcome');
  assert(await page.locator('.welcome-logo svg').getAttribute('aria-label') === 'IXD', 'Welcome mark replaced');
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.rhine?.stats().ready, { timeout: 30000 });
  assert(await page.locator('.loading-mark svg').getAttribute('aria-label') === 'IXD', 'Entry mark replaced');
  await page.screenshot({ path: 'verification/ixd-in-page-entry.png' });
  await page.locator('.entry-start').click();
  await page.waitForFunction(() => window.rhine.stats().startup === 'started', { timeout: 30000 });
  await page.evaluate(() => window.rhine.seek(7.4));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.boot-logo')).opacity === '1');
  await page.locator('#skip').click();
  await page.waitForFunction(() => window.rhine.stats().mode === 'archive');
  await page.locator('[data-action=replay]').click();
  await page.waitForFunction(() => window.rhine.stats().mode === 'boot');
  await page.evaluate(() => window.rhine.seek(4.16));
  await page.waitForFunction(() => Number(document.querySelector('.boot-logo [data-stroke=frame]').style.strokeDashoffset) > .5);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.rhine.seek(7.4));
  await page.waitForTimeout(150);
  const rect = await page.locator('.boot-logo').boundingBox();
  assert(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 390 && rect.y + rect.height <= 844, 'Logo stays inside mobile viewport');
  await page.screenshot({ path: 'verification/ixd-in-page-mobile.png' });
  assert(errors.length === 0, errors.join('\n'));
  console.log('PASS: source integration, original logo geometry, boot reveal, welcome, entry, skip, replay reset, mobile bounds; no runtime errors.');
}
