// ===== WATCHED PAGE (/watched) =====
// Lists every title the user has marked as watched, with type tabs (All/Movies/TV)
// plus a search box, sort, and genre filter. Watched docs are enriched with
// poster/year/genres on write (see watchlist.js); older docs — and the
// runtime/director/cast the badge engine needs — are filled in by the shared
// backfill in watched-meta.js on first view.
import { state } from './state.js';
import { IMG, PH, genreMap } from './config.js';
import { esc, debounce, $, toast } from './ui.js';
import { registerActions } from './events.js';
import { rateBtnHTML, myRatingHTML, WATCHED_BADGE_HTML } from './cards.js';
import { ensureWatchedMeta } from './watched-meta.js';
import { playCount, lastPlayMs } from './rewatch.js';

let watchedSort = 'recent', watchedGenre = 'all', watchedQuery = '';
let watchedDecade = 'all', watchedLanguage = 'all', watchedCountry = 'all';
let watchedCommunity = 0, watchedMine = 'all', watchedRuntime = 'all', watchedWhen = 'all';
let watchedDirector = 'all', watchedActor = 'all', watchedTheme = 'all', watchedMetadata = 'all';
let watchedPlays = 'all';
let advancedOpen = false;

// Normalize a watched doc into a renderable item, filling poster/year from the
// watchlist for entries saved before enrichment existed.
function toItem(key, d) {
  const wl = state.watchlist.find(w => w.id === key);
  return {
    id: d.tmdbId || +(String(key).split('_').pop() || 0), type: d.type || String(key).split('_')[0],
    title: d.title || wl?.title || '',
    poster: d.poster || wl?.poster || '',
    year: d.year || wl?.year || '',
    genres: (d.genres && d.genres.length ? d.genres : wl?.genres) || [],
    keywords: (d.keywords && d.keywords.length ? d.keywords : wl?.keywords) || [],
    language: d.language || wl?.language || '', country: d.country || wl?.country || '',
    runtime: +(d.runtime || wl?.runtime || 0), community: +(d.tmdbRating || wl?.rating || 0),
    userRating: +(state.ratings[key] || 0),
    director: d.director || '', directorId: +(d.directorId || 0), cast: d.cast || [], releaseDate: d.releaseDate || wl?.releaseDate || '',
    ts: d.watchedAt?.seconds || 0,
    plays: playCount(key), lastPlay: lastPlayMs(key),
  };
}

function allItems() {
  return Object.entries(state.watched).map(([k, d]) => toItem(k, d));
}

