// ===== DISCOVER — EDITORIAL DISCOVERY HUB =====
import { tmdb } from './api.js';
import { moods, mGenreList, tGenreList, IMG, REGIONS } from './config.js';
import { state } from './state.js';
import { toast, $, esc } from './ui.js';
import { buildCard, skelCards } from './cards.js';
import { registerActions } from './events.js';
import { observeReveals } from './effects.js';
import { fillProviderSelect, applyProviderFilter } from './provider-catalog.js';

let labPage = 1;
let labSignature = '';
let activePreset = '';
let collectionRegion = '';
let labRequest = 0;
let moodRequest = 0;
let surpriseRequest = 0;

const sectionSkeleton = () => `<div class="row">${skelCards(8)}</div>`;
const yearOf = item => (item.release_date || item.first_air_date || '').slice(0, 4);
const typeOf = item => item.media_type === 'tv' ? 'tv' : 'movie';
const regionName = () => (REGIONS.find(([code]) => code === state.region)?.[1] || state.region).replace(/[^A-Za-z ]/g, '').trim() || state.region;

function populateGenres() {
  const type = $('discoverType')?.value || 'movie';
  const genres = type === 'tv' ? tGenreList : mGenreList;
  [['discoverGenre', 'Any genre', ''], ['discoverExcludeGenre', 'Exclude no genre', 'No ']].forEach(([id, first, prefix]) => {
    const select = $(id); if (!select) return;
    const selected = select.value;
    select.innerHTML = `<option value="">${first}</option>` + genres.map(genre => `<option value="${genre.id}">${prefix}${esc(genre.n)}</option>`).join('');
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
  });
}

function populateProviders(preserve = true) {
  return fillProviderSelect($('discoverProvider'), $('discoverType')?.value === 'tv' ? 'tv' : 'movie', { preserve });
}

function renderMoodDeck() {
  const host = $('moodGrid'); if (!host) return;
  host.innerHTML = moods.map((mood, index) => `<button class="mood-card" data-action="pick-mood" data-idx="${index}" aria-label="Discover ${esc(mood.name)}"><span class="mood-index">${String(index + 1).padStart(2, '0')}</span><span class="mood-emoji">${mood.emoji}</span><span class="mood-name">${esc(mood.name)}</span><span class="mood-sub">${esc(mood.sub)}</span><i>Explore →</i></button>`).join('');
}

async function loadSpotlight(refresh = false) {
  const host = $('discoverSpotlight'); if (!host) return;
  host.innerHTML = '<div class="discover-spotlight-skeleton skel"></div>';
  try {
    const data = await tmdb('/trending/all/day');
    const eligible = (data.results || []).filter(item => item.backdrop_path && item.poster_path && ['movie', 'tv'].includes(item.media_type));
    const offset = refresh ? Math.floor(Math.random() * Math.min(eligible.length, 12)) : 0;
    const item = eligible[offset] || eligible[0]; if (!item) throw new Error('No spotlight');
    const type = typeOf(item), title = item.title || item.name || '';
    host.innerHTML = `<article class="discover-spotlight-card"><img src="${IMG}original${item.backdrop_path}" alt="" loading="eager"><div class="discover-spotlight-shade"></div><div class="discover-spotlight-copy"><span>Today’s spotlight · ${type === 'tv' ? 'Series' : 'Movie'}</span><h2>${esc(title)}</h2><p>${item.vote_average ? `★ ${item.vote_average.toFixed(1)} · ` : ''}${esc(yearOf(item))}</p><div><a href="/${type}/${item.id}" data-action="open-detail" data-id="${item.id}" data-type="${type}">Explore title</a><button data-action="discover-new-spotlight" aria-label="Show another spotlight">↻</button></div></div></article>`;
  } catch (_) { host.innerHTML = '<div class="discover-spotlight-error"><span>Spotlight unavailable</span><button data-action="discover-new-spotlight">Try again</button></div>'; }
}

