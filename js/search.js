// ===== SEARCH PAGE (premium) =====
// Instant typeahead suggestions, advanced client-side filters over a deep multi-page
// pool, and smart discovery fallbacks (search-by-vibe, trending searches, graceful
// no-results, skeletons, retry). Stale responses are dropped via a generation token
// since tmdb() exposes no abort.
import { tmdb } from './api.js';
import { IMG, PH, genreMap, mGenreList, tGenreList, moods } from './config.js';
import { state } from './state.js';
import { esc, debounce, $ } from './ui.js';
import { buildCard, personCard, skelCards } from './cards.js';
import { registerActions } from './events.js';

// ---- module state ----
let searchGen = 0;          // bumped on every submitted query/vibe; in-flight stragglers bail
let suggestGen = 0;         // separate token for the live typeahead dropdown
let pool = [];              // raw fetched results (across loaded pages)
let page = 0, totalPages = 0, totalResults = 0;
let curQuery = '';          // active text query
let mode = 'search';        // 'search' | 'vibe'
let vibeCtx = null;         // { genres, type, lang, label } for discover mode
let suggestItems = [], suggestIdx = -1;

const IMGw = (size, path) => path ? `${IMG}${size}${path}` : PH;

// ---- helpers ----
function resolveType(r) {
  if (r.__type) return r.__type;
  if (state.searchFilt !== 'multi') return state.searchFilt;
  return r.media_type || 'movie';
}
function itemYear(r) { return parseInt((r.release_date || r.first_air_date || '').slice(0, 4)) || 0; }
function keyOf(r, t) { return `${t}_${r.id}`; }

// XSS-safe highlight: escape first, then wrap the first case-insensitive query match.
function highlight(text, q) {
  const safe = esc(text || '');
  const nq = (q || '').trim();
  if (!nq) return safe;
  try {
    const rx = new RegExp('(' + nq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'i');
    return safe.replace(rx, '<mark class="sx-hi">$1</mark>');
  } catch (e) { return safe; }
}

// ---- unified fetcher (search vs discover), page-aware ----
async function fetchPage(pageNum) {
  if (mode === 'vibe') {
    const dt = vibeCtx.type === 'multi' ? 'movie' : vibeCtx.type;
    const p = { with_genres: vibeCtx.genres, sort_by: 'popularity.desc', 'vote_count.gte': 100, page: pageNum };
    if (vibeCtx.lang) p.with_original_language = vibeCtx.lang;
    const d = await tmdb(`/discover/${dt}`, p);
    return { results: (d.results || []).map(r => ({ ...r, __type: dt })), total_pages: d.total_pages || 1, total_results: d.total_results };
  }
  const d = await tmdb(`/search/${state.searchFilt}`, { query: curQuery, page: pageNum, include_adult: false });
  return { results: d.results || [], total_pages: d.total_pages || 1, total_results: d.total_results };
}

// ================= entry points =================
export function openSearch(initialQuery = '') {
  document.title = 'Search — CineVerse';
  pool = []; page = 0; suggestItems = []; suggestIdx = -1;
  populateGenreFilter();
  loadTrending();
  loadTrendingSearches();
  renderVibeChips($('vibeChips'), 'Search by vibe');
  renderSearchHistory();
  renderRecentStrip();
  const input = $('searchIn');
  if (initialQuery) {
    input.value = initialQuery;
    toggleClear();
    doSearch(initialQuery);
  } else {
    input.value = '';
    toggleClear();
    showDefault();
  }
  setTimeout(() => input.focus(), 150);
}

// Submitted search (router deep-load, history/trend chip, Enter, "see all") — shows
// the full results grid + filters. The typeahead dropdown is a separate flow so the
// two never overlap (dropdown closes here).
export async function doSearch(q) {
  curQuery = q; mode = 'search';
  try { history.replaceState(history.state, '', location.pathname + '?q=' + encodeURIComponent(q)); } catch (e) {}
  closeSuggest();
  await runInitial();
}

// Live typing — ONLY the typeahead dropdown (over the default view). The results grid
// is populated on submit (Enter / "see all" / suggestion pick), so it can't cover the
// filter bar.
async function liveSuggest(q) {
  curQuery = q; mode = 'search';
  const g = ++suggestGen;
  try {
    const d = await tmdb(`/search/${state.searchFilt}`, { query: q, page: 1, include_adult: false });
    if (g !== suggestGen) return;
    renderSuggest(d.results || [], q);
  } catch (e) { if (g === suggestGen) closeSuggest(); }
}

