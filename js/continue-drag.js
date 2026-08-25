// ===== DRAG TO REORDER CONTINUE WATCHING =====
// Arrow buttons worked and were reachable from a keyboard, but moving a card six
// places meant six taps and six repaints. Dragging is what a row of cards asks
// for.
//
// Built on Pointer Events, so one implementation covers mouse, touch and pen.
// The dragged card is lifted out with a transform and its neighbours slide with
// transforms too — nothing reflows during the gesture, so a long rail stays at
// full frame rate. Only when the pointer is released does the order actually
// change, once.
//
// A drag is a pointer gesture, so it cannot be the only way to express an order:
// the same grip is focusable and moves the card with the arrow keys.
import { moveContinue, moveContinueTo } from './continue-prefs.js';

const EDGE = 72;            // auto-scroll zone at each end of the rail
const EDGE_SPEED = 14;      // px per frame at the very edge
const START_SLOP = 6;       // movement before a press becomes a drag

let session = null;
let scrollRAF = 0;

const rowOf = card => card?.closest?.('.continue-row') || null;
const cardsIn = row => [...row.querySelectorAll('.continue-card[data-continue]:not(.hidden-card)')];

function layout(row) {
  return cardsIn(row).map(card => {
    const box = card.getBoundingClientRect();
    return { card, key: card.dataset.continue, left: box.left, width: box.width, centre: box.left + box.width / 2 };
  });
}

/** Where the dragged card would land, given the pointer's current position. */
function targetIndex(items, from, pointerX) {
  let index = 0;
  for (let i = 0; i < items.length; i++) if (pointerX > items[i].centre) index = i;
  // Dragging right past a card should place AFTER it; left, before it.
  if (pointerX <= items[0].centre) index = 0;
  return Math.max(0, Math.min(items.length - 1, index));
}

// Every card except the dragged one slides by exactly one slot, in whichever
// direction closes the gap it left behind.
function paint(session) {
  const { items, from, to, dx } = session;
  const gap = items.length > 1 ? items[1].left - (items[0].left + items[0].width) : 0;
  const step = items[from].width + gap;
  items.forEach((item, index) => {
    if (index === from) {
      item.card.style.transform = `translate3d(${dx}px,-6px,0) scale(1.03)`;
      return;
    }
    let shift = 0;
    if (from < to && index > from && index <= to) shift = -step;
    else if (from > to && index >= to && index < from) shift = step;
    item.card.style.transform = shift ? `translate3d(${shift}px,0,0)` : '';
  });
}

function clearTransforms(items) {
  items.forEach(item => {
    item.card.style.transform = '';
    item.card.classList.remove('continue-dragging', 'continue-shifting');
  });
}

function autoScroll(row, pointerX) {
  cancelAnimationFrame(scrollRAF);
  const box = row.getBoundingClientRect();
  let speed = 0;
  if (pointerX < box.left + EDGE) speed = -EDGE_SPEED * Math.min(1, (box.left + EDGE - pointerX) / EDGE);
  else if (pointerX > box.right - EDGE) speed = EDGE_SPEED * Math.min(1, (pointerX - (box.right - EDGE)) / EDGE);
  if (!speed) return;
  const tick = () => {
    if (!session) return;
    row.scrollLeft += speed;
    session.originX -= speed;                 // the rail moved under the pointer
    move(session.lastX);
    scrollRAF = requestAnimationFrame(tick);
  };
  scrollRAF = requestAnimationFrame(tick);
}

function move(pointerX) {
  if (!session) return;
  session.lastX = pointerX;
  session.dx = pointerX - session.originX;
  session.to = targetIndex(session.items, session.from, pointerX);
  paint(session);
}

function finish(commit) {
  if (!session) return;
  const { row, items, from, to } = session;
  cancelAnimationFrame(scrollRAF); scrollRAF = 0;
  row.classList.remove('continue-reordering');
  clearTransforms(items);
  const held = session;
  session = null;
  try { held.card.releasePointerCapture?.(held.pointerId); } catch (_) {}
  if (!commit || from === to) return;
  // One state change, one repaint, at the end of the gesture.
  moveContinueTo(items[from].key, to, items.map(item => item.key));
}

function begin(event, card) {
  const row = rowOf(card);
  if (!row) return;
  const items = layout(row);
  const from = items.findIndex(item => item.card === card);
  if (from < 0) return;
  session = {
    row, card, items, from, to: from,
    pointerId: event.pointerId,
    originX: event.clientX, lastX: event.clientX, dx: 0,
  };
  row.classList.add('continue-reordering');
  card.classList.add('continue-dragging');
  items.forEach((item, index) => { if (index !== from) item.card.classList.add('continue-shifting'); });
  try { card.setPointerCapture(event.pointerId); } catch (_) {}
  paint(session);
}

export function initContinueDrag() {
  let armed = null;      // a press that has not yet moved far enough to be a drag

  document.addEventListener('pointerdown', event => {
    if (event.button > 0) return;
    const handle = event.target.closest?.('.continue-drag-handle');
    if (!handle) return;
    const card = handle.closest('.continue-card[data-continue]');
    if (!card || !rowOf(card)) return;
    // Do not swallow the gesture yet: a press that never moves should still be
    // able to focus the handle and be driven from the keyboard.
    armed = { card, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }, { passive: true });

  document.addEventListener('pointermove', event => {
    if (armed && event.pointerId === armed.pointerId && !session) {
      if (Math.abs(event.clientX - armed.x) < START_SLOP && Math.abs(event.clientY - armed.y) < START_SLOP) return;
      begin(event, armed.card);
      armed = null;
      if (!session) return;
    }
    if (!session || event.pointerId !== session.pointerId) return;
    event.preventDefault();
    move(event.clientX);
    autoScroll(session.row, event.clientX);
  }, { passive: false });

  const end = event => {
    if (armed && event.pointerId === armed.pointerId) armed = null;
    if (session && event.pointerId === session.pointerId) finish(event.type === 'pointerup');
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);

  // A drag is a pointer gesture, so the same grip drives the order from the
  // keyboard. Focus is restored to the moved card's grip afterwards, otherwise
  // the repaint drops the reader back to the top of the page mid-reorder.
  document.addEventListener('keydown', event => {
    const handle = event.target.closest?.('.continue-drag-handle');
    if (!handle) return;
    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!direction) return;
    const row = rowOf(handle);
    if (!row) return;
    event.preventDefault();
    const key = handle.dataset.key;
    if (!moveContinue(key, direction, cardsIn(row).map(card => card.dataset.continue))) return;
    requestAnimationFrame(() => {
      document.querySelector(`.continue-drag-handle[data-key="${CSS.escape(key)}"]`)?.focus();
    });
  });
  // A drag has no meaning once the rail is gone or the page changes underneath it.
  document.addEventListener('cv:go', () => finish(false));
  window.addEventListener('blur', () => finish(false));
}

export const isDragging = () => !!session;
