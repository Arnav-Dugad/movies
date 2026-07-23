// ===== STUDIO PAGE =====
// Opened by clicking a studio/production-company logo on the detail page. Mirrors
// person.js: a header + paged grids of the company's movies and TV shows.
import { tmdb } from './api.js';
import { IMG } from './config.js';
import { esc, $ } from './ui.js';
import { buildCard } from './cards.js';
import { registerActions } from './events.js';
import { observeReveals } from './effects.js';

let reqGen = 0;                 // guards against a slower, stale fetch overwriting a newer one
let curId = null, mPage = 1, tPage = 1, mMax = 1, tMax = 1;

export async function openStudio(id) {
  const gen = ++reqGen;
  curId = id; mPage = 1; tPage = 1;
  const ct = $('studioContent');
  if (!ct) return;
  ct.innerHTML = '<div style="text-align:center;padding:100px"><div class="loader-text">Loading...</div></div>';
  document.title = 'Loading… — CineVerse';
  try {
    const [co, mv, tvr] = await Promise.all([
      tmdb(`/company/${id}`),
      tmdb('/discover/movie', { with_companies: id, sort_by: 'popularity.desc', page: 1 }),
      tmdb('/discover/tv', { with_companies: id, sort_by: 'popularity.desc', page: 1 }),
    ]);
    if (gen !== reqGen) return;
    document.title = `${co.name} — CineVerse`;
    mMax = mv.total_pages || 1; tMax = tvr.total_pages || 1;
    const logo = co.logo_path ? `${IMG}w300${co.logo_path}` : '';
    const meta = [co.origin_country, co.headquarters].filter(Boolean).join(' · ');
    const movies = mv.results || [], shows = tvr.results || [];
    const moreBtn = (kind, label, max) => max > 1 ? `<div style="text-align:center;margin:20px 0"><button class="btn-glass" data-action="studio-more-${kind}">${label}</button></div>` : '';
    ct.innerHTML = `
      <div class="studio-top">
        <div class="studio-logo-lg">${logo ? `<img src="${logo}" alt="${esc(co.name)}">` : `<span class="studio-mono">${esc((co.name || '?')[0])}</span>`}</div>
        <div class="studio-head">
          <h1 class="studio-name">${esc(co.name)}</h1>
          ${meta ? `<div class="studio-meta">${esc(meta)}</div>` : ''}
          ${co.description ? `<p class="person-bio">${esc(co.description)}</p>` : ''}
        </div>
      </div>
      ${movies.length ? `<div class="d-sec-title">Movies</div><div class="browse-grid" id="studioMovies">${movies.map(m => buildCard(m, 'movie')).join('')}</div>${moreBtn('movies', 'Load more movies', mMax)}` : ''}
      ${shows.length ? `<div class="d-sec-title" style="margin-top:28px">TV Shows</div><div class="browse-grid" id="studioShows">${shows.map(s => buildCard(s, 'tv')).join('')}</div>${moreBtn('tv', 'Load more shows', tMax)}` : ''}
      ${!movies.length && !shows.length ? '<p style="color:var(--text3);padding:20px 0">No titles found for this studio.</p>' : ''}`;
    observeReveals(ct);
  } catch (e) {
    console.error('openStudio', e);
    ct.innerHTML = '<div style="text-align:center;padding:100px 20px"><p style="color:var(--text3)">Failed to load</p><br><button class="btn-primary" data-action="back">Back</button></div>';
  }
}

async function loadMore(kind) {
  const gridId = kind === 'movie' ? 'studioMovies' : 'studioShows';
  const grid = $(gridId); if (!grid) return;
  const page = kind === 'movie' ? ++mPage : ++tPage;
  const path = kind === 'movie' ? '/discover/movie' : '/discover/tv';
  try {
    const d = await tmdb(path, { with_companies: curId, sort_by: 'popularity.desc', page });
    grid.insertAdjacentHTML('beforeend', (d.results || []).map(x => buildCard(x, kind)).join(''));
    const max = kind === 'movie' ? mMax : tMax;
    if (page >= max) { const btn = document.querySelector(`[data-action="studio-more-${kind === 'movie' ? 'movies' : 'tv'}"]`); if (btn) btn.parentElement.remove(); }
    observeReveals(grid);
  } catch (e) { console.error('studio loadMore', e); }
}

export function initStudio() {
  registerActions({
    'open-studio': (el, e) => { if (e) e.stopPropagation(); document.dispatchEvent(new CustomEvent('cv:go', { detail: `/studio/${+el.dataset.id}` })); },
    'studio-more-movies': () => loadMore('movie'),
    'studio-more-tv': () => loadMore('tv'),
  });
}
