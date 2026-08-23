// ===== INLINE DESKTOP TITLE PREVIEWS =====
// A card grows inside its own horizontal rail, so neighbouring posters glide
// aside instead of being covered by a floating panel. The trailer is decorative:
// cropped beyond YouTube's chrome, keyboard-disabled, caption-free and muted
// until the viewer explicitly chooses sound.
import { tmdb } from './api.js';
import { IMG } from './config.js';
import { mountAmbientVideo } from './video-bg.js';

const trailerCache = new Map();
const DESKTOP_HOVER = '(hover:hover) and (pointer:fine) and (min-width:901px)';
const HOVER_DELAY = 520;
const CLOSE_DELAY = 190;

let hoverTimer = null;
let closeTimer = null;
let hoveredCard = null;
let activeCard = null;
let teardown = () => {};
let requestToken = 0;

const desktopHoverOK = () => typeof window !== 'undefined'
  && document.documentElement.dataset.posterPreview !== 'hide'
  && window.matchMedia?.(DESKTOP_HOVER).matches;

function pickTrailer(videos) {
  const youtube = (videos || []).filter(video => video.site === 'YouTube' && video.key);
  return youtube.find(video => video.type === 'Trailer' && video.official)?.key
    || youtube.find(video => video.type === 'Trailer')?.key
    || youtube.find(video => /teaser|clip/i.test(video.type || ''))?.key
    || youtube[0]?.key || '';
}

async function trailerFor(card) {
  if (card.dataset.yt) return card.dataset.yt;
  const type = card.dataset.type === 'tv' ? 'tv' : 'movie', id = +card.dataset.id;
  if (!id) return '';
  const key = `${type}_${id}`;
  if (trailerCache.has(key)) return trailerCache.get(key);
  try {
    const payload = await tmdb(`/${type}/${id}/videos`);
    const trailer = pickTrailer(payload.results);
    trailerCache.set(key, trailer);
    if (trailer) card.dataset.yt = trailer;
    return trailer;
  } catch (_) {
    trailerCache.set(key, ''); return '';
  }
}

function soundButton() {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'card-preview-sound';
  button.setAttribute('aria-label', 'Unmute preview');
  button.innerHTML = '<svg class="sound-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 6a9 9 0 0 1 0 12"/></svg><svg class="sound-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m16 9 5 5M21 9l-5 5"/></svg>';
  button.addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation();
    const muted = !teardown.isMuted?.();
    teardown.setMuted?.(muted);
    button.classList.toggle('unmuted', !muted);
    button.setAttribute('aria-label', muted ? 'Unmute preview' : 'Mute preview');
  });
  return button;
}

function glideIntoView(card) {
  const row = card.parentElement;
  if (!row || !row.classList.contains('row')) return;
  const target = card.offsetLeft - (row.clientWidth - card.offsetWidth) / 2;
  row.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
}

function expand(card, trailer) {
  closePreview(true);
  activeCard = card;
  const media = card.querySelector('.card-img');
  if (!media) return;
  const base = card.getBoundingClientRect().width;
  const width = Math.min(460, Math.max(350, base * (card.classList.contains('card-w') ? 1.35 : 2.18)));
  card.style.setProperty('--inline-preview-width', `${width}px`);
  if (card.dataset.backdrop) {
    const backdrop = document.createElement('img');
    backdrop.className = 'card-preview-backdrop'; backdrop.alt = '';
    backdrop.src = `${IMG}w780${card.dataset.backdrop}`;
    media.prepend(backdrop);
  }
  card.appendChild(soundButton());
  card.classList.add('card-preview-expanded');
  teardown = mountAmbientVideo(media, trailer, { delay: 0, overlaySelector: '.card-preview-clean-mask', clean: true });
  const mask = document.createElement('span'); mask.className = 'card-preview-clean-mask'; mask.setAttribute('aria-hidden', 'true');
  media.appendChild(mask);
  requestAnimationFrame(() => glideIntoView(card));
}

function closePreview(immediate = false) {
  requestToken++;
  clearTimeout(hoverTimer); clearTimeout(closeTimer);
  hoverTimer = null; closeTimer = null;
  teardown(); teardown = () => {};
  const card = activeCard; activeCard = null;
  if (!card) return;
  card.classList.remove('card-preview-expanded');
  card.querySelector('.card-preview-sound')?.remove();
  const cleanup = () => {
    if (card.classList.contains('card-preview-expanded')) return;
    card.querySelector('.card-preview-backdrop')?.remove();
    card.querySelector('.card-preview-clean-mask')?.remove();
    card.style.removeProperty('--inline-preview-width');
  };
  if (immediate) cleanup(); else setTimeout(cleanup, 460);
}

function scheduleClose() {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => { hoveredCard = null; closePreview(); }, CLOSE_DELAY);
}

function enterCard(card) {
  if (!desktopHoverOK() || hoveredCard === card || !card.parentElement?.classList.contains('row')) return;
  hoveredCard = card;
  clearTimeout(closeTimer); clearTimeout(hoverTimer);
  const token = ++requestToken;
  hoverTimer = setTimeout(async () => {
    const trailer = await trailerFor(card);
    if (!trailer || token !== requestToken || hoveredCard !== card || !card.isConnected || !desktopHoverOK()) return;
    expand(card, trailer);
  }, HOVER_DELAY);
}

export function initCardPreviews() {
  document.addEventListener('pointerover', event => {
    const card = event.target.closest?.('.row > .card[data-id][data-type]');
    if (!card || card.contains(event.relatedTarget)) return;
    enterCard(card);
  });
  document.addEventListener('pointerout', event => {
    const card = event.target.closest?.('.row > .card[data-id][data-type]');
    if (!card || card.contains(event.relatedTarget)) return;
    if (hoveredCard === card || activeCard === card) scheduleClose();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) closePreview(true); });
  window.addEventListener('blur', () => closePreview(true));
  window.addEventListener('resize', () => closePreview(true), { passive: true });
  window.matchMedia?.(DESKTOP_HOVER).addEventListener?.('change', event => { if (!event.matches) closePreview(true); });
  document.addEventListener('cv:prefs', () => { if (!desktopHoverOK()) closePreview(true); });
  document.addEventListener('cv:go', () => closePreview(true));
}

export { pickTrailer };
