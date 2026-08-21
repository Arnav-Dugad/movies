// ===== WATCHLIST + WATCHED =====
import { auth, db, firebase } from './firebase.js';
import { state } from './state.js';
import { IMG, PH, genreMap } from './config.js';
import { esc, toast, $, debounce } from './ui.js';
import { refreshWLBtns, rateBtnHTML, myRatingHTML, WATCHED_BADGE_HTML } from './cards.js';
import { registerActions, readItem } from './events.js';
import { removeFromList, listsArr, listById, createList, renameList, deleteList, shareList } from './lists.js';
import { isListLocked, listHasPin, openPinModal, relockList } from './list-lock.js';
import { markShowWatched, clearShowProgress, showProgress } from './episodes.js';
import { tmdb, pool } from './api.js';

const requireAuth = () => document.dispatchEvent(new Event('cv:open-auth'));

export async function loadWatchlist() {
  if (!state.user) return;
  try {
    const s = await db.collection('users').doc(state.user.uid).collection('watchlist').orderBy('added', 'desc').get();
    state.watchlist = s.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.error(e); }
}

export async function loadWatched() {
  if (!state.user) return;
  try {
    const s = await db.collection('users').doc(state.user.uid).collection('watched').get();
    state.watched = {};
    s.docs.forEach(d => state.watched[d.id] = d.data());
  } catch (e) { console.error('loadWatched failed:', e); }
}

export async function toggleWatched(id, type, title, meta = {}) {
  if (!state.user) return requireAuth();
  const key = `${type}_${id}`;
  try {
    const ref = db.collection('users').doc(state.user.uid).collection('watched').doc(key);
    if (state.watched[key]) {
      await ref.delete(); delete state.watched[key];
      // Only clear episode progress when it was the "whole show" mark that put it
      // there. Someone who ticked episodes individually keeps their progress.
      if (type === 'tv' && showProgress(id).complete) clearShowProgress(id);
      toast('Unmarked as watched', 'info');
    } else {
      // Enrich with poster/year/genres so the Watched page (and anywhere else)
      // can render a real card without an extra TMDB fetch. Fall back to the
      // watchlist entry for titles marked watched before this data was stored.
      const wl = state.watchlist.find(w => w.id === key);
      const d = {
        tmdbId: id, type, title,
        poster: meta.poster || wl?.poster || '',
        year: meta.year || wl?.year || '',
        genres: meta.genres || wl?.genres || [],
        keywords: meta.keywords || wl?.keywords || [],
        runtime: +(meta.runtime || wl?.runtime || 0),
        language: meta.language || wl?.language || '',
        country: meta.country || wl?.country || '',
        releaseDate: meta.releaseDate || wl?.releaseDate || '',
        tmdbRating: +(meta.tmdbRating || wl?.rating || 0),
        voteCount: +(meta.voteCount || 0),
        // Franchise membership, when the caller knew it (the detail page always
        // does). Otherwise the metadata backfill fills it in later.
        collectionId: +(meta.collectionId || 0),
        collectionName: meta.collectionName || '',
        collectionPoster: meta.collectionPoster || '',
        watchedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };
      await ref.set(d);
      // serverTimestamp() is a SENTINEL, not a value — storing `d` as-is leaves
      // watchedAt.seconds undefined, which reads as epoch 0 (watched.js toItem).
      // That sorts a just-watched title to the bottom of "recent" and makes it
      // count as watched in 1970 for the badge/challenge windows. Mirror a local
      // clock; the real server value wins on the next load.
      state.watched[key] = { ...d, watchedAt: { seconds: Math.floor(Date.now() / 1000) } };
      toast('Marked as watched!', 'success');
      // A show marked watched IS every aired episode watched. Filling them keeps
      // the tracker, Continue Watching, and the TV stats agreeing with the badge
      // the user just turned on — without it the show sat at 0% forever.
      if (type === 'tv') {
        markShowWatched(id, { title, poster: d.poster, episodeRuntime: meta.episodeRuntime || 0 })
          .then(added => { if (added) document.dispatchEvent(new Event('cv:wl-changed')); })
          .catch(error => console.warn('markShowWatched', error));
      }
    }
    document.dispatchEvent(new Event('cv:wl-changed'));
  } catch (e) { console.error('toggleWatched failed:', e); toast('Error', 'error'); }
}

