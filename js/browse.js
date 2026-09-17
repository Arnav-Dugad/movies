// ===== BROWSE (Movies / TV) =====
import { tmdb } from './api.js';
import { mGenreList, tGenreList } from './config.js';
import { state } from './state.js';
import { $ } from './ui.js';
import { illustration } from './illustrations.js';
import { buildCard } from './cards.js';
import { registerActions } from './events.js';
import { observeReveals } from './effects.js';
import { initBrowseHero } from './hero.js';
import { fillProviderSelect, applyProviderFilter } from './provider-catalog.js';
import { adultFlag } from './prefs.js';
import { applyAdultParams, adultFromGenre, realGenre, adultGenreOptionsHTML, syncAdultGenreOptions, onMatureToggle } from './mature-filter.js';
import { queryParams, urlNamesFilters, applyFilterQuery, writeFilterQuery } from './url-state.js';

// Every filter, as [URL param, control id, default]. The same table restores a
// shared link and writes the page's state back into its address.
export const MOVIE_FIELDS = [
  ['genre', 'mGenres'], ['exclude', 'mExcludeGenre'], ['provider', 'mProvider'], ['sort', 'mSort', 'popularity.desc'],
  ['year', 'mYear'], ['lang', 'mLang'], ['rating', 'mRating'], ['max', 'mRatingMax'], ['runtime', 'mRuntime'],
  ['votes', 'mVotes'], ['cert', 'mCert'], ['release', 'mRelease'], ['rtype', 'mReleaseType'], ['country', 'mCountry'],
];
export const TV_FIELDS = [
  ['genre', 'tGenres'], ['exclude', 'tExcludeGenre'], ['provider', 'tProvider'], ['sort', 'tSort', 'popularity.desc'],
  ['year', 'tYear'], ['lang', 'tLang'], ['rating', 'tRating'], ['max', 'tRatingMax'], ['runtime', 'tRuntime'],
  ['votes', 'tVotes'], ['status', 'tStatus'], ['format', 'tType'], ['air', 'tAirWindow'], ['country', 'tCountry'],
];
const PAGES = {
  movie: { path: '/movies', fields: MOVIE_FIELDS, genre: 'mGenres', exclude: 'mExcludeGenre', provider: 'mProvider', stateKey: 'mGenre' },
  tv: { path: '/tv', fields: TV_FIELDS, genre: 'tGenres', exclude: 'tExcludeGenre', provider: 'tProvider', stateKey: 'tGenre' },
};

// A newer load owns the grid. Without this, a slow response for an older filter
// could land after a fast one and paint results for choices no longer selected.
const loadGen = { movie: 0, tv: 0 };

const gridSkel = (n = 12) => Array(n).fill('<div><div class="card-img skel" style="aspect-ratio:2/3"></div></div>').join('');

// Built once. The route can render /movies before the app's own boot reaches
// this (a direct link or a refresh), so the loaders call it too — and a filter
// restored from the URL needs these options to exist before it can be selected.
let filtersReady = false;
export function initFilters() {
  if (filtersReady) return;
  filtersReady = true;
  const yr = $('mYear'), tyr = $('tYear');
  const cy = new Date().getFullYear();
  let years = '<option value="">All Years</option>';
  for (let y = cy + 2; y >= 1950; y--) years += `<option value="${y}">${y}</option>`;
  yr.innerHTML = years;
  tyr.innerHTML = years;
  // Adult sits in the genre lists themselves ("Adult · 18+" / "No Adult"), and
  // only while mature content is on.
  $('mGenres').innerHTML = '<option value="">All movie genres</option>' + mGenreList.map(g => `<option value="${g.id}">${g.n}</option>`).join('') + adultGenreOptionsHTML('genre');
  $('tGenres').innerHTML = '<option value="">All TV genres</option>' + tGenreList.map(g => `<option value="${g.id}">${g.n}</option>`).join('') + adultGenreOptionsHTML('genre');
  $('mExcludeGenre').innerHTML = '<option value="">Nothing excluded</option>' + mGenreList.map(g => `<option value="${g.id}">No ${g.n}</option>`).join('') + adultGenreOptionsHTML('exclude');
  $('tExcludeGenre').innerHTML = '<option value="">Nothing excluded</option>' + tGenreList.map(g => `<option value="${g.id}">No ${g.n}</option>`).join('') + adultGenreOptionsHTML('exclude');
  fillProviderSelect($('mProvider'), 'movie');
  fillProviderSelect($('tProvider'), 'tv');
}

