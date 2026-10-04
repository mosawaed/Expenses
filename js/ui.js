// Reusable interface pieces: sheets, alerts, action sheets, toasts,
// segmented controls and haptic feedback.

import { h, icon, prefersReducedMotion } from './dom.js';

const layers = [];
let presentationListener = () => {};
let uid = 0;

/** Called with true/false when a full-height sheet opens or closes. */
export function onPresentationChange(fn) {
  presentationListener = fn;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Opens a layer above the app.
 * kind: "page" (full-height sheet), "action" (bottom action sheet) or "alert" (centered).
 */
export function openLayer({
  kind = 'page',
  content,
  label,
  labelledBy,
  onDismiss,
  dismissible = true,
  initialFocus,
  autoFocus = true,
  returnFocus = document.activeElement,
}) {
  const backdrop = h('div', { class: 'layer-backdrop' });
  const panel = h('div', {
    class: `layer-panel layer-panel-${kind}`,
    role: kind === 'alert' ? 'alertdialog' : 'dialog',
    'aria-modal': 'true',
    'aria-label': label,
    'aria-labelledby': labelledBy,
    tabindex: '-1',
  });
  if (kind === 'page') panel.append(h('div', { class: 'sheet-grabber', 'data-drag-handle': '', 'aria-hidden': 'true' }));
  panel.append(content);
  const el = h('div', { class: `layer layer-${kind}` }, backdrop, panel);

  if (kind !== 'page' && activeToast) activeToast.dismiss(); // keep dialog buttons uncovered
  const previousTop = layers[layers.length - 1];
  if (previousTop) previousTop.el.setAttribute('inert', '');
  document.getElementById('app').setAttribute('inert', '');
  document.getElementById('overlay-root').append(el);

  let closed = false;
  const layer = {
    el,
    panel,
    kind,
    close,
    requestDismiss() {
      if (dismissible) close('dismiss');
    },
  };
  layers.push(layer);

  if (kind === 'page') {
    document.body.classList.add('sheet-presented');
    presentationListener(true);
    enableDragToDismiss(layer);
  }

  void el.offsetHeight; // commit the start state so the entrance animates
  el.classList.add('is-open');

  backdrop.addEventListener('click', () => layer.requestDismiss());
  el.addEventListener('keydown', (event) => trapFocus(event, panel));

  if (autoFocus) {
    const focusTarget = initialFocus || panel.querySelector('[data-autofocus]') || panel;
    setTimeout(() => {
      if (!closed && !panel.contains(document.activeElement)) focusTarget.focus({ preventScroll: true });
    }, kind === 'page' ? 30 : 0);
  }

  function close(reason = 'close') {
    if (closed) return;
    closed = true;
    const index = layers.indexOf(layer);
    if (index >= 0) layers.splice(index, 1);
    el.classList.remove('is-open');
    el.classList.add('is-closing');
    if (kind === 'page' && !layers.some((l) => l.kind === 'page')) {
      document.body.classList.remove('sheet-presented');
      presentationListener(false);
    }
    const top = layers[layers.length - 1];
    if (top) top.el.removeAttribute('inert');
    else document.getElementById('app').removeAttribute('inert');

    const finish = () => el.remove();
    if (prefersReducedMotion()) finish();
    else {
      panel.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, 600);
    }
    // Blur first so the iPhone keyboard slides away together with the sheet.
    const focused = document.activeElement;
    if (focused && (panel.contains(focused) || focused.id === 'focus-proxy')) focused.blur();
    if (returnFocus && returnFocus.id !== 'focus-proxy' && document.contains(returnFocus) && typeof returnFocus.focus === 'function') {
      returnFocus.focus({ preventScroll: true });
    }
    if (reason === 'dismiss' && onDismiss) onDismiss();
  }

  return layer;
}

export function topLayer() {
  return layers[layers.length - 1] || null;
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && layers.length) {
    event.preventDefault();
    layers[layers.length - 1].requestDismiss();
  }
});