export function applyWatchedFilters(source, filters = {}) {
  let items = [...source];
  const type = filters.type || 'all', genre = filters.genre || 'all', query = (filters.query || '').trim().toLowerCase();
  const decade = filters.decade || 'all', language = filters.language || 'all', country = filters.country || 'all';
  const community = +(filters.community || 0), mine = filters.mine || 'all', runtime = filters.runtime || 'all', when = filters.when || 'all';
  const director = filters.director || 'all', actor = filters.actor || 'all', theme = filters.theme || 'all', metadata = filters.metadata || 'all';
  const plays = filters.plays || 'all';
  const sort = filters.sort || 'recent', now = filters.now || new Date(), nowSeconds = now.getTime() / 1000;
  if (type !== 'all') items = items.filter(i => i.type === type);
  if (genre !== 'all') items = items.filter(i => (i.genres || []).map(String).includes(String(genre)));
  if (query) items = items.filter(i => [i.title, i.director, ...(i.cast || []).map(person => person.name), ...(i.keywords || []).map(keyword => keyword.name || '')].join(' ').toLowerCase().includes(query));
  if (decade !== 'all') items = items.filter(i => Math.floor(+(i.year || 0) / 10) * 10 === +decade);
  if (language !== 'all') items = items.filter(i => i.language === language);
  if (country !== 'all') items = items.filter(i => i.country === country);
  if (community) items = items.filter(i => i.community >= community);
  if (mine === 'rated') items = items.filter(i => i.userRating > 0);
  else if (mine === 'unrated') items = items.filter(i => !i.userRating);
  else if (/^\d+$/.test(mine)) items = items.filter(i => i.userRating >= +mine);
  if (runtime === 'quick') items = items.filter(i => i.runtime > 0 && i.runtime <= 120);
  else if (runtime === 'standard') items = items.filter(i => i.runtime > 120 && i.runtime <= 600);
  else if (runtime === 'long') items = items.filter(i => i.runtime > 600 && i.runtime <= 2400);
  else if (runtime === 'epic') items = items.filter(i => i.runtime > 2400);
  else if (runtime === 'unknown') items = items.filter(i => !i.runtime);
  if (when !== 'all') {
    if (/^\d+$/.test(when)) items = items.filter(i => i.ts && i.ts >= nowSeconds - +when * 86400 && i.ts <= nowSeconds);
    else if (when === 'this_year') items = items.filter(i => i.ts && i.ts <= nowSeconds && new Date(i.ts * 1000).getFullYear() === now.getFullYear());
    else if (when === 'last_year') items = items.filter(i => i.ts && new Date(i.ts * 1000).getFullYear() === now.getFullYear() - 1);
    else if (when === 'unknown') items = items.filter(i => !i.ts);
  }
  if (plays === 'rewatched') items = items.filter(i => (i.plays || 1) > 1);
  else if (plays === 'once') items = items.filter(i => (i.plays || 1) === 1);
  else if (/^\d+$/.test(plays)) items = items.filter(i => (i.plays || 1) >= +plays);
  if (director !== 'all') items = items.filter(i => String(i.directorId || i.director) === director);
  if (actor !== 'all') items = items.filter(i => (i.cast || []).some(person => String(person.id) === actor));
  if (theme !== 'all') items = items.filter(i => (i.keywords || []).some(keyword => String(keyword.id || keyword) === theme));
  if (metadata !== 'all') items = items.filter(i => {
    const complete = !!(i.poster && i.year && i.genres?.length && i.runtime && i.language && i.directorId && i.cast?.length && i.keywords?.length);
    if (metadata === 'complete') return complete;
    if (metadata === 'credits_missing') return !i.directorId || !i.cast?.length;
    if (metadata === 'themes_missing') return !i.keywords?.length;
    if (metadata === 'poster_missing') return !i.poster;
    return !complete;
  });
  const sorters = {
    recent: (a, b) => b.ts - a.ts,
    watched_asc: (a, b) => (a.ts || Number.MAX_SAFE_INTEGER) - (b.ts || Number.MAX_SAFE_INTEGER),
    title_asc: (a, b) => a.title.localeCompare(b.title),
    title_desc: (a, b) => b.title.localeCompare(a.title),
    year_desc: (a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0),
    year_asc: (a, b) => (parseInt(a.year) || Number.MAX_SAFE_INTEGER) - (parseInt(b.year) || Number.MAX_SAFE_INTEGER),
    community_desc: (a, b) => b.community - a.community,
    community_asc: (a, b) => (a.community || 99) - (b.community || 99),
    user_desc: (a, b) => b.userRating - a.userRating,
    user_asc: (a, b) => (a.userRating || 99) - (b.userRating || 99),
    runtime_desc: (a, b) => b.runtime - a.runtime,
    runtime_asc: (a, b) => (a.runtime || Number.MAX_SAFE_INTEGER) - (b.runtime || Number.MAX_SAFE_INTEGER),
    rating_gap_desc: (a, b) => (b.userRating ? Math.abs(b.userRating - b.community) : -1) - (a.userRating ? Math.abs(a.userRating - a.community) : -1),
    theme_desc: (a, b) => (b.keywords?.length || 0) - (a.keywords?.length || 0),
    cast_desc: (a, b) => (b.cast?.length || 0) - (a.cast?.length || 0),
    plays_desc: (a, b) => (b.plays || 1) - (a.plays || 1) || b.ts - a.ts,
    last_play_desc: (a, b) => (b.lastPlay || 0) - (a.lastPlay || 0),
    metadata_desc: (a, b) => [b.poster,b.year,b.genres?.length,b.runtime,b.language,b.directorId,b.cast?.length,b.keywords?.length].filter(Boolean).length - [a.poster,a.year,a.genres?.length,a.runtime,a.language,a.directorId,a.cast?.length,a.keywords?.length].filter(Boolean).length,
  };
  return items.sort(sorters[sort] || sorters.recent);
}