// A URL naming any filter decides all of them. The provider list loads per
// region, so its value is applied once that list exists.
async function restoreFromURL(kind) {
  const page = PAGES[kind];
  const params = queryParams();
  if (!urlNamesFilters(page.fields, [], params)) return;
  applyFilterQuery(page.fields, { params, skip: ['provider'] });
  state[page.stateKey] = $(page.genre)?.value || '';
  const provider = params.get('provider') || '';
  const select = $(page.provider);
  if (select && select.value !== provider) await fillProviderSelect(select, kind, { wanted: provider });
}

const dateISO = d => d.toISOString().slice(0, 10);
function applyRuntime(params, value, shortMax, mediumMax) {
  if (value === 'short') params['with_runtime.lte'] = shortMax;
  else if (value === 'medium') { params['with_runtime.gte'] = shortMax + 1; params['with_runtime.lte'] = mediumMax; }
  else if (value === 'long') params['with_runtime.gte'] = mediumMax + 1;
}

// The genre controls as TMDB sees them: real genre ids, and the adult choice
// turned into keyword parameters.
function applyGenres(params, genre, exclude) {
  if (realGenre(genre)) params.with_genres = realGenre(genre);
  if (realGenre(exclude)) params.without_genres = realGenre(exclude);
  applyAdultParams(params, adultFromGenre(genre, exclude));
}

function resetGenre(kind) {
  state[kind === 'movie' ? 'mGenre' : 'tGenre'] = '';
  const select = $(kind === 'movie' ? 'mGenres' : 'tGenres');
  if (select) select.value = '';
}

function paintResults(grid, results, type, append) {
  const html = (results || []).filter(x => x.poster_path).map(x => buildCard(x, type)).join('');
  if (append) grid.insertAdjacentHTML('beforeend', html);
  else grid.innerHTML = html || `<div class="browse-empty">${illustration('search', { cls: 'empty-art' })}<strong>No matches</strong><span>Try clearing one or two filters.</span></div>`;
  observeReveals(grid);
}

// `route` is set only by the router: arriving at the page is when the URL gets a
// say. A filter change must never be overwritten by the address it is replacing.
export async function loadMovies(append = false, { route = false } = {}) {
  initFilters();
  const gen = ++loadGen.movie;
  if (!append) initBrowseHero('movie');
  if (!append) { state.mPg = 1; $('mGrid').innerHTML = gridSkel(); }
  if (route && !append) { await restoreFromURL('movie'); if (gen !== loadGen.movie) return; }
  const sort = $('mSort').value, year = $('mYear').value, lang = $('mLang').value, minRat = $('mRating').value;
  const runtime = $('mRuntime').value, votes = $('mVotes').value, cert = $('mCert').value;
  const release = $('mRelease').value, country = $('mCountry').value, provider = $('mProvider')?.value || '';
  const maxRat = $('mRatingMax')?.value || '', excludeGenre = $('mExcludeGenre')?.value || '', releaseType = $('mReleaseType')?.value || '';
  const params = { sort_by: sort, page: state.mPg, include_adult: adultFlag() };
  if (sort === 'vote_average.desc') params['vote_count.gte'] = Math.max(200, +(votes || 0));
  else if (sort === 'vote_average.asc') params['vote_count.gte'] = Math.max(50, +(votes || 0));
  applyGenres(params, state.mGenre, excludeGenre);
  if (year) params.primary_release_year = year;
  if (lang) params.with_original_language = lang;
  if (minRat) params['vote_average.gte'] = minRat;
  if (maxRat) params['vote_average.lte'] = maxRat;
  if (votes) params['vote_count.gte'] = Math.max(+(params['vote_count.gte'] || 0), +votes);
  if (country) params.with_origin_country = country;
  if (cert) { params.certification_country = 'US'; params.certification = cert; }
  if (releaseType) params.with_release_type = releaseType;
  applyProviderFilter(params, provider);
  applyRuntime(params, runtime, 89, 120);
  const now = new Date(), currentYear = now.getFullYear(), today = dateISO(now);
  if (release === 'released') params['primary_release_date.lte'] = today;
  else if (release === 'upcoming') params['primary_release_date.gte'] = today;
  else if (release === 'this_year') { params['primary_release_date.gte'] = `${currentYear}-01-01`; params['primary_release_date.lte'] = `${currentYear}-12-31`; }
  else if (release === 'five_years') { params['primary_release_date.gte'] = `${currentYear - 4}-01-01`; params['primary_release_date.lte'] = today; }
  if (!append) writeFilterQuery('/movies', MOVIE_FIELDS);
  try {
    const d = await tmdb('/discover/movie', params);
    if (gen !== loadGen.movie) return;
    paintResults($('mGrid'), d.results, 'movie', append);
  } catch (e) { if (!append && gen === loadGen.movie) $('mGrid').innerHTML = '<div class="row-error">Couldn\'t load movies. <button data-action="reload-movies">Retry</button></div>'; }
}
export function moreMovies() { state.mPg++; loadMovies(true); }

