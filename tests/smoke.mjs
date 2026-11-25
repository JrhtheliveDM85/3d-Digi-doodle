// Headless check for Clay Blocks. Run with the server already up:
//   PORT=8765 python3 serve.py
//   node tests/smoke.mjs
// Or just: node tests/smoke.mjs
// It can start the server itself when SMOKE_URL is not set.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || '8765';
const BASE = process.env.SMOKE_URL || `http://127.0.0.1:${PORT}/`;
const CHROME = process.env.CHROME || 'google-chrome';

const problems = [];
function fail(msg) { problems.push(msg); console.error('FAIL', msg); }
function ok(msg) { console.log('ok  ', msg); }

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
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
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  async send(method, params = {}, timeoutMs = 60000) {
    await this.ready;
    const id = ++this.id;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('timeout ' + method));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    return result;
  }
  async eval(expression, timeoutMs = 60000) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, timeoutMs);
    if (result.exceptionDetails) {
      const d = result.exceptionDetails;
      const text = d.exception?.description || d.text || JSON.stringify(d);
      throw new Error(text.slice(0, 2000));
    }
    return result.result?.value;
  }
}

async function waitForApp(cdp) {
  const status = await cdp.eval(`(async () => {
    for (let i = 0; i < 80; i++) {
      if (window.ClayBlocks && window.ClayBlocks.scene) return 'ready';
      await new Promise((r) => setTimeout(r, 100));
    }
    return 'missing';
  })()`);
  if (status !== 'ready') throw new Error('Clay Blocks did not start');
}

