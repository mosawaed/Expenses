// Swipe a transaction to the left to reveal "Delete" — swipe far to delete
// right away, like in the iPhone Mail app. Taps open the transaction.

import { haptic } from './ui.js';
import { prefersReducedMotion } from './dom.js';

const ACTION_WIDTH = 88;
const OPEN_THRESHOLD = 44;
const FULL_SWIPE_RATIO = 0.55;

let openRow = null;

// A touch anywhere else closes a row that is showing its Delete button.
document.addEventListener('pointerdown', (event) => {
  if (openRow && !openRow.contains(event.target)) closeRow(openRow);
}, true);

function setOffset(row, x) {
  row.style.setProperty('--swipe-x', `${x}px`);
}

function settle(row, x) {
  row.classList.add('is-settling');
  setOffset(row, x);
  const done = () => row.classList.remove('is-settling');
  row.addEventListener('transitionend', done, { once: true });
  setTimeout(done, 400);
}

function closeRow(row) {
  if (openRow === row) openRow = null;
  row.classList.remove('is-open', 'is-armed');
  settle(row, 0);
}

function suppressNextClick(row) {
  row.dataset.suppressClick = '1';
  setTimeout(() => { delete row.dataset.suppressClick; }, 450);
}

/** Animates a row away, then calls onDelete(id). */
export function removeRow(row, onDelete) {
  if (!row || row.classList.contains('is-removing')) return;
  row.classList.add('is-removing');
  if (openRow === row) openRow = null;
  const { id } = row.dataset;
  if (prefersReducedMotion()) {
    onDelete(id);
    return;
  }
  row.classList.add('is-armed');
  settle(row, -row.offsetWidth);
  setTimeout(() => {
    row.style.height = `${row.offsetHeight}px`;
    void row.offsetHeight;
    row.classList.add('is-collapsing');
    row.style.height = '0px';
    setTimeout(() => onDelete(id), 230);
  }, 170);
}

export function attachSwipe(container, { onDelete, onOpen }) {
  let drag = null;

  container.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    const content = event.target.closest('.tx-content');
    if (!content || !container.contains(content)) return;
    const row = content.closest('.tx-row');
    if (row.classList.contains('is-removing')) return;
    const base = row === openRow ? -ACTION_WIDTH : 0;
    drag = {
      row,
      content,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      base,
      x: base,
      locked: null,
      armed: false,
      width: row.offsetWidth,
    };
  });

  container.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.locked) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        drag.locked = 'x';
        drag.row.classList.add('is-swiping');
        try {
          drag.content.setPointerCapture(event.pointerId);
        } catch {
          /* not critical */
        }
      } else if (Math.abs(dy) > 8) {
        drag.locked = 'y'; // the user is scrolling the list
      }
    }
    if (drag.locked !== 'x') return;
    event.preventDefault();
    let x = drag.base + dx;
    if (x > 0) x /= 4; // gentle resistance when pulling the wrong way
    drag.x = x;
    const armed = -x > drag.width * FULL_SWIPE_RATIO;
    if (armed !== drag.armed) {
      drag.armed = armed;
      drag.row.classList.toggle('is-armed', armed);
      if (armed) haptic();
    }
    setOffset(drag.row, x);
  });

  const finish = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { row, locked, x, armed } = drag;
    drag = null;
    if (locked !== 'x') return;
    row.classList.remove('is-swiping');
    suppressNextClick(row);
    if (event.type === 'pointercancel') {
      settle(row, row === openRow ? -ACTION_WIDTH : 0);
      return;
    }
    if (armed) {
      removeRow(row, onDelete);
    } else if (-x > OPEN_THRESHOLD) {
      openRow = row;
      row.classList.add('is-open');
      settle(row, -ACTION_WIDTH);
    } else {
      closeRow(row);
    }
  };
  container.addEventListener('pointerup', finish);
  container.addEventListener('pointercancel', finish);

  container.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('.tx-delete');
    if (deleteButton) {
      removeRow(deleteButton.closest('.tx-row'), onDelete);
      return;
    }
    const content = event.target.closest('.tx-content');
    if (!content) return;
    const row = content.closest('.tx-row');
    if (row.dataset.suppressClick || row.classList.contains('is-removing')) return;
    if (row === openRow) {
      closeRow(row); // like iOS: a tap on an open row just closes it
      return;
    }
    onOpen(row.dataset.id);
  });

  container.addEventListener('keydown', (event) => {
    const content = event.target.closest('.tx-content');
    if (!content) return;
    const row = content.closest('.tx-row');
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(row.dataset.id);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeRow(row, onDelete);
    }
  });
}
