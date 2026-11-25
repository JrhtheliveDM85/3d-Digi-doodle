// Buyer-path check. Builds the shop zip, unpacks it, and drives that copy.
//   node tests/sale-check.mjs
// Leaves screenshots in /opt/cursor/artifacts and a JSON report on stdout.

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = '/opt/cursor/artifacts';
const PORT = '8877';
const DEBUG = 9444;
const problems = [];
const notes = [];
function fail(msg) { problems.push(msg); console.error('FAIL', msg); }
function ok(msg) { console.log('ok  ', msg); }
function note(msg) { notes.push(msg); console.log('note', msg); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
  });
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', reject);
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  async send(method, params = {}, timeoutMs = 60000) {
    await this.ready;
    const id = ++this.id;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('timeout ' + method)); }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    return result;
  }
  async eval(expression, timeoutMs = 90000) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (result.exceptionDetails) {
      const d = result.exceptionDetails;
      throw new Error((d.exception?.description || d.text || 'eval error').slice(0, 1500));
    }
    return result.result?.value;
  }
  async shot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log('shot', file);
  }
}

function b64ToFile(b64, file) {
  writeFileSync(file, Buffer.from(b64, 'base64'));
}

async function waitForApp(cdp) {
  const status = await cdp.eval(`(async () => {
    for (let i = 0; i < 80; i++) {
      if (window.ClayBlocks && window.ClayBlocks.scene) return 'ready';
      await new Promise((r) => setTimeout(r, 100));
    }
    return 'missing';
  })()`);
  if (status !== 'ready') throw new Error('app did not start');
}