function curatedDefinitions() {
  const streaming = { watch_region: state.region, with_watch_monetization_types: 'flatrate', include_adult: false };
  return [
    { id: 'discoverTrending', kicker: 'What everyone is finding', title: 'Trending across movies & TV', path: '/trending/all/week', type: 'multi', params: {} },
    { id: 'discoverStreamingMovies', kicker: `Subscription streaming · ${regionName()}`, title: 'Popular movies streaming now', path: '/discover/movie', type: 'movie', params: { ...streaming, sort_by: 'popularity.desc', 'vote_count.gte': 150 } },
    { id: 'discoverStreamingTV', kicker: `Subscription streaming · ${regionName()}`, title: 'Series ready to binge', path: '/discover/tv', type: 'tv', params: { ...streaming, sort_by: 'popularity.desc', 'vote_count.gte': 150 } },
    { id: 'discoverHindi', kicker: 'Stories close to home', title: 'Hindi audience favorites', path: '/discover/movie', type: 'movie', params: { with_original_language: 'hi', sort_by: 'vote_average.desc', 'vote_count.gte': 250 } },
    { id: 'discoverHidden', kicker: 'Excellent, not obvious', title: 'Hidden gems worth your time', path: '/discover/movie', type: 'movie', params: { sort_by: 'vote_average.desc', 'vote_average.gte': 7.1, 'vote_count.gte': 180, 'vote_count.lte': 2200 } },
    { id: 'discoverDocs', kicker: 'Real worlds, remarkable lives', title: 'Documentaries that stay with you', path: '/discover/movie', type: 'movie', params: { with_genres: '99', sort_by: 'vote_average.desc', 'vote_count.gte': 180 } },
  ];
}

async function loadCollections(force = false) {
  const host = $('discoverRows'); if (!host) return;
  if (!force && host.children.length && collectionRegion === state.region) return;
  collectionRegion = state.region;
  const label = $('discoverRegionLabel'); if (label) label.textContent = `Streaming region · ${regionName()}`;
  const definitions = curatedDefinitions();
  host.innerHTML = definitions.map(definition => `<section class="discover-row-section reveal"><div class="discover-row-head"><div><span>${esc(definition.kicker)}</span><h3>${esc(definition.title)}</h3></div><button data-action="discover-jump" data-target="discoverStudio">Refine</button></div><div class="row" id="${definition.id}">${skelCards(8)}</div></section>`).join('');
  observeReveals(host);
  await Promise.allSettled(definitions.map(async definition => {
    const row = $(definition.id); if (!row) return;
    try {
      const data = await tmdb(definition.path, definition.params);
      const cards = (data.results || []).filter(item => item.poster_path && (definition.type !== 'multi' || ['movie', 'tv'].includes(item.media_type))).slice(0, 20).map(item => buildCard(item, definition.type === 'multi' ? typeOf(item) : definition.type)).join('');
      row.innerHTML = cards || '<div class="discover-inline-empty">No titles available right now.</div>';
    } catch (_) { row.innerHTML = '<div class="discover-inline-empty">This collection could not load. Try again shortly.</div>'; }
  }));
}

function dateBounds(era) {
  if (!era) return null;
  if (era === 'classic') return { from: '1900-01-01', to: '1989-12-31' };
  const start = +era;
  return { from: `${start}-01-01`, to: `${start + 9}-12-31` };
}

function runtimeParams(type, value, params) {
  const edges = type === 'tv' ? [29, 60] : [89, 120];
  if (value === 'short') params['with_runtime.lte'] = edges[0];
  if (value === 'medium') { params['with_runtime.gte'] = edges[0] + 1; params['with_runtime.lte'] = edges[1]; }
  if (value === 'long') params['with_runtime.gte'] = edges[1] + 1;
}

