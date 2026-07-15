// ===== TRAILER + SHARE + IMAGE LIGHTBOX =====
import { toast, $, trapFocus, lockScroll, unlockScroll } from './ui.js';
import { registerActions } from './events.js';
import { IMG } from './config.js';

export function playTrailer(key) {
  $('trailerFrame').src = `https://www.youtube.com/embed/${key}?autoplay=1&rel=0`;
  $('trailerOv').classList.add('active');
}
export function closeTrailer() {
  $('trailerFrame').src = '';
  $('trailerOv').classList.remove('active');
}
export function isTrailerOpen() { return $('trailerOv').classList.contains('active'); }

export function shareItem(title, id, type) {
  // Deep link into CineVerse itself (Vercel serves /movie/:id and /tv/:id) so the
  // shared link opens this site on that exact title — not TMDB.
  const url = `${location.origin}/${type}/${id}`;
  if (navigator.share) {
    navigator.share({ title: `CineVerse: ${title}`, url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => toast('Link copied!', 'success')).catch(() => toast('Could not copy link', 'error'));
  } else {
    toast('Sharing not supported', 'error');
  }
}

// ===== IMAGE LIGHTBOX (detail media gallery) =====
// The gallery renders w780/w342 thumbs; full-size `original` is only fetched when
// an image is actually opened.
let lbPaths = [], lbIdx = 0, lbRelease = null;

function paintLB() {
  const img = $('imgStage'), cnt = $('imgCount');
  if (!img || !lbPaths.length) return;
  img.src = `${IMG}original${lbPaths[lbIdx]}`;
  if (cnt) cnt.textContent = `${lbIdx + 1} / ${lbPaths.length}`;
}

export function openLightbox(paths, idx = 0) {
  if (!paths || !paths.length) return;
  const trigger = document.activeElement;
  lbPaths = paths; lbIdx = Math.max(0, Math.min(idx, paths.length - 1));
  paintLB();
  const ov = $('imgOv');
  ov.classList.add('active');
  lockScroll();
  lbRelease = trapFocus(ov, trigger);
  const close = $('imgClose');
  if (close) close.focus();
}

export function closeLightbox() {
  const ov = $('imgOv');
  // Idempotent — closeAllModals() calls this on every navigation, and an
  // unbalanced unlockScroll() would corrupt the lock's reference count.
  if (!ov || !ov.classList.contains('active')) return;
  ov.classList.remove('active');
  const img = $('imgStage');
  if (img) img.src = '';   // stop the download / free the decoded bitmap
  unlockScroll();
  if (lbRelease) { lbRelease(); lbRelease = null; }
  lbPaths = [];
}

export function isLightboxOpen() { return $('imgOv').classList.contains('active'); }

function stepLB(d) {
  if (!lbPaths.length) return;
  lbIdx = (lbIdx + d + lbPaths.length) % lbPaths.length;   // wraps both ways
  paintLB();
}

export function initMedia() {
  // Close when clicking the trailer backdrop (but not the video box).
  const ov = $('trailerOv');
  ov.addEventListener('click', e => { if (e.target === ov) closeTrailer(); });

  const iov = $('imgOv');
  if (iov) iov.addEventListener('click', e => { if (e.target === iov) closeLightbox(); });
  // Arrow keys while the lightbox is open. Escape is handled by the router's
  // global handleEscape(), alongside every other modal.
  document.addEventListener('keydown', e => {
    if (!isLightboxOpen()) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); stepLB(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); stepLB(-1); }
  });

  registerActions({
    'play-trailer': (el, e) => { e.stopPropagation(); playTrailer(el.dataset.key); },
    'close-trailer': () => closeTrailer(),
    'share-item': (el) => shareItem(el.dataset.title || '', el.dataset.id, el.dataset.type),
    'open-lightbox': (el, e) => {
      e.stopPropagation();
      try { openLightbox(JSON.parse(el.dataset.paths || '[]'), +el.dataset.idx || 0); } catch (_) {}
    },
    'close-lightbox': () => closeLightbox(),
    'lightbox-prev': () => stepLB(-1),
    'lightbox-next': () => stepLB(1),
  });
}
