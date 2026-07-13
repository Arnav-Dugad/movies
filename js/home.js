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

export function initHomeActions() {
  registerActions({
    'retry-row': async (el) => {
      const target = $(el.dataset.target); if (!target) return;
      target.innerHTML = skelCards(8);
      try {
        const d = await tmdb(el.dataset.path);
        const t10 = el.dataset.t10 === 'true', wide = el.dataset.wide === 'true', type = el.dataset.type;
        const items = d.results.slice(0, t10 ? 10 : 20);
        target.innerHTML = items.map((item, i) => {
          const t = type === 'multi' ? (item.media_type || 'movie') : type;
          return t10 ? buildCard(item, t, { t10: true, rank: i + 1 }) : wide ? buildCard(item, t, { wide: true }) : buildCard(item, t);
        }).join('');
      } catch (e) { target.innerHTML = `<div class="row-error">Still couldn't load.<button data-action="retry-row" data-path="${el.dataset.path}" data-target="${el.dataset.target}" data-t10="${el.dataset.t10}" data-wide="${el.dataset.wide}" data-type="${el.dataset.type}">Retry</button></div>`; }
    },
  });
}

const SECTIONS = [
  { t: 'Popular Movies', p: '/movie/popular', type: 'movie', icon: '🎬', page: 'movies' },
  { t: 'Top 10 This Week', p: '/trending/movie/week', type: 'movie', t10: true, icon: '🔥', page: 'movies' },
  { t: 'Popular TV Shows', p: '/tv/popular', type: 'tv', icon: '📺', page: 'tv' },
  { t: 'Now Playing', p: '/movie/now_playing', type: 'movie', icon: '🎞️', page: 'movies' },
  { t: 'Upcoming Movies', p: '/movie/upcoming', type: 'movie', icon: '🗓️', page: 'movies' },
  { t: 'Top Rated Movies', p: '/movie/top_rated', type: 'movie', icon: '⭐', page: 'movies' },
  { t: 'Airing Today', p: '/tv/airing_today', type: 'tv', icon: '📡', page: 'tv' },
  { t: 'Top Rated TV', p: '/tv/top_rated', type: 'tv', icon: '🏆', page: 'tv' },
  { t: 'Trending This Week', p: '/trending/all/week', type: 'multi', wide: true, icon: '📈', page: 'movies' },
];

function sectionShell(id, icon, title, page, w = 155) {
  return `<div class="section reveal"><div class="section-head"><h2 class="section-title"><span>${icon}</span> ${title}</h2><button class="section-see-all" data-action="show-page" data-page="${page}">See All<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg></button></div><div class="row" id="${id}">${skelCards(8, w)}</div></div>`;
}

export async function initHome() {
  let html = `<div id="personalRows"></div>`;
  SECTIONS.forEach(s => { html += sectionShell('row' + s.p.replace(/\//g, '_'), s.icon, s.t, s.page); });
  $('homeRows').innerHTML = html;
  observeReveals();

  await Promise.allSettled(SECTIONS.map(async s => {
    const el = $('row' + s.p.replace(/\//g, '_'));
    try {
      const d = await tmdb(s.p);
      const items = d.results.slice(0, s.t10 ? 10 : 20);
      if (el) el.innerHTML = items.map((item, i) => {
        const t = s.type === 'multi' ? (item.media_type || 'movie') : s.type;
        return s.t10 ? buildCard(item, t, { t10: true, rank: i + 1 }) : s.wide ? buildCard(item, t, { wide: true }) : buildCard(item, t);
      }).join('');
    } catch (e) {
      if (el) el.innerHTML = `<div class="row-error">Couldn't load this row.<button data-action="retry-row" data-path="${s.p}" data-target="${el.id}" data-t10="${!!s.t10}" data-wide="${!!s.wide}" data-type="${s.type}">Retry</button></div>`;
    }
  }));

  renderPersonalRows();
}