function labQuery() {
  const type = $('discoverType')?.value || 'movie';
  const sortValue = $('discoverSort')?.value || 'popularity.desc';
  const dateField = type === 'tv' ? 'first_air_date' : 'primary_release_date';
  const titleField = type === 'tv' ? 'original_name' : 'original_title';
  const sortBy = sortValue === 'date.desc' ? `${dateField}.desc` : sortValue === 'date.asc' ? `${dateField}.asc` : sortValue === 'title.asc' ? `${titleField}.asc` : sortValue === 'title.desc' ? `${titleField}.desc` : sortValue;
  const params = { include_adult: false, page: labPage, sort_by: sortBy };
  const genre = $('discoverGenre')?.value, excludeGenre = $('discoverExcludeGenre')?.value, language = $('discoverLanguage')?.value;
  const rating = +($('discoverRating')?.value || 0), maxRating = +($('discoverRatingMax')?.value || 0), votes = +($('discoverVotes')?.value || 0);
  if (genre) params.with_genres = genre;
  if (excludeGenre) params.without_genres = excludeGenre;
  if (language) params.with_original_language = language;
  if (rating) params['vote_average.gte'] = rating;
  if (maxRating) params['vote_average.lte'] = maxRating;
  if (votes) params['vote_count.gte'] = votes;
  if (sortValue === 'vote_average.desc') params['vote_count.gte'] = Math.max(250, votes);
  else if (sortValue === 'vote_average.asc') params['vote_count.gte'] = Math.max(50, votes);
  if ($('discoverCountry')?.value) params.with_origin_country = $('discoverCountry').value;
  const bounds = dateBounds($('discoverEra')?.value || '');
  const lower = value => { const key = `${dateField}.gte`; params[key] = !params[key] || value > params[key] ? value : params[key]; };
  const upper = value => { const key = `${dateField}.lte`; params[key] = !params[key] || value < params[key] ? value : params[key]; };
  if (bounds) { lower(bounds.from); upper(bounds.to); }
  const release = $('discoverRelease')?.value || '', now = new Date(), today = now.toISOString().slice(0, 10), currentYear = now.getFullYear();
  if (release === 'released') upper(today);
  else if (release === 'upcoming') lower(today);
  else if (release === 'this_year') { lower(`${currentYear}-01-01`); upper(`${currentYear}-12-31`); }
  else if (release === 'recent') { lower(`${currentYear - 4}-01-01`); upper(today); }
  runtimeParams(type, $('discoverRuntime')?.value || '', params);
  applyProviderFilter(params, $('discoverProvider')?.value || '');
  if ($('discoverStreaming')?.checked) { params.watch_region = state.region; params.with_watch_monetization_types = 'flatrate'; }
  if (activePreset === 'hidden') { params['vote_count.gte'] = 150; params['vote_count.lte'] = 2200; }
  return { type, params };
}