// ===== WATCHLIST PAGE =====
// Inline list-management state (create/rename input, two-tap delete confirm) — kept
// out of a modal so managing lists stays on-page.
let listEdit = null;       // { mode: 'new' | 'rename' }
let pendingDelete = null;  // listId awaiting a second confirming click
let duplicateOpen = false;
let wlQuery = '', wlGenre = 'all', wlStatus = 'all', wlRating = 0, wlDecade = 'all', wlSort = 'recent';
let wlLanguage = 'all', wlCountry = 'all', wlRuntime = 'all', wlMine = 'all', wlAdded = 'all', wlMetadata = 'all';
const RUNTIME_CACHE_KEY = 'cv_list_runtime_cache_v1';
const COVER_OFFSETS_KEY = 'cv_list_cover_offsets_v1';
const runtimeLoads = new Set();

function readLocalObject(key) {
  try { const value = JSON.parse(localStorage.getItem(key) || '{}'); return value && typeof value === 'object' ? value : {}; }
  catch (_) { return {}; }
}

const runtimeCache = readLocalObject(RUNTIME_CACHE_KEY);
const coverOffsets = readLocalObject(COVER_OFFSETS_KEY);
const itemKey = item => item.id || `${item.type}_${item.tmdbId}`;

function saveLocalObject(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

function formatMinutes(value) {
  const minutes = Math.round(value || 0);
  if (!minutes) return 'Not available';
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? `${hours}h ${rest ? `${rest}m` : ''}`.trim() : `${rest}m`;
}

function runtimeOf(item) {
  const own = +(item.runtime || 0);
  return own || +(runtimeCache[itemKey(item)] || 0);
}

function listShowcaseHTML(items) {
  const list = listById(state.wlList);
  if (!list) return '';
  const posters = items.filter(item => item.poster);
  const offset = posters.length ? (+coverOffsets[list.id] || 0) % posters.length : 0;
  const coverItems = posters.length
    ? Array.from({ length: Math.min(4, posters.length) }, (_, index) => posters[(offset + index) % posters.length])
    : [];
  const cover = Array.from({ length: 4 }, (_, index) => {
    const item = coverItems[index];
    return item ? `<div><img src="${IMG}w342${item.poster}" alt="" loading="lazy"></div>` : '<div class="empty"><span>✦</span></div>';
  }).join('');

  const ratings = items.map(item => +(item.rating || 0)).filter(Boolean);
  const avgRating = ratings.length ? (ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(1) : '—';
  const runtimes = items.map(runtimeOf).filter(Boolean);
  const allRuntimeChecked = items.every(item => +(item.runtime || 0) || Object.prototype.hasOwnProperty.call(runtimeCache, itemKey(item)));
  const avgRuntime = runtimes.length ? formatMinutes(runtimes.reduce((sum, value) => sum + value, 0) / runtimes.length) : items.length && !allRuntimeChecked ? 'Calculating…' : '—';
  const genreCounts = new Map();
  items.flatMap(item => item.genres || []).forEach(id => { const name = genreMap[id]; if (name) genreCounts.set(name, (genreCounts.get(name) || 0) + 1); });
  const topGenres = [...genreCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([name]) => name).join(', ') || '—';
  const years = items.map(item => +(item.year || 0)).filter(year => year > 1800 && year < 2200).sort((a, b) => a - b);
  const yearRange = years.length ? (years[0] === years[years.length - 1] ? String(years[0]) : `${years[0]}–${years[years.length - 1]}`) : '—';
  const movies = items.filter(item => item.type === 'movie').length;
  const shows = items.filter(item => item.type === 'tv').length;

  return `<div class="wl-cover" aria-label="Automatic poster collage for ${esc(list.name)}"><div class="wl-cover-grid">${cover}</div><div class="wl-cover-shade"></div><div class="wl-cover-copy"><span>Curated collection</span><h2>${esc(list.name)}</h2><p>${items.length} title${items.length === 1 ? '' : 's'} · ${movies} movie${movies === 1 ? '' : 's'} · ${shows} show${shows === 1 ? '' : 's'}</p>${posters.length > 4 ? `<button data-action="shuffle-list-cover" data-list="${esc(list.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>Shuffle cover</button>` : ''}</div></div>
    <div class="wl-insights" aria-label="Statistics for ${esc(list.name)}">
      <div><span>Average rating</span><strong>${avgRating}${avgRating !== '—' ? '<small>/10</small>' : ''}</strong></div>
      <div><span>Average runtime</span><strong>${avgRuntime}</strong></div>
      <div><span>Top genres</span><strong>${esc(topGenres)}</strong></div>
      <div><span>Release years</span><strong>${yearRange}</strong></div>
    </div>`;
}

async function loadListRuntimes(items, listId) {
  const missing = items.filter(item => item.tmdbId && !item.runtime && !Object.prototype.hasOwnProperty.call(runtimeCache, itemKey(item))).slice(0, 60);
  if (!missing.length || runtimeLoads.has(listId)) return;
  runtimeLoads.add(listId);
  await pool(missing, async item => {
    const key = itemKey(item);
    try {
      const detail = await tmdb(`/${item.type}/${item.tmdbId}`);
      runtimeCache[key] = +(detail.runtime || detail.episode_run_time?.[0] || 0);
    } catch (_) { runtimeCache[key] = 0; }
  }, 5);
  runtimeLoads.delete(listId);
  saveLocalObject(RUNTIME_CACHE_KEY, runtimeCache);
  if (state.user && state.wlList === listId) renderWL();
}

async function saveListEdit() {
  const name = (($('wlListName') || {}).value || '').trim();
  if (!name) { listEdit = null; renderWL(); return; }
  if (listEdit && listEdit.mode === 'rename') await renameList(state.wlList, name);
  else { const l = await createList(name); if (l) state.wlList = l.id; }
  listEdit = null; renderWL();
}

export function setWLFilter(f, el) {
  state.wlFilter = f;   // secondary type filter: 'all' | 'movie' | 'tv'
  el.parentElement.querySelectorAll('.wl-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderWL();
}

// Which titles belong to the active list dimension (state.wlList).
function itemsForActiveList() {
  return state.watchlist.filter(w => listsArr(w).includes(state.wlList));
}

function addedSeconds(w) { return w.added?.seconds || (w.added?.toMillis ? Math.floor(w.added.toMillis() / 1000) : 0); }

function filteredListItems() {
  let items = itemsForActiveList();
  if (state.wlFilter === 'movie' || state.wlFilter === 'tv') items = items.filter(w => w.type === state.wlFilter);
  if (wlQuery) { const q = wlQuery.toLowerCase(); items = items.filter(w => (w.title || '').toLowerCase().includes(q)); }
  if (wlGenre !== 'all') items = items.filter(w => (w.genres || []).map(String).includes(wlGenre));
  if (wlStatus === 'watched') items = items.filter(w => !!state.watched[w.id]);
  else if (wlStatus === 'unwatched') items = items.filter(w => !state.watched[w.id]);
  if (wlRating) items = items.filter(w => +(w.rating || 0) >= wlRating);
  if (wlDecade !== 'all') items = items.filter(w => {
    const y = +(w.year || 0);
    return wlDecade === 'older' ? y > 0 && y < 1990 : y >= +wlDecade && y < +wlDecade + 10;
  });
  if (wlLanguage !== 'all') items = items.filter(w => w.language === wlLanguage);
  if (wlCountry !== 'all') items = items.filter(w => w.country === wlCountry);
  if (wlRuntime !== 'all') items = items.filter(w => {
    const runtime = runtimeOf(w);
    if (wlRuntime === 'unknown') return !runtime;
    if (wlRuntime === 'quick') return runtime > 0 && runtime < 90;
    if (wlRuntime === 'standard') return runtime >= 90 && runtime <= 120;
    return runtime > 120;
  });
  if (wlMine !== 'all') items = items.filter(w => {
    const mine = +(state.ratings[itemKey(w)] || 0);
    return wlMine === 'rated' ? mine > 0 : wlMine === 'unrated' ? !mine : mine >= +wlMine;
  });
  if (wlAdded !== 'all') items = items.filter(w => {
    const seconds = addedSeconds(w);
    if (wlAdded === 'unknown') return !seconds;
    return seconds && Date.now() / 1000 - seconds <= +wlAdded * 86400;
  });
  if (wlMetadata !== 'all') items = items.filter(w => {
    const complete = !!(w.poster && w.year && w.genres?.length && runtimeOf(w) && w.language && w.releaseDate);
    if (wlMetadata === 'complete') return complete;
    if (wlMetadata === 'poster_missing') return !w.poster;
    if (wlMetadata === 'runtime_missing') return !runtimeOf(w);
    return !complete;
  });
  const smartScore = w => +(w.rating || 0) * .6 + +(state.ratings[itemKey(w)] || 0) * .4 + (state.watched[itemKey(w)] ? 0 : 1);
  const sorters = {
    recent: (a, b) => addedSeconds(b) - addedSeconds(a),
    added_asc: (a, b) => (addedSeconds(a) || Number.MAX_SAFE_INTEGER) - (addedSeconds(b) || Number.MAX_SAFE_INTEGER),
    title_asc: (a, b) => (a.title || '').localeCompare(b.title || ''),
    title_desc: (a, b) => (b.title || '').localeCompare(a.title || ''),
    year_desc: (a, b) => +(b.year || 0) - +(a.year || 0),
    year_asc: (a, b) => +(a.year || 9999) - +(b.year || 9999),
    rating_desc: (a, b) => +(b.rating || 0) - +(a.rating || 0),
    rating_asc: (a, b) => +(a.rating || 0) - +(b.rating || 0),
    mine_desc: (a, b) => +(state.ratings[itemKey(b)] || 0) - +(state.ratings[itemKey(a)] || 0),
    mine_asc: (a, b) => +(state.ratings[itemKey(a)] || 99) - +(state.ratings[itemKey(b)] || 99),
    runtime_desc: (a, b) => runtimeOf(b) - runtimeOf(a),
    runtime_asc: (a, b) => (runtimeOf(a) || Number.MAX_SAFE_INTEGER) - (runtimeOf(b) || Number.MAX_SAFE_INTEGER),
    smart_desc: (a, b) => smartScore(b) - smartScore(a),
  };
  return items.sort(sorters[wlSort] || sorters.recent);
}

function syncWLControls(baseItems) {
  const controls = $('wlControls'); if (!controls) return;
  controls.style.display = state.user ? 'flex' : 'none';
  const genre = $('wlGenre');
  if (genre) {
    const ids = new Set(baseItems.flatMap(w => w.genres || []).map(String));
    genre.innerHTML = '<option value="all">All genres</option>' + [...ids]
      .filter(id => genreMap[id]).sort((a, b) => genreMap[a].localeCompare(genreMap[b]))
      .map(id => `<option value="${id}">${esc(genreMap[id])}</option>`).join('');
    genre.value = ids.has(wlGenre) ? wlGenre : 'all';
    if (genre.value !== wlGenre) wlGenre = 'all';
  }
  const values = { wlStatus, wlRating: String(wlRating), wlDecade, wlSort };
  Object.assign(values, { wlLanguage, wlCountry, wlRuntime, wlMine, wlAdded, wlMetadata });
  Object.entries(values).forEach(([id, value]) => { const el = $(id); if (el) el.value = value; });
  const dynamicSelect = (id, values, current, label) => {
    const select = $(id); if (!select) return;
    select.innerHTML = `<option value="all">${label}</option>` + [...values].filter(Boolean).sort().map(value => `<option value="${esc(value)}">${esc(value.toUpperCase())}</option>`).join('');
    select.value = values.has(current) ? current : 'all';
  };
  dynamicSelect('wlLanguage', new Set(baseItems.map(item => item.language)), wlLanguage, 'Any language');
  dynamicSelect('wlCountry', new Set(baseItems.map(item => item.country)), wlCountry, 'Any country');
  wlLanguage = $('wlLanguage')?.value || 'all'; wlCountry = $('wlCountry')?.value || 'all';
  const search = $('wlSearch'); if (search && search.value !== wlQuery) search.value = wlQuery;
}

function payloadFor(w) {
  return esc(JSON.stringify({ id: w.tmdbId, type: w.type, title: w.title, poster: w.poster, rating: w.rating, year: w.year, genres: w.genres || [], keywords: w.keywords || [], runtime: w.runtime || 0, language: w.language || '', country: w.country || '', releaseDate: w.releaseDate || '' }));
}

// Locked lists are excluded: naming one here as a membership would reveal that a
// title is inside it, which is exactly what the PIN hides. Unlock it to include
// it in the scan.
export function findListDuplicates(watchlist = state.watchlist, lists = state.lists) {
  const valid = new Set(lists.filter(list => list.id !== 'watchlist' && !isListLocked(list.id)).map(list => list.id));
  return watchlist.map(item => ({ item, memberships: listsArr(item).filter(id => valid.has(id)) }))
    .filter(entry => entry.memberships.length > 1)
    .sort((a, b) => b.memberships.length - a.memberships.length || (a.item.title || '').localeCompare(b.item.title || ''));
}

function renderDuplicateFinder() {
  const host = $('wlDuplicates'); if (!host) return;
  const duplicates = findListDuplicates(); host.hidden = !duplicateOpen;
  if (!duplicateOpen) { host.innerHTML = ''; return; }
  const listName = id => listById(id)?.name || id;
  host.innerHTML = `<div class="duplicate-head"><div><span>Collection quality control</span><h2>Smart Duplicate Finder</h2><p>${duplicates.length ? `${duplicates.length} title${duplicates.length === 1 ? '' : 's'} appear in more than one custom list.` : 'Every title currently has a clean place in your custom lists.'}</p></div><button data-action="toggle-duplicates" aria-label="Close duplicate finder">×</button></div>${duplicates.length ? `<div class="duplicate-grid">${duplicates.map(({ item, memberships }) => `<article><img src="${item.poster ? `${IMG}w185${item.poster}` : PH}" alt="" loading="lazy"><div><span>${item.type === 'tv' ? 'TV show' : 'Movie'} · ${item.year || 'Year unknown'}</span><h3>${esc(item.title || 'Untitled')}</h3><div class="duplicate-lists">${memberships.map(id => `<b>${esc(listName(id))}</b>`).join('')}</div><button class="btn-glass" data-action="open-list-picker" data-item="${payloadFor(item)}">Review memberships</button></div></article>`).join('')}</div>` : `<div class="duplicate-clear"><i>✓</i><div><strong>No repeated titles</strong><span>Your custom lists are clean and intentional.</span></div></div>`}`;
}

export function renderWL() {
  const ct = $('wlContent'), cnt = $('wlCount'), rail = $('wlLists'), head = $('wlHeadActions'), showcase = $('wlShowcase');
  if (!ct) return;

  if (!state.user) {
    if (rail) rail.innerHTML = '';
    if (head) head.innerHTML = '';
    if (showcase) showcase.innerHTML = '';
    if (cnt) cnt.textContent = '';
    syncWLControls([]);
    ct.innerHTML = `<div class="wl-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg><h3>Sign in to see your lists</h3><p>Create an account to save movies and shows</p><br><button class="btn-primary" data-action="open-auth">Sign In</button></div>`;
    return;
  }
  renderDuplicateFinder();

  // Guard against a deleted active list.
  if (!listById(state.wlList)) state.wlList = 'watchlist';

  // ----- List chip rail -----
  if (rail) {
    const chip = (id, label, icon) => {
      const locked = isListLocked(id);
      return `<button class="wl-chip${state.wlList === id ? ' active' : ''}${listHasPin(id) ? ' has-pin' : ''}${locked ? ' locked' : ''}" data-action="wl-list" data-list="${id}"${locked ? ' aria-label="' + esc(label) + ' (locked)"' : ''}>${icon ? `<span class="wl-chip-ico">${locked ? '🔒' : icon}</span>` : ''}${esc(label)}</button>`;
    };
    let html = '';
    state.lists.forEach(l => { html += chip(l.id, l.name, l.icon); });
    html += `<button class="wl-chip wl-chip-new" data-action="wl-new-list">＋ New</button>`;
    rail.innerHTML = html;
  }

  // ----- Head actions: inline create/rename input, else rename/delete controls -----
  if (head) {
    const active = listById(state.wlList);
    if (listEdit) {
      const val = listEdit.mode === 'rename' && active ? esc(active.name) : '';
      head.innerHTML = `<div class="wl-editrow"><input id="wlListName" type="text" placeholder="List name…" maxlength="30" value="${val}" autocomplete="off"><button class="btn-primary" data-action="wl-list-save">${listEdit.mode === 'rename' ? 'Save' : 'Create'}</button><button class="btn-glass" data-action="wl-list-cancel">Cancel</button></div>`;
    } else if (active) {
      // Any real list can be shared; only non-default lists can be renamed/deleted.
      const shared = active.shared ? ' shared' : '';
      const share = `<button class="btn-glass wl-manage${shared}" data-action="share-list" data-list="${esc(active.id)}" data-tip="${active.shared ? 'Re-share list' : 'Share list'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>`;
      let manage = '';
      if (active.id !== 'watchlist') {
        const del = pendingDelete === active.id
          ? `<button class="btn-glass wl-manage danger" data-action="wl-delete-list">Delete “${esc(active.name)}”?</button>`
          : `<button class="btn-glass wl-manage danger" data-action="wl-delete-list" data-tip="Delete list"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></button>`;
        manage = `<button class="btn-glass wl-manage" data-action="wl-rename-list" data-tip="Rename list"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg></button>${del}`;
      }
      const lockBtn = listHasPin(active.id)
        ? `<button class="btn-glass wl-manage locked" data-action="relock-list" data-list="${esc(active.id)}" data-tip="Lock now"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></button><button class="btn-glass wl-manage" data-action="open-list-pin" data-mode="change" data-list="${esc(active.id)}" data-tip="Change PIN"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><path d="M12 15v2"/></svg></button><button class="btn-glass wl-manage danger" data-action="open-list-pin" data-mode="remove" data-list="${esc(active.id)}" data-tip="Remove PIN"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 6.9-2.3"/></svg></button>`
        : `<button class="btn-glass wl-manage" data-action="open-list-pin" data-mode="set" data-list="${esc(active.id)}" data-tip="Lock with a PIN"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0"/></svg></button>`;
      const duplicateCount = findListDuplicates().length;
      const duplicateButton = `<button class="btn-glass wl-duplicate-btn${duplicateOpen ? ' active' : ''}" data-action="toggle-duplicates" data-tip="Open Duplicates Finder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="12" height="12" rx="2"/><path d="M8 20h10a2 2 0 0 0 2-2V8"/></svg><span>Duplicates Finder</span>${duplicateCount ? `<b>${duplicateCount}</b>` : ''}</button>`;
      head.innerHTML = duplicateButton + share + lockBtn + manage;
    } else head.innerHTML = '';
    const inp = $('wlListName'); if (inp) inp.focus();
  }

  // ----- Locked list: nothing about its contents reaches the DOM -----
  // Not a CSS blur or a display:none over rendered cards — the titles, the count,
  // the showcase, and the filter facets are simply never built while locked.
  if (isListLocked(state.wlList)) {
    const active = listById(state.wlList);
    if (showcase) showcase.innerHTML = '';
    if (cnt) cnt.textContent = 'Locked';
    syncWLControls([]);
    ct.innerHTML = `<section class="wl-locked">
      <div class="wl-locked-shield" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><circle cx="12" cy="16" r="1.4"/></svg></div>
      <h3>${esc(active?.name || 'This list')} is locked</h3>
      <p>Enter the PIN to show its titles. CineVerse re-locks it every time the page reloads.</p>
      <button class="btn-primary" data-action="open-list-pin" data-mode="unlock" data-list="${esc(state.wlList)}">Enter PIN</button>
      <small>A privacy screen, not encryption — these titles remain in your own account.</small>
    </section>`;
    return;
  }

  // ----- Grid -----
  const baseItems = itemsForActiveList();
  if (showcase) showcase.innerHTML = listShowcaseHTML(baseItems);
  if (baseItems.length) loadListRuntimes(baseItems, state.wlList);
  syncWLControls(baseItems);
  const items = filteredListItems();
  if (cnt) cnt.textContent = `${items.length} title${items.length !== 1 ? 's' : ''}`;

  if (!items.length) {
    const nm = listById(state.wlList)?.name || 'list';
    const filtered = !!(wlQuery || wlGenre !== 'all' || wlStatus !== 'all' || wlRating || wlDecade !== 'all' || wlLanguage !== 'all' || wlCountry !== 'all' || wlRuntime !== 'all' || wlMine !== 'all' || wlAdded !== 'all' || wlMetadata !== 'all' || state.wlFilter !== 'all');
    ct.innerHTML = filtered
      ? `<div class="wl-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><h3>No matching titles</h3><p>Try changing or resetting your filters</p></div>`
      : `<div class="wl-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg><h3>${esc(nm[0].toUpperCase() + nm.slice(1))} is empty</h3><p>Add movies and shows with the + on any poster</p></div>`;
    return;
  }

  ct.innerHTML = `<div class="wl-grid">${items.map(w => {
    const poster = w.poster ? `${IMG}w342${w.poster}` : PH;
    const wd = state.watched[w.id];
    const payload = payloadFor(w);
    // ✕ removes from the active list only, so removing from Favorites does not
    // silently remove the same title from Watchlist or another custom list.
    return `<a class="card" href="/${w.type}/${w.tmdbId}" aria-label="${esc(w.title)}" data-action="open-detail" data-id="${w.tmdbId}" data-type="${w.type}"><div class="card-img"><img src="${poster}" alt="${esc(w.title)}" loading="lazy" data-ph="${PH}">${wd ? WATCHED_BADGE_HTML : ''}${myRatingHTML(w.tmdbId, w.type)}${wd ? rateBtnHTML(w.tmdbId, w.type, w.title) : ''}<button class="card-wl in wl-remove" data-wl="${w.type}|${w.tmdbId}" data-action="wl-remove-here" data-item="${payload}" aria-label="Remove" data-tip="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div><div class="card-info"><div class="card-title">${esc(w.title) || ''}</div><div class="card-sub"><span>${w.year || ''}</span><span class="dot"></span><span>${w.type === 'tv' ? 'TV' : 'Movie'}</span></div></div></a>`;
  }).join('')}</div>`;
}

export function initWatchlist() {
  registerActions({
    'toggle-watched': async (el, e) => {
      e.stopPropagation();
      let genres = [];
      let keywords = [];
      try { genres = el.dataset.genres ? JSON.parse(el.dataset.genres) : []; } catch (_) {}
      try { keywords = el.dataset.keywords ? JSON.parse(el.dataset.keywords) : []; } catch (_) {}
      const id = +el.dataset.id, type = el.dataset.type;
      await toggleWatched(id, type, el.dataset.title || '', {
        poster: el.dataset.poster || '', year: el.dataset.year || '', genres, keywords,
        runtime: +el.dataset.runtime || 0, language: el.dataset.language || '',
        country: el.dataset.country || '', releaseDate: el.dataset.releaseDate || '',
        tmdbRating: +el.dataset.tmdbRating || 0, voteCount: +el.dataset.voteCount || 0,
        collectionId: +el.dataset.collectionId || 0, collectionName: el.dataset.collectionName || '',
        collectionPoster: el.dataset.collectionPoster || '',
      });
      document.dispatchEvent(new CustomEvent('cv:watched-toggled', { detail: { id, type } }));
      // Sync the button from the actual result rather than toggling blind — on a
      // failed write, toggleWatched leaves state.watched unchanged, so this
      // correctly leaves the button as-is instead of flipping to a wrong state.
      el.classList.toggle('active', !!state.watched[`${type}_${id}`]);
    },
    'wl-filter': (el) => setWLFilter(el.dataset.filter, el),
    'wl-genre': (el) => { wlGenre = el.value; renderWL(); },
    'wl-status': (el) => { wlStatus = el.value; renderWL(); },
    'wl-rating': (el) => { wlRating = +el.value || 0; renderWL(); },
    'wl-decade': (el) => { wlDecade = el.value; renderWL(); },
    'wl-language': (el) => { wlLanguage = el.value; renderWL(); },
    'wl-country': (el) => { wlCountry = el.value; renderWL(); },
    'wl-runtime': (el) => { wlRuntime = el.value; renderWL(); },
    'wl-mine': (el) => { wlMine = el.value; renderWL(); },
    'wl-added': (el) => { wlAdded = el.value; renderWL(); },
    'wl-metadata': (el) => { wlMetadata = el.value; renderWL(); },
    'wl-sort': (el) => { wlSort = el.value; renderWL(); },
    'wl-reset-filters': () => {
      wlQuery = ''; wlGenre = 'all'; wlStatus = 'all'; wlRating = 0; wlDecade = 'all'; wlSort = 'recent';
      wlLanguage = 'all'; wlCountry = 'all'; wlRuntime = 'all'; wlMine = 'all'; wlAdded = 'all'; wlMetadata = 'all';
      state.wlFilter = 'all';
      document.querySelectorAll('.wl-typefilter .wl-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === 'all'));
      renderWL();
    },
    // ----- List rail + management (My List page) -----
    'wl-list': (el) => { state.wlList = el.dataset.list; listEdit = null; pendingDelete = null; renderWL(); },
    'shuffle-list-cover': (el) => {
      const posters = itemsForActiveList().filter(item => item.poster);
      if (posters.length < 2) return;
      coverOffsets[el.dataset.list] = ((+coverOffsets[el.dataset.list] || 0) + 1) % posters.length;
      saveLocalObject(COVER_OFFSETS_KEY, coverOffsets);
      renderWL();
    },
    'toggle-duplicates': () => { duplicateOpen = !duplicateOpen; renderWL(); },
    'wl-new-list': () => { listEdit = { mode: 'new' }; pendingDelete = null; renderWL(); },
    'wl-rename-list': () => { listEdit = { mode: 'rename' }; pendingDelete = null; renderWL(); },
    'wl-list-cancel': () => { listEdit = null; renderWL(); },
    'wl-list-save': () => saveListEdit(),
    'share-list': async (el) => { await shareList(el.dataset.list); renderWL(); },
    'wl-delete-list': async (el) => {
      const id = state.wlList;
      if (pendingDelete !== id) { pendingDelete = id; renderWL(); return; }  // first click arms, second confirms
      pendingDelete = null;
      await deleteList(id);   // resets state.wlList to 'watchlist' inside
      renderWL();
    },
    'wl-remove-here': (el, e) => {
      e.stopPropagation();
      const item = readItem(el);
      removeFromList(item, item.type, state.wlList).then(renderWL);
    },
  });
  // Enter submits the inline list-name input.
  document.addEventListener('keydown', e => { if (e.target && e.target.id === 'wlListName' && e.key === 'Enter') { e.preventDefault(); saveListEdit(); } });
  const search = $('wlSearch');
  if (search) search.addEventListener('input', debounce(function () { wlQuery = this.value.trim(); renderWL(); }, 180));
  // Reset transient edit state when leaving the page or signing out.
  document.addEventListener('cv:auth', () => { listEdit = null; pendingDelete = null; duplicateOpen = false; state.wlList = 'watchlist'; });
  document.addEventListener('cv:list-lock', () => { if (location.pathname === '/watchlist') renderWL(); });
}
