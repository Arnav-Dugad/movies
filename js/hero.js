// ===== SHARED PREMIUM HERO CAROUSEL =====
// Home, Movies and TV all use this one engine so trailers, logos, swipe,
// progress, timing and reduced-motion behavior can never drift apart.
import { tmdb } from './api.js';
import { IMG, genreMap, pickLogo } from './config.js';
import { state } from './state.js';
import { esc, $, prefersReducedMotion, isTouch } from './ui.js';
import { registerActions } from './events.js';
import { haptic } from './haptics.js';
import { mountAmbientVideo, ambientOK } from './video-bg.js';

const HERO_INTERVAL_MS = 30000;
// How long a slide shows everything before only its title logo remains.
export const HERO_COLLAPSE_MS = 4000;
const models = {
  home: { hostId: 'heroWrap', endpoint: '/trending/all/day', mediaType: '', items: [], index: 0, timer: null, paused: false, ambient: null, videoGen: 0, loading: null },
  movie: { hostId: 'movieHero', endpoint: '/trending/movie/week', mediaType: 'movie', items: [], index: 0, timer: null, paused: false, ambient: null, videoGen: 0, loading: null },
  tv: { hostId: 'tvHero', endpoint: '/trending/tv/week', mediaType: 'tv', items: [], index: 0, timer: null, paused: false, ambient: null, videoGen: 0, loading: null },
};
const heroKeyCache = {};
const heroLogoCache = {};

const modelFor = key => models[key] || models.home;
const hostFor = model => $(model.hostId);
const mediaTypeFor = (model, item) => item.media_type || model.mediaType;

async function getTitleLogo(model, item) {
  const type = mediaTypeFor(model, item), cacheKey = `${type}_${item.id}`;
  if (cacheKey in heroLogoCache) return heroLogoCache[cacheKey];
  try {
    const data = await tmdb(`/${type}/${item.id}/images`, { include_image_language: 'en,null' });
    return (heroLogoCache[cacheKey] = pickLogo(data.logos));
  } catch (_) { return (heroLogoCache[cacheKey] = null); }
}

function mountHeroLogos(key) {
  const model = modelFor(key), host = hostFor(model);
  model.items.forEach((item, index) => {
    getTitleLogo(model, item).then(path => {
      if (!path || !host?.isConnected) return;
      const title = host.querySelector(`.hero-slide[data-idx="${index}"] .hero-title`);
      if (title) title.innerHTML = `<img class="hero-logo" src="${IMG}w500${path}" alt="${esc(item.title || item.name || '')}">`;
    });
  });
}

function expandDescription(model) {
  clearTimeout(model.collapseTimer);
  hostFor(model)?.querySelectorAll('.hero-slide.collapsed').forEach(slide => slide.classList.remove('collapsed'));
}

// A few seconds after a slide arrives, everything but its title logo steps
// aside — the badge, score, genres, synopsis and buttons — so the artwork and the
// trailer own the frame, identified by the one thing that names them. Anyone who
// reaches for the hero gets it all back: hovering or focusing expands it for as
// long as they stay, and on touch a tap on the collapsed slide brings the details
// and buttons back before anything can be triggered by accident.
//
// Reduced motion keeps everything in place: a layout that rearranges itself on a
// timer is exactly what that preference asks us not to do.
function collapseDescription(model) {
  if (prefersReducedMotion()) return;
  const host = hostFor(model);
  if (!host || host.matches(':hover') || host.matches(':focus-within')) return;
  host.querySelector('.hero-slide.active')?.classList.add('collapsed');
}

function scheduleCollapse(model) {
  clearTimeout(model.collapseTimer);
  if (prefersReducedMotion()) return;
  model.collapseTimer = setTimeout(() => {
    if (hostFor(model)?.offsetParent) collapseDescription(model);
  }, HERO_COLLAPSE_MS);
}

async function getTrailerKey(model, item) {
  const type = mediaTypeFor(model, item), cacheKey = `${type}_${item.id}`;
  if (cacheKey in heroKeyCache) return heroKeyCache[cacheKey];
  try {
    const data = await tmdb(`/${type}/${item.id}/videos`);
    const video = (data.results || []).find(item => item.type === 'Trailer' && item.site === 'YouTube') || (data.results || []).find(item => item.site === 'YouTube');
    return (heroKeyCache[cacheKey] = video?.key || null);
  } catch (_) { return (heroKeyCache[cacheKey] = null); }
}

function teardownVideo(model) {
  model.videoGen++;
  if (model.ambient) { model.ambient(); model.ambient = null; }
}