function watchedItems() {
  return applyWatchedFilters(allItems(), {
    type: state.watchedFilter, genre: watchedGenre, query: watchedQuery, decade: watchedDecade,
    language: watchedLanguage, country: watchedCountry, community: watchedCommunity, mine: watchedMine,
    runtime: watchedRuntime, when: watchedWhen, director: watchedDirector, actor: watchedActor, theme: watchedTheme, metadata: watchedMetadata,
    plays: watchedPlays, sort: watchedSort,
  });
}

// Options for the genre <select>, built from the genres present in watched items.
function genreOptions() {
  const ids = new Set();
  allItems().forEach(i => (i.genres || []).forEach(g => { if (genreMap[g]) ids.add(g); }));
  const opts = [...ids].map(id => [String(id), genreMap[id]]).sort((a, b) => a[1].localeCompare(b[1]));
  return `<option value="all">All genres</option>` + opts.map(([v, name]) => `<option value="${v}">${esc(name)}</option>`).join('');
}

function languageName(code) {
  try { return new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(code) || code.toUpperCase(); }
  catch (_) { return code.toUpperCase(); }
}

function countryName(code) {
  try { return new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }).of(code) || code; }
  catch (_) { return code; }
}

function valueOptions(items, field, label, display) {
  const values = [...new Set(items.map(item => item[field]).filter(Boolean))].sort((a, b) => display(a).localeCompare(display(b)));
  return `<option value="all">${label}</option>` + values.map(value => `<option value="${esc(value)}">${esc(display(value))}</option>`).join('');
}

function decadeOptions(items) {
  const decades = [...new Set(items.map(item => Math.floor(+(item.year || 0) / 10) * 10).filter(value => value >= 1800))].sort((a, b) => b - a);
  return '<option value="all">Any decade</option>' + decades.map(value => `<option value="${value}">${value}s</option>`).join('');
}

function activeFilterCount() {
  return [state.watchedFilter !== 'all', watchedGenre !== 'all', !!watchedQuery, watchedDecade !== 'all', watchedLanguage !== 'all', watchedCountry !== 'all', watchedCommunity > 0, watchedMine !== 'all', watchedPlays !== 'all', watchedRuntime !== 'all', watchedWhen !== 'all', watchedDirector !== 'all', watchedActor !== 'all', watchedTheme !== 'all', watchedMetadata !== 'all'].filter(Boolean).length;
}

