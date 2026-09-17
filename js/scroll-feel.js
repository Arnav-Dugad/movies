// ===== SCROLL FEEL =====
// How scrolling feels, beyond moving.
//
// Rows: posters lean with the speed of a sideways scroll (a flick leans them
// further than a slow drag) and settle back upright once the row stops. On a
// phone, each poster that passes gives a detent, and running into either end of
// the row gives a firmer edge.
//
// The page: on a phone, each section heading that passes the middle of the
// screen gives a detent, and reaching the very top or bottom gives an edge.
//
// Detents only follow a finger that moved: a row scrolled by its arrows, by the
// keyboard or by the app itself stays silent, and so does the smooth scroll a
// tap starts (Back to top, a jump link), since a tap never moves. The lean follows any scroll, and needs motion
// allowed and Settings → Poster depth effect on.
import { haptic } from './haptics.js';
import { prefs } from './prefs.js';
import { prefersReducedMotion } from './ui.js';

// ---------- pure ----------

/** Pure: the lean, in degrees, for a sideways velocity in px/ms. */
export function tiltFor(velocity, { max = 9, gain = 7 } = {}) {
  if (!Number.isFinite(velocity)) return 0;
  const deg = Math.max(-max, Math.min(max, -velocity * gain));
  return Math.abs(deg) < .05 ? 0 : Math.round(deg * 10) / 10;
}

/** Pure: which poster sits at the row's leading edge. */
export const detentIndex = (scrollLeft, step) => (step > 0 ? Math.round(Math.max(0, scrollLeft) / step) : 0);

/** Pure: 'start', 'end' or '' for a scroll position within [0, max]. */
export function edgeOf(position, max) {
  if (!(max > 1)) return '';
  if (position <= 1) return 'start';
  if (position >= max - 1) return 'end';
  return '';
}

// ---------- rows ----------

const FINGER_MS = 2600;      // a flick keeps coasting well after the finger lifts
const SETTLE_MS = 140;       // no scroll for this long means the row has stopped…

/** Pure: …stretched when frames are arriving slowly, so a busy device does not flicker. */
export const settleAfter = frameGap => (frameGap > 0 && frameGap < 250 ? Math.min(420, Math.max(SETTLE_MS, frameGap * 2.5)) : SETTLE_MS);
const rows = new WeakMap();

const leanAllowed = () => prefs.posterTilt !== false && !prefersReducedMotion();

function stepOf(row) {
  const cards = [...row.children].filter(child => child.offsetWidth > 0);
  if (cards.length > 1) {
    const step = cards[1].offsetLeft - cards[0].offsetLeft;
    if (step > 0) return step;
  }
  return cards[0]?.offsetWidth || 0;
}

function rowState(row) {
  let s = rows.get(row);
  if (!s) {
    s = { left: row.scrollLeft, at: performance.now(), lean: 0, index: 0, edge: '', step: 0, fingerAt: -Infinity, touching: false, settle: 0, release: 0, frame: 0 };
    rows.set(row, s);
  }
  return s;
}

function arm(row, s) {
  s.step = stepOf(row);
  s.index = detentIndex(row.scrollLeft, s.step);
  s.edge = edgeOf(row.scrollLeft, row.scrollWidth - row.clientWidth);
}

function paintLean(row, s) {
  s.frame = 0;
  row.style.setProperty('--row-tilt', `${s.lean}deg`);
}

