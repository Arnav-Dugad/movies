// ===== HERO CAROUSEL =====
import { tmdb } from './api.js';
import { IMG, genreMap, pickLogo } from './config.js';
import { state } from './state.js';
import { esc, $, prefersReducedMotion, isTouch } from './ui.js';
import { registerActions } from './events.js';
import { mountAmbientVideo, ambientOK } from './video-bg.js';

const HERO_INTERVAL_MS = 30000;

let heroAmbientTeardown = null;
let heroDescTimer = null;
let heroVideoGen = 0; // bumped on every mountHeroVideo() call; stale resolutions bail
const heroKeyCache = {};
const heroLogoCache = {};

// Trending items carry no title-logo art, so fetch it per slide (cached), mirroring
// getTrailerKey. Returns a logo file_path or null.
async function getTitleLogo(item) {
  const ck = `${item.media_type}_${item.id}`;
  if (ck in heroLogoCache) return heroLogoCache[ck];
  try {
    const d = await tmdb(`/${item.media_type}/${item.id}/images`, { include_image_language: 'en,null' });
    return (heroLogoCache[ck] = pickLogo(d.logos));
  } catch (e) { return (heroLogoCache[ck] = null); }
}

// After the slides render (text titles first, for zero layout shift), swap each
// slide's title to its official logo art where one exists. Fallback = leave text.
function mountHeroLogos() {
  state.heroItems.forEach((item, i) => {
    getTitleLogo(item).then(path => {
      if (!path) return;
      const el = document.querySelector(`.hero-slide[data-idx="${i}"] .hero-title`);
      if (el) el.innerHTML = `<img class="hero-logo" src="${IMG}w500${path}" alt="${esc(item.title || item.name || '')}">`;
    });
  });
}

// Netflix-style: collapse the meta/genres/description on the active slide a few
// seconds in, leaving the title + action buttons. Reset whenever the slide changes.
function scheduleDescCollapse() {
  clearTimeout(heroDescTimer);
  document.querySelectorAll('.hero-slide.collapsed').forEach(s => s.classList.remove('collapsed'));
  if (prefersReducedMotion()) return; // keep full info visible when motion is reduced
  heroDescTimer = setTimeout(() => {
    const active = document.querySelector('.hero-slide.active');
    if (active) active.classList.add('collapsed');
  }, 3000);
}
function expandDesc() {
  clearTimeout(heroDescTimer);
  document.querySelectorAll('.hero-slide.collapsed').forEach(s => s.classList.remove('collapsed'));
}

async function getTrailerKey(item) {
  const ck = `${item.media_type}_${item.id}`;
  if (ck in heroKeyCache) return heroKeyCache[ck];
  try {
    const d = await tmdb(`/${item.media_type}/${item.id}/videos`);
    const v = (d.results || []).find(x => x.type === 'Trailer' && x.site === 'YouTube') || (d.results || []).find(x => x.site === 'YouTube');
    return (heroKeyCache[ck] = v?.key || null);
  } catch (e) { return (heroKeyCache[ck] = null); }
}

async function mountHeroVideo() {
  // Generation token: any overlapping call (e.g. rapid visibility toggling) that
  // starts after this one invalidates it, so two in-flight calls for the same
  // slide can never both mount (the loser would otherwise orphan its iframe/
  // listener with no teardown reference left).
  const gen = ++heroVideoGen;
  if (heroAmbientTeardown) { heroAmbientTeardown(); heroAmbientTeardown = null; }
  if (!ambientOK()) return;
  const item = state.heroItems[state.heroIdx];
  if (!item) return;
  const idxAtRequest = state.heroIdx;
  const key = await getTrailerKey(item);
  // Bail if the slide changed, or a newer mountHeroVideo() call has superseded us.
  if (!key || idxAtRequest !== state.heroIdx || gen !== heroVideoGen) return;
  const slide = document.querySelector('.hero-slide.active');
  if (slide) heroAmbientTeardown = mountAmbientVideo(slide, key, { overlaySelector: '.hero-vignette', delay: 900 });
}

