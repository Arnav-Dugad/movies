// ===== AFTER DARK (MATURE CONTENT) =====
// Off by default and invisible until switched on: no section renders, no chip
// appears, `include_adult` stays false, and nothing in the interface hints that
// the option exists. Turning it on is a deliberate act in Settings.
//
// TMDB has no "erotic" genre, so every collection here is built from verified
// TMDB KEYWORDS (MATURE_KEYWORDS in config.js). Everything still comes from
// TMDB's public metadata — the preference only decides whether we ask for it.
//
// The section used to be one grid of twenty posters behind a row of chips. It is
// a hub now, shaped like the rest of Discover: a spotlight that earns the space,
// rails that each answer a different question (the acclaimed ones, the thrillers,
// what is streaming tonight, the series, the world), and a collection browser
// with its own type, order, era, language and streaming controls, a real count
// and paging.
import { tmdb } from './api.js';
import { MATURE_KEYWORDS, IMG, PH, genreMap, regionName } from './config.js';
import { $, esc, toast } from './ui.js';
import { buildCard, skelCards, wlBtnHTML, wlPayload } from './cards.js';
import { registerActions } from './events.js';
import { observeReveals } from './effects.js';
import { prefs, updatePref } from './prefs.js';
import { state } from './state.js';
import { MATURE_KEYWORD_QUERY } from './mature-filter.js';
import { queryParams, writeFilterQuery } from './url-state.js';

export const matureOn = () => !!prefs.mature;

// The single place that decides whether a TMDB request may include adult
// results, so no caller can accidentally leak them in while the toggle is off.
export const adultParam = () => (matureOn() ? { include_adult: true } : {});

// `id: 0` is every collection at once — the keyword ids joined as an OR.
const COLLECTIONS = [
  { id: 0, name: 'All After Dark', blurb: 'Every mature collection, together' },
  ...MATURE_KEYWORDS,
];

const SORTS = [
  ['popular', 'Most popular'],
  ['acclaimed', 'Critically acclaimed'],
  ['newest', 'Newest first'],
  ['gems', 'Hidden gems'],
];
const ERAS = [['', 'Any era'], ['2020', '2020s'], ['2010', '2010s'], ['2000', '2000s'], ['1990', '1990s'], ['classic', 'Before 1990']];
const LANGUAGES = [
  ['', 'Any language'], ['en', 'English'], ['fr', 'French'], ['it', 'Italian'], ['es', 'Spanish'],
  ['de', 'German'], ['ko', 'Korean'], ['ja', 'Japanese'], ['tl', 'Filipino'], ['pt', 'Portuguese'], ['hi', 'Hindi'],
];

// Survives re-renders and visits within the page load, so leaving Discover and
// coming back returns to the same collection with the same controls set.
const view = { keyword: 0, type: 'movie', sort: 'popular', era: '', language: '', streaming: false };
let page = 1, totalPages = 1;
let gridGen = 0, spotlightGen = 0, railsGen = 0;
let spotlightPool = [], spotlightIndex = 0;

// ---------- the address bar ----------
// The collection browser's choices ride in Discover's URL under their own
// `ad_` names, beside the Studio's, so a link to "Erotic thrillers · Series ·
// 2010s" opens exactly that. Defaults are never written, and none of this is
// written or read while mature content is off.
const AD_PARAMS = ['ad', 'ad_type', 'ad_sort', 'ad_era', 'ad_lang', 'ad_stream'];

function writeAfterDarkQuery() {
  if (!matureOn()) return;
  writeFilterQuery('/discover', [], {
    ad: view.keyword ? String(view.keyword) : '',
    ad_type: view.type === 'tv' ? 'tv' : '',
    ad_sort: view.sort === 'popular' ? '' : view.sort,
    ad_era: view.era, ad_lang: view.language, ad_stream: view.streaming ? '1' : '',
  });
}

/** Take the collection browser's state from the URL, when it names any. */
export function restoreAfterDarkFromURL() {
  const params = queryParams();
  if (!matureOn() || !AD_PARAMS.some(key => params.has(key))) return false;
  const keyword = +(params.get('ad') || 0);
  view.keyword = COLLECTIONS.some(collection => collection.id === keyword) ? keyword : 0;
  view.type = params.get('ad_type') === 'tv' ? 'tv' : 'movie';
  view.sort = SORTS.some(([value]) => value === params.get('ad_sort')) ? params.get('ad_sort') : 'popular';
  view.era = ERAS.some(([value]) => value && value === params.get('ad_era')) ? params.get('ad_era') : '';
  view.language = LANGUAGES.some(([value]) => value && value === params.get('ad_lang')) ? params.get('ad_lang') : '';
  view.streaming = params.get('ad_stream') === '1';
  return true;
}

