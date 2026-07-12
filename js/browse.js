// ===== BROWSE (Movies / TV) =====
import { tmdb } from './api.js';
import { mGenreList, tGenreList } from './config.js';
import { state } from './state.js';
import { $ } from './ui.js';
import { buildCard } from './cards.js';
import { registerActions } from './events.js';
import { observeReveals } from './effects.js';

const gridSkel = (n = 12) => Array(n).fill('<div><div class="card-img skel" style="aspect-ratio:2/3"></div></div>').join('');

export function initFilters() {
  const yr = $('mYear');
  yr.innerHTML = '<option value="">All Years</option>';
  const cy = new Date().getFullYear();
  for (let y = cy; y >= 1970; y--) yr.innerHTML += `<option value="${y}">${y}</option>`;
  $('mGenres').innerHTML = `<div class="g-pill active" role="button" tabindex="0" data-action="set-mg" data-id="">All</div>` + mGenreList.map(g => `<div class="g-pill" role="button" tabindex="0" data-action="set-mg" data-id="${g.id}">${g.n}</div>`).join('');
  $('tGenres').innerHTML = `<div class="g-pill active" role="button" tabindex="0" data-action="set-tg" data-id="">All</div>` + tGenreList.map(g => `<div class="g-pill" role="button" tabindex="0" data-action="set-tg" data-id="${g.id}">${g.n}</div>`).join('');
}

function setActivePill(el) { el.parentElement.querySelectorAll('.g-pill').forEach(p => p.classList.remove('active')); el.classList.add('active'); }

export async function loadMovies(append = false) {
  if (!append) { state.mPg = 1; $('mGrid').innerHTML = gridSkel(); }
  const sort = $('mSort').value, year = $('mYear').value, lang = $('mLang').value, minRat = $('mRating').value;
  const params = { sort_by: sort, page: state.mPg };
  if (sort === 'vote_average.desc') params['vote_count.gte'] = 200;
  if (state.mGenre) params.with_genres = state.mGenre;
  if (year) params.primary_release_year = year;
  if (lang) params.with_original_language = lang;
  if (minRat) params['vote_average.gte'] = minRat;
  try {
    const d = await tmdb('/discover/movie', params);
    const g = $('mGrid'); const h = d.results.map(m => buildCard(m, 'movie')).join('');
    if (append) g.insertAdjacentHTML('beforeend', h); else g.innerHTML = h;
    observeReveals(g);
  } catch (e) { if (!append) $('mGrid').innerHTML = '<div class="row-error">Couldn\'t load movies. <button data-action="reload-movies">Retry</button></div>'; }
}
export function moreMovies() { state.mPg++; loadMovies(true); }

export async function loadTV(append = false) {
  if (!append) { state.tPg = 1; $('tGrid').innerHTML = gridSkel(); }
  const sort = $('tSort').value, lang = $('tLang').value;
  const params = { sort_by: sort, page: state.tPg };
  if (sort === 'vote_average.desc') params['vote_count.gte'] = 200;
  if (state.tGenre) params.with_genres = state.tGenre;
  if (lang) params.with_original_language = lang;
  try {
    const d = await tmdb('/discover/tv', params);
    const g = $('tGrid'); const h = d.results.map(t => buildCard(t, 'tv')).join('');
    if (append) g.insertAdjacentHTML('beforeend', h); else g.innerHTML = h;
    observeReveals(g);
  } catch (e) { if (!append) $('tGrid').innerHTML = '<div class="row-error">Couldn\'t load shows. <button data-action="reload-tv">Retry</button></div>'; }
}
export function moreTV() { state.tPg++; loadTV(true); }

export function initBrowse() {
  registerActions({
    'set-mg': (el) => { state.mGenre = el.dataset.id; setActivePill(el); state.mPg = 1; loadMovies(); },
    'set-tg': (el) => { state.tGenre = el.dataset.id; setActivePill(el); state.tPg = 1; loadTV(); },
    'filter-movies': () => loadMovies(),
    'filter-tv': () => loadTV(),
    'more-movies': () => moreMovies(),
    'more-tv': () => moreTV(),
    'reload-movies': () => loadMovies(),
    'reload-tv': () => loadTV(),
  });
}
