// ===== TRAILER + SHARE =====
import { toast, $ } from './ui.js';
import { registerActions } from './events.js';

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
  const url = `https://www.themoviedb.org/${type}/${id}`;
  if (navigator.share) {
    navigator.share({ title: `CineVerse: ${title}`, url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => toast('Link copied!', 'success')).catch(() => toast('Could not copy link', 'error'));
  } else {
    toast('Sharing not supported', 'error');
  }
}

export function initMedia() {
  // Close when clicking the trailer backdrop (but not the video box).
  const ov = $('trailerOv');
  ov.addEventListener('click', e => { if (e.target === ov) closeTrailer(); });
  registerActions({
    'play-trailer': (el, e) => { e.stopPropagation(); playTrailer(el.dataset.key); },
    'close-trailer': () => closeTrailer(),
    'share-item': (el) => shareItem(el.dataset.title || '', el.dataset.id, el.dataset.type),
  });
}
