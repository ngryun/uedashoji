// Isolated browser smoke test. Requires local emulators (demo-ueda-traces), the static server on 8736 and Playwright.
// Clears only demo emulator documents; Firebase configuration is intercepted in these browser contexts.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = process.env.TRACE_SCREENSHOTS || os.tmpdir();
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}), headless: true,
    args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    async function makePage(mobile = false) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
        hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 1 });
      await context.route('**/firebase-config.js', route => route.fulfill({ contentType: 'text/javascript', body: `export const FIREBASE_ENABLED = true;
        export const firebaseConfig = { apiKey:'demo-key', projectId:'demo-ueda-traces', authDomain:'demo-ueda-traces.firebaseapp.com' };` }));
      await context.route('**/social.js', route => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(root, 'social.js'), 'utf8')
        .replace('const db = fs.getFirestore(app);', "const db = fs.getFirestore(app); fs.connectFirestoreEmulator(db, '127.0.0.1', 8085);")
        .replace('const auth = authMod.getAuth(app);', "const auth = authMod.getAuth(app); authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9095', { disableWarnings: true });") }));
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', msg => { if (msg.type() === 'error' && /shader|WebGLProgram/.test(msg.text())) errors.push(msg.text()); });
      await page.goto((process.env.TRACE_TEST_URL || 'http://127.0.0.1:8736/') + (mobile ? '?touch=1' : ''), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__m?.visitorTraces && !document.querySelector('#enterBtn').disabled);
      return page;
    }
    await fetch('http://127.0.0.1:8085/emulator/v1/projects/demo-ueda-traces/databases/(default)/documents', { method: 'DELETE' });
    const a = await makePage();
    await a.screenshot({ path: path.join(output, 'ueda-traces-start.png') });
    await a.click('#enterBtn');
    await a.evaluate(async () => { const social = await import('/social.js'); await social.initSocial(); if (!social.canShareVisitorTraces()) throw Error('Emulator auth failed'); });
    // Start away from the central mascot and benches, then walk with real keyboard input.
    await a.evaluate(() => window.__m.tp(-2, 10, 0));
    await a.keyboard.down('KeyW');
    await a.evaluate(() => __m.step(75));
    await a.keyboard.up('KeyW');
    await a.waitForFunction(() => JSON.parse(sessionStorage.getItem('guest.traces.visit.v1'))?.rooms?.[0]?.count >= 1);
    await a.waitForFunction(() => __m.visitorTraces.mesh.count >= 6);
    await a.evaluate(() => { const m = window.__m; m.player.yaw = Math.PI; m.player.pitch = -.7; });
    await a.waitForTimeout(1000);
    await a.screenshot({ path: path.join(output, 'ueda-traces-desktop.png') });
    const before = await a.evaluate(() => ({ count: __m.visitorTraces.mesh.count, visit: JSON.parse(sessionStorage.getItem('guest.traces.visit.v1')), status: document.querySelector('#traceStatus').textContent }));
    const savedUrl = `http://127.0.0.1:8085/v1/projects/demo-ueda-traces/databases/(default)/documents/visitorTraces/${before.visit.id}-0-0`;
    let saved = false;
    for (let attempt = 0; attempt < 100 && !saved; attempt++) {
      const response = await fetch(savedUrl);
      saved = response.ok && Boolean((await response.json()).fields?.points);
      if (!saved) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!saved) throw Error('The walk was not committed to the emulator');
    await a.context().close();
    const b = await makePage(true);
    await b.screenshot({ path: path.join(output, 'ueda-traces-mobile-start.png') });
    await b.click('#enterBtn');
    await b.evaluate(async () => { await (await import('/social.js')).initSocial(); });
    await b.waitForFunction(() => window.__m.visitorTraces.mesh.count >= 6, null, { timeout: 20000 });
    await b.evaluate(() => { __m.tp(-2, 3, Math.PI); __m.player.pitch = -.7; });
    await b.waitForTimeout(1000);
    await b.screenshot({ path: path.join(output, 'ueda-traces-mobile.png') });
    const shared = await b.evaluate(() => ({ count: __m.visitorTraces.mesh.count, status: document.querySelector('#traceStatus').textContent,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      hudOverlapsFloor: document.querySelector('#hudLeft').getBoundingClientRect().bottom > document.querySelector('#floorNav').getBoundingClientRect().top }));
    await b.click('#traceHudBtn');
    await b.reload({ waitUntil: 'domcontentloaded' }); await b.waitForFunction(() => window.__m?.visitorTraces);
    const preference = await b.locator('#traceToggle').isChecked();
    await b.click('#galleryBtn');
    await b.waitForFunction(() => !document.querySelector('#galleryPanel').hidden);
    assert.ok(await b.locator('.galleryCard').count() > 0);
    await b.click('#galleryClose');
    await b.click('#guestbookBtn');
    await b.waitForFunction(() => !document.querySelector('#guestbookPanel').hidden);
    await b.fill('#gbMessage', 'Footprint integration test');
    assert.equal(await b.locator('#gbMessage').inputValue(), 'Footprint integration test');
    await b.click('#guestbookClose');
    await b.setViewportSize({ width: 320, height: 667 });
    await b.locator('#traceToggle').scrollIntoViewIfNeeded();
    assert.ok(await b.locator('#traceToggle').isVisible());
    assert.equal(await b.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    console.log(JSON.stringify({ before, shared, preference, galleryAndGuestbook: 'passed', smallScreen: 'passed', errors }));
    if (errors.length || shared.count < 6 || preference || shared.horizontalOverflow || shared.hudOverlapsFloor) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
