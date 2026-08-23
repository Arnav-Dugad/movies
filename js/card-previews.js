// ===== DESKTOP POSTER PREVIEWS =====
// A trailer is requested only after a deliberate desktop hover. This keeps the
// first paint and mobile data use unchanged while giving every standard title
// card the same quiet, muted preview treatment.
import { tmdb } from './api.js';
import { mountAmbientVideo } from './video-bg.js';

const trailerCache = new Map();
const DESKTOP_HOVER = '(hover:hover) and (pointer:fine) and (min-width:901px)';
const HOVER_DELAY = 520;

let hoverTimer = null;
let hoveredCard = null;
let previewCard = null;
let previewTeardown = () => {};
let requestToken = 0;

function desktopHoverOK() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DESKTOP_HOVER).matches;
}

function pickTrailer(videos) {
  const youtube = (videos || []).filter(video => video.site === 'YouTube' && video.key);
  return youtube.find(video => video.type === 'Trailer' && video.official)?.key
    || youtube.find(video => video.type === 'Trailer')?.key
    || youtube.find(video => /teaser|clip/i.test(video.type || ''))?.key
    || youtube[0]?.key || '';
}

async function trailerFor(card) {
  if (card.dataset.yt) return card.dataset.yt;
  const type = card.dataset.type === 'tv' ? 'tv' : 'movie';
  const id = +card.dataset.id;
  if (!id) return '';
  const cacheKey = `${type}_${id}`;
  if (trailerCache.has(cacheKey)) return trailerCache.get(cacheKey);
  try {
    const payload = await tmdb(`/${type}/${id}/videos`);
    const key = pickTrailer(payload.results);
    trailerCache.set(cacheKey, key);
    if (key) card.dataset.yt = key;
    return key;
  } catch (_) {
    trailerCache.set(cacheKey, '');
    return '';
  }
}

function stopPreview() {
  requestToken++;
  clearTimeout(hoverTimer);
  hoverTimer = null;
  previewTeardown();
  previewTeardown = () => {};
  previewCard?.classList.remove('card-previewing');
  previewCard = null;
}

function leaveCard(card) {
  if (hoveredCard !== card) return;
  hoveredCard = null;
  stopPreview();
}

function enterCard(card) {
  if (!desktopHoverOK() || hoveredCard === card) return;
  stopPreview();
  hoveredCard = card;
  const token = ++requestToken;
  hoverTimer = setTimeout(async () => {
    const key = await trailerFor(card);
    if (!key || token !== requestToken || hoveredCard !== card || !card.isConnected || !desktopHoverOK()) return;
    const artwork = card.querySelector('.card-img');
    if (!artwork) return;
    previewCard = card;
    card.classList.add('card-previewing');
    previewTeardown = mountAmbientVideo(artwork, key, { delay: 0, overlaySelector: '.card-preview-overlay' });
  }, HOVER_DELAY);
}

export function initCardPreviews() {
  document.addEventListener('pointerover', event => {
    const card = event.target.closest?.('.card[data-id][data-type]');
    if (!card || card.contains(event.relatedTarget)) return;
    enterCard(card);
  });
  document.addEventListener('pointerout', event => {
    const card = event.target.closest?.('.card[data-id][data-type]');
    if (!card || card.contains(event.relatedTarget)) return;
    leaveCard(card);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { hoveredCard = null; stopPreview(); } });
  window.addEventListener('blur', () => { hoveredCard = null; stopPreview(); });
  window.matchMedia?.(DESKTOP_HOVER).addEventListener?.('change', event => { if (!event.matches) { hoveredCard = null; stopPreview(); } });
}

export { pickTrailer };