async function buildDiscovery({ append = false } = {}) {
  const host = $('discoverLabResults'); if (!host) return;
  if (!append) labPage = 1;
  const { type, params } = labQuery();
  const signature = `${type}|${JSON.stringify({ ...params, page: 0 })}`;
  if (append && signature !== labSignature) { labPage = 1; return buildDiscovery(); }
  labSignature = signature;
  const request = ++labRequest;
  if (!append) host.innerHTML = `<div class="discover-lab-loading"><span>Building your collection</span>${sectionSkeleton()}</div>`;
  const loadButton = host.querySelector('[data-action="discover-more"]'); if (loadButton) { loadButton.disabled = true; loadButton.textContent = 'Loading…'; }
  try {
    const data = await tmdb(`/discover/${type}`, params);
    if (request !== labRequest) return;
    const results = (data.results || []).filter(item => item.poster_path);
    const cards = results.map(item => buildCard(item, type)).join('');
    if (append) {
      const grid = host.querySelector('.discover-result-grid');
      if (grid) grid.insertAdjacentHTML('beforeend', cards);
      host.querySelector('.discover-result-count').textContent = `${Math.min(data.total_results || 0, 10000).toLocaleString()} catalog matches`;
      const button = host.querySelector('[data-action="discover-more"]');
      if (button) { button.disabled = false; button.textContent = 'Load more'; if (labPage >= (data.total_pages || 1)) button.remove(); }
    } else {
      host.innerHTML = `<div class="discover-result-head"><div><span>Built for this moment</span><h3>${results.length ? 'Your discovery collection' : 'No exact matches'}</h3><p class="discover-result-count">${Math.min(data.total_results || 0, 10000).toLocaleString()} catalog matches</p></div><button data-action="discover-reset">Reset studio</button></div>${cards ? `<div class="discover-result-grid">${cards}</div>${(data.total_pages || 1) > 1 ? '<button class="discover-more" data-action="discover-more">Load more</button>' : ''}` : '<div class="discover-no-results"><strong>Try one fewer filter</strong><span>Widen the era, rating, or streaming option to discover more.</span></div>'}`;
    }
    observeReveals(host);
    if (!append) host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (_) { host.innerHTML = '<div class="discover-no-results"><strong>Discovery paused</strong><span>We could not reach the catalog. Your filters are still here.</span><button class="btn-glass" data-action="discover-build">Try again</button></div>'; }
}

function resetStudio() {
  labRequest++;
  activePreset = '';
  const defaults = { discoverType: 'movie', discoverGenre: '', discoverExcludeGenre: '', discoverEra: '', discoverLanguage: '', discoverRating: '0', discoverRatingMax: '0', discoverVotes: '0', discoverRuntime: '', discoverCountry: '', discoverRelease: '', discoverSort: 'popularity.desc', discoverProvider: '' };
  Object.entries(defaults).forEach(([id, value]) => { if ($(id)) $(id).value = value; });
  if ($('discoverStreaming')) $('discoverStreaming').checked = true;
  populateGenres();
  populateProviders(false);
  const host = $('discoverLabResults'); if (host) host.innerHTML = '';
}

function applyPreset(name) {
  resetStudio(); activePreset = name;
  const set = (id, value) => { if ($(id)) $(id).value = value; };
  if (name === 'critics') { set('discoverRating', '8'); set('discoverSort', 'vote_average.desc'); }
  if (name === 'hindi') { set('discoverLanguage', 'hi'); set('discoverRating', '6'); }
  if (name === 'family') { set('discoverGenre', '10751'); set('discoverRating', '6'); }
  if (name === 'hidden') { set('discoverRating', '7'); set('discoverSort', 'vote_average.desc'); }
  if (name === 'classic') { set('discoverEra', '2010'); set('discoverRating', '7'); set('discoverSort', 'vote_average.desc'); }
  document.querySelectorAll('.discover-presets button').forEach(button => button.classList.toggle('active', button.dataset.preset === name));
  buildDiscovery();
}

async function pickMood(index) {
  const mood = moods[index], host = $('moodResults'); if (!mood || !host) return;
  const request = ++moodRequest;
  document.querySelectorAll('.mood-card').forEach((card, idx) => card.classList.toggle('active', idx === index));
  host.innerHTML = `<div class="discover-mood-result-head"><div><span>${mood.emoji} Mood journey</span><h3>${esc(mood.name)}</h3><p>Finding excellent ${esc(mood.sub.toLowerCase())} picks…</p></div></div><div class="discover-result-grid">${skelCards(10)}</div>`;
  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const type = mood.type === 'tv' ? 'tv' : 'movie';
  const params = { with_genres: mood.genres, sort_by: 'vote_average.desc', 'vote_count.gte': 150, page: Math.floor(Math.random() * 3) + 1, include_adult: false, watch_region: state.region, with_watch_monetization_types: 'flatrate' };
  if (mood.lang) params.with_original_language = mood.lang;
  try {
    const data = await tmdb(`/discover/${type}`, params);
    if (request !== moodRequest) return;
    const items = (data.results || []).filter(item => item.poster_path).slice(0, 20);
    host.innerHTML = `<div class="discover-mood-result-head"><div><span>${mood.emoji} Mood journey</span><h3>${esc(mood.name)}</h3><p>${items.length} quality picks available for streaming in ${esc(regionName())}.</p></div><button data-action="pick-mood" data-idx="${index}">Refresh mood</button></div><div class="discover-result-grid">${items.map(item => buildCard(item, type)).join('')}</div>`;
    observeReveals(host);
  } catch (_) { host.innerHTML = '<div class="discover-no-results"><strong>Could not build this mood</strong><span>Try another mood or refresh shortly.</span></div>'; }
}

export async function randomPick(type) {
  const button = $(type === 'movie' ? 'spinBtn' : 'spinBtnTV'), host = $('pickerResult');
  if (!button || !host) return;
  const request = ++surpriseRequest;
  const buttons = [$('spinBtn'), $('spinBtnTV')].filter(Boolean);
  button.classList.add('spinning'); buttons.forEach(item => { item.disabled = true; });
  host.innerHTML = '<div class="discover-surprise-empty loading"><i>···</i><strong>Choosing carefully</strong><span>Quality and streaming availability matter</span></div>';
  try {
    const page = Math.floor(Math.random() * 8) + 1;
    const data = await tmdb(`/discover/${type}`, { sort_by: 'vote_average.desc', page, 'vote_average.gte': 6.5, 'vote_count.gte': 250, watch_region: state.region, with_watch_monetization_types: 'flatrate', include_adult: false });
    if (request !== surpriseRequest) return;
    const choices = (data.results || []).filter(item => item.poster_path && item.backdrop_path);
    const pick = choices[Math.floor(Math.random() * choices.length)];
    if (!pick) throw new Error('No pick');
    const title = pick.title || pick.name || '';
    host.innerHTML = `<div class="discover-surprise-card"><div>${buildCard(pick, type)}</div><section><span>Tonight’s pick</span><h3>${esc(title)}</h3><p>${pick.overview ? esc(pick.overview) : 'A strong match selected from highly rated streaming titles.'}</p><div><b>${pick.vote_average ? `★ ${pick.vote_average.toFixed(1)}` : 'Quality pick'}</b><b>${esc(yearOf(pick))}</b><b>${type === 'tv' ? 'TV show' : 'Movie'}</b></div><a class="btn-primary" href="/${type}/${pick.id}" data-action="open-detail" data-id="${pick.id}" data-type="${type}">Open tonight’s pick</a></section></div>`;
    toast(`Tonight’s pick: ${title}`, 'success');
  } catch (_) { host.innerHTML = '<div class="discover-surprise-empty"><i>!</i><strong>No pick found this time</strong><span>Try once more for a fresh result.</span></div>'; toast('Could not choose a title', 'error'); }
  finally { if (request === surpriseRequest) { button.classList.remove('spinning'); buttons.forEach(item => { item.disabled = false; }); } }
}

export function initDiscover() {
  renderMoodDeck();
  populateGenres();
  populateProviders();
  if (!$('discoverLabResults')?.children.length) $('discoverLabResults').innerHTML = '<div class="discover-lab-welcome"><i>✦</i><div><strong>Your filters are ready</strong><span>Use one quick start or build a precise collection above.</span></div></div>';
  loadSpotlight();
  loadCollections();
}

export function initDiscoverActions() {
  registerActions({
    'pick-mood': element => pickMood(+element.dataset.idx),
    'random-pick': element => randomPick(element.dataset.type === 'tv' ? 'tv' : 'movie'),
    'discover-type': () => { activePreset = ''; populateGenres(); populateProviders(false); },
    'discover-build': () => { activePreset = ''; document.querySelectorAll('.discover-presets button').forEach(button => button.classList.remove('active')); buildDiscovery(); },
    'discover-more': () => { labPage++; buildDiscovery({ append: true }); },
    'discover-reset': () => resetStudio(),
    'discover-preset': element => applyPreset(element.dataset.preset),
    'discover-jump': element => $(element.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    'discover-new-spotlight': () => loadSpotlight(true),
    'discover-refresh-collections': () => loadCollections(true),
  });
  document.addEventListener('cv:region', () => { collectionRegion = ''; populateProviders(false); if (location.pathname === '/discover') loadCollections(true); });
}