/** Drop the collection browser's params — mature content was switched off. */
export function clearAfterDarkQuery() {
  if (!AD_PARAMS.some(key => queryParams().has(key))) return;
  writeFilterQuery('/discover', [], Object.fromEntries(AD_PARAMS.map(key => [key, ''])));
}

const dateField = type => (type === 'tv' ? 'first_air_date' : 'primary_release_date');
const today = () => new Date().toISOString().slice(0, 10);
const yearOf = item => (item.release_date || item.first_air_date || '').slice(0, 4);
const titleOf = item => item.title || item.name || '';
const option = (value, label, current) => `<option value="${esc(value)}"${String(value) === String(current) ? ' selected' : ''}>${esc(label)}</option>`;
const collectionOf = id => COLLECTIONS.find(collection => collection.id === id) || COLLECTIONS[0];

// ---------- requests ----------

function gridParams(pageNumber) {
  const type = view.type, date = dateField(type);
  const params = {
    with_keywords: view.keyword ? String(view.keyword) : MATURE_KEYWORD_QUERY,
    include_adult: true,
    page: pageNumber,
  };
  if (view.sort === 'acclaimed') { params.sort_by = 'vote_average.desc'; params['vote_count.gte'] = type === 'tv' ? 20 : 80; }
  else if (view.sort === 'newest') { params.sort_by = `${date}.desc`; params[`${date}.lte`] = today(); params['vote_count.gte'] = 3; }
  else if (view.sort === 'gems') { params.sort_by = 'vote_average.desc'; params['vote_average.gte'] = 6.5; params['vote_count.gte'] = type === 'tv' ? 10 : 40; params['vote_count.lte'] = 500; }
  else { params.sort_by = 'popularity.desc'; params['vote_count.gte'] = 8; }

  // An era narrows whatever date bound the order already set, never widens it:
  // "newest" must still stop at today inside the 2020s.
  const bounds = view.era === 'classic' ? ['1900-01-01', '1989-12-31']
    : view.era ? [`${view.era}-01-01`, `${+view.era + 9}-12-31`] : null;
  if (bounds) {
    params[`${date}.gte`] = bounds[0];
    const upper = params[`${date}.lte`];
    params[`${date}.lte`] = upper && upper < bounds[1] ? upper : bounds[1];
  }
  if (view.language) params.with_original_language = view.language;
  if (view.streaming) { params.watch_region = state.region; params.with_watch_monetization_types = 'flatrate'; }
  return params;
}

function railDefinitions() {
  const every = { with_keywords: MATURE_KEYWORD_QUERY, include_adult: true };
  return [
    { id: 'adRailAcclaimed', kicker: 'The canon', title: 'Critically acclaimed', type: 'movie', params: { ...every, sort_by: 'vote_average.desc', 'vote_count.gte': 150 } },
    { id: 'adRailStreaming', kicker: `Subscription streaming · ${regionName(state.region)}`, title: 'Streaming tonight', type: 'movie', params: { ...every, sort_by: 'popularity.desc', watch_region: state.region, with_watch_monetization_types: 'flatrate' } },
    { id: 'adRailThrillers', kicker: 'Desire with a body count', title: 'Erotic thrillers', type: 'movie', params: { with_keywords: '207767', include_adult: true, sort_by: 'popularity.desc', 'vote_count.gte': 8 } },
    { id: 'adRailSeries', kicker: 'One more episode', title: 'Series after dark', type: 'tv', params: { ...every, sort_by: 'popularity.desc', 'vote_count.gte': 8 } },
    { id: 'adRailWorld', kicker: 'Beyond Hollywood', title: 'World cinema after dark', type: 'movie', params: { ...every, with_original_language: 'fr|it|es|de|ko|ja|sv|da|pt', sort_by: 'vote_average.desc', 'vote_count.gte': 40 } },
  ];
}

// ---------- markup ----------

function spotlightSkeleton() {
  return '<div class="ad-spotlight ad-spotlight-loading skel" id="adSpotlight" aria-hidden="true"></div>';
}

