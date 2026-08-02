// ===== BROWSE (Movies / TV) =====
import { tmdb } from './api.js';
import { IMG, mGenreList, tGenreList, genreMap, pickLogo } from './config.js';
import { state } from './state.js';
import { $, esc, prefersReducedMotion } from './ui.js';
import { buildCard } from './cards.js';
import { registerActions } from './events.js';
import { observeReveals } from './effects.js';

const gridSkel = (n = 12) => Array(n).fill('<div><div class="card-img skel" style="aspect-ratio:2/3"></div></div>').join('');
const BROWSE_HERO_MS = 14000;
const browseHeroes = {
  movie: { items: [], index: 0, timer: null, loading: null },
  tv: { items: [], index: 0, timer: null, loading: null },
};

const heroId = type => type === 'movie' ? 'movieHero' : 'tvHero';

function browseHeroPayload(item, type) {
  return esc(JSON.stringify({ id: item.id, type, title: item.title || item.name || '', poster: item.poster_path || '', rating: item.vote_average || 0, year: (item.release_date || item.first_air_date || '').slice(0, 4), genres: item.genre_ids || [] }));
}

function renderBrowseHero(type) {
  const host = $(heroId(type)), model = browseHeroes[type]; if (!host || !model.items.length) return;
  host.innerHTML = model.items.map((item, index) => {
    const title = item.title || item.name || '', year = (item.release_date || item.first_air_date || '').slice(0, 4);
    const genres = (item.genre_ids || []).slice(0, 3).map(id => genreMap[id]).filter(Boolean);
    return `<article class="browse-feature-slide${index === model.index ? ' active' : ''}" data-browse-slide="${index}"><img src="${IMG}original${item.backdrop_path}" alt="" loading="${index ? 'lazy' : 'eager'}"><div class="browse-feature-shade"></div><div class="browse-feature-copy"><span class="browse-feature-kicker">${type === 'movie' ? 'Movie spotlight' : 'Series spotlight'} · ${String(index + 1).padStart(2, '0')}</span><h2 data-browse-title="${index}">${esc(title)}</h2><div class="browse-feature-meta">${item.vote_average ? `<b>★ ${item.vote_average.toFixed(1)}</b>` : ''}<span>${year}</span>${genres.map(genre => `<span>${esc(genre)}</span>`).join('')}</div><p>${esc(item.overview || '')}</p><div class="browse-feature-actions"><a class="btn-primary" href="/${type}/${item.id}" data-action="open-detail" data-id="${item.id}" data-type="${type}">Explore title</a><button class="btn-glass" data-action="open-list-picker" data-item="${browseHeroPayload(item, type)}">＋ My List</button></div></div></article>`;
  }).join('') + `<div class="browse-feature-nav"><button data-action="browse-hero-step" data-type="${type}" data-step="-1" aria-label="Previous feature">‹</button><div>${model.items.map((_, index) => `<button class="${index === model.index ? 'active' : ''}" data-action="browse-hero-go" data-type="${type}" data-idx="${index}" aria-label="Feature ${index + 1}"><i style="animation-duration:${BROWSE_HERO_MS}ms"></i></button>`).join('')}</div><button data-action="browse-hero-step" data-type="${type}" data-step="1" aria-label="Next feature">›</button></div>`;
  model.items.forEach((item, index) => {
    tmdb(`/${type}/${item.id}/images`, { include_image_language: 'en,null' }).then(data => {
      const logo = pickLogo(data.logos), title = host.querySelector(`[data-browse-title="${index}"]`);
      if (logo && title) title.innerHTML = `<img src="${IMG}w500${logo}" alt="${esc(item.title || item.name || '')}">`;
    }).catch(() => {});
  });
}

function startBrowseHero(type) {
  const model = browseHeroes[type]; clearInterval(model.timer);
  if (prefersReducedMotion() || model.items.length < 2) return;
  model.timer = setInterval(() => { const host = $(heroId(type)); if (host?.offsetParent) goBrowseHero(type, model.index + 1); }, BROWSE_HERO_MS);
}

function goBrowseHero(type, index) {
  const model = browseHeroes[type]; if (!model?.items.length) return;
  model.index = (index + model.items.length) % model.items.length;
  const host = $(heroId(type));
  host?.querySelectorAll('.browse-feature-slide').forEach((slide, idx) => slide.classList.toggle('active', idx === model.index));
  host?.querySelectorAll('.browse-feature-nav>div>button').forEach((dot, idx) => dot.classList.toggle('active', idx === model.index));
  startBrowseHero(type);
}