function watchedDateLabel(seconds) {
  if (!seconds) return '';
  return new Date(seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(seconds * 1000).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function setWatchedFilter(f, el) {
  state.watchedFilter = f;
  el.parentElement.querySelectorAll('.wl-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderGrid();
}

function renderGrid() {
  const ct = $('watchedContent'), cnt = $('watchedCount');
  if (!ct) return;
  const items = watchedItems(), total = Object.keys(state.watched).length, active = activeFilterCount();
  if (cnt) cnt.textContent = active ? `${items.length} of ${total} titles` : `${items.length} title${items.length !== 1 ? 's' : ''}`;
  const status = $('watchedFilterStatus'), badge = $('watchedActiveCount');
  if (status) status.innerHTML = `<span>${active ? `${active} active filter${active === 1 ? '' : 's'}` : 'Showing your complete watch history'}</span><b>${items.length} result${items.length === 1 ? '' : 's'}</b>`;
  if (badge) { badge.hidden = !active; badge.textContent = active; }

  if (!items.length) {
    const anyWatched = Object.keys(state.watched).length > 0;
    const scope = state.watchedFilter === 'movie' ? 'movies' : state.watchedFilter === 'tv' ? 'TV shows' : 'titles';
    ct.innerHTML = anyWatched
      ? `<div class="wl-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><h3>No matches</h3><p>Try a different search, genre, or filter</p></div>`
      : `<div class="wl-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 6L9 17l-5-5"/></svg><h3>No watched ${scope} yet</h3><p>Open a title and tap the ✓ to mark it watched</p></div>`;
    return;
  }

  ct.innerHTML = `<div class="wl-grid">${items.map(w => {
    const poster = w.poster ? `${IMG}w342${w.poster}` : PH;
    return `<a class="card" href="/${w.type}/${w.id}" aria-label="${esc(w.title)}" data-action="open-detail" data-id="${w.id}" data-type="${w.type}"><div class="card-img"><img src="${poster}" alt="${esc(w.title)}" loading="lazy" data-ph="${PH}">${WATCHED_BADGE_HTML}${w.plays > 1 ? `<span class="card-plays" title="Seen ${w.plays} times">${w.plays}×</span>` : ''}${myRatingHTML(w.id, w.type)}${rateBtnHTML(w.id, w.type, w.title)}</div><div class="card-info"><div class="card-title">${esc(w.title) || ''}</div><div class="card-sub"><span>${w.year || ''}</span><span class="dot"></span><span>${w.type === 'tv' ? 'TV' : 'Movie'}</span></div>${w.ts ? `<div class="watched-card-date">Watched ${esc(watchedDateLabel(w.ts))}</div>` : ''}</div></a>`;
  }).join('')}</div>`;
}

export function renderWatched() {
  const ct = $('watchedContent'), cnt = $('watchedCount'), controls = $('watchedControls');
  if (!ct) return;

  if (!state.user) {
    if (controls) controls.style.display = 'none';
    if (cnt) cnt.textContent = '';
    ct.innerHTML = `<div class="wl-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 6L9 17l-5-5"/></svg><h3>Sign in to see what you've watched</h3><p>Mark titles as watched to build your history</p><br><button class="btn-primary" data-action="open-auth">Sign In</button></div>`;
    return;
  }

  // Show controls only when there's something to control.
  const hasAny = Object.keys(state.watched).length > 0;
  if (controls) {
    controls.style.display = hasAny ? '' : 'none';
    const items = allItems();
    const gsel = $('watchedGenre');
    if (gsel) { gsel.innerHTML = genreOptions(); gsel.value = watchedGenre; if (gsel.value !== watchedGenre) { watchedGenre = 'all'; gsel.value = 'all'; } }
    const dsel = $('watchedDecade'); if (dsel) { dsel.innerHTML = decadeOptions(items); dsel.value = watchedDecade; if (dsel.value !== watchedDecade) { watchedDecade = 'all'; dsel.value = 'all'; } }
    const lsel = $('watchedLanguage'); if (lsel) { lsel.innerHTML = valueOptions(items, 'language', 'Any language', languageName); lsel.value = watchedLanguage; if (lsel.value !== watchedLanguage) { watchedLanguage = 'all'; lsel.value = 'all'; } }
    const csel = $('watchedCountry'); if (csel) { csel.innerHTML = valueOptions(items, 'country', 'Any country', countryName); csel.value = watchedCountry; if (csel.value !== watchedCountry) { watchedCountry = 'all'; csel.value = 'all'; } }
    const objectOptions = (id, entries, current, first) => {
      const select = $(id); if (!select) return 'all';
      const unique = new Map(entries.filter(item => item?.id && item.name).map(item => [String(item.id), item.name]));
      select.innerHTML = `<option value="all">${first}</option>` + [...unique].sort((a, b) => a[1].localeCompare(b[1])).map(([value, name]) => `<option value="${value}">${esc(name)}</option>`).join('');
      select.value = unique.has(current) ? current : 'all'; return select.value;
    };
    watchedDirector = objectOptions('watchedDirector', items.filter(item => item.directorId).map(item => ({ id: item.directorId, name: item.director })), watchedDirector, 'Any director');
    watchedActor = objectOptions('watchedActor', items.flatMap(item => item.cast || []), watchedActor, 'Any actor');
    watchedTheme = objectOptions('watchedTheme', items.flatMap(item => item.keywords || []), watchedTheme, 'Any theme');
    const ssel = $('watchedSort'); if (ssel) ssel.value = watchedSort;
    [['watchedCommunity', String(watchedCommunity)], ['watchedMine', watchedMine], ['watchedRuntime', watchedRuntime], ['watchedWhen', watchedWhen], ['watchedMetadata', watchedMetadata], ['watchedPlays', watchedPlays]].forEach(([id, value]) => { const select = $(id); if (select) select.value = value; });
    const sinp = $('watchedSearch'); if (sinp && sinp.value !== watchedQuery) sinp.value = watchedQuery;
    const advanced = $('watchedAdvanced'), toggle = controls.querySelector('[data-action="toggle-watched-filters"]');
    if (advanced) advanced.hidden = !advancedOpen;
    if (toggle) { toggle.classList.toggle('active', advancedOpen); toggle.setAttribute('aria-expanded', String(advancedOpen)); }
  }

  renderGrid();
  ensureWatchedMeta();
}

export function initWatched() {
  registerActions({
    'watched-filter': (el) => setWatchedFilter(el.dataset.filter, el),
    'watched-sort': (el) => { watchedSort = el.value; renderGrid(); },
    'watched-genre': (el) => { watchedGenre = el.value; renderGrid(); },
    'watched-decade': (el) => { watchedDecade = el.value; renderGrid(); },
    'watched-language': (el) => { watchedLanguage = el.value; renderGrid(); },
    'watched-country': (el) => { watchedCountry = el.value; renderGrid(); },
    'watched-community': (el) => { watchedCommunity = +el.value; renderGrid(); },
    'watched-mine': (el) => { watchedMine = el.value; renderGrid(); },
    'watched-plays': (el) => { watchedPlays = el.value; renderGrid(); },
    'watched-runtime': (el) => { watchedRuntime = el.value; renderGrid(); },
    'watched-when': (el) => { watchedWhen = el.value; renderGrid(); },
    'watched-director': (el) => { watchedDirector = el.value; renderGrid(); },
    'watched-actor': (el) => { watchedActor = el.value; renderGrid(); },
    'watched-theme': (el) => { watchedTheme = el.value; renderGrid(); },
    'watched-metadata': (el) => { watchedMetadata = el.value; renderGrid(); },
    'toggle-watched-filters': () => { advancedOpen = !advancedOpen; renderWatched(); },
    'watched-random': () => {
      const items = watchedItems();
      if (!items.length) { toast('No titles match your filters', 'info'); return; }
      const item = items[Math.floor(Math.random() * items.length)];
      document.dispatchEvent(new CustomEvent('cv:go', { detail: `/${item.type}/${item.id}` }));
    },
    'watched-reset': () => {
      watchedSort = 'recent'; watchedGenre = 'all'; watchedQuery = ''; watchedDecade = 'all'; watchedLanguage = 'all'; watchedCountry = 'all'; watchedCommunity = 0; watchedMine = 'all'; watchedRuntime = 'all'; watchedWhen = 'all'; watchedDirector = 'all'; watchedActor = 'all'; watchedTheme = 'all'; watchedMetadata = 'all'; watchedPlays = 'all';
      state.watchedFilter = 'all';
      document.querySelectorAll('#watchedPage .wl-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.filter === 'all'));
      renderWatched();
    },
  });
  const inp = $('watchedSearch');
  if (inp) inp.addEventListener('input', debounce(function () { watchedQuery = this.value.trim(); renderGrid(); }, 200));
  // Repaint once the backfill fills in posters/genres for older docs. Must be the
  // full renderWatched(), not renderGrid(): only the former rebuilds the genre
  // <select>, whose options are derived from the genres the backfill just added.
  document.addEventListener('cv:meta-backfilled', () => { if (state.user) renderWatched(); });
}