function spotlightHTML(item) {
  const title = titleOf(item);
  const genres = (item.genre_ids || []).map(id => genreMap[id]).filter(Boolean).slice(0, 3);
  const meta = [
    item.vote_average ? `<b class="ad-spot-score">★ ${item.vote_average.toFixed(1)}</b>` : '',
    yearOf(item) ? `<span>${esc(yearOf(item))}</span>` : '',
    ...genres.map(genre => `<span>${esc(genre)}</span>`),
  ].filter(Boolean).join('');
  return `<article class="ad-spotlight" id="adSpotlight">
    <div class="ad-spot-art" aria-hidden="true"><img src="${IMG}w1280${item.backdrop_path}" alt="" loading="lazy"></div>
    <div class="ad-spot-inner">
      <a class="ad-spot-poster" href="/movie/${item.id}" data-action="open-detail" data-id="${item.id}" data-type="movie" aria-label="Open ${esc(title)}"><img src="${item.poster_path ? `${IMG}w342${item.poster_path}` : PH}" alt="" loading="lazy" data-ph="${PH}"></a>
      <div class="ad-spot-copy">
        <span class="ad-spot-eyebrow">Tonight, after dark</span>
        <h3>${esc(title)}</h3>
        ${meta ? `<div class="ad-spot-meta">${meta}</div>` : ''}
        ${item.overview ? `<p>${esc(item.overview)}</p>` : ''}
        <div class="ad-spot-actions">
          <a class="btn-primary" href="/movie/${item.id}" data-action="open-detail" data-id="${item.id}" data-type="movie"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>Open title</a>
          ${wlBtnHTML(item.id, 'movie', wlPayload(item, 'movie'))}
          <button class="btn-glass ad-spot-next" data-action="mature-spotlight-next" aria-label="Show another spotlight title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>Another</button>
        </div>
      </div>
    </div>
  </article>`;
}

function collectionsHTML() {
  return COLLECTIONS.map(collection => {
    const active = collection.id === view.keyword;
    return `<button class="ad-tile${active ? ' active' : ''}" role="tab" aria-selected="${active}" data-action="mature-keyword" data-id="${collection.id}"><b>${esc(collection.name)}</b><small>${esc(collection.blurb)}</small></button>`;
  }).join('');
}

function toolbarHTML() {
  const segment = (type, label) => `<button class="${view.type === type ? 'active' : ''}" data-action="mature-type" data-type="${type}" aria-pressed="${view.type === type}">${label}</button>`;
  return `<div class="ad-seg" role="group" aria-label="Movies or series">${segment('movie', 'Movies')}${segment('tv', 'Series')}</div>
    <label class="ad-field"><span>Order</span><select data-action="mature-sort">${SORTS.map(([value, label]) => option(value, label, view.sort)).join('')}</select></label>
    <label class="ad-field"><span>Era</span><select data-action="mature-era">${ERAS.map(([value, label]) => option(value, label, view.era)).join('')}</select></label>
    <label class="ad-field"><span>Language</span><select data-action="mature-language">${LANGUAGES.map(([value, label]) => option(value, label, view.language)).join('')}</select></label>
    <label class="ad-switch"><input type="checkbox" data-action="mature-streaming"${view.streaming ? ' checked' : ''}><i aria-hidden="true"></i><span id="adStreamingLabel">Streaming in ${esc(regionName(state.region))}</span></label>`;
}

function blurButtonHTML() {
  return `<button data-action="mature-blur-toggle" aria-pressed="${prefs.matureBlur ? 'true' : 'false'}">${prefs.matureBlur ? 'Artwork blurred' : 'Artwork visible'}</button>`;
}

// Built from the definitions every time, so a rail removed for being empty in
// one region comes back when the region changes to one where it is not.
function railsHTML() {
  return railDefinitions().map(rail => `<section class="discover-row-section ad-rail" id="${rail.id}Wrap">
      <div class="discover-row-head"><div><span>${esc(rail.kicker)}</span><h3>${esc(rail.title)}</h3></div></div>
      <div class="row" id="${rail.id}">${skelCards(8)}</div>
    </section>`).join('');
}