async function runInitial() {
  showResults();
  showSkeleton();
  const g = ++searchGen;
  page = 1;
  try {
    const d = await fetchPage(1);
    if (g !== searchGen) return;
    pool = d.results; totalPages = d.total_pages; totalResults = d.total_results ?? pool.length;
    renderResults();
  } catch (e) {
    if (g !== searchGen) return;
    console.error('search failed', e); showError();
  }
}

async function loadMore() {
  if (page >= totalPages) return;
  const g = searchGen;               // don't bump — only a NEW query invalidates us
  const btn = $('searchMore'); if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  try {
    const d = await fetchPage(page + 1);
    if (g !== searchGen) return;
    page += 1; pool = pool.concat(d.results);
    renderResults();
  } catch (e) { if (g === searchGen) renderResults(); }
}

// ================= rendering =================
function currentFilters() {
  return {
    genre: $('fltGenre')?.value || '',
    decade: $('fltDecade')?.value || '',
    rating: +($('fltRating')?.value || 0),
    sort: $('fltSort')?.value || 'relevance',
  };
}

function applyFilters(raw) {
  const f = currentFilters();
  const contentFilter = !!(f.genre || f.decade || f.rating);
  const seen = new Set();
  let list = [];
  raw.forEach(r => {
    const t = resolveType(r);
    if (!r.id) return;
    if (t === 'person') { if (contentFilter) return; }
    else {
      if (!r.poster_path && !r.profile_path) { /* still allow, card shows placeholder */ }
      if (f.genre && !((r.genre_ids || []).some(id => genreMap[id] === f.genre))) return;
      if (f.decade) { const y = itemYear(r); if (!y) return; if (f.decade === 'older') { if (y >= 1990) return; } else { const d = +f.decade; if (y < d || y > d + 9) return; } }
      if (f.rating && (r.vote_average || 0) < f.rating) return;
    }
    const k = keyOf(r, t);
    if (seen.has(k)) return; seen.add(k);
    list.push({ r, t });
  });
  // sort
  const q = curQuery.trim().toLowerCase();
  if (f.sort === 'rating') list.sort((a, b) => (b.r.vote_average || 0) - (a.r.vote_average || 0));
  else if (f.sort === 'newest') list.sort((a, b) => itemYear(b.r) - itemYear(a.r));
  else if (f.sort === 'popularity') list.sort((a, b) => (b.r.popularity || 0) - (a.r.popularity || 0));
  else if (mode === 'search' && q) {
    // relevance: exact/prefix title matches bubble up, otherwise keep TMDB order
    const score = x => { const title = (x.r.title || x.r.name || '').toLowerCase(); if (title === q) return 0; if (title.startsWith(q)) return 1; if (title.includes(q)) return 2; return 3; };
    list = list.map((x, i) => ({ x, i, s: score(x) })).sort((a, b) => a.s - b.s || a.i - b.i).map(o => o.x);
  }
  return list;
}

function renderResults() {
  const g = $('searchGrid'), head = $('searchResultsHead'), empty = $('searchEmpty'), err = $('searchError'), moreWrap = $('searchMoreWrap');
  err.style.display = 'none';
  if (!pool.length) { g.innerHTML = ''; head.innerHTML = ''; moreWrap.style.display = 'none'; showEmpty(curQuery); return; }
  empty.style.display = 'none';
  const items = applyFilters(pool);
  const label = mode === 'vibe' ? `Popular ${esc(vibeCtx.label)}` : `${items.length}${page < totalPages ? '+' : ''} result${items.length !== 1 ? 's' : ''} for “${esc(curQuery)}”`;
  head.innerHTML = `<span class="srh-label">${label}</span>`;
  g.innerHTML = items.length
    ? items.map(({ r, t }) => (t === 'person' ? personCard(r) : buildCard(r, t))).join('')
    : `<div class="search-nomatch">No items match these filters. <button class="link-btn" data-action="search-reset">Clear filters</button></div>`;
  moreWrap.style.display = page < totalPages ? 'flex' : 'none';
  const btn = $('searchMore'); if (btn) { btn.disabled = false; btn.textContent = 'Load more results'; }
}

