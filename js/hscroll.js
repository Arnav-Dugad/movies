// ===== HORIZONTAL SCROLLER ARROWS (desktop only) =====
// Every horizontal strip (card rows, trailers, cast, crew, gallery, genre pills)
// hides its scrollbar, which leaves a mouse user with no way to reach the overflow.
// This decorates each strip with prev/next arrows on pointer devices; touch keeps
// swiping and never gets the buttons.
//
// Enhancement is driven by a MutationObserver rather than a call in each of the
// seven render sites: the whole app renders via `innerHTML =`, so strips appear
// and vanish constantly. `data-hs` makes it idempotent, and holding no element
// references means nothing leaks when a render blows the DOM away.
import { isTouch, prefersReducedMotion } from './ui.js';

const SEL = '.row, .cast-scroll, .vid-scroll, .similar-row, .gal-scroll, .genre-scroll, .season-scroll, .season-tabs, .fp-parts';

const ARROW = {
  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>',
};

// Hide an arrow when there's nothing that way (and both when nothing overflows).
// The 2px slack absorbs sub-pixel scroll positions at the extremes.
function sync(el, prev, next) {
  const max = el.scrollWidth - el.clientWidth;
  const scrollable = max > 4;
  prev.classList.toggle('hs-off', !scrollable || el.scrollLeft <= 2);
  next.classList.toggle('hs-off', !scrollable || el.scrollLeft >= max - 2);
}

function syncAll() {
  document.querySelectorAll('.hs-wrap').forEach(w => {
    const el = w.querySelector('[data-hs]');
    const prev = w.querySelector('.hs-prev');
    const next = w.querySelector('.hs-next');
    if (el && prev && next) sync(el, prev, next);
  });
}

function enhance(el) {
  if (el.dataset.hs) return;
  el.dataset.hs = '1';

  // Wrap so the arrows have a positioning context. Safe for the cascade: every
  // selector that reaches into these strips is a descendant match, or targets the
  // strip's own children (.row>.card), both of which survive an added ancestor.
  const wrap = document.createElement('div');
  wrap.className = 'hs-wrap';
  el.parentNode.insertBefore(wrap, el);
  wrap.appendChild(el);

  const mk = (dir) => {
    const b = document.createElement('button');
    b.className = `hs-arrow hs-${dir} hs-off`;
    b.type = 'button';
    b.setAttribute('aria-label', dir === 'prev' ? 'Scroll left' : 'Scroll right');
    b.innerHTML = ARROW[dir];
    b.addEventListener('click', (e) => {
      // These sit over cards that are themselves click targets.
      e.preventDefault();
      e.stopPropagation();
      const step = Math.max(160, Math.round(el.clientWidth * 0.85));
      el.scrollBy({ left: dir === 'prev' ? -step : step, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    });
    return b;
  };

  const prev = mk('prev'), next = mk('next');
  wrap.append(prev, next);

  let raf = null;
  el.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = null; sync(el, prev, next); });
  }, { passive: true });

  // A mouse wheel should be enough to navigate the two episode rails. Only take
  // the event while there is content in that direction; at either edge the page
  // resumes its normal vertical scroll immediately.
  if (el.matches('.season-scroll,.season-tabs')) el.addEventListener('wheel', event => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const max = el.scrollWidth - el.clientWidth;
    const canMove = event.deltaY < 0 ? el.scrollLeft > 1 : el.scrollLeft < max - 1;
    if (!canMove) return;
    event.preventDefault();
    el.scrollBy({ left: event.deltaY, behavior: 'auto' });
  }, { passive: false });

  sync(el, prev, next);
}

let scanRaf = null;
function scheduleScan() {
  if (scanRaf) return;
  scanRaf = requestAnimationFrame(() => {
    scanRaf = null;
    document.querySelectorAll(SEL).forEach(enhance);
    syncAll();   // content may have changed under an already-enhanced strip
  });
}

export function initHScroll() {
  // Pointer devices only. Touch scrolls by swiping and would just lose screen
  // space to buttons it doesn't need.
  if (isTouch()) return;
  scheduleScan();
  // childList only: enhance() mutates the DOM, so watching attributes too would
  // make sync()'s class toggles re-trigger this forever.
  new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', scheduleScan, { passive: true });
}