export function matureSectionHTML() {
  if (!matureOn()) return '';
  return `<section class="mature-section" id="matureSection" aria-labelledby="adTitle">
    <div class="discover-section-head ad-head">
      <div>
        <span class="ad-eyebrow"><i>18+</i>After dark</span>
        <h2 id="adTitle">After Dark</h2>
        <p>Erotic cinema, softcore classics, and slow-burn seduction — collected from TMDB keywords and shown only because you turned mature content on.</p>
      </div>
      <div class="discover-section-tools" id="adTools">${blurButtonHTML()}<button data-action="mature-off">Turn off</button></div>
    </div>
    ${spotlightSkeleton()}
    <div class="ad-rails" id="adRails">${railsHTML()}</div>
    <div class="ad-browser" id="adBrowser">
      <div class="ad-browser-head"><div><span>Browse the collections</span><h3 id="adCollectionName">${esc(collectionOf(view.keyword).name)}</h3><p id="adCollectionBlurb">${esc(collectionOf(view.keyword).blurb)}</p></div><b class="ad-count" id="adCount" aria-live="polite"></b></div>
      <div class="ad-collections" role="tablist" aria-label="After Dark collections" id="adCollections">${collectionsHTML()}</div>
      <div class="ad-toolbar" id="adToolbar">${toolbarHTML()}</div>
      <div class="browse-grid mature-grid" id="matureGrid">${skelCards(12)}</div>
      <div class="ad-more-wrap" id="adMoreWrap"></div>
    </div>
    <p class="mature-note">Adult titles appear in search, Discover, and as a genre in every genre filter only while mature content is on — and never shape your recommendations or what friends see unless you allow it in Settings. Keep anything private in a PIN-locked list from the + on a poster.</p>
  </section>`;
}

// ---------- rendering ----------

async function renderSpotlight({ next = false } = {}) {
  const gen = ++spotlightGen;
  try {
    if (!spotlightPool.length) {
      const data = await tmdb('/discover/movie', { with_keywords: MATURE_KEYWORD_QUERY, include_adult: true, sort_by: 'popularity.desc', 'vote_count.gte': 50 });
      spotlightPool = (data.results || []).filter(item => item.backdrop_path && item.poster_path && item.overview).slice(0, 12);
    }
    if (gen !== spotlightGen) return;
    const host = $('adSpotlight');
    if (!host) return;
    if (!spotlightPool.length) { host.remove(); return; }
    if (next) spotlightIndex = (spotlightIndex + 1) % spotlightPool.length;
    host.outerHTML = spotlightHTML(spotlightPool[spotlightIndex % spotlightPool.length]);
  } catch (_) {
    // The hub is complete without a spotlight; an empty skeleton would not be.
    if (gen === spotlightGen) $('adSpotlight')?.remove();
  }
}

async function renderRails() {
  const gen = ++railsGen;
  await Promise.allSettled(railDefinitions().map(async rail => {
    const row = $(rail.id);
    if (!row) return;
    try {
      const data = await tmdb(`/discover/${rail.type}`, rail.params);
      if (gen !== railsGen || !row.isConnected) return;
      const items = (data.results || []).filter(item => item.poster_path).slice(0, 20);
      // A rail with nothing in it is removed rather than left as an apology —
      // "Streaming tonight" is legitimately empty in some regions.
      if (!items.length) { $(`${rail.id}Wrap`)?.remove(); return; }
      row.innerHTML = items.map(item => buildCard(item, rail.type)).join('');
      observeReveals(row);
    } catch (_) {
      if (gen === railsGen) $(`${rail.id}Wrap`)?.remove();
    }
  }));
}

function moreButtonHTML() {
  return page < totalPages
    ? `<button class="discover-more ad-more" data-action="mature-more">Load more ${view.type === 'tv' ? 'series' : 'films'}</button>`
    : '';
}

