// ===== SHARED-ELEMENT PAGE TRANSITIONS =====
// Opening a title morphs the artwork you pressed into the title page: a poster
// flies into the page's poster, a backdrop (the home hero, a Continue Watching
// still, a hover preview) into the page's backdrop, and a title logo (the hero's,
// a hover preview's, a "Because you liked …" rail heading's) into the page's
// logo. Going back runs the same morph in reverse onto the card you came from,
// when it is on screen.
//
// How it works with the View Transitions API (router.js owns the transition):
//   1. Before the transition starts, the source images are given shared names
//      (armSources). The browser snapshots them as the "old" state.
//   2. Inside the update callback the names are taken off the sources first
//      (releaseSources), then the new page renders. The title page's first
//      paint (js/detail.js) carries the same names, built from the hint this
//      module read off the pressed element, so both ends exist in one frame.
//   3. The title page waits for the morph to finish (transitionSettled) before
//      it swaps its first paint for the full page, so the element being
//      animated to never disappears mid-flight.
//
// A name must be unique when each snapshot is taken, which is why sources are
// released inside the callback and only elements actually visible on screen are
// ever tagged (a card scrolled out of its row would otherwise fly in from
// nowhere).
import { prefersReducedMotion } from './ui.js';
import { IMG } from './config.js';

export const NAMES = { poster: 'cv-poster', backdrop: 'cv-backdrop', logo: 'cv-logo' };
const LOGO = '.hero-logo, .cvp-logo, .rail-logo, .title-logo';
// Groups a pressed button belongs to, so "Watch Now" in the hero finds the
// hero's backdrop and logo.
const SCOPE = '.card, .hero-slide, .cvp, .continue-card, .t10-hero, .t10-row, .fr-card, .release-card, .party-hero, .ad-spot, .fp-part, .bo-chart-row, .discover-spotlight-card, .rec-head';
// Images that are decoration on top of artwork, never the artwork itself.
const NOT_ART = '.card-lqip, .card-provider-badge img, .watched-badge img, .card-myrating img, .sx-row-provider img';

let active = null;
const tagged = new Set();

export const canMorph = () => typeof document.startViewTransition === 'function' && !prefersReducedMotion();

/**
 * Router: remember the running transition. `onDone` runs when it finishes,
 * unless a newer transition has replaced it by then (an interrupted morph must
 * not clear the names the next one just set).
 */
export function setActiveTransition(transition, onDone) {
  active = transition;
  transition.ready?.catch(() => {});
  transition.updateCallbackDone?.catch(() => {});
  transition.finished.catch(() => {}).finally(() => {
    if (active !== transition) return;
    active = null;
    onDone?.();
  });
}

export const hasArmedSources = () => tagged.size > 0;

// Work that must wait until the old page has been snapshotted: an overlay that
// holds a morph source (the hover preview) closes here instead of at once. The
// router flushes the queue at the start of the swap; a timer is the backstop.
const afterSnapshotQueue = [];
export function afterSnapshot(fn) {
  afterSnapshotQueue.push(fn);
  setTimeout(flushAfterSnapshot, 1000);
}
export function flushAfterSnapshot() {
  afterSnapshotQueue.splice(0).forEach(fn => { try { fn(); } catch (error) { console.error(error); } });
}

/**
 * Resolves once the running page transition has finished animating (at once
 * when none is running). Capped, so a transition the browser stalls can never
 * hold a page back.
 */
export function transitionSettled(cap = 900) {
  if (!active) return Promise.resolve();
  return Promise.race([active.finished.catch(() => {}), new Promise(resolve => setTimeout(resolve, cap))]);
}

/**
 * Pure: the share of `rect` inside every clip in `clips` (viewport first, then
 * any scrolling or clipping ancestors), 0–1.
 */
export function visibleShare(rect, clips) {
  if (!(rect.width > 0 && rect.height > 0)) return 0;
  let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
  for (const clip of clips) {
    left = Math.max(left, clip.left); top = Math.max(top, clip.top);
    right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom);
    if (right <= left || bottom <= top) return 0;
  }
  return ((right - left) * (bottom - top)) / (rect.width * rect.height);
}

