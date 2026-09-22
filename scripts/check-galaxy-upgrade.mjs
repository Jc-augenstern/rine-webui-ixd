import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.IXD_TEST_URL || 'http://127.0.0.1:5173';
const output = resolve(process.env.IXD_TEST_OUTPUT || '.tools/galaxy-upgrade');
const production = process.env.IXD_TEST_MODE === 'production';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const report = { url: base, production, browser: browser.version(), platform: process.platform, checks: [], errors: [], consoleErrors: [], expectedDiagnostics: [], measurements: {}, visualReviewRequired: true };
const check = (name, value) => { assert.ok(value, name); report.checks.push(name); };
const stats = page => page.evaluate(() => window.rhine.stats().experience);
const shot = (page, name) => page.screenshot({path: `${output}/${name}.png`});
const debug = (page, options) => page.evaluate(options => window.rhine.debugGalaxy(options), options);
const watch = (page, forcedNoWebGL = false) => {
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') { if(forcedNoWebGL && /Error creating WebGL context/.test(message.text())) report.expectedDiagnostics.push(message.text());else report.consoleErrors.push(message.text()); } });
};
const ready = async page => {
  await page.locator('.sm-modal.is-ready').waitFor();
  await page.waitForFunction(()=>{
    const terminal=document.querySelector('.sm-terminal');
    const style=getComputedStyle(terminal);
    return Number(style.opacity)>.995&&style.clipPath==='inset(0px)';
  });
};
const closed = page => page.locator('.sm-modal').waitFor({state:'hidden'});
const glyphSignature = locator => locator.evaluate(el => {
  const clone = el.cloneNode(true);
  const ids = [clone, ...clone.querySelectorAll('[id]')].filter(node => node.id).map(node => node.id);
  let markup = clone.outerHTML;
  ids.forEach((id, index) => { markup = markup.replaceAll(id, `instance-id-${index}`); });
  return markup;
});
async function login(page, name) {
  await page.goto(base);
  await page.locator('#ixd-account').waitFor({state:'visible'});
  await page.waitForFunction(()=>window.rhine?.stats().experience?.phase==='login');
  await page.evaluate(() => {
    window.upgradePhaseLog = [];
    const host = document.querySelector('#viewport');
    const observer = new MutationObserver(() => window.upgradePhaseLog.push({phase:host.dataset.experience,time:performance.now()}));
    observer.observe(host,{attributes:true,attributeFilter:['data-experience']});
  });
  await page.locator('#ixd-account').fill('ixd-demo');
  await page.locator('#ixd-password').fill('ixd2026');
  await page.locator('.identity-submit').click();
  await page.waitForFunction(()=>window.rhine?.stats().experience?.phase==='bridge');
  await page.evaluate(()=>{window.testPortalCanvas=document.querySelector('.galaxy-webgl');});
  const before = (await stats(page)).galaxy;
  await page.waitForTimeout(700);
  await shot(page,`${name}-portal`);
  const during = (await stats(page)).galaxy;
  check(`${name}: live galaxy renders inside the portal`, during?.renderedFrames > before?.renderedFrames);
  check(`${name}: only one galaxy canvas during bridge`, await page.locator('.galaxy-webgl').count() === 1);
  await page.waitForFunction(()=>window.rhine.stats().experience.phase==='galaxy');
  await page.waitForTimeout(450);
  const phases = await page.evaluate(()=>window.upgradePhaseLog);
  report.measurements[`${name}-phases`] = phases;
  check(`${name}: explicit bridge follows welcome`, phases.map(p=>p.phase).join('>').includes('welcome>bridge>galaxy'));
  check(`${name}: home is interactive after the portal`, await page.locator('.sm-home').evaluate(el=>!el.inert));
  check(`${name}: portal and homepage share the exact same renderer canvas`,await page.evaluate(()=>document.querySelector('.galaxy-webgl')===window.testPortalCanvas));
}
async function pointerPath(page, points, interval = 35) {
  for (const point of points) { await page.mouse.move(point.x,point.y); await page.waitForTimeout(interval); }
}
async function pixelDifference(page, first, second, center, radius) {
  return page.evaluate(async({a,b,center,radius})=>{
    const decode = async source => { const image=new Image();image.src=source;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const c=canvas.getContext('2d');c.drawImage(image,0,0);return {width:image.width,height:image.height,data:c.getImageData(0,0,image.width,image.height).data}; };
    const before=await decode(a),after=await decode(b),scale=before.width/innerWidth;
    let localSum=0,farSum=0,localCount=0,farCount=0,localChanged=0;
    for(let y=0;y<before.height;y+=2)for(let x=0;x<before.width;x+=2){const offset=(y*before.width+x)*4,delta=(Math.abs(before.data[offset]-after.data[offset])+Math.abs(before.data[offset+1]-after.data[offset+1])+Math.abs(before.data[offset+2]-after.data[offset+2]))/3;const distance=Math.hypot(x/scale-center.x,y/scale-center.y);if(distance<radius*1.2){localSum+=delta;localCount++;if(delta>4)localChanged++;}else if(distance>radius*2){farSum+=delta;farCount++;}}
    return {localMean:localSum/localCount,farMean:farSum/Math.max(1,farCount),localChangedFraction:localChanged/localCount,scale};
  },{a:`data:image/png;base64,${first.toString('base64')}`,b:`data:image/png;base64,${second.toString('base64')}`,center,radius});
}
async function isolateField(page, size, name) {
  check(`${name}: dev-only diagnostic exists`, await page.evaluate(()=>typeof window.rhine.debugGalaxy==='function'));
  await debug(page,{freezeCamera:true,freezeTime:true,resetFlow:true});
  const css = await page.addStyleTag({content:'.sm-root{visibility:hidden!important}'});
  await page.mouse.move(-25,-25);
  await page.waitForTimeout(100);
  const camera = (await stats(page)).galaxy.camera;
  const baseline = await page.screenshot({path:`${output}/${name}-field-rest.png`});
  const host = await page.locator('.galaxy-webgl').boundingBox();
  const center = {x:host.x+host.width*.38,y:host.y+host.height*.57};
  // A stationary pointer is no longer a radial lens. Move existing material by
  // injecting a short real path, then inspect the stored velocity/displacement.
  await pointerPath(page,Array.from({length:13},(_,i)=>({x:center.x-96+i*8,y:center.y})),25);
  const live = (await stats(page)).galaxy;
  check(`${name}: field uses CSS coordinates independent of DPR`, Math.hypot(live.field.cssPointer.x-(center.x-host.x),live.field.cssPointer.y-(center.y-host.y))<5);
  check(`${name}: independent persistent field is driven while camera is frozen`, live.field.active&&live.field.enabled&&live.field.injectionCount>0&&live.field.energy>0&&live.field.cameraFrozen);
  check(`${name}: the former lens and newly generated decorative trails are absent`,live.field.oldRefraction===false&&live.field.decorativeTrails===false);
  check(`${name}: camera remains still`, Math.hypot(camera.x-live.camera.x,camera.y-live.camera.y,camera.z-live.camera.z)<.001);
  const active = await page.screenshot({path:`${output}/${name}-field-active.png`});
  const pixels = await pixelDifference(page,baseline,active,center,live.field.radiusPx);
  report.measurements[`${name}-isolation`] = {pixels,field:live.field,viewport:size};
  check(`${name}: frozen sky changes over a broad local region`, pixels.localMean>.35&&pixels.localChangedFraction>.025);
  check(`${name}: deformation is local rather than a full-screen move`, pixels.farMean<pixels.localMean*.35+.15);
  const rightward=[];for(let i=0;i<=16;i++)rightward.push({x:center.x-100+i*12.5,y:center.y});
  await pointerPath(page,rightward,30);
  const right=(await stats(page)).galaxy.field;
  const rightProbe=(await debug(page,{probe:right.cssPointer})).sample;
  await pointerPath(page,rightward.toReversed(),12);
  const left=(await stats(page)).galaxy.field;
  const leftProbe=(await debug(page,{probe:left.cssPointer})).sample;
  check(`${name}: direction responds to rapid reversal`, right.velocity.x>0&&left.velocity.x<0);
  // Stored displacement retains its history. New force reverses velocity, not
  // the already displaced texture instantaneously as the old lens did.
  check(`${name}: persistent material velocity responds to the changed direction`,rightProbe.velocity.x>0&&leftProbe.velocity.x<0&&left.injectionCount>right.injectionCount);
  const circle=[];for(let i=0;i<=28;i++)circle.push({x:center.x+45*Math.cos(i/28*Math.PI*2),y:center.y+45*Math.sin(i/28*Math.PI*2)});
  await pointerPath(page,circle,20);
  const moving=(await stats(page)).galaxy.field;
  await page.waitForTimeout(1050);
  const dwell=(await stats(page)).galaxy.field;
  check(`${name}: dwell stops injection while stored motion decays`, Math.hypot(dwell.velocity.x,dwell.velocity.y)<1&&dwell.injectionCount===moving.injectionCount&&dwell.energy<moving.energy&&dwell.maxDisplacementPx>0);
  await page.mouse.move(-25,-25);
  await page.waitForTimeout(120);
  const afterLeave=(await stats(page)).galaxy.field;
  check(`${name}: leaving preserves the old region's stored movement`,!afterLeave.active&&afterLeave.injectionCount===dwell.injectionCount&&afterLeave.energy>0&&afterLeave.maxDisplacementPx>0);
  await page.waitForTimeout(2800);
  const departed=(await stats(page)).galaxy.field;
  check(`${name}: leaving damps stored energy without moving input to center`, departed.energy<afterLeave.energy*.1&&!departed.active&&Math.hypot(departed.cssPointer.x-dwell.cssPointer.x,departed.cssPointer.y-dwell.cssPointer.y)<5);
  check(`${name}: material speed and displacement stay within their budgets`,[live.field,right,left,moving,dwell,afterLeave,departed].every(field=>Number.isFinite(field.energy)&&field.maxSpeedPx<=field.velocityLimitPx+.01&&field.maxDisplacementPx<=field.displacementLimitPx+.01));
  report.measurements[`${name}-continuous`] = {right,left,rightProbe,leftProbe,moving,dwell,afterLeave,departed};
  await shot(page,`${name}-field-restored`);
  await css.evaluate(el=>el.remove());
  await debug(page,{freezeCamera:false,freezeTime:false});
}
try {
  const desktop=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});watch(desktop);
  await login(desktop,'desktop');
  if(!production)await isolateField(desktop,{width:1920,height:1080,dpr:1},'desktop');
  const ids=['ai','robotics','interaction','visual','xr','hardware','core','project','competition','salon','portfolio','join'];
  const signatures=[];
  const visualPresets=[];
  for(const id of ids){const svg=desktop.locator(`[data-star="${id}"] .sm-galaxy-vector`);const signature=await glyphSignature(svg);signatures.push(signature);check(`${id}: meaningful vector structure`,await svg.locator('path,circle,ellipse,polygon,line,polyline').count()>5);}
  for(const id of ids){const visual=desktop.locator(`[data-star="${id}"] .sm-node-visual`);const data=await visual.evaluate(el=>({...el.dataset}));visualPresets.push(data.visualPreset);check(`${id}: explicit stable visual and motion identity`,Boolean(data.visualPreset&&data.motionPreset&&data.visualSeed));}
  check('Twelve explicit visual presets rather than seed-only variants',new Set(visualPresets).size===12);
  check('All twelve enabled nodes have distinct SVG structure',new Set(signatures).size===12);
  check('SVG instances have no duplicate IDs',await desktop.evaluate(()=>{const ids=[...document.querySelectorAll('.sm-root svg [id]')].map(el=>el.id);return new Set(ids).size===ids.length;}));
  await shot(desktop,'all-node-identities');
  await desktop.evaluate(()=>{
    const atlas=document.createElement('div');atlas.id='test-visual-atlas';atlas.style.cssText='position:fixed;inset:0;z-index:99999;background:#050a16;display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(3,1fr);gap:12px;padding:18px;pointer-events:none';
    for(const source of document.querySelectorAll('.sm-star')){const cell=document.createElement('div');cell.style.cssText='position:relative;border:1px solid #28334b;display:grid;place-content:center;justify-items:center;color:white;font:16px sans-serif';const clone=source.cloneNode(true);clone.style.cssText+=';position:relative;left:auto;top:auto;transform:none;width:220px;height:220px;margin:0';const glyph=clone.querySelector('.sm-star-glyph');if(glyph)glyph.style.cssText+=';position:absolute;inset:0;width:220px;height:220px;transform:none';clone.querySelectorAll('.sm-star-label,.sm-star-hover').forEach(el=>el.remove());const title=document.createElement('div');title.textContent=source.getAttribute('aria-label')||source.dataset.star;cell.append(clone,title);atlas.append(cell);}document.body.append(atlas);
  });
  await shot(desktop,'twelve-preset-atlas');
  await desktop.locator('#test-visual-atlas').evaluate(el=>el.remove());
  for(const id of ['ai','robotics','xr','portfolio','join']){
    const node=desktop.locator(`[data-star="${id}"]`),origin=await glyphSignature(node.locator('.sm-galaxy-vector'));
    await node.click();await desktop.waitForTimeout(230);
    check(`${id}: flight retains the origin vector`,await glyphSignature(desktop.locator('.sm-voyager-glyph .sm-galaxy-vector'))===origin);
    await shot(desktop,`${id}-flight`);await ready(desktop);
    check(`${id}: detail retains the origin vector`,await glyphSignature(desktop.locator('.sm-voyager-glyph .sm-galaxy-vector'))===origin);
    await shot(desktop,`${id}-detail`);
    if(!production){const prior=(await stats(desktop)).galaxy.field.injectionCount;await desktop.mouse.move(600,500);await desktop.waitForTimeout(350);const field=(await stats(desktop)).galaxy.field;check(`${id}: reading stops new background force`,!field.enabled&&field.injectionCount===prior);}
    await desktop.keyboard.press('Escape');await closed(desktop);
    check(`${id}: return restores keyboard focus`,await node.evaluate(el=>document.activeElement===el));
    check(`${id}: return preserves home identity`,await glyphSignature(node.locator('.sm-galaxy-vector'))===origin);
  }
  await desktop.locator('[data-star="robotics"]').click();await desktop.waitForTimeout(160);await desktop.keyboard.press('Escape');await desktop.keyboard.press('Escape');await closed(desktop);
  check('Early repeated Escape releases modal input',await desktop.locator('.sm-home').evaluate(el=>!el.inert));
  await desktop.locator('.sm-empty').first().click();check('Dormant stars remain unavailable',await desktop.locator('.sm-modal').isHidden());
  await desktop.locator('.sm-tools [data-action="replay"]').click();
  await desktop.locator('#ixd-account').waitFor({state:'visible'});
  await desktop.waitForFunction(()=>window.rhine?.stats().experience?.phase==='login');
  check('Replay requires a fresh login',await desktop.locator('#ixd-password').inputValue()==='');
  await desktop.locator('#ixd-account').fill('ixd-demo');await desktop.locator('#ixd-password').fill('ixd2026');await desktop.locator('.identity-submit').click();
  await desktop.waitForFunction(()=>window.rhine.stats().experience.phase==='bridge');
  await desktop.locator('.ixd-portal-skip').click();
  await desktop.waitForFunction(()=>window.rhine.stats().experience.phase==='galaxy');
  check('Skipping bridge lands on complete interactive homepage',await desktop.locator('.sm-home').evaluate(el=>!el.inert)&&await desktop.locator('.ixd-portal').isHidden());
  await desktop.locator('[data-star="core"]').click();await ready(desktop);await desktop.keyboard.press('Escape');await closed(desktop);
  if(!production){
    for(const item of [{width:1366,height:768,dpr:1.25},{width:390,height:844,dpr:2}]){
      const page=await browser.newPage({viewport:{width:item.width,height:item.height},deviceScaleFactor:item.dpr});watch(page);
      await login(page,`${item.width}`);await isolateField(page,item,`${item.width}`);
      check(`${item.width}: no horizontal document overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.close();
    }
  }
  for(const mode of ['reduced','no-webgl']){
    const page=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:mode==='reduced'?'reduce':'no-preference'});watch(page,mode==='no-webgl');
    if(mode==='no-webgl')await page.addInitScript(()=>{const getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl'||type==='webgl2'||type==='experimental-webgl'?null:getContext.call(this,type,...args);};});
    await page.goto(base);await page.locator('#ixd-account').waitFor({state:'visible'});await page.waitForFunction(()=>window.rhine?.stats().experience?.phase==='login');await page.locator('#ixd-account').fill('ixd-demo');await page.locator('#ixd-password').fill('ixd2026');await page.locator('.identity-submit').click();
    await page.waitForFunction(()=>window.rhine?.stats().experience?.phase==='galaxy');
    const state=await stats(page);check(`${mode}: login and portal finish in a usable scene`,await page.locator('.sm-home').evaluate(el=>!el.inert));
    if(mode==='reduced')check('Reduced motion selects a short bridge',state.bridgeDuration<.5&&state.galaxy.reduced);
    else check('WebGL failure selects explicit static galaxy fallback',state.galaxy.renderer==='static'&&await page.locator('.galaxy-static-sky').isVisible());
    await page.locator('[data-star="join"]').click();await ready(page);check(`${mode}: fallback navigation still works`,await page.locator('.sm-close').isVisible());await shot(page,`${mode}-detail`);await page.keyboard.press('Escape');await closed(page);await page.close();
  }
  report.measurements.performance=await desktop.evaluate(()=>new Promise(resolve=>{const intervals=[];let prior=performance.now();const frame=time=>{intervals.push(time-prior);prior=time;if(intervals.length<180)requestAnimationFrame(frame);else {const sorted=intervals.slice(20).sort((a,b)=>a-b);resolve({measurement:'requestAnimationFrame intervals, not GPU time',samples:sorted.length,medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)]});}};requestAnimationFrame(frame);}));
  check('No page exceptions',report.errors.length===0);check('No console errors',report.consoleErrors.length===0);
}catch(error){report.failure=String(error.stack||error);const page=browser.contexts().flatMap(c=>c.pages()).at(-1);if(page){await shot(page,'failure').catch(()=>{});report.failureState=await stats(page).catch(()=>null);}throw error;}
finally{await writeFile(`${output}/results.json`,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({checks:report.checks.length,failure:report.failure,errors:report.errors,consoleErrors:report.consoleErrors,output},null,2));}