function onRowScroll(row) {
  const s = rowState(row);
  const now = performance.now(), left = row.scrollLeft;
  const dt = now - s.at;
  // A gap longer than a few dropped frames is a new gesture, not a speed.
  const velocity = dt > 0 && dt < 250 ? (left - s.left) / dt : 0;
  s.left = left; s.at = now;

  if (leanAllowed() && !row.classList.contains('continue-reordering')) {
    // Eased toward the target, so one jumpy frame does not jerk the posters.
    s.lean = Math.round((s.lean * .55 + tiltFor(velocity) * .45) * 10) / 10;
    row.classList.add('is-leaning');
    if (!s.frame) s.frame = requestAnimationFrame(() => paintLean(row, s));
    clearTimeout(s.settle); clearTimeout(s.release);
    s.settle = setTimeout(() => {
      s.lean = 0;
      row.style.setProperty('--row-tilt', '0deg');
      s.release = setTimeout(() => { if (!s.lean) row.classList.remove('is-leaning'); }, 520);
    }, settleAfter(dt));
  }

  if (s.touching || now - s.fingerAt < FINGER_MS) {
    if (!s.step) arm(row, s);
    const index = detentIndex(left, s.step);
    if (index !== s.index) { s.index = index; haptic('detent'); }
    const edge = edgeOf(left, row.scrollWidth - row.clientWidth);
    if (edge && edge !== s.edge) haptic('edge');
    s.edge = edge;
  }
}

// ---------- page ----------

const HEADS = '.section-head, .stats-section-head, .settings-panel-head, .profile-panel-head, .discover-section-head, .browse-top, .wl-head, .year-hero, .diary-head';
const page = { touching: false, moved: false, fingerAt: -Infinity, edge: 'start' };
const pageFinger = () => page.touching || performance.now() - page.fingerAt < 1600;
let headObserver = null;
const watched = new WeakSet();

/** Pure: did this intersection change carry the heading across the root's top edge? */
export function crossedMiddle({ isIntersecting, boundingClientRect: box, rootBounds: root }) {
  if (!box || !root) return false;
  return isIntersecting ? box.top < root.top : box.bottom <= root.top + 1;
}

function watchHeads() {
  if (!headObserver) {
    // The root is the lower half of the screen. A heading crosses the middle
    // when it leaves that half over its top edge (scrolling down) or comes back
    // in over it (scrolling up). Crossings are changes of state, so a fast
    // fling that carries a heading past the middle between two frames still
    // registers; headings entering or leaving at the bottom of the screen do not.
    headObserver = new IntersectionObserver(entries => {
      if (!pageFinger()) return;
      if (entries.some(crossedMiddle)) haptic('detent');
    }, { rootMargin: '-50% 0px 0px 0px', threshold: 0 });
  }
  document.querySelectorAll(HEADS).forEach(head => {
    if (watched.has(head)) return;
    watched.add(head);
    headObserver.observe(head);
  });
}

function onPageScroll() {
  if (!pageFinger()) { page.edge = edgeOf(scrollY, document.documentElement.scrollHeight - innerHeight); return; }
  const edge = edgeOf(scrollY, document.documentElement.scrollHeight - innerHeight);
  if (edge && edge !== page.edge) haptic('edge');
  page.edge = edge;
}

export function initScrollFeel() {
  // Scroll events do not bubble, but they do reach a capturing listener.
  document.addEventListener('scroll', event => {
    const target = event.target;
    if (target === document || target === document.documentElement) { onPageScroll(); return; }
    if (target instanceof Element && target.classList.contains('row')) onRowScroll(target);
  }, { capture: true, passive: true });

  let pressedRow = null;
  document.addEventListener('touchstart', event => {
    page.moved = false;
    pressedRow = event.target.closest?.('.row') || null;
    if (pressedRow) arm(pressedRow, rowState(pressedRow));
  }, { capture: true, passive: true });
  // "Touching" starts with the first move, so a tap is never a scroll.
  document.addEventListener('touchmove', () => {
    if (page.moved) return;
    page.moved = page.touching = true;
    const s = pressedRow && rows.get(pressedRow);
    if (s) s.touching = true;
  }, { capture: true, passive: true });
  const lift = () => {
    const now = performance.now();
    if (page.moved) page.fingerAt = now;
    page.touching = false;
    const s = pressedRow && rows.get(pressedRow);
    if (s) { if (s.touching) s.fingerAt = now; s.touching = false; }
    pressedRow = null;
  };
  document.addEventListener('touchend', lift, { capture: true, passive: true });
  document.addEventListener('touchcancel', lift, { capture: true, passive: true });

  watchHeads();
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; watchHeads(); });
  }).observe(document.body, { childList: true, subtree: true });
}