function trapFocus(event, panel) {
  if (event.key !== 'Tab') return;
  const items = [...panel.querySelectorAll(FOCUSABLE)].filter((node) => node.offsetParent !== null || node === document.activeElement);
  if (!items.length) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// Drag the grabber or header of a page sheet down to close it, like on iOS.
function enableDragToDismiss(layer) {
  const { panel, el } = layer;
  let startY = 0;
  let lastY = 0;
  let lastTime = 0;
  let velocity = 0;
  let offset = 0;
  let pointerId = null;

  panel.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || !event.target.closest('[data-drag-handle]')) return;
    if (event.target.closest('button, input, textarea, select, a, label')) return;
    pointerId = event.pointerId;
    startY = lastY = event.clientY;
    lastTime = event.timeStamp;
    velocity = 0;
    offset = 0;
    panel.setPointerCapture(pointerId);
    el.classList.add('is-dragging');
  });

  panel.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    const dy = event.clientY - startY;
    offset = dy > 0 ? dy : dy / 6; // resist dragging upwards
    const dt = event.timeStamp - lastTime;
    if (dt > 0) velocity = (event.clientY - lastY) / dt;
    lastY = event.clientY;
    lastTime = event.timeStamp;
    panel.style.transform = `translateY(${offset}px)`;
    el.style.setProperty('--drag-progress', String(Math.min(1, Math.max(0, offset / panel.offsetHeight))));
  });

  const end = (event) => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    el.classList.remove('is-dragging');
    panel.style.transform = '';
    el.style.removeProperty('--drag-progress');
    if (offset > Math.min(160, panel.offsetHeight * 0.3) || (velocity > 0.6 && offset > 20)) layer.requestDismiss();
  };
  panel.addEventListener('pointerup', end);
  panel.addEventListener('pointercancel', end);
}

/** iOS-style action sheet. Resolves with the chosen action's value, or null. */
export function actionSheet({ title, message, actions }) {
  return new Promise((resolve) => {
    let result = null;
    const titleId = `sheet-title-${++uid}`;
    const choose = (value) => {
      result = value;
      layer.close();
      resolve(value);
    };
    const group = h('div', { class: 'action-group' },
      (title || message) && h('div', { class: 'action-header' },
        title && h('p', { class: 'action-title', id: titleId }, title),
        message && h('p', { class: 'action-message' }, message)),
      actions.filter((a) => a.role !== 'cancel').map((action) =>
        h('button', {
          type: 'button',
          class: `action-button${action.role === 'destructive' ? ' is-destructive' : ''}`,
          onClick: () => choose(action.value),
        }, action.label)));
    const cancel = actions.find((a) => a.role === 'cancel');
    const content = h('div', { class: 'action-sheet' },
      group,
      cancel && h('button', { type: 'button', class: 'action-button action-cancel', 'data-autofocus': '', onClick: () => choose(null) }, cancel.label));
    const layer = openLayer({
      kind: 'action',
      content,
      labelledBy: title ? titleId : undefined,
      label: title ? undefined : 'Options',
      onDismiss: () => resolve(result),
    });
  });
}

/** Centered iOS-style alert. Resolves with the chosen action's value, or null. */
export function alertDialog({ title, message, actions }) {
  return new Promise((resolve) => {
    const titleId = `alert-title-${++uid}`;
    const choose = (value) => {
      layer.close();
      resolve(value);
    };
    const buttons = actions.map((action) =>
      h('button', {
        type: 'button',
        class: `alert-button${action.role === 'destructive' ? ' is-destructive' : ''}${action.role === 'cancel' ? ' is-cancel' : ''}${action.primary ? ' is-primary' : ''}`,
        'data-autofocus': action.role === 'cancel' ? '' : undefined,
        onClick: () => choose(action.role === 'cancel' ? null : action.value),
      }, action.label));
    const content = h('div', { class: 'alert' },
      h('div', { class: 'alert-body' },
        h('p', { class: 'alert-title', id: titleId }, title),
        message && h('p', { class: 'alert-message' }, message)),
      h('div', { class: `alert-buttons${buttons.length > 2 ? ' is-stacked' : ''}` }, buttons));
    const layer = openLayer({ kind: 'alert', content, labelledBy: titleId, onDismiss: () => resolve(null) });
  });
}

