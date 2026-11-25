// help.js — step-by-step recipe cards.
// One step per card, a picture where it helps, a play button that reads it,
// a search box, and branches ("round hole or square hole?").

export const CARDS = {
  start: {
    title: 'Help', pic: '📖',
    text: 'Pick what you want to do. Or type a question in the search box.',
    links: ['add', 'stack', 'hole', 'clay', 'print'],
  },
  add: {
    title: 'Add a shape', pic: '🧊',
    steps: [
      'Press the big "Shapes" button at the bottom.',
      'Press a shape, like Box or Ball.',
      'It drops onto the grey plate. Done!',
    ],
    links: ['stack', 'clay'],
  },
  stack: {
    title: 'Stack shapes', pic: '🥞',
    steps: [
      'Add two shapes.',
      'Press the big "Move" button.',
      'Drag one shape on top of the other.',
      'It snaps and sits on top by itself.',
    ],
    links: ['clay'],
  },
  hole: {
    title: 'Make a hole', pic: '🕳️',
    text: 'A hole is a shape that cuts into your model. What shape is the hole?',
    branch: [
      { label: 'A round hole', goto: 'hole_round' },
      { label: 'A square hole', goto: 'hole_square' },
    ],
  },
  hole_round: {
    title: 'A round hole', pic: '⭕',
    steps: [
      'Add a Cylinder.',
      'Select it. In its card, turn on "This is a hole".',
      'Move it so it pokes into your model.',
      'Press "Make it clay". The hole is cut out.',
    ],
    links: ['clay', 'print'],
  },
  hole_square: {
    title: 'A square hole', pic: '⬛',
    steps: [
      'Add a Box.',
      'Select it. In its card, turn on "This is a hole".',
      'Move it so it pokes into your model.',
      'Press "Make it clay". The hole is cut out.',
    ],
    links: ['clay', 'print'],
  },
  clay: {
    title: 'Make it clay and smooth it', pic: '🪄',
    steps: [
      'When your shapes look right, press "Make it clay".',
      'This joins the solid shapes and cuts the holes.',
      'It does not close gaps in the skin, and it does not promise a perfect print.',
      'Press "Sculpt", then press "Smooth".',
      'Drag on the model to smooth the bumps.',
      'Use Push and Pull to shape it like clay.',
    ],
    links: ['print'],
  },
  print: {
    title: 'Send to printer', pic: '🖨️',
    steps: [
      'Press the big "Print" button.',
      'Read each line. A tick means that one check passed.',
      'Fix it for me only does two jobs: make the model smaller, or sit it on the plate.',
      'If a line says there are open edges, this app cannot close them.',
      'Press "Save 3MF" or "Save STL", then open that file in your printer app.',
    ],
    links: ['clay'],
  },
};

// Keyword search -> card id
const KEYWORDS = [
  { id: 'hole', words: ['hole', 'cut', 'gap', 'dig', 'hollow'] },
  { id: 'add', words: ['add', 'shape', 'start', 'box', 'sphere', 'new', 'begin'] },
  { id: 'stack', words: ['stack', 'on top', 'pile', 'join', 'together', 'move'] },
  { id: 'clay', words: ['clay', 'smooth', 'sculpt', 'merge', 'melt', 'soft', 'bump'] },
  { id: 'print', words: ['print', 'save', 'export', 'stl', '3mf', 'printer', 'send', 'file'] },
];

export function searchCard(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return 'start';
  let best = null, bestScore = 0;
  for (const k of KEYWORDS) {
    let score = 0;
    for (const w of k.words) if (q.includes(w)) score += w.length;
    if (score > bestScore) { bestScore = score; best = k.id; }
  }
  return best || 'start';
}

export class HelpSystem {
  constructor(container, { speak = () => {} } = {}) {
    this.el = container;
    this.speak = speak;
    this.current = 'start';
  }

  cardToText(card) {
    let t = card.title + '. ';
    if (card.text) t += card.text + ' ';
    if (card.steps) t += card.steps.map((s, i) => `Step ${i+1}. ${s}`).join(' ');
    return t;
  }

  show(id) {
    const card = CARDS[id] || CARDS.start;
    this.current = id;
    const stepsHtml = card.steps
      ? `<ol class="help-steps">${card.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
      : '';
    const textHtml = card.text ? `<p>${esc(card.text)}</p>` : '';
    const branchHtml = card.branch
      ? `<div class="branch-row">${card.branch.map((b) => `<button class="pill" data-goto="${b.goto}" data-speak="${esc(b.label)}">${esc(b.label)}</button>`).join('')}</div>`
      : '';
    const linksHtml = card.links && card.links.length
      ? `<p class="hint">Next:</p><div class="help-list">${card.links.map((l) => `<button data-goto="${l}" data-speak="${esc(CARDS[l].title)}">➡️ ${esc(CARDS[l].title)}</button>`).join('')}</div>`
      : '';
    const back = id !== 'start' ? `<button class="minibtn" data-goto="start" data-speak="Back to help menu">⬅️ All help</button>` : '';

    this.el.innerHTML = `
      <div class="card help-card">
        <button class="play" title="Read this aloud" data-speak="Read this aloud" aria-label="Read this card aloud">🔊 Read</button>
        <h3>${esc(card.title)}</h3>
        <div class="help-pic" aria-hidden="true">${card.pic || ''}</div>
        ${textHtml}
        ${stepsHtml}
        ${branchHtml}
        ${linksHtml}
        <div style="margin-top:10px">${back}</div>
      </div>`;

    // wire buttons
    this.el.querySelector('.play').addEventListener('click', () => this.speak(this.cardToText(card), { force: true }));
    this.el.querySelectorAll('[data-goto]').forEach((b) => {
      b.addEventListener('click', () => this.show(b.getAttribute('data-goto')));
    });
  }
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