function renderSuggest(raw, q) {
  const box = $('searchSuggest'), input = $('searchIn');
  const nq = q.trim().toLowerCase();
  const ranked = raw
    .filter(r => r.id && (r.title || r.name))
    .map(r => { const t = resolveType(r); const title = (r.title || r.name || '').toLowerCase(); const s = title === nq ? 0 : title.startsWith(nq) ? 1 : title.includes(nq) ? 2 : 3; return { r, t, s }; })
    .sort((a, b) => a.s - b.s || (b.r.popularity || 0) - (a.r.popularity || 0))
    .slice(0, 7);
  suggestItems = ranked; suggestIdx = -1;
  if (!ranked.length) { closeSuggest(); return; }
  box.innerHTML = ranked.map(({ r, t }, i) => {
    const isP = t === 'person';
    const thumb = IMGw(isP ? 'w185' : 'w92', isP ? r.profile_path : r.poster_path);
    const year = (r.release_date || r.first_air_date || '').slice(0, 4);
    const tl = t === 'tv' ? 'TV' : isP ? 'Person' : 'Movie';
    const rate = (!isP && r.vote_average) ? r.vote_average.toFixed(1) : '';
    return `<div class="sx-row" role="option" data-i="${i}" data-action="${isP ? 'open-person' : 'open-detail'}" data-id="${r.id}"${isP ? '' : ` data-type="${t}"`}>
      <div class="sx-thumb"><img src="${thumb}" alt="" loading="lazy" data-ph="${PH}"></div>
      <div class="sx-info"><div class="sx-title">${highlight(r.title || r.name, q)}</div><div class="sx-sub">${[year, tl].filter(Boolean).join(' • ')}</div></div>
      ${rate ? `<div class="sx-rate"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>${rate}</div>` : ''}
    </div>`;
  }).join('') + `<button class="sx-all" data-action="search-submit" data-q="${esc(q)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>See all results for “<span></span>”</button>`;
  box.querySelector('.sx-all span').textContent = q;
  box.classList.add('open');
  if (input) input.setAttribute('aria-expanded', 'true');
}
function closeSuggest() {
  const box = $('searchSuggest'), input = $('searchIn');
  if (box) box.classList.remove('open');
  if (input) input.setAttribute('aria-expanded', 'false');
  suggestIdx = -1;
}
function highlightSuggest() {
  const rows = $('searchSuggest').querySelectorAll('.sx-row');
  rows.forEach((el, i) => el.classList.toggle('active', i === suggestIdx));
  if (suggestIdx >= 0 && rows[suggestIdx]) rows[suggestIdx].scrollIntoView({ block: 'nearest' });
}
function openSuggestItem(i) {
  const it = suggestItems[i]; if (!it) return;
  addToHistory(curQuery);
  closeSuggest();
  const dest = it.t === 'person' ? `/person/${it.r.id}` : `/${it.t}/${it.r.id}`;
  document.dispatchEvent(new CustomEvent('cv:go', { detail: dest }));
}

// ---- view toggles ----
function showDefault() { $('searchDefault').style.display = 'block'; $('searchResultsWrap').style.display = 'none'; $('searchFilters').style.display = 'none'; closeSuggest(); }
function showResults() { $('searchDefault').style.display = 'none'; $('searchResultsWrap').style.display = 'block'; $('searchFilters').style.display = 'flex'; }
function showSkeleton() { $('searchEmpty').style.display = 'none'; $('searchError').style.display = 'none'; $('searchMoreWrap').style.display = 'none'; $('searchGrid').innerHTML = skelCards(12); $('searchResultsHead').innerHTML = ''; }
function showError() {
  $('searchGrid').innerHTML = ''; $('searchResultsHead').innerHTML = ''; $('searchEmpty').style.display = 'none'; $('searchMoreWrap').style.display = 'none';
  const e = $('searchError');
  e.innerHTML = `<div class="search-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg><h3>Something went wrong</h3><p>Couldn't reach the movie database.</p><button class="btn-primary" data-action="search-retry">Try again</button></div>`;
  e.style.display = 'block';
}
function showEmpty(q) {
  const e = $('searchEmpty');
  e.innerHTML = `<div class="search-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><h3>No matches for “${esc(q)}”</h3><p>Explore something else instead</p><div id="emptyVibe"></div></div>`;
  e.style.display = 'block';
  renderVibeChips($('emptyVibe'), '');
}

