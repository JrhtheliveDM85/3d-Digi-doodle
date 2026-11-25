// voice.js — speaks labels using the device's own voice.
// If no speech is available, everything still works silently.

const state = {
  on: true,
  rate: 1,          // 0.6 .. 1.4
  supported: typeof window !== 'undefined' && 'speechSynthesis' in window,
};

let lastText = '';
let lastTime = 0;

export function loadVoiceSettings(saved) {
  if (!saved) return;
  if (typeof saved.on === 'boolean') state.on = saved.on;
  if (typeof saved.rate === 'number') state.rate = saved.rate;
}

export function getVoiceSettings() {
  return { on: state.on, rate: state.rate };
}

export function isSupported() { return state.supported; }

export function setEnabled(on) {
  state.on = !!on;
  if (!state.on) cancel();
}

export function setRate(rate) {
  state.rate = Math.min(1.4, Math.max(0.6, Number(rate) || 1));
}

export function cancel() {
  if (state.supported) { try { window.speechSynthesis.cancel(); } catch (_) {} }
}

// Speak a short label. De-bounces the same text within 700ms so hover +
// focus + click don't stack up and talk over each other.
export function speak(text, { force = false } = {}) {
  if (!text) return;
  if (!state.on || !state.supported) return;
  const now = Date.now();
  if (!force && text === lastText && now - lastTime < 700) return;
  lastText = text; lastTime = now;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.rate = state.rate;
    u.pitch = 1;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  } catch (_) { /* stay silent, keep working */ }
}

// Wire hover / focus / tap on any element carrying data-speak (or its label).
// We attach one set of delegated listeners to the document.
export function attachGlobalSpeech(root = document) {
  const getText = (el) => {
    const node = el.closest('[data-speak]');
    if (!node) return null;
    const t = node.getAttribute('data-speak');
    if (t && t.trim()) return t.trim();
    return (node.textContent || '').trim().slice(0, 120);
  };
  const handler = (e) => {
    const t = getText(e.target);
    if (t) speak(t);
  };
  root.addEventListener('pointerover', handler, { passive: true });
  root.addEventListener('focusin', handler);
  // Tap / click always speaks (force) so touch users hear it.
  root.addEventListener('click', (e) => {
    const t = getText(e.target);
    if (t) speak(t, { force: true });
  });
}
