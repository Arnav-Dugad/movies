// ===== SWIPE A CONTINUE WATCHING CARD =====
// On a touch screen, flick a card's artwork up to mark its next episode watched,
// or down to hide the show from the rail. The card follows the finger, names
// what it is about to do, and springs back if you let go short of the line.
//
// Only the artwork takes the gesture (css/feel.css gives it `touch-action:
// pan-x`), so the page still scrolls from the card's title, the gaps and the
// rest of the rail — and the rail itself still scrolls sideways. In edit mode
// the rail belongs to drag-to-reorder, so the swipe stands aside.
import { haptic } from './haptics.js';
import { toast } from './ui.js';
import { toggleHidden } from './continue-prefs.js';
import { renderContinueWatching } from './home.js';

const THRESHOLD = 62, SLOP = 10;

/** Pure: what a swipe of `dy` pixels would do on a card. */
export function swipeAction(dy, { canMark = true, canHide = true, threshold = THRESHOLD } = {}) {
  if (dy <= -threshold) return canMark ? 'watch' : '';
  if (dy >= threshold) return canHide ? 'hide' : '';
  return '';
}

/** Pure: how far the card moves for a drag of `dy` (resisting past the line). */
export function swipeOffset(dy, threshold = THRESHOLD) {
  const limit = threshold * 1.6;
  if (Math.abs(dy) <= threshold) return Math.round(dy);
  const over = Math.abs(dy) - threshold;
  return Math.round(Math.sign(dy) * Math.min(limit, threshold + over * 0.35));
}

let session = null;

function end(commit) {
  if (!session) return;
  const { card, action } = session;
  card.classList.remove('is-swiping');
  card.style.removeProperty('--swipe-y');
  card.dataset.swipe = '';
  session = null;
  if (!commit || !action) return;
  // Marking runs through the card's own quick button, so the tick, the toast and
  // the milestones behave exactly as a tap on it would.
  if (action === 'watch') { card.querySelector('.continue-quick')?.click(); return; }
  const key = card.dataset.continue;
  if (!key) return;
  toggleHidden(key);
  haptic('pin');
  toast('Hidden from Continue Watching — Edit to bring it back', 'info');
  renderContinueWatching();
}

export function initContinueSwipe() {
  document.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') return;
    const art = event.target.closest?.('.continue-art-shell');
    const card = art?.closest('.continue-card');
    if (!card || card.closest('.continue-section.editing') || card.classList.contains('up-next-card')) return;
    session = {
      card, art, id: event.pointerId, x: event.clientX, y: event.clientY, live: false, action: '',
      canMark: !!card.querySelector('.continue-quick'),
    };
  }, { passive: true });

  document.addEventListener('pointermove', event => {
    if (!session || event.pointerId !== session.id) return;
    const dx = event.clientX - session.x, dy = event.clientY - session.y;
    if (!session.live) {
      if (Math.abs(dy) < SLOP || Math.abs(dy) <= Math.abs(dx)) return;
      session.live = true;
      session.card.classList.add('is-swiping');
    }
    const action = swipeAction(dy, { canMark: session.canMark });
    if (action !== session.action) { session.action = action; if (action) haptic('detent'); }
    session.card.dataset.swipe = action;
    session.card.style.setProperty('--swipe-y', `${swipeOffset(dy)}px`);
  }, { passive: true });

  const finish = event => {
    if (!session || (event.pointerId !== undefined && event.pointerId !== session.id)) return;
    end(event.type === 'pointerup' && session.live);
  };
  document.addEventListener('pointerup', finish, { passive: true });
  document.addEventListener('pointercancel', finish, { passive: true });
}
