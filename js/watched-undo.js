// ===== UNDO THE LAST WATCHED MARK =====
// Marking a title watched sends a ticket stub to My List (js/ticket-stub.js).
// For the next few seconds a quiet bar offers to take it back: Undo unmarks the
// title and the stub flies back OUT of the tab, to where the poster was.
//
// One offer at a time, and it disappears the moment it is used or expires, so it
// never becomes a second, competing history.
import { flyTicketBack } from './ticket-stub.js';
import { haptic } from './haptics.js';
import { esc } from './ui.js';

const LIFETIME = 7000;
let live = null;

function dismiss() {
  if (!live) return;
  const { node, timer } = live;
  clearTimeout(timer);
  live = null;
  node.classList.remove('is-open');
  setTimeout(() => node.remove(), 260);
}

/**
 * Offer to undo the mark just made.
 * @param {{ title: string, rect: DOMRect|null, undo: () => void }} offer
 */
export function offerWatchedUndo({ title = '', rect = null, undo }) {
  dismiss();
  const zone = document.getElementById('toastZone');
  if (!zone || typeof undo !== 'function') return null;
  const node = document.createElement('div');
  node.className = 'watched-undo';
  node.setAttribute('role', 'status');
  node.innerHTML = `<span class="watched-undo-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5.2 5.2L20 7"/></svg></span>
    <span class="watched-undo-copy"><b>Marked watched</b><small>${esc(title || 'This title')}</small></span>
    <button type="button" class="watched-undo-btn">Undo</button>`;
  zone.appendChild(node);
  requestAnimationFrame(() => node.classList.add('is-open'));
  node.querySelector('.watched-undo-btn').addEventListener('click', () => {
    const back = rect;
    dismiss();
    haptic('untick');
    undo();
    flyTicketBack(back);
  }, { once: true });
  live = { node, timer: setTimeout(dismiss, LIFETIME) };
  return node;
}
