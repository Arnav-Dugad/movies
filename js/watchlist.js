// ===== WATCHLIST + WATCHED =====
import { auth, db, firebase } from './firebase.js';
import { state } from './state.js';
import { IMG, PH, genreMap } from './config.js';
import { esc, toast, $, debounce } from './ui.js';
import { refreshWLBtns, rateBtnHTML, myRatingHTML, WATCHED_BADGE_HTML } from './cards.js';
import { registerActions, readItem } from './events.js';
import { removeFromList, listsArr, listById, createList, renameList, deleteList, shareList } from './lists.js';

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
      await ref.delete(); delete state.watched[key]; toast('Unmarked as watched', 'info');
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
    }
    document.dispatchEvent(new Event('cv:wl-changed'));
  } catch (e) { console.error('toggleWatched failed:', e); toast('Error', 'error'); }
}

// ===== WATCHLIST PAGE =====
// Inline list-management state (create/rename input, two-tap delete confirm) — kept
// out of a modal so managing lists stays on-page.
let listEdit = null;       // { mode: 'new' | 'rename' }
let pendingDelete = null;  // listId awaiting a second confirming click
let wlQuery = '', wlGenre = 'all', wlStatus = 'all', wlRating = 0, wlDecade = 'all', wlSort = 'recent';

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
  const sorters = {
    recent: (a, b) => addedSeconds(b) - addedSeconds(a),
    title_asc: (a, b) => (a.title || '').localeCompare(b.title || ''),
    title_desc: (a, b) => (b.title || '').localeCompare(a.title || ''),
    year_desc: (a, b) => +(b.year || 0) - +(a.year || 0),
    year_asc: (a, b) => +(a.year || 9999) - +(b.year || 9999),
    rating_desc: (a, b) => +(b.rating || 0) - +(a.rating || 0),
    rating_asc: (a, b) => +(a.rating || 0) - +(b.rating || 0),
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
  Object.entries(values).forEach(([id, value]) => { const el = $(id); if (el) el.value = value; });
  const search = $('wlSearch'); if (search && search.value !== wlQuery) search.value = wlQuery;
}

function payloadFor(w) {
  return esc(JSON.stringify({ id: w.tmdbId, type: w.type, title: w.title, poster: w.poster, rating: w.rating, year: w.year, genres: w.genres || [] }));
}

export function renderWL() {
  const ct = $('wlContent'), cnt = $('wlCount'), rail = $('wlLists'), head = $('wlHeadActions');
  if (!ct) return;

  if (!state.user) {
    if (rail) rail.innerHTML = '';
    if (head) head.innerHTML = '';
    if (cnt) cnt.textContent = '';
    syncWLControls([]);
    ct.innerHTML = `<div class="wl-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg><h3>Sign in to see your lists</h3><p>Create an account to save movies and shows</p><br><button class="btn-primary" data-action="open-auth">Sign In</button></div>`;
    return;
  }

  // Guard against a deleted active list.
  if (!listById(state.wlList)) state.wlList = 'watchlist';

  // ----- List chip rail -----
  if (rail) {
    const chip = (id, label, icon) => `<button class="wl-chip${state.wlList === id ? ' active' : ''}" data-action="wl-list" data-list="${id}">${icon ? `<span class="wl-chip-ico">${icon}</span>` : ''}${esc(label)}</button>`;
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
      head.innerHTML = share + manage;
    } else head.innerHTML = '';
    const inp = $('wlListName'); if (inp) inp.focus();
  }

  // ----- Grid -----
  const baseItems = itemsForActiveList();
  syncWLControls(baseItems);
  const items = filteredListItems();
  if (cnt) cnt.textContent = `${items.length} title${items.length !== 1 ? 's' : ''}`;

  if (!items.length) {
    const nm = listById(state.wlList)?.name || 'list';
    const filtered = !!(wlQuery || wlGenre !== 'all' || wlStatus !== 'all' || wlRating || wlDecade !== 'all' || state.wlFilter !== 'all');
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
      try { genres = el.dataset.genres ? JSON.parse(el.dataset.genres) : []; } catch (_) {}
      const id = +el.dataset.id, type = el.dataset.type;
      await toggleWatched(id, type, el.dataset.title || '', { poster: el.dataset.poster || '', year: el.dataset.year || '', genres });
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
    'wl-sort': (el) => { wlSort = el.value; renderWL(); },
    'wl-reset-filters': () => {
      wlQuery = ''; wlGenre = 'all'; wlStatus = 'all'; wlRating = 0; wlDecade = 'all'; wlSort = 'recent';
      state.wlFilter = 'all';
      document.querySelectorAll('.wl-typefilter .wl-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === 'all'));
      renderWL();
    },
    // ----- List rail + management (My List page) -----
    'wl-list': (el) => { state.wlList = el.dataset.list; listEdit = null; pendingDelete = null; renderWL(); },
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
  document.addEventListener('cv:auth', () => { listEdit = null; pendingDelete = null; state.wlList = 'watchlist'; });
}