export async function initHero() {
  try {
    const d = await tmdb('/trending/all/day');
    state.heroItems = d.results.filter(r => r.backdrop_path && (r.media_type === 'movie' || r.media_type === 'tv')).slice(0, 6);
    if (!state.heroItems.length) return;
    const wrap = $('heroWrap');
    if (!wrap) return;
    let slidesHTML = '';
    state.heroItems.forEach((item, i) => {
      const title = item.title || item.name; const safeTitle = esc(title);
      const year = (item.release_date || item.first_air_date || '').slice(0, 4);
      const rating = item.vote_average ? item.vote_average.toFixed(1) : '';
      const genres = (item.genre_ids || []).slice(0, 3).map(gid => genreMap[gid] || '').filter(Boolean);
      const payload = esc(JSON.stringify({ id: item.id, type: item.media_type, title, poster: item.poster_path || '', rating: item.vote_average || 0, year, genres: item.genre_ids || [] }));
      slidesHTML += `<div class="hero-slide ${i === 0 ? 'active' : ''}" data-idx="${i}">
        <img src="${IMG}original${item.backdrop_path}" alt="" loading="${i === 0 ? 'eager' : 'lazy'}">
        <div class="hero-vignette"></div>
        <div class="hero-content">
          <div class="hero-badge trending"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>Trending #${i + 1}</div>
          <h1 class="hero-title">${safeTitle}</h1>
          <div class="hero-meta">
            ${rating ? `<span class="hero-meta-item rating"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>${rating}</span><span class="hero-meta-sep"></span>` : ''}<span class="hero-meta-item">${year}</span><span class="hero-meta-sep"></span><span class="hero-meta-item">${item.media_type === 'tv' ? 'TV Series' : 'Movie'}</span>
          </div>
          ${genres.length ? `<div class="hero-genres">${genres.map(g => `<span class="hero-genre-tag">${g}</span>`).join('')}</div>` : ''}
          <p class="hero-desc">${esc(item.overview || '')}</p>
          <div class="hero-actions">
            <button class="btn-primary magnetic" data-action="open-detail" data-id="${item.id}" data-type="${item.media_type}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16" fill="currentColor" stroke="none"/></svg>Watch Now</button>
            <button class="btn-glass" data-action="open-list-picker" data-item="${payload}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>My List</button>
          </div>
        </div>
      </div>`;
    });
    slidesHTML += `<div class="hero-progress">${state.heroItems.map((_, i) => `<div class="hero-prog-item ${i === 0 ? 'active' : ''}" role="button" tabindex="0" aria-label="Go to slide ${i + 1}" data-action="hero-go" data-idx="${i}"><div class="hero-prog-fill" style="animation-duration:${HERO_INTERVAL_MS}ms"></div></div>`).join('')}</div>`;
    wrap.innerHTML = slidesHTML;
    startHeroTimer();
    mountHeroVideo();
    mountHeroLogos();
    scheduleDescCollapse();
  } catch (e) { console.error('Hero error:', e); }
}

export function goHero(i) {
  // Defend against a stale/out-of-range call (e.g. leftover DOM after a re-render):
  // without this, an empty heroItems array turns the next timer tick's modulo into
  // NaN, silently corrupting state.heroIdx forever.
  if (!state.heroItems.length) return;
  state.heroIdx = ((i % state.heroItems.length) + state.heroItems.length) % state.heroItems.length;
  document.querySelectorAll('.hero-slide').forEach((s, idx) => s.classList.toggle('active', idx === state.heroIdx));
  document.querySelectorAll('.hero-prog-item').forEach((p, idx) => { p.classList.remove('active', 'done'); if (idx < state.heroIdx) p.classList.add('done'); if (idx === state.heroIdx) p.classList.add('active'); });
  startHeroTimer();
  mountHeroVideo();
  scheduleDescCollapse();
}

export function startHeroTimer() {
  clearInterval(state.heroTimer);
  if (state.heroPaused) return;
  state.heroTimer = setInterval(() => { goHero(state.heroIdx + 1); }, HERO_INTERVAL_MS);
}
function pauseHero() { state.heroPaused = true; clearInterval(state.heroTimer); expandDesc(); }
function resumeHero() { if (!state.heroPaused) return; state.heroPaused = false; startHeroTimer(); scheduleDescCollapse(); }

export function initHeroInteractions() {
  const wrap = $('heroWrap');
  if (!wrap) return;
  // Swipe
  let touchStartX = 0, touchStartY = 0;
  wrap.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; }, { passive: true });
  wrap.addEventListener('touchend', e => {
    const diffX = touchStartX - e.changedTouches[0].clientX;
    const diffY = touchStartY - e.changedTouches[0].clientY;
    // Require horizontal movement to dominate vertical, so a diagonal drag while
    // scrolling the page doesn't spuriously trigger a slide change.
    if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY) && state.heroItems.length) {
      if (diffX > 0) goHero(state.heroIdx + 1);
      else goHero(state.heroIdx - 1);
    }
  }, { passive: true });

  // Pause on hover (desktop only — touch devices can fire a synthetic mouseenter
  // on tap with no matching mouseleave, which would pause the carousel forever).
  if (!isTouch()) {
    wrap.addEventListener('mouseenter', pauseHero);
    wrap.addEventListener('mouseleave', resumeHero);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInterval(state.heroTimer);
      if (heroAmbientTeardown) { heroAmbientTeardown(); heroAmbientTeardown = null; }
      // Pair with expandDesc() like every other pause path — a backgrounded tab's
      // setTimeout still fires (throttled), so without this the description could
      // silently collapse while hidden and stay collapsed for no visible reason.
      expandDesc();
    }
    else if (!state.heroPaused) { startHeroTimer(); mountHeroVideo(); scheduleDescCollapse(); }
  });

  registerActions({
    'hero-go': (el) => goHero(+el.dataset.idx),
  });
}
