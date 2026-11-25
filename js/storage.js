// storage.js — never lose work.
// Autosaves to browser storage after every change, keeps a picture
// timeline, and can save a file to a folder the user chooses.

const KEY_PROJECT = 'clayblocks.project.v2';
const KEY_HISTORY = 'clayblocks.history.v2';
const KEY_SETTINGS = 'clayblocks.settings.v2';
const MAX_HISTORY = 60; // plenty for a session; keeps storage small

function safeGet(key) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; }
  catch (_) { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (_) { return false; } // storage full / blocked (private window) — keep working
}

/* ---- current project ---- */
export function saveProject(project) { safeSet(KEY_PROJECT, project); }
export function loadProject() { return safeGet(KEY_PROJECT); }
export function clearProject() {
  try { localStorage.removeItem(KEY_PROJECT); localStorage.removeItem(KEY_HISTORY); } catch (_) {}
}

/* ---- settings (voice, font, contrast) ---- */
export function saveSettings(s) { safeSet(KEY_SETTINGS, s); }
export function loadSettings() { return safeGet(KEY_SETTINGS) || {}; }

/* ---- history / picture timeline ---- */
// Each item: { at, label, project, thumb } where thumb is a small dataURL.
export function loadHistory() { return safeGet(KEY_HISTORY) || []; }

export function pushHistory(item) {
  const list = loadHistory();
  list.push(item);
  while (list.length > MAX_HISTORY) list.shift();
  safeSet(KEY_HISTORY, list);
  return list;
}

/* ---- suggestion box (ideas saved locally) ---- */
const KEY_IDEAS = 'clayblocks.ideas.v1';
export function loadIdeas() { return safeGet(KEY_IDEAS) || []; }
export function addIdea(text) {
  const list = loadIdeas();
  list.push({ at: Date.now(), text: String(text).slice(0, 500) });
  safeSet(KEY_IDEAS, list);
  return list;
}

/* ---- Save a file to disk ----
   Chrome/Edge: File System Access API lets the user pick a folder/file.
   Other browsers: fall back to a normal download. */
export function canUseFilePicker() {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

export async function saveFile(bytes, suggestedName, mime, description) {
  const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
  if (canUseFilePicker()) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: description || 'File', accept: { [mime || 'application/octet-stream']: ['.' + suggestedName.split('.').pop()] } }],
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return { ok: true, method: 'picker', name: suggestedName };
    } catch (err) {
      if (err && err.name === 'AbortError') return { ok: false, method: 'cancelled' };
      // fall through to download on any other error
    }
  }
  // Download fallback
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = suggestedName;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  return { ok: true, method: 'download', name: suggestedName };
}