async function renderGrid({ append = false } = {}) {
  const grid = $('matureGrid'), count = $('adCount'), more = $('adMoreWrap');
  if (!grid) return;
  const gen = ++gridGen;
  const wanted = append ? page + 1 : 1;
  if (!append) writeAfterDarkQuery();
  if (append) {
    const button = more?.querySelector('button');
    if (button) { button.disabled = true; button.textContent = 'Loading…'; }
  } else {
    grid.innerHTML = skelCards(12);
    if (more) more.innerHTML = '';
    if (count) count.textContent = '';
  }
  try {
    const data = await tmdb(`/discover/${view.type}`, gridParams(wanted));
    if (gen !== gridGen || !grid.isConnected) return;
    // The page counter advances only once the page is really here, so a failed
    // "load more" retries the same page instead of skipping one.
    page = wanted;
    totalPages = Math.min(data.total_pages || 1, 500);   // TMDB refuses page > 500
    const items = (data.results || []).filter(item => item.poster_path);
    const cards = items.map(item => buildCard(item, view.type)).join('');
    if (append) grid.insertAdjacentHTML('beforeend', cards);
    else grid.innerHTML = cards || `<div class="mature-empty"><strong>Nothing here yet</strong><span>Try another era or language, or switch off “Streaming in ${esc(regionName(state.region))}”.</span></div>`;
    const total = +(data.total_results || 0);
    if (count) count.textContent = total ? `${total.toLocaleString()} ${view.type === 'tv' ? 'series' : total === 1 ? 'film' : 'films'}` : '';
    if (more) more.innerHTML = moreButtonHTML();
    observeReveals(grid);
  } catch (_) {
    if (gen !== gridGen) return;
    if (append) {
      const button = more?.querySelector('button');
      if (button) { button.disabled = false; button.textContent = 'Retry loading more'; }
    } else {
      grid.innerHTML = '<div class="mature-empty"><strong>After Dark could not load</strong><span>The catalogue did not answer. Your choices are kept.</span><button class="btn-glass" data-action="mature-retry">Try again</button></div>';
    }
  }
}

/** Paint the whole hub into its host. */
export function renderMatureSection() {
  if (!$('matureSection')) return;
  page = 1; totalPages = 1;
  renderSpotlight();
  renderRails();
  renderGrid();
}

/** Bring the parts that describe preferences back in line without a refetch. */
export function syncMatureChrome() {
  const tools = $('adTools');
  const blur = tools?.querySelector('[data-action="mature-blur-toggle"]');
  if (blur) blur.outerHTML = blurButtonHTML();
}

function refreshCollectionHead() {
  const current = collectionOf(view.keyword);
  const name = $('adCollectionName'), blurb = $('adCollectionBlurb');
  if (name) name.textContent = current.name;
  if (blurb) blurb.textContent = current.blurb;
  document.querySelectorAll('#adCollections .ad-tile').forEach(tile => {
    const active = +tile.dataset.id === view.keyword;
    tile.classList.toggle('active', active);
    tile.setAttribute('aria-selected', String(active));
  });
}

function refreshToolbar() {
  const bar = $('adToolbar');
  if (bar) bar.innerHTML = toolbarHTML();
}

export function initMature() {
  registerActions({
    'mature-keyword': element => {
      const id = +element.dataset.id;
      view.keyword = COLLECTIONS.some(collection => collection.id === id) ? id : 0;
      refreshCollectionHead();
      element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      renderGrid();
    },
    'mature-type': element => {
      const type = element.dataset.type === 'tv' ? 'tv' : 'movie';
      if (type === view.type) return;
      view.type = type;
      refreshToolbar();
      renderGrid();
    },
    'mature-sort': element => { view.sort = SORTS.some(([value]) => value === element.value) ? element.value : 'popular'; renderGrid(); },
    'mature-era': element => { view.era = ERAS.some(([value]) => value === element.value) ? element.value : ''; renderGrid(); },
    'mature-language': element => { view.language = LANGUAGES.some(([value]) => value === element.value) ? element.value : ''; renderGrid(); },
    'mature-streaming': element => { view.streaming = !!element.checked; renderGrid(); },
    'mature-more': () => renderGrid({ append: true }),
    'mature-retry': () => renderGrid(),
    'mature-spotlight-next': () => renderSpotlight({ next: true }),
    // The blur is a document-level data attribute (prefs.js applyPrefs), so the
    // artwork changes the instant the preference does; only the label follows.
    'mature-blur-toggle': () => updatePref('matureBlur', !prefs.matureBlur),
    // updatePref announces `cv:mature`, and Discover removes the section on it.
    'mature-off': () => { updatePref('mature', false); toast('Mature content hidden', 'info'); },
  });

  // The streaming rail, the streaming switch and its label all name the region.
  document.addEventListener('cv:region', () => {
    if (!$('matureSection')) return;
    const label = $('adStreamingLabel');
    if (label) label.textContent = `Streaming in ${regionName(state.region)}`;
    const rails = $('adRails');
    if (rails) { rails.innerHTML = railsHTML(); renderRails(); }
    if (view.streaming) renderGrid();
  });
}
