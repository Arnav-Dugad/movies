// ===== DESKTOP TITLE PREVIEWS =====
// Netflix-style previews are separate landscape surfaces, never video squeezed
// into a portrait poster. They are created only after deliberate mouse hover,
// fetch at most one trailer per title, and are completely absent on touch UI.
import { tmdb } from './api.js';
import { IMG, PH } from './config.js';
import { mountAmbientVideo } from './video-bg.js';

const trailerCache = new Map();
const DESKTOP_HOVER = '(hover:hover) and (pointer:fine) and (min-width:901px)';
const HOVER_DELAY = 560;
const CLOSE_DELAY = 120;

let hoverTimer = null;
let closeTimer = null;
let hoveredCard = null;
let sourceCard = null;
let surface = null;
let previewTeardown = () => {};
let requestToken = 0;

const desktopHoverOK = () => typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && document.documentElement.dataset.posterPreview !== 'hide'
  && window.matchMedia(DESKTOP_HOVER).matches;

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
  const key = `${type}_${id}`;
  if (trailerCache.has(key)) return trailerCache.get(key);
  try {
    const payload = await tmdb(`/${type}/${id}/videos`);
    const trailer = pickTrailer(payload.results);
    trailerCache.set(key, trailer);
    if (trailer) card.dataset.yt = trailer;
    return trailer;
  } catch (_) {
    trailerCache.set(key, '');
    return '';
  }
}

function ensureSurface() {
  if (surface?.isConnected) return surface;
  surface = document.createElement('article');
  surface.className = 'card-hover-preview';
  surface.setAttribute('aria-hidden', 'true');
  surface.innerHTML = `<a class="card-hover-media" href="#" data-action="open-detail">
      <img alt=""><span class="card-hover-scrim" aria-hidden="true"></span>
    </a><div class="card-hover-info"><a class="card-hover-open" href="#" data-action="open-detail">
      <span aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
      <span><strong></strong><small></small></span><b aria-hidden="true">&#8594;</b>
    </a></div>`;
  surface.addEventListener('pointerenter', () => clearTimeout(closeTimer));
  surface.addEventListener('pointerleave', scheduleClose);
  surface.addEventListener('click', closePreview);
  document.body.appendChild(surface);
  return surface;
}

function fillSurface(card) {
  const preview = ensureSurface();
  const id = card.dataset.id, type = card.dataset.type === 'tv' ? 'tv' : 'movie';
  const title = card.dataset.title || card.getAttribute('aria-label') || card.querySelector('.card-title')?.textContent || 'Open title';
  const year = card.dataset.year || card.querySelector('.card-sub span')?.textContent || '';
  const rating = card.dataset.rating ? `★ ${card.dataset.rating}` : '';
  const image = card.dataset.backdrop ? `${IMG}w780${card.dataset.backdrop}` : card.querySelector('.card-img img')?.src || PH;
  preview.querySelector('.card-hover-media img').src = image;
  preview.querySelector('.card-hover-media img').alt = title;
  preview.querySelector('.card-hover-open strong').textContent = title;
  preview.querySelector('.card-hover-open small').textContent = [year, type === 'tv' ? 'TV show' : 'Movie', rating].filter(Boolean).join(' · ');
  preview.querySelectorAll('[data-action="open-detail"]').forEach(link => {
    link.href = `/${type}/${id}`; link.dataset.id = id; link.dataset.type = type;
  });
  return preview;
}

function positionSurface(preview, card) {
  const rect = card.getBoundingClientRect();
  const width = Math.min(460, Math.max(352, rect.width * 2.25));
  const mediaHeight = width * 9 / 16;
  const height = mediaHeight + 78;
  const left = Math.min(innerWidth - width - 12, Math.max(12, rect.left + rect.width / 2 - width / 2));
  const top = Math.min(innerHeight - height - 12, Math.max(70, rect.top + rect.height / 2 - height / 2));
  preview.classList.remove('open');
  preview.style.left = `${rect.left}px`; preview.style.top = `${rect.top}px`;
  preview.style.width = `${rect.width}px`; preview.style.height = `${rect.height}px`;
  preview.style.setProperty('--preview-media-height', `${mediaHeight}px`);
  preview.getBoundingClientRect();
  requestAnimationFrame(() => {
    if (preview !== surface || card !== sourceCard) return;
    preview.style.left = `${left}px`; preview.style.top = `${top}px`;
    preview.style.width = `${width}px`; preview.style.height = `${height}px`;
    preview.classList.add('open'); preview.setAttribute('aria-hidden', 'false');
  });
}

function closePreview() {
  requestToken++;
  clearTimeout(hoverTimer); clearTimeout(closeTimer);
  hoverTimer = null; closeTimer = null; hoveredCard = null;
  previewTeardown(); previewTeardown = () => {};
  sourceCard?.classList.remove('card-preview-source');
  sourceCard = null;
  if (!surface) return;
  surface.classList.remove('open'); surface.setAttribute('aria-hidden', 'true');
  const old = surface;
  setTimeout(() => { if (old === surface && !old.classList.contains('open')) { old.remove(); surface = null; } }, 330);
}

function scheduleClose() {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(closePreview, CLOSE_DELAY);
}

function enterCard(card) {
  if (!desktopHoverOK() || hoveredCard === card) return;
  closePreview();
  hoveredCard = card;
  const token = ++requestToken;
  hoverTimer = setTimeout(async () => {
    if (token !== requestToken || hoveredCard !== card || !card.isConnected || !desktopHoverOK()) return;
    sourceCard = card; card.classList.add('card-preview-source');
    const preview = fillSurface(card);
    positionSurface(preview, card);
    const trailer = await trailerFor(card);
    if (!trailer || token !== requestToken || sourceCard !== card || !preview.isConnected || !desktopHoverOK()) return;
    previewTeardown = mountAmbientVideo(preview.querySelector('.card-hover-media'), trailer, { delay: 0, overlaySelector: '.card-hover-scrim' });
  }, HOVER_DELAY);
}

export function initCardPreviews() {
  document.addEventListener('pointerover', event => {
    const card = event.target.closest?.('.card[data-id][data-type]');
    if (!card || card.contains(event.relatedTarget)) return;
    clearTimeout(closeTimer); enterCard(card);
  });
  document.addEventListener('pointerout', event => {
    const card = event.target.closest?.('.card[data-id][data-type]');
    if (!card || card.contains(event.relatedTarget)) return;
    if (hoveredCard === card) scheduleClose();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) closePreview(); });
  window.addEventListener('blur', closePreview);
  window.addEventListener('resize', closePreview, { passive: true });
  window.addEventListener('scroll', closePreview, { passive: true, capture: true });
  window.matchMedia?.(DESKTOP_HOVER).addEventListener?.('change', event => { if (!event.matches) closePreview(); });
  document.addEventListener('cv:prefs', () => { if (!desktopHoverOK()) closePreview(); });
  document.addEventListener('cv:go', closePreview);
}

export { pickTrailer };