async function mountHeroVideo(key) {
  const model = modelFor(key), host = hostFor(model), generation = ++model.videoGen;
  if (model.ambient) { model.ambient(); model.ambient = null; }
  if (!host?.offsetParent || !ambientOK()) return;
  const item = model.items[model.index], indexAtRequest = model.index;
  if (!item) return;
  const trailerKey = await getTrailerKey(model, item);
  if (!trailerKey || generation !== model.videoGen || indexAtRequest !== model.index || !host.offsetParent) return;
  const slide = host.querySelector('.hero-slide.active');
  if (slide) model.ambient = mountAmbientVideo(slide, trailerKey, {
    overlaySelector: '.hero-vignette', delay: 900,
  });
}

function heroPayload(model, item) {
  const type = mediaTypeFor(model, item), title = item.title || item.name || '';
  return esc(JSON.stringify({ id: item.id, type, title, poster: item.poster_path || '', rating: item.vote_average || 0, year: (item.release_date || item.first_air_date || '').slice(0, 4), genres: item.genre_ids || [] }));
}

function renderHero(key) {
  const model = modelFor(key), host = hostFor(model);
  if (!host || !model.items.length) return;
  const slides = model.items.map((item, index) => {
    const type = mediaTypeFor(model, item), title = item.title || item.name || '';
    const year = (item.release_date || item.first_air_date || '').slice(0, 4);
    const rating = item.vote_average ? item.vote_average.toFixed(1) : '';
    const genres = (item.genre_ids || []).slice(0, 3).map(id => genreMap[id] || '').filter(Boolean);
    return `<div class="hero-slide ${index === model.index ? 'active' : ''}" data-idx="${index}">
      <img src="${IMG}original${item.backdrop_path}" alt="" loading="${index === 0 ? 'eager' : 'lazy'}">
      <div class="hero-vignette"></div>
      <div class="hero-content">
        <div class="hero-badge trending"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>Trending #${index + 1}</div>
        <h1 class="hero-title">${esc(title)}</h1>
        <div class="hero-meta">${rating ? `<span class="hero-meta-item rating"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>${rating}</span><span class="hero-meta-sep"></span>` : ''}<span class="hero-meta-item">${year}</span><span class="hero-meta-sep"></span><span class="hero-meta-item">${type === 'tv' ? 'TV Series' : 'Movie'}</span></div>
        ${genres.length ? `<div class="hero-genres">${genres.map(genre => `<span class="hero-genre-tag">${esc(genre)}</span>`).join('')}</div>` : ''}
        <p class="hero-desc">${esc(item.overview || '')}</p>
        <div class="hero-actions">
          <a class="btn-primary magnetic" href="/${type}/${item.id}" data-action="open-detail" data-id="${item.id}" data-type="${type}" data-title="${esc(title)}" data-poster="${esc(item.poster_path || '')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16" fill="currentColor" stroke="none"/></svg>Watch Now</a>
          <button class="btn-glass" data-action="open-list-picker" data-item="${heroPayload(model, item)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>My List</button>
        </div>
      </div>
    </div>`;
  }).join('');
  host.innerHTML = `${slides}<div class="hero-progress">${model.items.map((_, index) => `<div class="hero-prog-item ${index === model.index ? 'active' : index < model.index ? 'done' : ''}" role="button" tabindex="0" aria-label="Go to slide ${index + 1}" data-action="hero-go" data-hero-key="${key}" data-idx="${index}"><div class="hero-prog-fill" style="animation-duration:${HERO_INTERVAL_MS}ms"></div></div>`).join('')}</div>`;
  startHeroTimer(key);
  mountHeroVideo(key);
  mountHeroLogos(key);
  expandDescription(model);
  scheduleCollapse(model);
}

async function loadHero(key) {
  const model = modelFor(key), host = hostFor(model);
  if (!host) return;
  if (model.items.length) { renderHero(key); return; }
  if (model.loading) return model.loading;
  model.loading = tmdb(model.endpoint).then(data => {
    model.items = (data.results || []).map(item => ({ ...item, media_type: item.media_type || model.mediaType })).filter(item => item.backdrop_path && ['movie', 'tv'].includes(item.media_type)).slice(0, 6);
    model.index = 0;
    if (key === 'home') { state.heroItems = model.items; state.heroIdx = 0; }
    if (model.items.length) renderHero(key);
  }).catch(error => console.error(`${key} hero error:`, error)).finally(() => { model.loading = null; });
  return model.loading;
}