async function startServer() {
  const child = spawn('python3', ['serve.py'], {
    cwd: ROOT,
    env: { ...process.env, PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => { log += b; });
  child.stderr.on('data', (b) => { log += b; });
  for (let i = 0; i < 40; i++) {
    try {
      await getJson(`http://127.0.0.1:${PORT}/manifest.webmanifest`);
      return child;
    } catch {
      if (child.exitCode != null) throw new Error('server exited\n' + log);
      await sleep(150);
    }
  }
  child.kill();
  throw new Error('server did not start\n' + log);
}

async function startChrome() {
  const debugPort = 9333;
  const userDir = `/tmp/clay-chrome-${process.pid}`;
  const child = spawn(CHROME, [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDir}`,
    '--window-size=1280,900',
    '--no-first-run',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stderr.on('data', (b) => { log += b; });
  child.stdout.on('data', (b) => { log += b; });
  for (let i = 0; i < 40; i++) {
    try {
      const version = await getJson(`http://127.0.0.1:${debugPort}/json/version`);
      const list = await getJson(`http://127.0.0.1:${debugPort}/json/list`);
      const page = list.find((t) => t.type === 'page');
      return { child, version, page, log, debugPort };
    } catch {
      if (child.exitCode != null) throw new Error('chrome exited\n' + log);
      await sleep(150);
    }
  }
  child.kill();
  throw new Error('chrome did not open a debug port\n' + log);
}

async function run() {
  let server = null;
  let chrome = null;
  if (!process.env.SMOKE_URL) server = await startServer();
  try {
    const started = await startChrome();
    chrome = started.child;
    const debugPort = started.debugPort;
    console.log('chrome', started.version.Browser);
    let cdp = new CDP(started.page.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
    });

    await cdp.send('Page.navigate', { url: BASE });
    await sleep(500);
    await waitForApp(cdp);
    ok('page loaded and the app started');

    const boot = await cdp.eval(`(() => {
      const text = document.body.innerText;
      const banned = /tinkercad|autodesk|watertight/i.test(text);
      const tools = [...document.querySelectorAll('#toolbar .toolbtn')].map((b) => ({
        label: b.innerText.replace(/\\s+/g, ' ').trim(),
        speak: b.getAttribute('data-speak'),
        h: Math.round(b.getBoundingClientRect().height),
      }));
      return {
        title: document.title,
        banner: document.querySelector('#banner').textContent,
        banned,
        tools,
        canvas: document.querySelector('#view').getBoundingClientRect().width,
      };
    })()`);
    if (boot.title !== 'Clay Blocks') fail('title is ' + boot.title);
    else ok('title is Clay Blocks');
    if (boot.banned) fail('banned name on the first screen');
    if (boot.banner !== 'You are adding shapes') fail('banner: ' + boot.banner);
    else ok('banner names the tool');
    for (const t of boot.tools) {
      if (!t.speak) fail('tool has no spoken label: ' + t.label);
      if (!/[A-Za-z]/.test(t.label)) fail('tool has no word: ' + t.label);
      if (t.h < 64) fail('tool target is small (' + t.h + '): ' + t.label);
    }
    if (boot.tools.length === 6 && problems.length === 0) ok('six big tools have an icon, a word, a spoken label, and a tall target');
    console.log('  canvas width', boot.canvas);

    // Closed box and a single open triangle: the check must tell them apart.
    const mesh = await cdp.eval(`(() => {
      const { THREE, checkModel, analyzeSurface } = window.ClayBlocks;
      const box = new THREE.BoxGeometry(20, 10, 20);
      const closed = analyzeSurface(box);
      const openGeo = new THREE.BufferGeometry();
      openGeo.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 10,0,0, 0,10,0], 3));
      const open = analyzeSurface(openGeo);
      const report = checkModel(openGeo, { isClay: true });
      const line = report.checks.find((c) => c.key === 'surface');
      return { closed, open, line };
    })()`);
    if (mesh.closed.boundary !== 0 || mesh.closed.gaps !== 0 || mesh.closed.shells !== 1) fail('a closed box was reported open: ' + JSON.stringify(mesh.closed));
    else ok('a closed box has no gaps');
    if (mesh.open.gaps !== 3) fail('an open triangle was reported closed: ' + JSON.stringify(mesh.open));
    else ok('an open triangle is reported as a gap');
    if (!mesh.line || mesh.line.fix || mesh.line.level === 'ok') fail('open skin offered a fix or a pass: ' + JSON.stringify(mesh.line));
    else if (!/cannot close/i.test(mesh.line.msg)) fail('open-edge line is unclear: ' + mesh.line.msg);
    else ok('open edges have no Fix it for me');

    // Build a model through the buttons.
    const built = await cdp.eval(`(async () => {
      const $ = (s) => document.querySelector(s);
      const scene = window.ClayBlocks.scene;
      $('#page-shapes [data-shape="box"]').click();
      const width = $('#selected-card input[data-axis="x"]');
      width.value = '300';
      width.dispatchEvent(new Event('change'));
      $('#tool-print').click();
      const before = [...document.querySelectorAll('#print-checks .check')].map((el) => ({
        level: [...el.classList].find((c) => ['ok','no','warn','note'].includes(c)),
        text: el.querySelector('.msg').textContent,
        button: el.querySelector('button') ? el.querySelector('button').textContent : '',
      }));
      const shrink = [...document.querySelectorAll('#print-checks button')].find((b) => /Fix it for me/.test(b.textContent) && /smaller/.test(b.getAttribute('data-speak') || ''));
      if (shrink) shrink.click();
      await new Promise((r) => setTimeout(r, 50));
      $('#tool-print').click();
      const afterShrink = [...document.querySelectorAll('#print-checks .check')].map((el) => ({
        level: [...el.classList].find((c) => ['ok','no','warn','note'].includes(c)),
        text: el.querySelector('.msg').textContent,
        button: el.querySelector('button') ? el.querySelector('button').textContent : '',
      }));
      $('#print-close').click();

      $('#tool-shapes').click();
      $('#page-shapes [data-shape="cylinder"]').click();
      $('#hole-toggle').click();
      const kids = scene.shapesGroup.children;
      const hole = kids[kids.length - 1];
      const solid = kids[kids.length - 2];
      hole.position.set(solid.position.x, solid.position.y, solid.position.z);
      hole.position.y = 180;
      scene._snap(hole);
      const snapped = Math.abs((hole.position.y - scene._halfH(hole)) - scene._topOf(solid)) < 0.2;
      // Put the cutter back through the solid so the join has a real overlap.
      hole.position.copy(solid.position);

      $('#btn-makeclay').click();
      const clay = { ok: scene.isClay, toast: $('#toast').textContent };
      const skin = window.ClayBlocks.analyzeSurface(scene.getExportGeometry());
      $('#tool-print').click();
      const clayReport = [...document.querySelectorAll('#print-checks .check')].map((el) => ({
        level: [...el.classList].find((c) => ['ok','no','warn','note'].includes(c)),
        text: el.querySelector('.msg').textContent,
        button: el.querySelector('button') ? el.querySelector('button').textContent : '',
        speak: el.querySelector('button') ? el.querySelector('button').getAttribute('data-speak') : '',
      }));
      const flatFix = [...document.querySelectorAll('#print-checks button')].find((b) => /Sit it on the plate/.test(b.getAttribute('data-speak') || ''));
      if (flatFix) flatFix.click();
      await new Promise((r) => setTimeout(r, 30));
      return { before, afterShrink, snapped, clay, clayReport, skin, isClay: scene.isClay };
    })()`, 90000);
    console.log('  make-clay toast:', built.clay.toast);
    console.log('  print lines:', JSON.stringify(built.clayReport, null, 2));
    console.log('  skin:', JSON.stringify(built.skin));

    const tooBig = built.before.find((r) => /too big/i.test(r.text));
    if (!tooBig || !/Fix it for me/.test(tooBig.button)) fail('too-big row did not offer Fix it for me');
    else ok('too big offers Fix it for me');
    const separate = built.before.find((r) => /still separate/i.test(r.text));
    if (!separate || !/Make it clay/.test(separate.button) || /Fix it for me/.test(separate.button)) fail('separate shapes used the wrong button: ' + JSON.stringify(separate));
    else ok('separate shapes offer Make it clay, not a fake repair');
    const fitAfter = built.afterShrink.find((r) => r.level === 'ok' && /fits the Bambu Lab X2D/.test(r.text));
    if (!fitAfter) fail('shrink did not make it fit: ' + JSON.stringify(built.afterShrink));
    else ok('Fix it for me made the model fit');
    if (!built.snapped) fail('stack snap did not sit the shape on the one below');
    else ok('shapes snap when stacked');
    if (!built.clay.ok) fail('Make it clay did not join the model: ' + built.clay.toast);
    else ok('Make it clay joined the shapes');

    const pageText = await cdp.eval(`document.body.innerText`);
    if (/tinkercad|autodesk|watertight|ready to print/i.test(pageText)) fail('print card over-claims or uses a forbidden name');
    else ok('print card avoids watertight claims and forbidden names');
    const surface = built.clayReport.find((r) => /open edge|not a promise|cannot close|cannot repair/i.test(r.text));
    if (!surface) fail('no honest surface line: ' + JSON.stringify(built.clayReport));
    else if (surface.button) fail('surface line offered a fix: ' + JSON.stringify(surface));
    else if (/Open edges:/.test(surface.text)) fail('surface line dumps an edge count: ' + surface.text);
    else ok('surface line is honest and has no fix button (' + surface.level + ')');

    // Sculpt a real stroke through the pointer path, then undo.
    const sculpt = await cdp.eval(`(async () => {
      const scene = window.ClayBlocks.scene;
      const { THREE } = window.ClayBlocks;
      scene._resize();
      const canvas = document.querySelector('#view');
      const pos = scene.clayMesh.geometry.attributes.position;
      const before = Float32Array.from(pos.array);
      let best = null;
      const ray = new THREE.Raycaster();
      for (let i = 0; i < pos.count; i += 15) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        scene.clayMesh.localToWorld(v);
        const ndc = v.clone().project(scene.camera);
        if (ndc.z > 1 || Math.abs(ndc.x) > 0.9 || Math.abs(ndc.y) > 0.9) continue;
        ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), scene.camera);
        const hit = ray.intersectObject(scene.clayMesh, false)[0];
        if (hit) { best = { i, ndc }; break; }
      }
      if (!best) return { error: 'no visible vertex', moved: 0 };
      const rect = canvas.getBoundingClientRect();
      const x = (best.ndc.x * 0.5 + 0.5) * rect.width + rect.left;
      const y = (-best.ndc.y * 0.5 + 0.5) * rect.height + rect.top;
      const fire = (type, target) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
        pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
      }));
      document.querySelector('#tool-sculpt').click();
      document.querySelector('[data-brush="pull"]').click();
      fire('pointerdown', canvas);
      fire('pointermove', canvas);
      fire('pointerup', window);
      let moved = 0;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getX(i) !== before[i * 3] || pos.getY(i) !== before[i * 3 + 1] || pos.getZ(i) !== before[i * 3 + 2]) moved++;
      }
      const banner = document.querySelector('#banner').textContent;
      const serialBeforeUndo = JSON.stringify(scene.serialize());
      document.querySelector('#tool-undo').click();
      const serialAfterUndo = JSON.stringify(scene.serialize());
      return { moved, banner, undoWorked: serialAfterUndo !== serialBeforeUndo, verts: pos.count };
    })()`);
    console.log('  sculpt moved vertices:', sculpt.moved, 'of', sculpt.verts);
    if (sculpt.error) fail(sculpt.error);
    else if (sculpt.moved < 30) fail('sculpt stroke moved too few vertices: ' + sculpt.moved);
    else ok('a pull stroke moves the clay (' + sculpt.moved + ' vertices)');
    if (sculpt.banner !== 'You are sculpting') fail('sculpt banner: ' + sculpt.banner);
    if (!sculpt.undoWorked) fail('undo did not change the model');
    else ok('undo steps back');

    // Files.
    const files = await cdp.eval(`(async () => {
      const { exportSTL, export3MF, scene } = window.ClayBlocks;
      const geo = scene.getExportGeometry();
      const stl = exportSTL(geo);
      const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
      const tri = view.getUint32(80, true);
      const header = new TextDecoder().decode(stl.slice(0, 20));
      const mf = export3MF(geo);
      const fflate = await import('fflate');
      const unzipped = fflate.unzipSync(mf);
      const names = Object.keys(unzipped);
      const xml = new TextDecoder().decode(unzipped['3D/3dmodel.model']);
      return {
        stlLen: stl.byteLength,
        tri,
        stlMath: 84 + tri * 50,
        header,
        names,
        unit: xml.includes('unit="millimeter"'),
        app: xml.includes('Clay Blocks'),
      };
    })()`);
    if (!String(files.header).startsWith('Clay Blocks STL') || files.stlLen !== files.stlMath || files.tri < 10) fail('STL check failed ' + JSON.stringify(files));
    else ok('STL is a binary file in millimetres (' + files.tri + ' triangles)');
    if (!files.unit || !files.names.includes('3D/3dmodel.model') || !files.names.includes('[Content_Types].xml')) fail('3MF check failed ' + JSON.stringify(files));
    else ok('3MF is a zip with unit="millimeter"');

    // Timeline, help, settings.
    const ui = await cdp.eval(`(async () => {
      const items = document.querySelectorAll('#timeline-strip .tl-item');
      const firstLabel = items[0] ? items[0].getAttribute('data-speak') : '';
      if (items.length > 1) items[0].click();
      document.querySelector('#btn-help').click();
      const helpRead = document.querySelector('#help-body .play')?.innerText || '';
      const helpSpeak = document.querySelector('#help-body .play')?.getAttribute('data-speak') || '';
      document.querySelector('#btn-settings').click();
      document.querySelector('#set-font').click();
      await document.fonts.load('20px "Atkinson Hyperlegible"');
      await document.fonts.load('700 20px "Atkinson Hyperlegible"');
      const fontOn = document.documentElement.getAttribute('data-font') === 'reading';
      const fontLoaded = document.fonts.check('20px "Atkinson Hyperlegible"');
      const family = getComputedStyle(document.body).fontFamily;
      document.querySelector('#set-contrast').click();
      const contrast = document.documentElement.getAttribute('data-contrast') === 'high';
      const ink = getComputedStyle(document.body).color;
      document.querySelector('#set-voice').click();
      const voice = document.querySelector('#set-voice').textContent;
      const missingSpeak = [...document.querySelectorAll('button')]
        .filter((b) => b.getClientRects().length > 0)
        .filter((b) => !b.getAttribute('data-speak') || !/[A-Za-z0-9]/.test(b.innerText || ''))
        .map((b) => (b.innerText || b.id || 'button').trim().slice(0, 40));
      return {
        versions: items.length, firstLabel, helpRead, helpSpeak,
        fontOn, fontLoaded, family, contrast, ink, voice, missingSpeak,
        banner: document.querySelector('#banner').textContent,
      };
    })()`);
    if (ui.versions < 2) fail('timeline has too few pictures: ' + ui.versions);
    else ok('picture timeline has ' + ui.versions + ' versions');
    if (!/Read/.test(ui.helpRead) || !ui.helpSpeak) fail('help read control: ' + JSON.stringify(ui));
    else ok('help card has a Read button and a spoken label');
    if (!ui.fontOn || !ui.fontLoaded || !/Atkinson Hyperlegible/.test(ui.family)) fail('reading font did not apply: ' + JSON.stringify(ui));
    else ok('reading font loads from the folder and applies');
    if (!ui.contrast || ui.ink !== 'rgb(0, 0, 0)') fail('high contrast ink is ' + ui.ink);
    else ok('high contrast uses black text');
    if (!/OFF/.test(ui.voice)) fail('voice toggle: ' + ui.voice);
    else ok('voice can be turned off');
    if (ui.missingSpeak.length) fail('controls missing a word or a spoken label: ' + ui.missingSpeak.join(' | '));
    else ok('visible controls have a word and a spoken label');

    // Autosave and the resume card.
    await cdp.send('Page.reload', { ignoreCache: false });
    await sleep(400);
    await waitForApp(cdp);
    const resume = await cdp.eval(`(() => {
      const overlay = document.querySelector('#resume-overlay');
      return {
        shown: overlay.classList.contains('show'),
        heading: overlay.querySelector('h2').textContent,
        line: document.querySelector('#resume-line').textContent,
        thumb: (document.querySelector('#resume-thumb').getAttribute('src') || '').slice(0, 22),
      };
    })()`);
    if (!resume.shown || resume.heading !== 'Where was I?') fail('resume card missing: ' + JSON.stringify(resume));
    else ok('Where was I? comes back after a reload');
    await cdp.eval(`document.querySelector('#resume-continue').click()`);
    const continued = await cdp.eval(`document.querySelector('#resume-overlay').classList.contains('show')`);
    if (continued) fail('Continue left the card open');
    else ok('Continue closes the card and keeps the model');

    // Service worker, installability, then offline.
    let sw = await cdp.eval(`(async () => {
      const reg = await navigator.serviceWorker.ready;
      const cache = await caches.open('clay-blocks-v2');
      const keys = (await cache.keys()).map((r) => new URL(r.url).pathname.split('/').pop());
      return { active: !!reg.active, controlling: !!navigator.serviceWorker.controller, keys };
    })()`, 30000);
    if (!sw.controlling) {
      await cdp.send('Page.reload');
      await sleep(500);
      await waitForApp(cdp);
      sw = await cdp.eval(`(async () => {
        const reg = await navigator.serviceWorker.ready;
        const cache = await caches.open('clay-blocks-v2');
        const keys = (await cache.keys()).map((r) => new URL(r.url).pathname.split('/').pop());
        return { active: !!reg.active, controlling: !!navigator.serviceWorker.controller, keys };
      })()`);
    }
    const need = ['three.module.js', 'index.html', 'styles.css', 'AtkinsonHyperlegible-Regular.ttf', 'fflate.module.js', 'printcheck.js'];
    const missingCache = need.filter((n) => !sw.keys.includes(n));
    if (!sw.active || missingCache.length) fail('offline cache is missing ' + missingCache.join(', '));
    else ok('service worker cached the app, the libraries, and the reading font');

    let installErrors = [];
    try {
      const inst = await cdp.send('Page.getInstallabilityErrors');
      installErrors = inst.errors || [];
    } catch (err) {
      installErrors = [{ errorId: 'cdp', errorMessage: String(err.message || err) }];
    }
    if (installErrors.length) fail('Chrome installability: ' + JSON.stringify(installErrors));
    else ok('Chrome reports the page can be installed');

    if (server) { server.kill(); server = null; }
    let serverDown = false;
    for (let i = 0; i < 20; i++) {
      try { await getJson(`http://127.0.0.1:${PORT}/manifest.webmanifest`); }
      catch { serverDown = true; break; }
      await sleep(150);
    }
    if (!serverDown) fail('the local server was still answering');
    else ok('local server is stopped');

    try { await cdp.eval(`location.reload()`); } catch (err) { console.log('  reload left the old page:', String(err.message || err).split('\n')[0]); }
    await sleep(1000);
    const again = await getJson(`http://127.0.0.1:${debugPort}/json/list`);
    const page = again.find((t) => t.type === 'page' && String(t.url || '').includes('127.0.0.1'))
      || again.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!page) throw new Error('Chrome has no page after the offline reload');
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await waitForApp(cdp);
    const offline = await cdp.eval(`(() => {
      const scene = window.ClayBlocks.scene;
      scene.reset();
      scene.addShape('box');
      const geo = scene.getExportGeometry();
      const stl = window.ClayBlocks.exportSTL(geo);
      return {
        title: document.title,
        shapes: scene.shapesGroup.children.length,
        stl: stl.byteLength,
        onLine: navigator.onLine,
      };
    })()`);
    if (!offline.shapes || offline.stl < 84 || offline.title !== 'Clay Blocks') fail('offline reload did not work: ' + JSON.stringify(offline));
    else ok('with the server stopped, a reload still adds a shape and writes an STL');

    // A picture for the guide, from the earlier online session, is already gone.
    // Draw a fresh holed model while offline and photograph the screen.
    await cdp.eval(`(async () => {
      const scene = window.ClayBlocks.scene;
      scene.reset();
      scene.addShape('box');
      scene.addShape('cylinder');
      const hole = scene.shapesGroup.children[1];
      hole.userData.isHole = true;
      hole.position.set(0, 25, 0);
      scene.makeClay();
      document.querySelector('#resume-overlay').classList.remove('show');
      document.querySelector('#print-overlay').classList.remove('show');
      document.querySelector('#tool-shapes').click();
      scene._resize();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    })()`, 90000);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(ROOT, 'screenshot.png'), Buffer.from(shot.data, 'base64'));
    ok('saved screenshot.png');

    const exceptions = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown');
    if (exceptions.length) {
      const first = exceptions[0].params?.exceptionDetails?.exception?.description || JSON.stringify(exceptions[0]).slice(0, 500);
      fail('page exception: ' + first);
    }
  } finally {
    if (chrome) chrome.kill();
    if (server) server.kill();
  }

  if (problems.length) {
    console.error('\\n' + problems.length + ' problem(s).');
    process.exit(1);
  }
  console.log('\\nAll checks passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