async function run() {
  mkdirSync(ART, { recursive: true });
  execFileSync('python3', ['scripts/make-shop-zip.py'], { cwd: ROOT, stdio: 'inherit' });
  const buyer = mkdtempSync(path.join(tmpdir(), 'clay-buyer-'));
  execFileSync('unzip', ['-q', path.join(ROOT, 'dist/Clay-Blocks.zip'), '-d', buyer]);
  const must = [
    'index.html', 'INSTALL.md', 'LICENCE.md', 'README.md', 'CREDITS.md', 'serve.py',
    'sw.js', 'manifest.webmanifest',
    'fonts/AtkinsonHyperlegible-Regular.ttf', 'fonts/AtkinsonHyperlegible-Bold.ttf', 'fonts/OFL.txt',
    'vendor/three.module.js', 'vendor/fflate.module.js', 'vendor/three-bvh-csg.module.js',
    'vendor/LICENSES/three.js-LICENSE', 'vendor/LICENSES/fflate-LICENSE',
    'vendor/LICENSES/three-mesh-bvh-LICENSE', 'vendor/LICENSES/three-bvh-csg-LICENSE',
    'js/exporters.js', 'js/printcheck.js',
  ];
  const missing = must.filter((n) => !existsSync(path.join(buyer, n)));
  if (missing.length) fail('shop zip is missing ' + missing.join(', '));
  else ok('shop zip has the app, guide, licence, font, and library notices');
  const packText = readFileSync(path.join(buyer, 'INSTALL.md'), 'utf8')
    + readFileSync(path.join(buyer, 'js/printcheck.js'), 'utf8')
    + readFileSync(path.join(buyer, 'index.html'), 'utf8');
  if (/tinkercad|autodesk/i.test(packText)) fail('shop pack names another modeller');
  else ok('shop pack does not use another modeller name');

  const server = spawn('python3', ['serve.py'], { cwd: buyer, env: { ...process.env, PORT }, stdio: 'ignore' });
  const userDir = `/tmp/clay-sale-chrome-${process.pid}`;
  const chrome = spawn('google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${userDir}`,
    '--window-size=1280,900', '--no-first-run', 'about:blank',
  ], { stdio: 'ignore' });
  const outDir = mkdtempSync(path.join(tmpdir(), 'clay-files-'));

  try {
    for (let i = 0; i < 40; i++) {
      try { await getJson(`http://127.0.0.1:${PORT}/manifest.webmanifest`); break; }
      catch { if (i === 39) throw new Error('buyer server did not start'); await sleep(150); }
    }
    let page;
    for (let i = 0; i < 40; i++) {
      try {
        const list = await getJson(`http://127.0.0.1:${DEBUG}/json/list`);
        page = list.find((t) => t.type === 'page');
        if (page) break;
      } catch { /* chrome still starting */ }
      await sleep(150);
    }
    if (!page) throw new Error('no chrome page');
    const cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    await sleep(400);
    await waitForApp(cdp);
    ok('unpacked shop copy opened in Chrome');

    const made = await cdp.eval(`(async () => {
      const $ = (s) => document.querySelector(s);
      const scene = window.ClayBlocks.scene;
      const { exportSTL, export3MF, analyzeSurface } = window.ClayBlocks;
      const b64 = (bytes) => {
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
      };
      const bounds = (stl) => {
        const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
        const tri = view.getUint32(80, true);
        const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
        let o = 84;
        for (let t = 0; t < tri; t++) {
          o += 12;
          for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) {
            const n = view.getFloat32(o, true);
            if (n < min[k]) min[k] = n;
            if (n > max[k]) max[k] = n;
            o += 4;
          }
          o += 2;
        }
        return { tri, min, max };
      };

      scene.reset();
      scene.addShape('box');
      const boxStl = exportSTL(scene.getExportGeometry());
      const box3 = export3MF(scene.getExportGeometry());
      const boxBounds = bounds(boxStl);

      scene.reset();
      scene.addShape('box');
      const width = $('#selected-card input[data-axis="x"]');
      width.value = '300';
      width.dispatchEvent(new Event('change'));
      $('#tool-print').click();
      const tooBig = $('#print-checks').innerText;
      $('#print-close').click();

      scene.reset();
      scene.addShape('box');
      scene.addShape('cylinder');
      const solid2 = scene.shapesGroup.children[0];
      const hole2 = scene.shapesGroup.children[1];
      hole2.userData.isHole = true;
      hole2.position.copy(solid2.position);
      $('#btn-makeclay').click();
      const skin = analyzeSurface(scene.getExportGeometry());
      const rawSkin = null;
      $('#tool-print').click();
      const card = $('#print-checks').innerText;
      const heading = $('#print-overlay h2').textContent;
      const surfaceBtn = [...document.querySelectorAll('#print-checks .check')].some((el) => /gap|faces|promise|separate pieces/i.test(el.innerText) && el.querySelector('button'));
      const holeStl = exportSTL(scene.getExportGeometry());
      const hole3 = export3MF(scene.getExportGeometry());
      $('#print-close').click();
      document.querySelector('#resume-overlay')?.classList.remove('show');
      scene._resize();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return {
        boxBounds,
        tooBig,
        rawSkin,
        skin,
        card,
        heading,
        surfaceBtn,
        page: document.body.innerText,
        boxStl: b64(boxStl),
        box3: b64(box3),
        holeStl: b64(holeStl),
        hole3: b64(hole3),
      };
    })()`);

    b64ToFile(made.boxStl, path.join(outDir, 'box.stl'));
    b64ToFile(made.box3, path.join(outDir, 'box.3mf'));
    b64ToFile(made.holeStl, path.join(outDir, 'hole.stl'));
    b64ToFile(made.hole3, path.join(outDir, 'hole.3mf'));
    note('skin after Make it clay ' + JSON.stringify(made.skin));

    const bb = made.boxBounds;
    const height = bb.max[2] - bb.min[2];
    if (Math.abs(bb.min[2]) > 0.5 || height < 30 || height > 50) fail('plain box STL is not standing on Z=0: ' + JSON.stringify(bb));
    else ok('plain box STL is Z-up and sits on the bed (height ' + height.toFixed(1) + ' mm)');
    if (!/too big/i.test(made.tooBig) || !/256/.test(made.tooBig) || !/260/.test(made.tooBig) || !/X2D/.test(made.tooBig)) {
      fail('size warning does not name the X2D bed: ' + made.tooBig.slice(0, 240));
    } else ok('a 300 mm shape is told it is too big for the 256 x 256 x 260 mm bed');
    if (/ready to print|watertight|tinkercad|autodesk/i.test(made.page)) fail('the screen over-claims or uses a forbidden name');
    else ok('the screen does not say the model is ready to print');
    if (!/Print check/.test(made.heading)) fail('print heading is ' + made.heading);
    if (made.surfaceBtn) fail('the skin note offered a fix button');
    else ok('the skin note has no Fix it for me button');
    if (!/not a promise that the skin is fully closed/i.test(made.card)) fail('print card hid the limit of the check: ' + made.card.slice(0, 400));
    else ok('print card says the check is not a promise the skin is closed');

    await cdp.shot(path.join(ART, 'desktop_model_with_hole.png'));
    await cdp.eval(`document.querySelector('#tool-print').click()`);
    await cdp.shot(path.join(ART, 'print_check_on_screen.png'));
    await cdp.eval(`document.querySelector('#print-close').click()`);

    // Phone-sized screen.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 2, mobile: true });
    await cdp.eval(`window.dispatchEvent(new Event('resize')); window.ClayBlocks.scene._resize();`);
    await sleep(200);
    await cdp.shot(path.join(ART, 'phone_360_layout.png'));
    const phone = await cdp.eval(`(() => {
      const scene = window.ClayBlocks.scene;
      scene.reset();
      document.querySelector('#tool-shapes').click();
      document.querySelector('#page-shapes [data-shape="box"]').click();
      const canvas = document.querySelector('#view').getBoundingClientRect();
      const tools = [...document.querySelectorAll('#toolbar .toolbtn')].map((b) => {
        const r = b.getBoundingClientRect();
        return { text: b.innerText.replace(/\\s+/g, ' ').trim(), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
      });
      const clay = document.querySelector('#btn-makeclay');
      clay.scrollIntoView({ block: 'nearest' });
      const cr = clay.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.min(window.innerWidth - 4, cr.left + cr.width / 2), cr.top + Math.min(24, cr.height / 2));
      const shapeBtn = document.querySelector('#page-shapes [data-shape="box"]');
      shapeBtn.scrollIntoView({ block: 'nearest' });
      const shape = shapeBtn.getBoundingClientRect();
      const font = parseFloat(getComputedStyle(document.body).fontSize);
      return {
        canvasH: Math.round(canvas.height),
        canvasW: Math.round(canvas.width),
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        font,
        tools,
        clayShown: getComputedStyle(document.querySelector('#clay-cta')).display !== 'none',
        clayHit: hit === clay || (hit && clay.contains(hit)),
        clayTop: Math.round(cr.top),
        clayH: Math.round(cr.height),
        clayParent: document.querySelector('#clay-cta').parentElement.id,
        hit: hit ? (hit.id || hit.className || hit.tagName) : 'none',
        shapeTop: Math.round(shape.top),
        shapeHit: (() => {
          const el = document.elementFromPoint(shape.left + shape.width / 2, shape.top + 20);
          return el && (el === document.querySelector('#page-shapes [data-shape="box"]') || document.querySelector('#page-shapes [data-shape="box"]').contains(el));
        })(),
        shapeVisible: shape.height >= 44,
      };
    })()`);
    note('phone layout ' + JSON.stringify(phone));
    await cdp.shot(path.join(ART, 'phone_shapes.png'));
    if (phone.canvasH < 100) fail('on a 360x640 screen the 3D view is only ' + phone.canvasH + ' px tall');
    else ok('on a 360x640 screen the 3D view is ' + phone.canvasH + ' px tall');
    if (phone.scrollW > phone.innerW + 2) fail('phone page scrolls sideways (' + phone.scrollW + ' > ' + phone.innerW + ')');
    else ok('phone page does not scroll sideways');
    if (phone.font < 16) fail('phone text is ' + phone.font + ' px');
    else ok('phone text is ' + phone.font + ' px');
    const tiny = phone.tools.filter((t) => t.w < 44 || t.h < 44);
    if (tiny.length) fail('phone tools are smaller than 44 px: ' + JSON.stringify(tiny));
    else ok('phone tool buttons are at least 44 px');
    if (!phone.shapeHit) fail('shape buttons are covered on the phone: ' + JSON.stringify(phone));
    else ok('shape buttons are on the phone screen');
    if (phone.clayShown && !phone.clayHit) fail('Make it clay is covered by another control: ' + JSON.stringify(phone));
    else ok('Make it clay can be pressed on the phone');

    await cdp.eval(`document.querySelector('#tool-print').click()`);
    await cdp.shot(path.join(ART, 'phone_print_card.png'));
    const sheet = await cdp.eval(`(() => {
      const sheet = document.querySelector('#print-overlay .sheet');
      const buttons = [...sheet.querySelectorAll('button')].map((b) => {
        const r = b.getBoundingClientRect();
        return { text: b.innerText.replace(/\\s+/g, ' ').trim(), h: Math.round(r.height), w: Math.round(r.width) };
      });
      return { scroll: sheet.scrollHeight > sheet.clientHeight + 4, buttons };
    })()`);
    const smallBtn = sheet.buttons.filter((b) => b.h < 44 || b.w < 80);
    if (smallBtn.length) fail('print-card buttons are hard to press on a phone: ' + JSON.stringify(smallBtn));
    else ok('print-card buttons stay big on a phone' + (sheet.scroll ? ' (the card scrolls)' : ''));
    await cdp.eval(`document.querySelector('#print-close').click()`);

    // Offline from the installed cache, server stopped.
    const sw = await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
      .then(() => cdp.eval(`(async () => {
        const reg = await navigator.serviceWorker.ready;
        const names = await caches.keys();
        return { active: !!reg.active, names };
      })()`));
    if (!sw.active || !sw.names.includes('clay-blocks-v3')) fail('service worker cache is ' + JSON.stringify(sw.names));
    else ok('service worker cache is clay-blocks-v3');

    server.kill();
    let down = false;
    for (let i = 0; i < 20; i++) {
      try { await getJson(`http://127.0.0.1:${PORT}/manifest.webmanifest`); }
      catch { down = true; break; }
      await sleep(150);
    }
    if (!down) fail('could not stop the server for the offline check');
    try { await cdp.eval(`location.reload()`); } catch { /* navigation drops the old page */ }
    await sleep(800);
    const list = await getJson(`http://127.0.0.1:${DEBUG}/json/list`);
    const again = list.find((t) => t.type === 'page' && String(t.url || '').includes('127.0.0.1')) || list.find((t) => t.type === 'page');
    const cdp2 = new CDP(again.webSocketDebuggerUrl);
    await cdp2.ready;
    await cdp2.send('Runtime.enable');
    await waitForApp(cdp2);
    const offline = await cdp2.eval(`(() => {
      const scene = window.ClayBlocks.scene;
      scene.reset();
      scene.addShape('sphere');
      const stl = window.ClayBlocks.exportSTL(scene.getExportGeometry());
      return { title: document.title, tris: new DataView(stl.buffer, stl.byteOffset, stl.byteLength).getUint32(80, true) };
    })()`);
    if (offline.title !== 'Clay Blocks' || offline.tris < 10) fail('offline reload failed: ' + JSON.stringify(offline));
    else ok('with the server stopped, the page still makes a ball and an STL (' + offline.tris + ' triangles)');

    for (const [stl, mf, label] of [
      ['box.stl', 'box.3mf', 'plain box'],
      ['hole.stl', 'hole.3mf', 'box with a round hole'],
    ]) {
      try {
        const report = execFileSync('python3', [
          path.join(ROOT, 'tests/check_export.py'),
          path.join(outDir, stl),
          path.join(outDir, mf),
        ], { encoding: 'utf8' });
        note(label + ' file check ' + report.trim().replace(/\n/g, ' '));
        ok(label + ' STL and 3MF are valid Z-up files with a positive volume');
      } catch (err) {
        fail(label + ' file check failed: ' + (err.stdout || err.stderr || err.message));
      }
    }
  } finally {
    chrome.kill();
    try { server.kill(); } catch { /* already stopped */ }
  }

  if (problems.length) {
    console.error('\n' + problems.length + ' problem(s).');
    process.exit(1);
  }
  console.log('\nSale check passed.');
}

run().catch((err) => { console.error(err); process.exit(1); });
