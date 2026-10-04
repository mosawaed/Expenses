// Tiny DOM helpers. User-entered text (notes) always goes in as text nodes,
// never as HTML, so a note can't inject markup.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  setProps(el, props);
  appendChildren(el, children);
  return el;
}

export function svg(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  setProps(el, props, true);
  appendChildren(el, children);
  return el;
}

function setProps(el, props, isSvg = false) {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') {
      if (isSvg) el.setAttribute('class', value);
      else el.className = value;
    } else if (key === 'text') {
      el.textContent = value;
    } else if (key === 'style') {
      for (const [prop, v] of Object.entries(value)) {
        if (v !== undefined && v !== null) el.style.setProperty(prop, String(v));
      }
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

// Icons drawn on a 24×24 grid with round 1.8px strokes (styled in CSS).
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  income: '<path d="M17 7 7 17M7 9.5V17h7.5"/>',
  expense: '<path d="M7 17 17 7M9.5 7H17v7.5"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5h.01M18 14.5h.01"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>',
  chevronLeft: '<path d="m14.5 18-6-6 6-6"/>',
  chevronRight: '<path d="m9.5 18 6-6-6-6"/>',
  chevronDown: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l.9 12.1A2 2 0 0 0 8.9 21h6.2a2 2 0 0 0 2-1.9L18 7M9 7V4.5h6V7"/>',
  export: '<path d="M12 15V3.5M8 7.5l4-4 4 4"/><path d="M8 11H6.5a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H16"/>',
  import: '<path d="M12 3.5V15M8 11l4 4 4-4"/><path d="M5 14.5v4.5A1.5 1.5 0 0 0 6.5 20.5h11a1.5 1.5 0 0 0 1.5-1.5v-4.5"/>',
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  note: '<path d="M5 19.5h4L19.2 9.3a2.4 2.4 0 0 0-3.4-3.4L5.5 16.1z"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.4 2.9 7.8 7 9.5 4.1-1.7 7-5.1 7-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.8"/><path d="M10.5 18.5h3"/>',
  share: '<path d="M12 14.5V3.5M8 7.5l4-4 4 4"/><path d="M8 10.5H6.5A1.5 1.5 0 0 0 5 12v7.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5H16"/>',
  addSquare: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8.5v7M8.5 12h7"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>',
  alert: '<path d="M10.3 4.2 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
  arrowDown: '<path d="M12 5v14M6.5 13.5 12 19l5.5-5.5"/>',
  arrowUp: '<path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/>',
  sparkle: '<path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5zM18.5 15.5c.3 1.6 1 2.3 2.5 2.5-1.5.2-2.2.9-2.5 2.5-.3-1.6-1-2.3-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5z"/>',
  wallet: '<path d="M18 7.5V6a2 2 0 0 0-2-2H5.5A2.5 2.5 0 0 0 3 6.5v11A2.5 2.5 0 0 0 5.5 20H19a2 2 0 0 0 2-2v-8.5a2 2 0 0 0-2-2H5.5A2.5 2.5 0 0 1 3 6.5"/><path d="M16.5 14h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
};

export function icon(name, className = '') {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  el.setAttribute('class', `icon${className ? ` ${className}` : ''}`);
  el.innerHTML = ICONS[name] || '';
  return el;
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
