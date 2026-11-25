// app.js — wires the whole app together.
import * as THREE from 'three';
import { Scene } from './scene.js';
import { STLLoader } from '../vendor/STLLoader.js';
import { OBJLoader } from '../vendor/OBJLoader.js';
import * as V from './voice.js';
import * as store from './storage.js';
import { exportSTL, export3MF } from './exporters.js';
import { checkModel, analyzeSurface } from './printcheck.js';
import { HelpSystem, searchCard } from './help.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---------------- state ---------------- */
let scene;
let help;
let loading = false;              // true while restoring, so we don't commit
let history = [];
let cursor = -1;
let pendingImportGeometry = null;

const BANNERS = {
  shapes: 'You are adding shapes',
  move: 'You are moving',
  sculpt: 'You are sculpting',
  help: 'You are reading help',
  settings: 'You are changing settings',
};

/* ---------------- boot ---------------- */
window.addEventListener('DOMContentLoaded', init);

// Register the service worker so the app installs and works offline.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* fine without it */ });
  });
}

function init() {
  // settings first (font/contrast/voice) so the page looks right immediately
  const s = store.loadSettings();
  V.loadVoiceSettings(s.voice);
  if (s.font === 'reading') document.documentElement.setAttribute('data-font', 'reading');
  if (s.contrast === 'high') document.documentElement.setAttribute('data-contrast', 'high');

  scene = new Scene($('#view'), { onChange: onSceneChange, onSelect: renderSelected });
  help = new HelpSystem($('#help-body'), { speak: V.speak });
  help.show('start');

  V.attachGlobalSpeech(document);
  wireToolbar();
  wireShapes();
  wireSculpt();
  wireSettings(s);
  wirePrint();
  wireBin();
  wireImport();
  wireHelp();

  reflectVoiceUI();
  updateClayCTA();
  renderIdeasCount();

  // Test hook (harmless in normal use): lets an automated check drive the app.
  // Test hook only. Not a public API, and not shown in the app.
  window.ClayBlocks = { scene, exportSTL, export3MF, checkModel, analyzeSurface, setTool, doMakeClay, THREE };

  // Restore last work → "Where was I?"
  const saved = store.loadProject();
  history = store.loadHistory();
  if (saved && ((saved.shapes && saved.shapes.length) || saved.mode === 'clay')) {
    loading = true;
    scene.load(saved);
    loading = false;
    cursor = history.length - 1;
    const thumb = (history[cursor] && history[cursor].thumb) || scene.thumbnail();
    $('#resume-thumb').src = thumb;
    $('#resume-line').textContent = 'Here is what you were making. Do you want to keep going?';
    show('#resume-overlay');
    V.speak('Welcome back. Here is what you were making. Continue, or start fresh?', { force: true });
    renderTimeline();
  } else {
    setTool('shapes');
  }

  $('#resume-continue').addEventListener('click', () => {
    hide('#resume-overlay');
    if (history.length === 0) commit('reopened');
    setTool('shapes');
  });
  $('#resume-fresh').addEventListener('click', () => {
    hide('#resume-overlay');
    loading = true; scene.reset(); loading = false;
    store.clearProject();
    history = []; cursor = -1;
    renderTimeline(); updateClayCTA();
    setTool('shapes');
    toast('Fresh start. Your old one is gone.');
  });
}

/* ---------------- commit / autosave / history ---------------- */
function onSceneChange(label) {
  if (loading) return;
  commit(label);
  updateClayCTA();
}

function commit(label) {
  const project = scene.serialize();
  store.saveProject(project);
  const snap = { at: Date.now(), label, project, thumb: scene.thumbnail(150) };
  history.push(snap);
  if (history.length > 60) history.shift();
  store.pushHistory(snap); // storage caps this too
  cursor = history.length - 1;
  renderTimeline();
}

function jumpTo(i) {
  if (i < 0 || i >= history.length) return;
  loading = true;
  scene.load(history[i].project);
  loading = false;
  cursor = i;
  store.saveProject(history[i].project);
  renderTimeline();
  updateClayCTA();
  // switching to a clay version? keep tool sensible
  if (scene.isClay && currentTool === 'shapes') setTool('sculpt');
}

function undo() {
  if (cursor > 0) { jumpTo(cursor - 1); toast('Went back one step.'); }
  else toast('Nothing to undo.');
}