// ---------- Toasts ----------

let activeToast = null;

export function toast(message, { actionLabel, onAction, duration = 4000, iconName } = {}) {
  const root = document.getElementById('toast-root');
  if (activeToast) activeToast.dismiss();
  const action = actionLabel
    ? h('button', {
      type: 'button',
      class: 'toast-action',
      onClick: () => {
        dismiss();
        onAction?.();
      },
    }, actionLabel)
    : null;
  const el = h('div', { class: 'toast' },
    iconName && h('span', { class: 'toast-icon' }, icon(iconName)),
    h('span', { class: 'toast-text' }, message),
    action);
  root.append(el);
  void el.offsetHeight;
  el.classList.add('is-visible');

  let timer = setTimeout(dismiss, duration);
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => {
    clearTimeout(timer);
    timer = setTimeout(dismiss, 2000);
  });

  let gone = false;
  function dismiss() {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    el.classList.remove('is-visible');
    setTimeout(() => el.remove(), 300);
    if (activeToast && activeToast.el === el) activeToast = null;
  }
  activeToast = { el, dismiss };
  return activeToast;
}

// ---------- Segmented control ----------

/** iOS-style segmented control built on radio buttons (keyboard and screen reader friendly). */
export function segmented({ options, value, onChange, label, className = '' }) {
  const name = `seg-${++uid}`;
  const root = h('div', {
    class: `segmented ${className}`.trim(),
    role: 'radiogroup',
    'aria-label': label,
    style: { '--count': options.length },
  });
  root.append(h('span', { class: 'segmented-thumb', 'aria-hidden': 'true' }));
  const inputs = options.map((option) => {
    const id = `${name}-${option.value}`;
    const input = h('input', { type: 'radio', name, id, value: option.value, class: 'segmented-input' });
    input.addEventListener('change', () => {
      if (!input.checked) return;
      update(option.value);
      onChange?.(option.value);
    });
    const optionLabel = h('label', { for: id, class: 'segmented-option', dataset: { value: option.value } },
      option.icon ? icon(option.icon) : null,
      h('span', null, option.label));
    root.append(input, optionLabel);
    return input;
  });

  function update(next) {
    const index = Math.max(0, options.findIndex((o) => o.value === next));
    inputs.forEach((input, i) => { input.checked = i === index; });
    root.style.setProperty('--index', String(index));
    root.dataset.value = options[index].value;
  }
  update(value);

  return {
    el: root,
    set: update,
    get value() {
      return root.dataset.value;
    },
  };
}

// ---------- Haptics ----------

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * A light tap of haptic feedback. Android supports navigator.vibrate; iOS 18+
 * gives a native tap when a switch control toggles, so we toggle a hidden one.
 */
export function haptic() {
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(8);
      return;
    }
    if (!isIOS) return;
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return; // don't disturb the keyboard
    const input = h('input', { type: 'checkbox', switch: true, tabindex: '-1' });
    const label = h('label', { 'aria-hidden': 'true', style: { display: 'none' } }, input);
    document.body.append(label);
    label.click();
    label.remove();
  } catch {
    /* haptics are optional */
  }
}

export { isIOS };

/**
 * iOS only shows the keyboard when focus() runs during a tap. Sheets slide in,
 * so we focus an invisible field right away and move focus to the real input
 * once the sheet is in place.
 */
export function summonKeyboard() {
  const proxy = document.getElementById('focus-proxy');
  if (!proxy) return;
  proxy.value = '';
  proxy.focus({ preventScroll: true });
}

/** Moves focus from the invisible field to the real one, keeping anything already typed. */
export function handOverKeyboard(input) {
  const proxy = document.getElementById('focus-proxy');
  if (proxy && document.activeElement === proxy && proxy.value) {
    input.value += proxy.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (proxy) proxy.value = '';
  input.focus({ preventScroll: true });
}
