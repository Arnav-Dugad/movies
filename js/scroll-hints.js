// ===== SCROLL HINTS =====
// On a phone a horizontal row gives no sign that it scrolls: the last card is
// simply cut by the screen edge. Every horizontal scroller gets a soft fade on
// the edge that has more to show: the right edge at the start, both edges in
// the middle, the left at the end, none when everything fits. Desktop rows keep
// their arrow buttons and no fade.
//
// The state lives in a data attribute (data-scroll-fade="start|middle|end"),
// set on scroll, when rows are added, and on resize; the fade itself is a CSS
// mask (css/refinements.css).

// Any element whose content can scroll sideways qualifies; these are the
// families that do, checked by class so hidden rows cost nothing.
export const SCROLLERS = '.row, .cast-scroll, .season-scroll, .season-tabs, .gal-scroll, .vid-scroll, .similar-row, .genre-scroll, .search-chips, .search-filters, .discover-presets, .discover-jumpbar, .settings-jump, .fp-parts, .fp-tabs, .franchise-row, .network-scroll, .notification-tabs, .notification-provider-prefs, .person-tabs, .person-photo-row, .profile-recent-row, .release-tabs, .stats-index-jump, .taste-change-track, .voice-hints, .wl-lists, .finale-shelf, .diary-year, .diary-otd-years, .year-chips, .award-timeline, .bo-director-eras, .continue-row';

/** Pure: which edges of a scroller have more content. */
export function fadeState(scrollLeft, clientWidth, scrollWidth) {
  const room = scrollWidth - clientWidth;
  if (room <= 4) return '';
  // Right-to-left layouts report negative positions; the distance is what counts.
  const at = Math.abs(scrollLeft);
  if (at <= 4) return 'start';
  if (at >= room - 4) return 'end';
  return 'middle';
}

function update(el) {
  const state = fadeState(el.scrollLeft, el.clientWidth, el.scrollWidth);
  if ((el.dataset.scrollFade || '') === state) return;
  if (state) el.dataset.scrollFade = state; else delete el.dataset.scrollFade;
}

let queued = false;
function sweep() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    document.querySelectorAll(SCROLLERS).forEach(el => { if (el.clientWidth) update(el); });
  });
}

export function initScrollHints() {
  if (typeof document === 'undefined') return;
  // Scroll events do not bubble; a capturing listener hears every scroller.
  document.addEventListener('scroll', event => {
    const el = event.target;
    if (el instanceof Element && el.matches(SCROLLERS)) update(el);
  }, { capture: true, passive: true });
  window.addEventListener('resize', sweep, { passive: true });
  // Rows are rendered and refilled all the time; one pass per frame follows them.
  new MutationObserver(sweep).observe(document.body, { childList: true, subtree: true });
  // A row in a section that skipped rendering (content-visibility) has no width
  // to measure until it comes on screen.
  document.addEventListener('contentvisibilityautostatechange', sweep, true);
  // Images arriving can widen a row after it rendered.
  document.addEventListener('load', event => { if (event.target instanceof HTMLImageElement) sweep(); }, true);
  sweep();
}