function renderTimeline() {
  const strip = $('#timeline-strip');
  strip.innerHTML = '';
  history.forEach((snap, i) => {
    const item = document.createElement('button');
    item.className = 'tl-item' + (i === cursor ? ' current' : '');
    item.setAttribute('data-speak', 'Version ' + (i + 1));
    item.innerHTML = `<img src="${snap.thumb || ''}" alt="Version ${i+1}"><div class="cap">${i+1}</div>`;
    item.addEventListener('click', () => jumpTo(i));
    strip.appendChild(item);
  });
  strip.scrollLeft = strip.scrollWidth;
}

/* ---------------- tools / banner ---------------- */
let currentTool = 'shapes';
function setTool(tool) {
  currentTool = tool;
  const sceneTool = (tool === 'sculpt') ? 'sculpt' : (tool === 'move') ? 'move' : (tool === 'shapes') ? 'shapes' : 'none';
  scene.setTool(sceneTool);
  $('#banner-line').textContent = BANNERS[tool] || 'Clay Blocks';
  V.speak(BANNERS[tool], { force: true });

  $$('.toolbtn[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
  // help & settings are not in the 6, clear their pressed look via panel only
  $$('.panel-page').forEach((p) => p.classList.remove('active'));
  const page = $('#page-' + tool);
  if (page) page.classList.add('active');

  if (tool === 'sculpt') refreshSculptPanel();
  renderSelected(scene.getSelected());
}

function wireToolbar() {
  $('#tool-shapes').addEventListener('click', () => setTool('shapes'));
  $('#tool-move').addEventListener('click', () => setTool('move'));
  $('#tool-sculpt').addEventListener('click', () => setTool('sculpt'));
  $('#tool-undo').addEventListener('click', undo);
  $('#tool-save').addEventListener('click', saveProjectFile);
  $('#tool-print').addEventListener('click', openPrint);
  $('#btn-help').addEventListener('click', () => setTool('help'));
  $('#btn-settings').addEventListener('click', () => setTool('settings'));
  $('#btn-makeclay').addEventListener('click', doMakeClay);
}

/* ---------------- shapes + selected editor ---------------- */
function wireShapes() {
  $$('#page-shapes [data-shape]').forEach((b) => {
    b.addEventListener('click', () => { scene.addShape(b.dataset.shape); });
  });
}

function selHolder() {
  return currentTool === 'move' ? $('#selected-card-move') : $('#selected-card');
}

function renderSelected(sel) {
  // clear both, fill the active one
  const a = $('#selected-card'); const b = $('#selected-card-move');
  if (a) a.innerHTML = ''; if (b) b.innerHTML = '';
  if (!sel) return;
  const holder = selHolder();
  if (!holder) return;

  const k = sel.kind;
  const s = sel.size;
  let fields = '';
  const f = (label, axis, val) => `
    <div class="row"><label>${label}</label>
    <input type="number" min="2" max="300" step="1" value="${Math.round(val)}" data-axis="${axis}" data-speak="${label} in millimetres" /> mm</div>`;
  if (k === 'sphere') fields = f('Across', 'x', s.x);
  else if (k === 'cylinder' || k === 'cone') fields = f('Across', 'x', s.x) + f('Height', 'y', s.y);
  else fields = f('Width', 'x', s.x) + f('Height', 'y', s.y) + f('Depth', 'z', s.z);

  holder.innerHTML = `
    <div class="card">
      <h3>Your ${niceName(k)}</h3>
      ${fields}
      <div class="pill-row">
        <button class="pill" data-preset="small" data-speak="Small">Small</button>
        <button class="pill" data-preset="medium" data-speak="Medium">Medium</button>
        <button class="pill" data-preset="big" data-speak="Big">Big</button>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="pill" id="hole-toggle" aria-pressed="${sel.isHole}" data-speak="This is a hole">${sel.isHole ? '🕳️ This is a hole' : '🧱 This is solid'}</button>
      </div>
      <button class="danger" id="bin-shape" style="width:100%;margin-top:8px" data-speak="Put in the bin">🗑️ Put in the bin</button>
    </div>`;

  holder.querySelectorAll('input[data-axis]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const cur = scene.getSelected(); if (!cur) return;
      const size = { ...cur.size };
      size[inp.dataset.axis] = Number(inp.value);
      scene.setSelectedSize(size);
    });
  });
  holder.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  });
  holder.querySelector('#hole-toggle').addEventListener('click', () => {
    const cur = scene.getSelected(); if (!cur) return;
    scene.setSelectedHole(!cur.isHole);
    renderSelected(scene.getSelected());
  });
  holder.querySelector('#bin-shape').addEventListener('click', () => askBin());
}

