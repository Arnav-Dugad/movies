// ===== HERO CAROUSEL =====
import { tmdb } from './api.js';
import { IMG, genreMap } from './config.js';
import { state } from './state.js';
import { esc, $ } from './ui.js';
import { registerActions, readItem } from './events.js';
import { toggleWL } from './watchlist.js';

export async function initHero() {
  try {
    const d = await tmdb('/trending/all/day');
    state.heroItems = d.results.filter(r => r.backdrop_path && (r.media_type === 'movie' || r.media_type === 'tv')).slice(0, 6);
    if (!state.heroItems.length) return;
    const wrap = $('heroWrap');
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
            <button class="btn-glass" data-action="hero-wl" data-item="${payload}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>My List</button>
          </div>
        </div>
      </div>`;
    });
    slidesHTML += `<div class="hero-progress">${state.heroItems.map((_, i) => `<div class="hero-prog-item ${i === 0 ? 'active' : ''}" role="button" tabindex="0" aria-label="Go to slide ${i + 1}" data-action="hero-go" data-idx="${i}"><div class="hero-prog-fill"></div></div>`).join('')}</div>`;
    wrap.innerHTML = slidesHTML;
    startHeroTimer();
  } catch (e) { console.error('Hero error:', e); }
}

export function goHero(i) {
  state.heroIdx = i;
  document.querySelectorAll('.hero-slide').forEach((s, idx) => s.classList.toggle('active', idx === i));
  document.querySelectorAll('.hero-prog-item').forEach((p, idx) => { p.classList.remove('active', 'done'); if (idx < i) p.classList.add('done'); if (idx === i) p.classList.add('active'); });
  startHeroTimer();
}

export function startHeroTimer() {
  clearInterval(state.heroTimer);
  if (state.heroPaused) return;
  state.heroTimer = setInterval(() => { state.heroIdx = (state.heroIdx + 1) % state.heroItems.length; goHero(state.heroIdx); }, 8000);
}
function pauseHero() { state.heroPaused = true; clearInterval(state.heroTimer); }
function resumeHero() { if (!state.heroPaused) return; state.heroPaused = false; startHeroTimer(); }

export function initHeroInteractions() {
  const wrap = $('heroWrap');
  // Swipe
  let touchStartX = 0;
  wrap.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  wrap.addEventListener('touchend', e => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50 && state.heroItems.length) {
      if (diff > 0) goHero((state.heroIdx + 1) % state.heroItems.length);
      else goHero((state.heroIdx - 1 + state.heroItems.length) % state.heroItems.length);
    }
  }, { passive: true });

  // Pause on hover (desktop) and when tab hidden.
  wrap.addEventListener('mouseenter', pauseHero);
  wrap.addEventListener('mouseleave', resumeHero);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInterval(state.heroTimer); } else if (!state.heroPaused) { startHeroTimer(); } });

  registerActions({
    'hero-go': (el) => goHero(+el.dataset.idx),
    'hero-wl': (el, e) => { e.stopPropagation(); const it = readItem(el); toggleWL(it, it.type); },
  });
}