async function loadBrowseHero(type) {
  const model = browseHeroes[type];
  if (model.items.length) { renderBrowseHero(type); startBrowseHero(type); return; }
  if (model.loading) return model.loading;
  const host = $(heroId(type)); if (host) host.innerHTML = '<div class="browse-feature-loading skel"></div>';
  model.loading = tmdb(`/trending/${type}/week`).then(data => {
    model.items = (data.results || []).filter(item => item.backdrop_path).slice(0, 5); model.index = 0;
    renderBrowseHero(type); startBrowseHero(type);
  }).catch(() => { if (host) host.innerHTML = ''; }).finally(() => { model.loading = null; });
  return model.loading;
}

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
  if (!append) loadBrowseHero('movie');
  if (!append) { state.mPg = 1; $('mGrid').innerHTML = gridSkel(); }
  const sort = $('mSort').value, year = $('mYear').value, lang = $('mLang').value, minRat = $('mRating').value;
  const runtime = $('mRuntime').value, votes = $('mVotes').value, cert = $('mCert').value;
  const release = $('mRelease').value, country = $('mCountry').value;
  const params = { sort_by: sort, page: state.mPg, include_adult: false };
  if (sort === 'vote_average.desc') params['vote_count.gte'] = Math.max(200, +(votes || 0));
  if (state.mGenre) params.with_genres = state.mGenre;
  if (year) params.primary_release_year = year;
  if (lang) params.with_original_language = lang;
  if (minRat) params['vote_average.gte'] = minRat;
  if (votes) params['vote_count.gte'] = Math.max(+(params['vote_count.gte'] || 0), +votes);
  if (country) params.with_origin_country = country;
  if (cert) { params.certification_country = 'US'; params.certification = cert; }
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
  if (!append) loadBrowseHero('tv');
  if (!append) { state.tPg = 1; $('tGrid').innerHTML = gridSkel(); }
  const sort = $('tSort').value, year = $('tYear').value, lang = $('tLang').value;
  const minRat = $('tRating').value, runtime = $('tRuntime').value, votes = $('tVotes').value;
  const status = $('tStatus').value, country = $('tCountry').value;
  const params = { sort_by: sort, page: state.tPg };
  if (sort === 'vote_average.desc') params['vote_count.gte'] = Math.max(200, +(votes || 0));
  if (state.tGenre) params.with_genres = state.tGenre;
  if (year) params.first_air_date_year = year;
  if (lang) params.with_original_language = lang;
  if (minRat) params['vote_average.gte'] = minRat;
  if (votes) params['vote_count.gte'] = Math.max(+(params['vote_count.gte'] || 0), +votes);
  if (status !== '') params.with_status = status;
  if (country) params.with_origin_country = country;
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
      ['mYear','mLang','mRating','mRuntime','mVotes','mCert','mRelease','mCountry'].forEach(id => { if ($(id)) $(id).value = ''; });
      $('mSort').value = 'popularity.desc'; resetGenre('movie'); loadMovies();
    },
    'reset-tv': () => {
      ['tYear','tLang','tRating','tRuntime','tVotes','tStatus','tCountry'].forEach(id => { if ($(id)) $(id).value = ''; });
      $('tSort').value = 'popularity.desc'; resetGenre('tv'); loadTV();
    },
    'more-movies': () => moreMovies(),
    'more-tv': () => moreTV(),
    'reload-movies': () => loadMovies(),
    'reload-tv': () => loadTV(),
    'browse-hero-go': el => goBrowseHero(el.dataset.type, +el.dataset.idx),
    'browse-hero-step': el => goBrowseHero(el.dataset.type, browseHeroes[el.dataset.type].index + +el.dataset.step),
  });
  ['movie', 'tv'].forEach(type => {
    const host = $(heroId(type)); if (!host) return;
    let startX = 0;
    host.addEventListener('touchstart', event => { startX = event.touches[0].clientX; }, { passive: true });
    host.addEventListener('touchend', event => { const delta = startX - event.changedTouches[0].clientX; if (Math.abs(delta) > 55) goBrowseHero(type, browseHeroes[type].index + (delta > 0 ? 1 : -1)); }, { passive: true });
  });
}