// ================= discovery / defaults =================
async function loadTrending() {
  try { const d = await tmdb('/trending/all/day'); $('trendGrid').innerHTML = (d.results || []).slice(0, 12).map(r => buildCard(r, r.media_type)).join(''); } catch (e) {}
}
async function loadTrendingSearches() {
  const wrap = $('trendingSearches'); if (!wrap) return;
  try {
    const d = await tmdb('/trending/all/week');
    const names = [...new Set((d.results || []).map(r => r.title || r.name).filter(Boolean))].slice(0, 10);
    if (!names.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = `<div class="search-section-title">Trending searches</div><div class="chip-row">${names.map(n => `<button class="chip sx-chip" data-action="trend-search" data-q="${esc(n)}"></button>`).join('')}</div>`;
    wrap.querySelectorAll('.sx-chip').forEach((el, i) => el.textContent = names[i]);
  } catch (e) { wrap.innerHTML = ''; }
}
function renderVibeChips(wrap, title) {
  if (!wrap) return;
  const chips = moods.map(m => `<button class="chip vibe-chip" data-action="vibe-search" data-genres="${m.genres}" data-type="${m.type}"${m.lang ? ` data-lang="${m.lang}"` : ''} data-label="${esc(m.name)}"><span class="vibe-emoji">${m.emoji}</span><span></span></button>`).join('');
  wrap.innerHTML = `${title ? `<div class="search-section-title">${esc(title)}</div>` : ''}<div class="chip-row vibe-row">${chips}</div>`;
  wrap.querySelectorAll('.vibe-chip span:last-child').forEach((el, i) => el.textContent = moods[i].name);
}
async function vibeSearch(el) {
  mode = 'vibe';
  vibeCtx = { genres: el.dataset.genres, type: el.dataset.type || 'movie', lang: el.dataset.lang || '', label: el.dataset.label || 'Picks' };
  curQuery = '';
  const input = $('searchIn'); if (input) { input.value = ''; toggleClear(); }
  closeSuggest();
  await runInitial();
}

// ================= genre filter options =================
function populateGenreFilter() {
  const sel = $('fltGenre'); if (!sel || sel.dataset.filled) return;
  const names = [...new Set([...mGenreList, ...tGenreList].map(g => g.n))].sort();
  sel.innerHTML = `<option value="">All genres</option>` + names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  sel.dataset.filled = '1';
}

// ================= recent searches / recently viewed =================
function toggleClear() { const c = $('searchClear'); if (c) c.style.display = $('searchIn').value ? 'flex' : 'none'; }
function addToHistory(q) {
  if (!state.user || !q || q.length < 2) return;
  state.searchHistory = state.searchHistory.filter(h => h !== q);
  state.searchHistory.unshift(q);
  state.searchHistory = state.searchHistory.slice(0, 8);
  try { localStorage.setItem('cv_history_' + state.user.uid, JSON.stringify(state.searchHistory)); } catch (e) {}
  renderSearchHistory();
}
function renderSearchHistory() {
  const w = $('searchHistoryWrap'); if (!w) return;
  if (!state.searchHistory.length) { w.innerHTML = ''; return; }
  w.innerHTML = `<div class="search-section-title">Recent Searches</div><div class="search-history">${state.searchHistory.map((h, i) => `<div class="search-history-item" role="button" tabindex="0" data-action="history-search" data-q="${esc(h)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span></span><span class="remove" data-action="history-remove" data-i="${i}">✕</span></div>`).join('')}</div>`;
  w.querySelectorAll('.search-history-item').forEach((el, i) => { el.querySelector('span:not(.remove)').textContent = state.searchHistory[i]; });
}
function renderRecentStrip() {
  const wrap = $('recentStrip'); if (!wrap) return;
  const items = state.recentlyViewed.slice(0, 12);
  if (!items.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<div class="search-section-title">Recently Viewed</div><div class="search-grid">${items.map(r => buildCard({ id: r.id, title: r.title, name: r.title, poster_path: r.poster, media_type: r.type, genre_ids: r.genres || [] }, r.type)).join('')}</div>`;
}
function removeHistory(i) {
  state.searchHistory.splice(i, 1);
  if (state.user) { try { localStorage.setItem('cv_history_' + state.user.uid, JSON.stringify(state.searchHistory)); } catch (e) {} }
  renderSearchHistory();
}

// ================= type chips =================
function setFilter(f) {
  state.searchFilt = f;
  document.querySelectorAll('.search-chips .chip').forEach(c => c.classList.toggle('active', c.dataset.f === f));
  const q = $('searchIn').value.trim();
  if (mode === 'search' && q.length >= 2) doSearch(q);
}

// ================= init =================
export function initSearch() {
  const input = $('searchIn');

  input.addEventListener('input', debounce(function () {
    toggleClear();
    const q = this.value.trim();
    if (q.length < 2) { closeSuggest(); curQuery = ''; showDefault(); return; }
    liveSuggest(q);
  }, 180));

  input.addEventListener('keydown', e => {
    const open = $('searchSuggest').classList.contains('open') && suggestItems.length;
    if (e.key === 'ArrowDown' && open) { e.preventDefault(); suggestIdx = (suggestIdx + 1) % suggestItems.length; highlightSuggest(); }
    else if (e.key === 'ArrowUp' && open) { e.preventDefault(); suggestIdx = (suggestIdx - 1 + suggestItems.length) % suggestItems.length; highlightSuggest(); }
    else if (e.key === 'Enter') {
      const q = e.target.value.trim();
      if (open && suggestIdx >= 0) { e.preventDefault(); openSuggestItem(suggestIdx); }
      else if (q.length >= 2) { addToHistory(q); doSearch(q); }
    } else if (e.key === 'Escape') { closeSuggest(); }
  });

  input.addEventListener('focus', () => { if (input.value.trim().length >= 2 && suggestItems.length) $('searchSuggest').classList.add('open'); });

  // Close the dropdown when clicking outside the search field.
  document.addEventListener('click', e => { if (!e.target.closest('.search-field')) closeSuggest(); });

  // Record Recent Searches when a result OR a suggestion is opened (capture phase,
  // before navigation) — the typing→click flow never hits the Enter path.
  ['searchResultsWrap', 'searchSuggest'].forEach(id => {
    const wrap = $(id);
    if (wrap) wrap.addEventListener('click', e => {
      if (e.target.closest('[data-action="open-detail"],[data-action="open-person"]')) {
        const q = input.value.trim(); if (q.length >= 2) addToHistory(q);
      }
    }, true);
  });

  // Deep-loading /search renders before auth loads history from localStorage.
  document.addEventListener('cv:auth', () => { if (location.pathname === '/search') { renderSearchHistory(); renderRecentStrip(); } });

  registerActions({
    'set-filter': (el) => setFilter(el.dataset.f),
    'search-filter': () => renderResults(),
    'search-reset': () => { ['fltGenre', 'fltDecade', 'fltRating'].forEach(id => { const s = $(id); if (s) s.value = ''; }); const so = $('fltSort'); if (so) so.value = 'relevance'; renderResults(); },
    'search-clear': () => { input.value = ''; toggleClear(); curQuery = ''; showDefault(); input.focus(); },
    'load-more-search': () => loadMore(),
    'search-submit': (el) => { const q = el.dataset.q || $('searchIn').value.trim(); if (q.length >= 2) { addToHistory(q); doSearch(q); } },
    'search-retry': () => { if (mode === 'vibe') runInitial(); else if (curQuery) doSearch(curQuery); },
    'vibe-search': (el) => vibeSearch(el),
    'trend-search': (el) => { const q = el.dataset.q || el.textContent.trim(); input.value = q; toggleClear(); addToHistory(q); doSearch(q); input.focus(); },
    'history-search': (el) => { const q = el.dataset.q ? decodeEntities(el.dataset.q) : (el.querySelector('span')?.textContent || ''); input.value = q; toggleClear(); doSearch(q); addToHistory(q); },
    'history-remove': (el, e) => { e.stopPropagation(); removeHistory(+el.dataset.i); },
  });
}

function decodeEntities(s) { const d = document.createElement('textarea'); d.innerHTML = s; return d.value; }