// The viewport plus every clipping ancestor's box, or null when a parent hides it.
function clipsFor(el) {
  const clips = [{ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }];
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      const r = node.getBoundingClientRect();
      clips.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
  }
  return clips;
}

function onScreen(el, min = 0.6) {
  const rect = el.getBoundingClientRect();
  if (rect.width < 24 || rect.height < 24) return false;
  const clips = clipsFor(el);
  return !!clips && visibleShare(rect, clips) >= min;
}

/**
 * Pure: a clip-path inset (percent of the box) that trims `rect` to what the
 * clips let through, or '' when nothing is cut. Percentages hold under a
 * uniform scale, so a zooming hero image is trimmed correctly too.
 */
export function insetFor(rect, clips) {
  let { left, top, right, bottom } = rect;
  for (const clip of clips) {
    left = Math.max(left, clip.left); top = Math.max(top, clip.top);
    right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom);
  }
  const pct = (cut, size) => Math.max(0, Math.round((cut / size) * 1000) / 10);
  const inset = [pct(top - rect.top, rect.height), pct(rect.right - right, rect.width), pct(rect.bottom - bottom, rect.height), pct(left - rect.left, rect.width)];
  return inset.some(v => v > 0.2) ? `inset(${inset.map(v => `${v}%`).join(' ')})` : '';
}

// A snapshot is taken of the whole element, not the part its scrolling row or
// the hero frame shows, so a source is trimmed to its on-screen part first.
const trimmed = new Map();
function trimToScreen(el) {
  const clips = clipsFor(el);
  const inset = clips ? insetFor(el.getBoundingClientRect(), clips) : '';
  if (!inset) return;
  trimmed.set(el, el.style.clipPath);
  el.style.clipPath = inset;
}

/** Pure: which job an artwork box does — portrait art is a poster, wide art a backdrop. */
export const artKind = (width, height) => (width / height > 1.15 ? 'backdrop' : 'poster');

const usable = img => img && !img.matches(NOT_ART) && img.complete && img.naturalWidth > 0 && !(img.currentSrc || img.src || '').startsWith('data:');

/**
 * The artwork a press should morph from: { poster, backdrop, logo }, each
 * { el, src } when that piece is visible on screen. Also reads a title and the
 * TMDB paths cards carry, so the title page's first paint can show artwork the
 * press did not include (a card's backdrop, say) without waiting for the fetch.
 */
export function captureArt(trigger) {
  const scope = trigger.closest(SCOPE) || trigger;
  const art = { poster: null, backdrop: null, logo: null, title: '', backdropPath: '', posterPath: '', logoTone: '' };
  const images = [...new Set([...trigger.querySelectorAll('img'), ...(scope === trigger ? [] : scope.querySelectorAll('img'))])];
  for (const img of images) {
    if (!usable(img)) continue;
    // Artwork that belongs to a different title's link (a rail heading's
    // poster beside another title's name) is not this title's.
    const owner = img.closest('[data-action="open-detail"]');
    if (owner && owner !== trigger && owner.dataset.id !== trigger.dataset.id) continue;
    const src = img.currentSrc || img.src;
    if (img.matches(LOGO)) {
      if (!art.logo && onScreen(img, 0.8)) { art.logo = { el: img, src }; art.logoTone = img.dataset.tone || ''; }
      continue;
    }
    if (!onScreen(img)) continue;
    const rect = img.getBoundingClientRect();
    const kind = artKind(rect.width, rect.height);
    if (!art[kind]) art[kind] = { el: img, src };
  }
  const card = trigger.closest('[data-backdrop]') || scope.querySelector?.('[data-backdrop]');
  art.backdropPath = card?.dataset.backdrop || '';
  art.posterPath = trigger.dataset.poster || '';
  art.title = trigger.dataset.title
    || scope.querySelector?.('.card-title, .hero-title, .t10-hero-copy h2, .continue-body h3, .cvp-wordmark')?.textContent
    || art.logo?.el.alt || '';
  return art;
}

