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
// Dwell before anything happens at all, so sweeping the pointer across a rail
// never opens a card.
const HOVER_DELAY = 420;
// The card widens first and the artwork settles; the trailer arrives after. Two
// separate beats rather than one — an iframe mounting DURING the width animation
// forces layout and composite work on every frame of it, which is what made the
// expansion stutter. It also gives the eye a moment to register the still before
// it starts moving, which is the whole appeal of the Netflix version.
const EXPAND_MS = 560;
const VIDEO_DELAY = 260;
const CLOSE_DELAY = 280;

let hoverTimer = null;
let closeTimer = null;
let hoveredCard = null;
let activeCard = null;
let teardown = () => {};
let requestToken = 0;
let cleanupTimer = null;
let videoTimer = null;
let pendingCleanup = null;
let motionGuardUntil = 0;

const desktopHoverOK = () => typeof window !== 'undefined'
  && document.documentElement.dataset.posterPreview !== 'hide'
  && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
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
  // Move only enough to expose a clipped edge. Centering the card moves it out
  // from under the pointer and was the main cause of previews opening/closing in
  // a loop near either side of a rail.
  const rail = row.getBoundingClientRect(), box = card.getBoundingClientRect(), margin = 18;
  let delta = 0;
  if (box.left < rail.left + margin) delta = box.left - rail.left - margin;
  else if (box.right > rail.right - margin) delta = box.right - rail.right + margin;
  if (Math.abs(delta) > 1) {
    motionGuardUntil = performance.now() + 700;
    row.scrollBy({ left: delta, behavior: 'smooth' });
  }
}

function expand(card, trailer) {
  closePreview(true);
  const media = card.querySelector('.card-img');
  if (!media) return;
  activeCard = card;
  const row = card.parentElement;
  const base = card.getBoundingClientRect().width;
  const mediaHeight = Math.max(1, media.getBoundingClientRect().height);
  // The poster and trailer occupy the exact same vertical space. Only horizontal
  // room is negotiated, so every rail stays aligned while portrait art becomes
  // a true 16:9 preview.
  const ideal = Math.round(mediaHeight * 16 / 9);
  const available = Math.max(base, Math.min(560, (row?.clientWidth || 900) - 36));
  const width = Math.max(base, Math.min(ideal, available));
  card.style.setProperty('--inline-preview-width', `${width}px`);
  card.style.setProperty('--inline-preview-height', `${Math.round(mediaHeight)}px`);
  if (card.dataset.backdrop) {
    const backdrop = document.createElement('img');
    backdrop.className = 'card-preview-backdrop'; backdrop.alt = '';
    backdrop.src = `${IMG}w780${card.dataset.backdrop}`;
    media.prepend(backdrop);
  }
  const mask = document.createElement('span'); mask.className = 'card-preview-clean-mask'; mask.setAttribute('aria-hidden', 'true');
  media.appendChild(mask);
  card.appendChild(soundButton());
  card.classList.add('card-preview-preparing');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (activeCard !== card) return;
    card.classList.remove('card-preview-preparing');
    card.classList.add('card-preview-expanded');
    setTimeout(() => { if (activeCard === card) glideIntoView(card); }, 90);
    // Wait for the expansion to finish before asking the browser to build an
    // iframe. `mountAmbientVideo` fades the video in on its own once ready.
    videoTimer = setTimeout(() => {
      videoTimer = null;
      if (activeCard !== card || !card.isConnected) return;
      card.classList.add('card-preview-playing');
      teardown = mountAmbientVideo(media, trailer, { delay: 0, overlaySelector: '.card-preview-clean-mask', clean: true, respectAutoplay: false });
    }, EXPAND_MS + VIDEO_DELAY);
  }));
}

function closePreview(immediate = false) {
  requestToken++;
  clearTimeout(hoverTimer); clearTimeout(closeTimer);
  clearTimeout(videoTimer); videoTimer = null;
  clearTimeout(cleanupTimer); cleanupTimer = null;
  if (pendingCleanup) { const finish = pendingCleanup; pendingCleanup = null; finish(); }
  hoverTimer = null; closeTimer = null;
  const stop = teardown; teardown = () => {};
  const card = activeCard; activeCard = null;
  if (!card) { stop(); return; }
  const cleanup = () => {
    if (card.classList.contains('card-preview-expanded')) return;
    stop();
    card.classList.remove('card-preview-preparing', 'card-preview-closing', 'card-preview-playing');
    card.querySelector('.card-preview-sound')?.remove();
    card.querySelector('.card-preview-backdrop')?.remove();
    card.querySelector('.card-preview-clean-mask')?.remove();
    card.style.removeProperty('--inline-preview-width');
    card.style.removeProperty('--inline-preview-height');
  };
  if (immediate) {
    card.classList.remove('card-preview-expanded'); cleanup();
  } else {
    stop.setMuted?.(true);
    card.classList.add('card-preview-closing');
    card.classList.remove('card-preview-expanded', 'card-preview-preparing', 'card-preview-playing');
    pendingCleanup = cleanup;
    cleanupTimer = setTimeout(() => {
      pendingCleanup = null; cleanup();
    }, 560);
  }
}

function scheduleClose(card = activeCard || hoveredCard) {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    if (performance.now() < motionGuardUntil || card?.matches?.(':hover')) {
      scheduleClose(card); return;
    }
    hoveredCard = null; closePreview();
  }, CLOSE_DELAY);
}

function enterCard(card) {
  if (!desktopHoverOK() || hoveredCard === card || !card.parentElement?.classList.contains('row')) return;
  hoveredCard = card;
  clearTimeout(closeTimer); clearTimeout(hoverTimer);
  const token = ++requestToken;
  const started = performance.now();
  // Start the metadata request immediately; the dwell delay still prevents an
  // accidental fly-over from opening, but network latency is no longer added
  // after that delay.
  const trailerRequest = trailerFor(card);
  hoverTimer = setTimeout(async () => {
    const trailer = await trailerRequest;
    if (!trailer || token !== requestToken || hoveredCard !== card || !card.isConnected || !desktopHoverOK()) return;
    expand(card, trailer);
  }, Math.max(0, HOVER_DELAY - (performance.now() - started)));
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
    if (hoveredCard === card || activeCard === card) scheduleClose(card);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) closePreview(true); });
  window.addEventListener('blur', () => closePreview(true));
  window.addEventListener('resize', () => closePreview(true), { passive: true });
  window.matchMedia?.(DESKTOP_HOVER).addEventListener?.('change', event => { if (!event.matches) closePreview(true); });
  document.addEventListener('cv:prefs', () => { if (!desktopHoverOK()) closePreview(true); });
  document.addEventListener('cv:go', () => closePreview(true));
}

export { pickTrailer };
