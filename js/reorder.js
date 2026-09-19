// ===== DRAG TO REORDER =====
// One list, put in order by hand. Used by Settings for the blocks of a title
// page (js/detail-parts.js), and written to be used by any list of rows.
//
// The arrows beside every row are the real control: they work from a keyboard,
// they are what a screen reader announces, and they need no pointer. This adds
// the shortcut a mouse or a thumb expects on top of them — the row you hold
// follows you, the rows it passes step aside, and letting go commits where it
// landed. Nothing here is the only way to do anything.
//
// Rows are a fixed height inside one list, so the arithmetic is simple: the
// gap that opens is one row's height, and the index under the pointer is the
// distance travelled divided by that height.
import { haptic } from './haptics.js';

const ROW = '.order-row';

/**
 * Make a list draggable.
 * @param {HTMLElement} list       the element whose children are the rows
 * @param {(order: string[]) => void} onCommit  called with the keys, in the new
 *   order, once — only when the order actually changed.
 */
export function initReorder(list, onCommit) {
  if (!list || list._reorder) return;
  list._reorder = true;

  let row = null, rows = [], from = 0, to = 0, startY = 0, height = 0, pointer = 0;

  const keys = () => [...list.querySelectorAll(ROW)].map(el => el.dataset.key);

  const place = () => {
    // Every row between the two positions steps one place the other way.
    rows.forEach((el, index) => {
      if (el === row) return;
      let shift = 0;
      if (from < to && index > from && index <= to) shift = -height;
      else if (from > to && index >= to && index < from) shift = height;
      el.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  };

  const move = event => {
    if (!row) return;
    const offset = event.clientY - startY;
    row.style.transform = `translateY(${offset}px)`;
    const next = Math.max(0, Math.min(rows.length - 1, from + Math.round(offset / height)));
    if (next === to) return;
    to = next;
    haptic('detent');
    place();
  };

  const end = () => {
    if (!row) return;
    const held = row, target = to, start = from;
    rows.forEach(el => { el.style.transform = ''; el.classList.remove('sliding'); });
    held.classList.remove('lifted');
    list.classList.remove('dragging');
    row = null; rows = [];
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    if (target === start) return;
    haptic('drop');
    const order = keys();
    order.splice(target, 0, order.splice(start, 1)[0]);
    onCommit?.(order);
  };

  list.addEventListener('pointerdown', event => {
    // A grip, or anywhere on the row that is not one of its buttons.
    const target = event.target.closest?.(ROW);
    if (!target || event.button > 0 || event.target.closest('button')) return;
    rows = [...list.querySelectorAll(ROW)];
    if (rows.length < 2) return;
    row = target;
    from = to = rows.indexOf(target);
    startY = event.clientY;
    height = Math.round(rows[0].getBoundingClientRect().height + parseFloat(getComputedStyle(list).rowGap || 0) || 1) || 1;
    pointer = event.pointerId;
    list.classList.add('dragging');
    row.classList.add('lifted');
    rows.forEach(el => { if (el !== row) el.classList.add('sliding'); });
    try { list.setPointerCapture(pointer); } catch (_) {}
    haptic('peek');
    event.preventDefault();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
}