/** The first-paint hint for the title page, built from captured art. */
export function hintFrom(art, { id, type }) {
  return {
    id, type,
    title: (art.title || '').trim(),
    poster: art.poster?.src || (art.posterPath ? `${IMG}w342${art.posterPath}` : ''),
    backdrop: art.backdrop?.src || (art.backdropPath ? `${IMG}w780${art.backdropPath}` : ''),
    logo: art.logo?.src || '',
    logoTone: art.logoTone,
    // Only pieces with an on-screen source get a shared name on the title page.
    morph: canMorph() ? { poster: !!art.poster, backdrop: !!art.backdrop, logo: !!art.logo } : {},
  };
}

function tag(el, kind) {
  const name = NAMES[kind];
  for (const other of tagged) if (other !== el && other.style.viewTransitionName === name) { other.style.viewTransitionName = ''; tagged.delete(other); }
  el.style.viewTransitionName = name;
  tagged.add(el);
}

/** Name the captured sources so the next page transition snapshots them. */
export function armSources(art) {
  if (!canMorph()) return;
  releaseSources();
  for (const kind of ['poster', 'backdrop', 'logo']) if (art[kind]) { tag(art[kind].el, kind); trimToScreen(art[kind].el); }
  if (tagged.size) document.documentElement.classList.add('vt-morph');
  // Hover zoom and tilt are frozen so the snapshot is the artwork at rest.
  for (const el of tagged) el.closest('.card, .continue-card, .fr-card, .bo-home-card, .t10-row')?.classList.add('vt-source');
}

/** Take shared names off every element this module tagged. */
export function releaseSources() {
  tagged.forEach(el => { el.style.viewTransitionName = ''; });
  tagged.clear();
  trimmed.forEach((previous, el) => { el.style.clipPath = previous; });
  trimmed.clear();
}

/**
 * Leaving a title page for another page: name the page's poster, backdrop and
 * logo as sources, and remember which title it was so the landing page's card
 * can be named as the destination. Null when the page is not a title page.
 */
export function armReturn(fromPath) {
  const match = /^\/(movie|tv)\/(\d+)\/?$/.exec(fromPath || '');
  if (!match || !canMorph()) return null;
  const host = document.getElementById('detailContent');
  if (!host) return null;
  releaseSources();
  const kinds = {};
  const poster = host.querySelector('.detail-poster:not(.detail-poster-empty)');
  if (poster && onScreen(poster, 0.5)) { tag(poster, 'poster'); trimToScreen(poster); kinds.poster = true; }
  // The backdrop's frame, with its shading, is what flies back.
  const backdrop = host.querySelector('.detail-back:not(.detail-back-portrait):not(.detail-back-empty)');
  if (backdrop?.querySelector(':scope > img') && onScreen(backdrop, 0.4)) { tag(backdrop, 'backdrop'); trimToScreen(backdrop); kinds.backdrop = true; }
  const logo = host.querySelector('.title-logo');
  if (logo && onScreen(logo, 0.8)) { tag(logo, 'logo'); kinds.logo = true; }
  if (!Object.keys(kinds).length) return null;
  document.documentElement.classList.add('vt-morph');
  return { type: match[1], id: match[2], kinds };
}

/** Inside the update callback, after the landing page rendered and scrolled. */
export function landReturn(ret) {
  releaseSources();
  if (!ret) return;
  const links = document.querySelectorAll(`[data-action="open-detail"][data-id="${ret.id}"][data-type="${ret.type}"]`);
  const found = {};
  for (const link of links) {
    const art = captureArt(link);
    for (const kind of ['poster', 'backdrop', 'logo']) {
      if (ret.kinds[kind] && !found[kind] && art[kind]) { tag(art[kind].el, kind); trimToScreen(art[kind].el); found[kind] = true; }
    }
    if (Object.keys(found).length === Object.keys(ret.kinds).length) break;
  }
}

/** After the transition: clear every shared name and the frozen-hover state. */
export function finishTransition() {
  releaseSources();
  document.querySelectorAll('[style*="view-transition-name"]').forEach(el => { el.style.viewTransitionName = ''; });
  document.querySelectorAll('.vt-source').forEach(el => el.classList.remove('vt-source'));
  document.documentElement.classList.remove('vt-morph');
}