export async function loadTV(append = false, { route = false } = {}) {
  initFilters();
  const gen = ++loadGen.tv;
  if (!append) initBrowseHero('tv');
  if (!append) { state.tPg = 1; $('tGrid').innerHTML = gridSkel(); }
  if (route && !append) { await restoreFromURL('tv'); if (gen !== loadGen.tv) return; }
  const sort = $('tSort').value, year = $('tYear').value, lang = $('tLang').value;
  const minRat = $('tRating').value, runtime = $('tRuntime').value, votes = $('tVotes').value;
  const status = $('tStatus').value, country = $('tCountry').value, provider = $('tProvider')?.value || '';
  const maxRat = $('tRatingMax')?.value || '', excludeGenre = $('tExcludeGenre')?.value || '';
  const format = $('tType')?.value || '', airWindow = $('tAirWindow')?.value || '';
  // include_adult was missing here alone of every catalogue request, so TV kept
  // excluding adult series with mature content on.
  const params = { sort_by: sort, page: state.tPg, include_adult: adultFlag() };
  if (sort === 'vote_average.desc') params['vote_count.gte'] = Math.max(200, +(votes || 0));
  else if (sort === 'vote_average.asc') params['vote_count.gte'] = Math.max(50, +(votes || 0));
  applyGenres(params, state.tGenre, excludeGenre);
  if (year) params.first_air_date_year = year;
  if (lang) params.with_original_language = lang;
  if (minRat) params['vote_average.gte'] = minRat;
  if (maxRat) params['vote_average.lte'] = maxRat;
  if (votes) params['vote_count.gte'] = Math.max(+(params['vote_count.gte'] || 0), +votes);
  if (status !== '') params.with_status = status;
  if (format !== '') params.with_type = format;
  if (country) params.with_origin_country = country;
  applyProviderFilter(params, provider);
  applyRuntime(params, runtime, 29, 60);
  const now = new Date(), today = dateISO(now), currentYear = now.getFullYear();
  if (airWindow === 'released') params['first_air_date.lte'] = today;
  else if (airWindow === 'upcoming') params['first_air_date.gte'] = today;
  else if (airWindow === 'recent') { const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 90); params['first_air_date.gte'] = dateISO(cutoff); params['first_air_date.lte'] = today; }
  else if (airWindow === 'this_year') { params['first_air_date.gte'] = `${currentYear}-01-01`; params['first_air_date.lte'] = `${currentYear}-12-31`; }
  if (!append) writeFilterQuery('/tv', TV_FIELDS);
  try {
    const d = await tmdb('/discover/tv', params);
    if (gen !== loadGen.tv) return;
    paintResults($('tGrid'), d.results, 'tv', append);
  } catch (e) { if (!append && gen === loadGen.tv) $('tGrid').innerHTML = '<div class="row-error">Couldn\'t load shows. <button data-action="reload-tv">Retry</button></div>'; }
}
export function moreTV() { state.tPg++; loadTV(true); }

export function initBrowse() {
  registerActions({
    'set-mg': (el) => { state.mGenre = el.value; state.mPg = 1; loadMovies(); },
    'set-tg': (el) => { state.tGenre = el.value; state.tPg = 1; loadTV(); },
    'filter-movies': () => loadMovies(),
    'filter-tv': () => loadTV(),
    'reset-movies': () => {
      ['mYear','mLang','mRating','mRatingMax','mRuntime','mVotes','mCert','mRelease','mReleaseType','mCountry','mProvider','mExcludeGenre'].forEach(id => { if ($(id)) $(id).value = ''; });
      $('mSort').value = 'popularity.desc'; resetGenre('movie'); loadMovies();
    },
    'reset-tv': () => {
      ['tYear','tLang','tRating','tRatingMax','tRuntime','tVotes','tStatus','tType','tAirWindow','tCountry','tProvider','tExcludeGenre'].forEach(id => { if ($(id)) $(id).value = ''; });
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
  // The adult choices come and go with the preference, and the grid on screen was
  // fetched under the old include_adult, so the open page reloads.
  onMatureToggle(() => {
    if (!filtersReady) return;
    Object.values(PAGES).forEach(page => {
      syncAdultGenreOptions($(page.genre), 'genre');
      syncAdultGenreOptions($(page.exclude), 'exclude');
      state[page.stateKey] = $(page.genre)?.value || '';
    });
    if (location.pathname === '/movies') loadMovies();
    else if (location.pathname === '/tv') loadTV();
  });
}