export function goHero(index, key = 'home') {
  const model = modelFor(key), host = hostFor(model);
  if (!model.items.length || !host) return;
  model.index = ((index % model.items.length) + model.items.length) % model.items.length;
  if (key === 'home') state.heroIdx = model.index;
  host.querySelectorAll('.hero-slide').forEach((slide, idx) => slide.classList.toggle('active', idx === model.index));
  host.querySelectorAll('.hero-prog-item').forEach((progress, idx) => {
    progress.classList.remove('active', 'done');
    if (idx < model.index) progress.classList.add('done');
    if (idx === model.index) progress.classList.add('active');
  });
  startHeroTimer(key);
  mountHeroVideo(key);
  expandDescription(model);
  scheduleCollapse(model);
}

export function startHeroTimer(key = 'home') {
  const model = modelFor(key), host = hostFor(model);
  clearInterval(model.timer);
  if (!host?.offsetParent || model.paused || prefersReducedMotion() || model.items.length < 2) return;
  model.timer = setInterval(() => {
    const host = hostFor(model);
    if (host?.offsetParent) goHero(model.index + 1, key);
  }, HERO_INTERVAL_MS);
  if (key === 'home') state.heroTimer = model.timer;
}

function pauseHero(key) {
  const model = modelFor(key); model.paused = true; clearInterval(model.timer); expandDescription(model);
  if (key === 'home') state.heroPaused = true;
}
function resumeHero(key) {
  const model = modelFor(key); if (!model.paused) return;
  model.paused = false; if (key === 'home') state.heroPaused = false;
  startHeroTimer(key); mountHeroVideo(key); expandDescription(model); scheduleCollapse(model);
}

export function initHero() { return loadHero('home'); }
export function initBrowseHero(type) { return loadHero(type === 'tv' ? 'tv' : 'movie'); }

export function initHeroInteractions() {
  Object.entries(models).forEach(([key, model]) => {
    const host = hostFor(model); if (!host) return;
    let startX = 0, startY = 0;
    host.addEventListener('touchstart', event => { startX = event.touches[0].clientX; startY = event.touches[0].clientY; }, { passive: true });
    host.addEventListener('touchend', event => {
      const dx = startX - event.changedTouches[0].clientX, dy = startY - event.changedTouches[0].clientY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && model.items.length) { haptic('swipe'); goHero(model.index + (dx > 0 ? 1 : -1), key); }
    }, { passive: true });
    if (!isTouch()) {
      host.addEventListener('mouseenter', () => pauseHero(key));
      host.addEventListener('mouseleave', () => resumeHero(key));
    }
    // Keyboard: focusing any control inside the hero keeps it expanded.
    host.addEventListener('focusin', () => expandDescription(model));
    host.addEventListener('focusout', event => { if (!host.contains(event.relatedTarget)) scheduleCollapse(model); });
    // Touch: the first tap on a collapsed slide only brings the details back.
    host.addEventListener('click', event => {
      const slide = event.target.closest('.hero-slide.collapsed');
      if (!slide) return;
      event.preventDefault();
      event.stopPropagation();
      expandDescription(model);
      scheduleCollapse(model);
    }, true);
  });
  document.addEventListener('visibilitychange', () => {
    Object.entries(models).forEach(([key, model]) => {
      if (document.hidden) { clearInterval(model.timer); teardownVideo(model); expandDescription(model); }
      else if (!model.paused && hostFor(model)?.offsetParent) { startHeroTimer(key); mountHeroVideo(key); expandDescription(model); scheduleCollapse(model); }
    });
  });
  // Routed pages stay mounted and only toggle display. Observe those three page
  // shells so exactly one carousel timer/trailer is alive after every navigation.
  let visibilityQueued = false;
  const syncVisibility = () => {
    if (visibilityQueued) return;
    visibilityQueued = true;
    queueMicrotask(() => {
      visibilityQueued = false;
      Object.entries(models).forEach(([key, model]) => {
        if (hostFor(model)?.offsetParent) { startHeroTimer(key); mountHeroVideo(key); expandDescription(model); scheduleCollapse(model); }
        else { clearInterval(model.timer); teardownVideo(model); expandDescription(model); }
      });
    });
  };
  const routeObserver = new MutationObserver(syncVisibility);
  ['homePage', 'moviesPage', 'tvPage'].forEach(id => { const page = $(id); if (page) routeObserver.observe(page, { attributes: true, attributeFilter: ['style'] }); });
  registerActions({ 'hero-go': el => goHero(+el.dataset.idx, el.dataset.heroKey || 'home') });
}