function applyPreset(name) {
  const cur = scene.getSelected(); if (!cur) return;
  const base = { small: 25, medium: 50, big: 90 }[name] || 50;
  const k = cur.kind;
  let size;
  if (k === 'sphere') size = { x: base, y: base, z: base };
  else if (k === 'cylinder' || k === 'cone') size = { x: base, y: Math.round(base * 1.2), z: base };
  else size = { x: base, y: Math.round(base * 0.8), z: base };
  scene.setSelectedSize(size);
  renderSelected(scene.getSelected());
}

function niceName(k) {
  return { box: 'Box', cylinder: 'Cylinder', sphere: 'Ball', cone: 'Cone', wedge: 'Ramp' }[k] || 'Shape';
}

/* ---------------- make clay ---------------- */
function updateClayCTA() {
  const showCta = !scene.isClay && scene.hasContent && (currentTool === 'shapes' || currentTool === 'move');
  const cta = $('#clay-cta');
  const narrow = window.matchMedia('(max-width: 820px)').matches;
  const panel = $('#panel');
  if (narrow && cta.parentElement !== panel) panel.prepend(cta);
  if (!narrow && cta.parentElement === panel) document.body.appendChild(cta);
  cta.style.display = showCta ? 'block' : 'none';
}
window.addEventListener('resize', () => { if (scene) updateClayCTA(); });

function doMakeClay() {
  const res = scene.makeClay();
  if (!res.ok) { toast(res.error); V.speak(res.error, { force: true }); return; }
  toast('Joined. You can sculpt it now.');
  setTool('sculpt');
}

