// ===== HOME SECTIONS (+ personalization) =====
import { tmdb } from './api.js';
import { $ } from './ui.js';
import { buildCard, skelCards } from './cards.js';
import { observeReveals } from './effects.js';
import { registerActions } from './events.js';
import { renderRecommendations } from './recommend.js';

// Re-exported so router.js (cv:auth / cv:wl-changed) and initHome can refresh the
// personalized rows. The advanced logic lives in recommend.js.
export function renderPersonalRows() { return renderRecommendations(); }

// Build a row's cards from a TMDB result set, honoring t10 / wide / person / multi.
function cardsFor(s, results) {
  const items = results.slice(0, s.t10 ? 10 : 20).filter(x => s.type === 'person' ? x.profile_path : x.poster_path);
  return items.map((item, i) => {
    const t = s.type === 'multi' ? (item.media_type || 'movie') : s.type;
    return s.t10 ? buildCard(item, t, { t10: true, rank: i + 1 }) : s.wide ? buildCard(item, t, { wide: true }) : buildCard(item, t);
  }).join('');
}

export function initHomeActions() {
  registerActions({
    'retry-row': async (el) => {
      const target = $(el.dataset.target); if (!target) return;
      target.innerHTML = skelCards(8);
      let params = {}; try { params = el.dataset.params ? JSON.parse(el.dataset.params) : {}; } catch (_) {}
      const s = { t10: el.dataset.t10 === 'true', wide: el.dataset.wide === 'true', type: el.dataset.type };
      try {
        const d = await tmdb(el.dataset.path, params);
        target.innerHTML = cardsFor(s, d.results || []);
      } catch (e) { target.innerHTML = rowError(el.dataset.path, el.dataset.target, s, params); }
    },
  });
}

// Genre ids: 16 Animation, 27 Horror, 35 Comedy, 878 Sci-Fi, 10751 Family.
// Exported so the curated collection page (js/collection.js) can re-run the exact
// same endpoint + params behind a row's "See all".
export const SECTIONS = [
  { id: 'pop_movies', t: 'Popular Movies', p: '/movie/popular', type: 'movie', icon: '🎬', page: 'movies' },
  { id: 'top10', t: 'Top 10 This Week', p: '/trending/movie/week', type: 'movie', t10: true, icon: '🔥', page: 'movies' },
  { id: 'pop_tv', t: 'Popular TV Shows', p: '/tv/popular', type: 'tv', icon: '📺', page: 'tv' },
  { id: 'acclaimed', t: 'Critically Acclaimed', p: '/discover/movie', params: { sort_by: 'vote_average.desc', 'vote_count.gte': 3000 }, type: 'movie', icon: '🏆', page: 'movies' },
  { id: 'now_playing', t: 'Now Playing', p: '/movie/now_playing', type: 'movie', icon: '🎞️', page: 'movies' },
  { id: 'trending_people', t: 'Trending People', p: '/trending/person/week', type: 'person', icon: '🎭' },
  { id: 'gems', t: 'Hidden Gems', p: '/discover/movie', params: { sort_by: 'vote_average.desc', 'vote_average.gte': 7.2, 'vote_count.gte': 200, 'vote_count.lte': 1500 }, type: 'movie', icon: '💎', page: 'movies' },
  { id: 'upcoming', t: 'Upcoming Movies', p: '/movie/upcoming', type: 'movie', icon: '🗓️', page: 'movies' },
  { id: 'horror', t: 'Spine-Chilling Horror', p: '/discover/movie', params: { with_genres: '27', sort_by: 'popularity.desc', 'vote_count.gte': 150 }, type: 'movie', icon: '😱', page: 'movies' },
  { id: 'comedy', t: 'Laugh Out Loud', p: '/discover/movie', params: { with_genres: '35', sort_by: 'popularity.desc', 'vote_count.gte': 150 }, type: 'movie', icon: '😂', page: 'movies' },
  { id: 'top_rated', t: 'Top Rated Movies', p: '/movie/top_rated', type: 'movie', icon: '⭐', page: 'movies' },
  { id: 'animation', t: 'Animated Favorites', p: '/discover/movie', params: { with_genres: '16', sort_by: 'popularity.desc', 'vote_count.gte': 200 }, type: 'movie', icon: '🎨', page: 'movies' },
  { id: 'airing', t: 'Airing Today', p: '/tv/airing_today', type: 'tv', icon: '📡', page: 'tv' },
  { id: 'world', t: 'World Cinema', p: '/discover/movie', params: { with_original_language: 'ko', sort_by: 'popularity.desc', 'vote_count.gte': 100 }, type: 'movie', icon: '🌏', page: 'movies' },
  { id: 'top_tv', t: 'Top Rated TV', p: '/tv/top_rated', type: 'tv', icon: '🏆', page: 'tv' },
  { id: 'trending_all', t: 'Trending This Week', p: '/trending/all/week', type: 'multi', wide: true, icon: '📈', page: 'movies' },
];

function rowError(path, target, s, params) {
  return `<div class="row-error">Couldn't load this row.<button data-action="retry-row" data-path="${path}" data-target="${target}" data-t10="${!!s.t10}" data-wide="${!!s.wide}" data-type="${s.type}" data-params='${JSON.stringify(params || {})}'>Retry</button></div>`;
}

function sectionShell(s, w = 155) {
  // See All now opens the EXACT curated set (same endpoint + params), not a coarse
  // /movies page — so every row, including person rows, gets one.
  const seeAll = `<a class="section-see-all" href="/collection/${s.id}" data-action="see-all" data-id="${s.id}">See All<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg></a>`;
  return `<div class="section reveal"><div class="section-head"><h2 class="section-title"><span>${s.icon}</span> ${s.t}</h2>${seeAll}</div><div class="row" id="row_${s.id}">${skelCards(8, w)}</div></div>`;
}

export async function initHome() {
  let html = `<div id="personalRows"></div>`;
  SECTIONS.forEach(s => { html += sectionShell(s); });
  $('homeRows').innerHTML = html;
  observeReveals();

  await Promise.allSettled(SECTIONS.map(async s => {
    const el = $('row_' + s.id);
    try {
      const d = await tmdb(s.p, s.params || {});
      if (el) el.innerHTML = cardsFor(s, d.results || []);
    } catch (e) {
      if (el) el.innerHTML = rowError(s.p, el.id, s, s.params || {});
    }
  }));

  renderPersonalRows();
}
