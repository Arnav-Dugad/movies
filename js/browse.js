// ===== BROWSE (Movies / TV) =====
import { tmdb } from './api.js';
import { mGenreList, tGenreList } from './config.js';
import { state } from './state.js';
import { $ } from './ui.js';
import { buildCard } from './cards.js';
import { registerActions } from './events.js';
import { observeReveals } from './effects.js';
import { initBrowseHero } from './hero.js';
import { fillProviderSelect, applyProviderFilter } from './provider-catalog.js';

const gridSkel = (n = 12) => Array(n).fill('<div><div class="card-img skel" style="aspect-ratio:2/3"></div></div>').join('');
export function initFilters() {
  const yr = $('mYear'), tyr = $('tYear');
  yr.innerHTML = '<option value="">All Years</option>';
  tyr.innerHTML = '<option value="">All Years</option>';
  const cy = new Date().getFullYear();
  for (let y = cy + 2; y >= 1950; y--) {
    yr.innerHTML += `<option value="${y}">${y}</option>`;
    tyr.innerHTML += `<option value="${y}">${y}</option>`;
  }
  $('mGenres').innerHTML = '<option value="">All movie genres</option>' + mGenreList.map(g => `<option value="${g.id}">${g.n}</option>`).join('');
  $('tGenres').innerHTML = '<option value="">All TV genres</option>' + tGenreList.map(g => `<option value="${g.id}">${g.n}</option>`).join('');
  fillProviderSelect($('mProvider'), 'movie');
  fillProviderSelect($('tProvider'), 'tv');
}

const dateISO = d => d.toISOString().slice(0, 10);
function applyRuntime(params, value, shortMax, mediumMax) {
  if (value === 'short') params['with_runtime.lte'] = shortMax;
  else if (value === 'medium') { params['with_runtime.gte'] = shortMax + 1; params['with_runtime.lte'] = mediumMax; }
  else if (value === 'long') params['with_runtime.gte'] = mediumMax + 1;
}

function resetGenre(kind) {
  state[kind === 'movie' ? 'mGenre' : 'tGenre'] = '';
  const select = $(kind === 'movie' ? 'mGenres' : 'tGenres');
  if (select) select.value = '';
}

function paintResults(grid, results, type, append) {
  const html = (results || []).filter(x => x.poster_path).map(x => buildCard(x, type)).join('');
  if (append) grid.insertAdjacentHTML('beforeend', html);
  else grid.innerHTML = html || `<div class="browse-empty"><strong>No matches</strong><span>Try clearing one or two filters.</span></div>`;
  observeReveals(grid);
}

export async function loadMovies(append = false) {
  if (!append) initBrowseHero('movie');
  if (!append) { state.mPg = 1; $('mGrid').innerHTML = gridSkel(); }
  const sort = $('mSort').value, year = $('mYear').value, lang = $('mLang').value, minRat = $('mRating').value;
  const runtime = $('mRuntime').value, votes = $('mVotes').value, cert = $('mCert').value;
  const release = $('mRelease').value, country = $('mCountry').value, provider = $('mProvider')?.value || '';
  const params = { sort_by: sort, page: state.mPg, include_adult: false };
  if (sort === 'vote_average.desc') params['vote_count.gte'] = Math.max(200, +(votes || 0));
  if (state.mGenre) params.with_genres = state.mGenre;
  if (year) params.primary_release_year = year;
  if (lang) params.with_original_language = lang;
  if (minRat) params['vote_average.gte'] = minRat;
  if (votes) params['vote_count.gte'] = Math.max(+(params['vote_count.gte'] || 0), +votes);
  if (country) params.with_origin_country = country;
  if (cert) { params.certification_country = 'US'; params.certification = cert; }
  applyProviderFilter(params, provider);
  applyRuntime(params, runtime, 89, 120);
  const now = new Date(), currentYear = now.getFullYear(), today = dateISO(now);
  if (release === 'released') params['primary_release_date.lte'] = today;
  else if (release === 'upcoming') params['primary_release_date.gte'] = today;
  else if (release === 'this_year') { params['primary_release_date.gte'] = `${currentYear}-01-01`; params['primary_release_date.lte'] = `${currentYear}-12-31`; }
  else if (release === 'five_years') { params['primary_release_date.gte'] = `${currentYear - 4}-01-01`; params['primary_release_date.lte'] = today; }
  try {
    const d = await tmdb('/discover/movie', params);
    paintResults($('mGrid'), d.results, 'movie', append);
  } catch (e) { if (!append) $('mGrid').innerHTML = '<div class="row-error">Couldn\'t load movies. <button data-action="reload-movies">Retry</button></div>'; }
}
export function moreMovies() { state.mPg++; loadMovies(true); }

export async function loadTV(append = false) {
  if (!append) initBrowseHero('tv');
  if (!append) { state.tPg = 1; $('tGrid').innerHTML = gridSkel(); }
  const sort = $('tSort').value, year = $('tYear').value, lang = $('tLang').value;
  const minRat = $('tRating').value, runtime = $('tRuntime').value, votes = $('tVotes').value;
  const status = $('tStatus').value, country = $('tCountry').value, provider = $('tProvider')?.value || '';
  const params = { sort_by: sort, page: state.tPg };
  if (sort === 'vote_average.desc') params['vote_count.gte'] = Math.max(200, +(votes || 0));
  if (state.tGenre) params.with_genres = state.tGenre;
  if (year) params.first_air_date_year = year;
  if (lang) params.with_original_language = lang;
  if (minRat) params['vote_average.gte'] = minRat;
  if (votes) params['vote_count.gte'] = Math.max(+(params['vote_count.gte'] || 0), +votes);
  if (status !== '') params.with_status = status;
  if (country) params.with_origin_country = country;
  applyProviderFilter(params, provider);
  applyRuntime(params, runtime, 29, 60);
  try {
    const d = await tmdb('/discover/tv', params);
    paintResults($('tGrid'), d.results, 'tv', append);
  } catch (e) { if (!append) $('tGrid').innerHTML = '<div class="row-error">Couldn\'t load shows. <button data-action="reload-tv">Retry</button></div>'; }
}
export function moreTV() { state.tPg++; loadTV(true); }

export function initBrowse() {
  registerActions({
    'set-mg': (el) => { state.mGenre = el.value; state.mPg = 1; loadMovies(); },
    'set-tg': (el) => { state.tGenre = el.value; state.tPg = 1; loadTV(); },
    'filter-movies': () => loadMovies(),
    'filter-tv': () => loadTV(),
    'reset-movies': () => {
      ['mYear','mLang','mRating','mRuntime','mVotes','mCert','mRelease','mCountry','mProvider'].forEach(id => { if ($(id)) $(id).value = ''; });
      $('mSort').value = 'popularity.desc'; resetGenre('movie'); loadMovies();
    },
    'reset-tv': () => {
      ['tYear','tLang','tRating','tRuntime','tVotes','tStatus','tCountry','tProvider'].forEach(id => { if ($(id)) $(id).value = ''; });
      $('tSort').value = 'popularity.desc'; resetGenre('tv'); loadTV();
    },
    'more-movies': () => moreMovies(),
    'more-tv': () => moreTV(),
    'reload-movies': () => loadMovies(),
    'reload-tv': () => loadTV(),
  });
  document.addEventListener('cv:region', () => {
    fillProviderSelect($('mProvider'), 'movie', { preserve: false });
    fillProviderSelect($('tProvider'), 'tv', { preserve: false });
  });
}