/* ---------------- sculpt ---------------- */
function wireSculpt() {
  $$('#page-sculpt [data-brush]').forEach((b) => {
    b.addEventListener('click', () => {
      scene.setSculptBrush(b.dataset.brush);
      $$('#page-sculpt [data-brush]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
  });
  $('#brush-size').addEventListener('input', (e) => scene.setSculptSize(e.target.value));
}

function refreshSculptPanel() {
  const locked = !scene.isClay;
  $('#sculpt-locked').style.display = locked ? 'block' : 'none';
  $('#sculpt-tools').style.display = locked ? 'none' : 'block';
}

/* ---------------- settings ---------------- */
function wireSettings(s) {
  const voiceBtn = $('#set-voice');
  voiceBtn.addEventListener('click', () => {
    const now = !V.getVoiceSettings().on;
    V.setEnabled(now);
    persistSettings();
    reflectVoiceUI();
    if (now) V.speak('Voice is on', { force: true });
  });
  $('#set-rate').value = V.getVoiceSettings().rate;
  $('#set-rate').addEventListener('input', (e) => { V.setRate(e.target.value); persistSettings(); });
  $('#set-rate').addEventListener('change', () => V.speak('This is the speed', { force: true }));

  const fontBtn = $('#set-font');
  fontBtn.setAttribute('aria-pressed', String(s.font === 'reading'));
  fontBtn.textContent = s.font === 'reading' ? '🔤 Reading font' : '🔤 Normal font';
  fontBtn.addEventListener('click', () => {
    const on = document.documentElement.getAttribute('data-font') !== 'reading';
    document.documentElement.setAttribute('data-font', on ? 'reading' : '');
    fontBtn.setAttribute('aria-pressed', String(on));
    fontBtn.textContent = on ? '🔤 Reading font' : '🔤 Normal font';
    persistSettings();
  });

  const conBtn = $('#set-contrast');
  conBtn.setAttribute('aria-pressed', String(s.contrast === 'high'));
  conBtn.textContent = s.contrast === 'high' ? '◑ High contrast' : '◑ Normal contrast';
  conBtn.addEventListener('click', () => {
    const on = document.documentElement.getAttribute('data-contrast') !== 'high';
    document.documentElement.setAttribute('data-contrast', on ? 'high' : '');
    conBtn.setAttribute('aria-pressed', String(on));
    conBtn.textContent = on ? '◑ High contrast' : '◑ Normal contrast';
    persistSettings();
  });

  // templates
  $$('#page-settings [data-template]').forEach((b) => {
    b.addEventListener('click', () => loadTemplate(b.dataset.template));
  });

  // suggestion box
  $('#idea-save').addEventListener('click', () => {
    const t = $('#idea-text').value.trim();
    if (!t) { toast('Write your idea first.'); return; }
    store.addIdea(t);
    $('#idea-text').value = '';
    renderIdeasCount();
    toast('Idea saved. Thank you!');
  });
}

function persistSettings() {
  store.saveSettings({
    voice: V.getVoiceSettings(),
    font: document.documentElement.getAttribute('data-font') === 'reading' ? 'reading' : 'normal',
    contrast: document.documentElement.getAttribute('data-contrast') === 'high' ? 'high' : 'normal',
  });
}

function reflectVoiceUI() {
  const on = V.getVoiceSettings().on;
  const btn = $('#set-voice');
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = on ? '🔊 Voice is ON' : '🔇 Voice is OFF';
  $('#voice-note').textContent = V.isSupported() ? '' : 'This device has no voice, so words are shown instead.';
}

function renderIdeasCount() {
  const n = store.loadIdeas().length;
  $('#idea-count').textContent = n ? `${n} idea${n>1?'s':''} saved on this device.` : '';
}

/* ---------------- templates ---------------- */
function loadTemplate(name) {
  const T = {
    grip: { mode: 'blocks', shapes: [
      { kind: 'cylinder', size: { x: 90, y: 16, z: 90 }, pos: { x: 0, y: 8, z: 0 }, isHole: false },
      { kind: 'cylinder', size: { x: 55, y: 20, z: 55 }, pos: { x: 0, y: 10, z: 0 }, isHole: true },
    ]},
    spoon: { mode: 'blocks', shapes: [
      { kind: 'box', size: { x: 120, y: 12, z: 24 }, pos: { x: 0, y: 6, z: 0 }, isHole: false },
      { kind: 'sphere', size: { x: 46, y: 46, z: 46 }, pos: { x: 70, y: 12, z: 0 }, isHole: false },
    ]},
    bowl: { mode: 'blocks', shapes: [
      { kind: 'cylinder', size: { x: 120, y: 40, z: 120 }, pos: { x: 0, y: 20, z: 0 }, isHole: false },
      { kind: 'cylinder', size: { x: 90, y: 44, z: 90 }, pos: { x: 0, y: 24, z: 0 }, isHole: true },
    ]},
    ramp: { mode: 'blocks', shapes: [
      { kind: 'wedge', size: { x: 120, y: 40, z: 60 }, pos: { x: 0, y: 20, z: 0 }, isHole: false },
    ]},
  };
  const proj = T[name]; if (!proj) return;
  loading = true; scene.load(proj); loading = false;
  commit('template-' + name);
  updateClayCTA();
  setTool('move');
  toast('Template ready. Change it however you like.');
}

/* ---------------- save project file ---------------- */
async function saveProjectFile() {
  const data = JSON.stringify({ app: 'clay-blocks', version: 2, savedAt: new Date().toISOString(), project: scene.serialize() }, null, 0);
  const res = await store.saveFile(new TextEncoder().encode(data), 'my-model.clayblocks.json', 'application/json', 'Clay Blocks model');
  if (res.ok) toast(res.method === 'picker' ? 'Saved to your folder.' : 'File downloaded.');
}

/* ---------------- print ---------------- */
function wirePrint() {
  $('#print-close').addEventListener('click', () => hide('#print-overlay'));
  $('#save-3mf').addEventListener('click', () => doExport('3mf'));
  $('#save-stl').addEventListener('click', () => doExport('stl'));
}

function openPrint() {
  const geo = scene.getExportGeometry();
  const { checks } = checkModel(geo, { isClay: scene.isClay });
  const box = $('#print-checks');
  box.innerHTML = '';
  checks.forEach((c) => {
    const level = c.level || (c.ok ? 'ok' : 'no');
    const div = document.createElement('div');
    div.className = 'check ' + level;
    div.setAttribute('data-speak', c.msg);
    const mark = level === 'ok' ? '✅' : level === 'note' ? 'ℹ️' : '⚠️';
    div.innerHTML = `<span class="mark" aria-hidden="true">${mark}</span><span class="msg"></span>`;
    div.querySelector('.msg').textContent = c.msg;
    if (c.fix) {
      const fix = document.createElement('button');
      fix.className = 'fix pill';
      fix.textContent = fixLabel(c.fix);
      fix.setAttribute('data-speak', fixSpeak(c.fix));
      fix.addEventListener('click', () => { runFix(c.fix); openPrint(); });
      div.appendChild(fix);
    }
    box.appendChild(div);
  });
  show('#print-overlay');
  V.speak(printSummary(checks), { force: true });
}

function fixLabel(fix) {
  if (fix === 'clay') return '🪄 Make it clay';
  return '🛠️ Fix it for me';
}
function fixSpeak(fix) {
  if (fix === 'drop') return 'Fix it for me. Sit it on the plate.';
  if (fix === 'shrink') return 'Fix it for me. Make it smaller so it fits.';
  if (fix === 'clay') return 'Make it clay';
  return 'Fix it for me';
}
function printSummary(checks) {
  const bad = checks.find((c) => c.level === 'no' || c.level === 'warn');
  if (bad) return bad.msg;
  const note = checks.find((c) => c.level === 'note');
  if (note) return note.msg;
  return 'The checks we can do have passed. You can save the file.';
}
function runFix(fix) {
  if (fix === 'drop') scene.dropToPlate();
  else if (fix === 'shrink') scene.shrinkToFit();
  else if (fix === 'clay') { const r = scene.makeClay(); if (!r.ok) toast(r.error); }
}

async function doExport(kind) {
  const geo = scene.getExportGeometry();
  if (!geo) { toast('Add a shape first.'); return; }
  try {
    if (kind === 'stl') {
      const bytes = exportSTL(geo);
      const res = await store.saveFile(bytes, 'my-model.stl', 'model/stl', 'STL model (mm)');
      if (res.ok) toast(res.method === 'picker' ? 'STL saved to your folder.' : 'STL downloaded.');
    } else {
      const bytes = export3MF(geo);
      const res = await store.saveFile(bytes, 'my-model.3mf', 'model/3mf', '3MF model (mm)');
      if (res.ok) toast(res.method === 'picker' ? '3MF saved to your folder.' : '3MF downloaded.');
    }
  } catch (err) {
    toast('Sorry, saving the file did not work.');
  }
}

/* ---------------- bin ---------------- */
function wireBin() {
  $('#bin-no').addEventListener('click', () => hide('#bin-overlay'));
  $('#bin-yes').addEventListener('click', () => { hide('#bin-overlay'); scene.deleteSelected(); toast('Put in the bin.'); });
}
function askBin() {
  const sel = scene.getSelected(); if (!sel) return;
  $('#bin-line').textContent = `This will remove your ${niceName(sel.kind)}.`;
  show('#bin-overlay');
  V.speak('Put it in the bin?', { force: true });
}

/* ---------------- import scan ---------------- */
function wireImport() {
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      let geo;
      if (file.name.toLowerCase().endsWith('.obj')) {
        const obj = new OBJLoader().parse(new TextDecoder().decode(buf));
        geo = firstGeometry(obj);
      } else {
        geo = new STLLoader().parse(buf);
      }
      if (!geo) { toast('Could not read that file.'); return; }
      pendingImportGeometry = geo;
      show('#import-overlay');
      V.speak('Do you want this as a solid print, or as a hole the shape fits into?', { force: true });
    } catch (err) { toast('Could not read that file.'); }
    e.target.value = '';
  });
  $$('#import-overlay [data-import]').forEach((b) => {
    b.addEventListener('click', () => {
      const choice = b.dataset.import;
      hide('#import-overlay');
      if (choice === 'cancel' || !pendingImportGeometry) { pendingImportGeometry = null; return; }
      if (choice === 'both') {
        scene.importMesh(pendingImportGeometry.clone(), { asHole: false });
        scene.importMesh(pendingImportGeometry.clone(), { asHole: true });
      } else {
        scene.importMesh(pendingImportGeometry, { asHole: choice === 'negative' });
      }
      pendingImportGeometry = null;
      setTool('move');
    });
  });
}
function firstGeometry(obj) {
  let g = null;
  obj.traverse((c) => { if (!g && c.isMesh) g = c.geometry; });
  return g;
}

/* ---------------- help ---------------- */
function wireHelp() {
  $('#help-search').addEventListener('input', (e) => {
    const id = searchCard(e.target.value);
    help.show(id);
  });
}

/* ---------------- little helpers ---------------- */
function show(sel) { $(sel).classList.add('show'); }
function hide(sel) { $(sel).classList.remove('show'); }
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
