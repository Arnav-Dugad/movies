// ===== CUSTOM LISTS =====
// A saved title lives in users/{uid}/watchlist/{type}_{id} (one doc per title, the
// union of everything you've saved) and carries a `lists: [listId,…]` membership
// array. List metadata lives in users/{uid}/lists/{listId}. The doc exists iff the
// title is in ≥1 list — so inWL (doc existence) already means "saved somewhere".
//
// Mutations are read-modify-write on the in-memory `lists` array (never
// arrayUnion/arrayRemove): the item is already in state.watchlist, so we compute the
// next array and set({lists}, {merge}). Safe in real Firestore and mock-friendly.
// Import direction is watchlist.js -> lists.js ONLY (lists.js never imports
// watchlist.js) so there's no cycle; cards.js stays state-only.
import { db, firebase } from './firebase.js';
import { state } from './state.js';
import { $, esc, toast, trapFocus, lockScroll, unlockScroll } from './ui.js';
import { registerActions, readItem } from './events.js';
import { refreshWLBtns } from './cards.js';

const RESERVED = new Set(['watchlist', 'watched']);   // ids a custom list can never take
const DEFAULT_LISTS = [
  { id: 'watchlist', name: 'Watchlist', icon: '📋', color: 'red', order: 0 },
  { id: 'favorites', name: 'Favorites', icon: '❤️', color: 'red', order: 1 },
  { id: 'watchlater', name: 'Watch Later', icon: '🕒', color: 'cyan', order: 2 },
];

const ts = () => firebase.firestore.FieldValue.serverTimestamp();
const listCol = () => db.collection('users').doc(state.user.uid).collection('lists');
const wlCol = () => db.collection('users').doc(state.user.uid).collection('watchlist');
const keyOf = (id, type) => `${type}_${id}`;
// A doc key is `${type}_${id}` — the reliable fallback when an older watchlist
// entry is missing its own tmdbId/type fields.
export function fromKey(key) {
  const i = String(key || '').lastIndexOf('_');
  if (i < 1) return {};
  const id = parseInt(String(key).slice(i + 1), 10);
  return { type: String(key).slice(0, i), tmdbId: Number.isFinite(id) ? id : undefined };
}

// Firestore THROWS on an undefined field value, which turned one malformed
// watchlist entry into a blanket "error updating list"/"could not share list".
// Every write goes through this.
export const clean = (obj) => {
  const out = {};
  Object.entries(obj).forEach(([k, v]) => { if (v !== undefined) out[k] = v; });
  return out;
};
const errCode = (e) => (e && e.code ? ` (${e.code})` : '');

// The union-store doc shape (matches the old toggleWL payload so nothing downstream
// — stats, taste, badges — sees a different watchlist item).
function buildItemDoc(item, type) {
  const id = item.id != null ? item.id : item.tmdbId;
  return clean({
    tmdbId: id,
    type,
    title: item.title || item.name || '',
    poster: item.poster || item.poster_path || '',
    rating: item.rating || item.vote_average || 0,
    year: item.year || (item.release_date || item.first_air_date || '').slice(0, 4),
    added: ts(),
    genres: item.genres || item.genre_ids || [],
    keywords: item.keywords || [],
    runtime: item.runtime || (item.episode_run_time || [])[0] || 0,
    language: item.language || item.original_language || '',
    country: item.country || (item.origin_country || [])[0] || '',
    releaseDate: item.releaseDate || item.release_date || item.first_air_date || '',
  });
}

// ----- Metadata -----
export async function loadLists() {
  if (!state.user) { state.lists = []; return; }
  try {
    const snap = await listCol().get();
    if (snap.empty) {
      // Genuine first use — Watchlist is non-deletable, so an empty collection is
      // unambiguous. Seed the three defaults in one batch.
      const batch = db.batch();
      DEFAULT_LISTS.forEach(l => batch.set(listCol().doc(l.id), { name: l.name, icon: l.icon, color: l.color, order: l.order, created: ts() }));
      await batch.commit();
      state.lists = DEFAULT_LISTS.map(l => ({ ...l }));
    } else {
      state.lists = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
    }
  } catch (e) { console.error('loadLists', e); state.lists = DEFAULT_LISTS.map(l => ({ ...l })); }
}

export function listById(id) { return state.lists.find(l => l.id === id) || null; }

// A list with a PIN that has not been opened this session. Read straight from
// `state` rather than importing js/list-lock.js, which imports this module.
export function listIsLocked(id) {
  const list = listById(id);
  return !!(list?.lock?.hash && !state.unlockedLists.has(id));
}

// Membership, with lazy migration: a legacy doc (or one with no lists field) reads
// as belonging to the default Watchlist.
export function listsArr(entry) {
  return entry && entry.lists && entry.lists.length ? entry.lists : ['watchlist'];
}
export function inList(id, type, listId) {
  const e = state.watchlist.find(w => w.id === keyOf(id, type));
  return !!e && listsArr(e).includes(listId);
}

// ----- Membership mutations (read-modify-write) -----
export async function addToList(item, type, listId, { silent = false } = {}) {
  if (!state.user) return document.dispatchEvent(new Event('cv:open-auth'));
  const id = item.id != null ? item.id : item.tmdbId;
  const key = keyOf(id, type);
  const ref = wlCol().doc(key);
  let entry = state.watchlist.find(w => w.id === key);
  try {
    if (!entry) {
      const d = buildItemDoc(item, type);
      d.lists = [listId];
      await ref.set(d);
      state.watchlist.unshift({ id: key, ...d, lists: [listId] });
    } else {
      const cur = listsArr(entry);
      if (cur.includes(listId)) return;
      const next = [...cur, listId];
      await ref.set({ lists: next }, { merge: true });
      entry.lists = next;
    }
    refreshWLBtns();
    // silent: bulk callers (cloning a shared list) show one summary toast instead.
    if (!silent) toast(`Saved to ${listById(listId)?.name || 'list'}`, 'success');
    document.dispatchEvent(new Event('cv:wl-changed'));
  } catch (e) { console.error('addToList', e); toast(`Could not add to list${errCode(e)}`, 'error'); }
}

export async function removeFromList(item, type, listId) {
  if (!state.user) return;
  const id = item.id != null ? item.id : item.tmdbId;
  const key = keyOf(id, type);
  const entry = state.watchlist.find(w => w.id === key);
  if (!entry) return;
  const ref = wlCol().doc(key);
  const next = listsArr(entry).filter(l => l !== listId);
  try {
    if (!next.length) {
      await ref.delete();
      state.watchlist = state.watchlist.filter(w => w.id !== key);
    } else {
      await ref.set({ lists: next }, { merge: true });
      entry.lists = next;
    }
    refreshWLBtns();
    toast(`Removed from ${listById(listId)?.name || 'list'}`, 'info');
    document.dispatchEvent(new Event('cv:wl-changed'));
  } catch (e) { console.error('removeFromList', e); toast(`Could not update list${errCode(e)}`, 'error'); }
}

// The main card ✓ tap — remove from every list (delete the doc).
export async function removeFromAllLists(item, type) {
  if (!state.user) return;
  const id = item.id != null ? item.id : item.tmdbId;
  const key = keyOf(id, type);
  const entry = state.watchlist.find(w => w.id === key);
  if (!entry) return;
  const n = listsArr(entry).length;
  try {
    await wlCol().doc(key).delete();
    state.watchlist = state.watchlist.filter(w => w.id !== key);
    refreshWLBtns();
    toast(n > 1 ? `Removed from ${n} lists` : 'Removed from list', 'info');
    document.dispatchEvent(new Event('cv:wl-changed'));
  } catch (e) { console.error('removeFromAllLists', e); toast(`Could not update list${errCode(e)}`, 'error'); }
}

// ----- List CRUD -----
function slugId(name) {
  let base = (name || 'list').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'list';
  let id = base;
  let n = 1;
  while (RESERVED.has(id) || state.lists.some(l => l.id === id)) id = base + (++n);
  return id;
}

export async function createList(name, { icon = '🎬', color = 'purple' } = {}) {
  const nm = (name || '').trim();
  if (!state.user || !nm) return null;
  const id = slugId(nm);
  const order = state.lists.reduce((m, l) => Math.max(m, l.order || 0), 0) + 1;
  try {
    await listCol().doc(id).set(clean({ name: nm, icon, color, order, created: ts() }));
    const list = { id, name: nm, icon, color, order };
    state.lists.push(list);
    return list;
  } catch (e) { console.error('createList', e); toast(`Could not create list${errCode(e)}`, 'error'); return null; }
}

export async function renameList(id, name) {
  const nm = (name || '').trim();
  const list = listById(id);
  if (!state.user || !list || !nm) return;
  try { await listCol().doc(id).set({ name: nm }, { merge: true }); list.name = nm; document.dispatchEvent(new Event('cv:wl-changed')); }
  catch (e) { console.error('renameList', e); }
}

export async function deleteList(id) {
  if (id === 'watchlist') return;   // the default is permanent
  if (!state.user || !listById(id)) return;
  try {
    // Strip the id from every member; a title left in zero lists falls back to
    // Watchlist rather than being silently deleted.
    const batch = db.batch();
    state.watchlist.forEach(w => {
      const cur = listsArr(w);
      if (!cur.includes(id)) return;
      let next = cur.filter(l => l !== id);
      if (!next.length) next = ['watchlist'];
      batch.set(wlCol().doc(w.id), { lists: next }, { merge: true });
      w.lists = next;
    });
    batch.set(listCol().doc(id), {}, { merge: true });   // ensure the doc exists for delete-in-batch parity
    batch.delete(listCol().doc(id));
    await batch.commit();
    state.lists = state.lists.filter(l => l.id !== id);
    if (state.wlList === id) state.wlList = 'watchlist';
    refreshWLBtns();
    document.dispatchEvent(new Event('cv:wl-changed'));
  } catch (e) { console.error('deleteList', e); toast(`Could not delete list${errCode(e)}`, 'error'); }
}

// ----- Share a list -----
// Publishes a DERIVED snapshot to users/{uid}/shared/list_{listId}. This lives
// under the same `shared` subcollection as the friend-readable taste doc, so it
// inherits that cross-user read posture — the raw watchlist stays owner-only.
const sharedListRef = (uid, listId) => db.collection('users').doc(uid).collection('shared').doc(`list_${listId}`);

// ----- PIN lock (js/list-lock.js owns the crypto; this owns the write) -----
// Passing null clears the field. deleteField() keeps the document clean instead
// of leaving a null behind that listHasPin would then have to special-case.
export async function saveListLock(listId, lock) {
  const list = listById(listId);
  if (!state.user || !list) return false;
  try {
    await listCol().doc(listId).set({ lock: lock || firebase.firestore.FieldValue.delete() }, { merge: true });
    if (lock) list.lock = lock; else delete list.lock;
    document.dispatchEvent(new Event('cv:wl-changed'));
    return true;
  } catch (e) { console.error('saveListLock', e); toast(`Could not update the list lock${errCode(e)}`, 'error'); return false; }
}

// Revokes a published share snapshot. Called when a list is locked, so an old
// link can never keep serving titles the owner has just made private.
export async function unshareList(listId) {
  const list = listById(listId);
  if (!state.user || !list || !list.shared) return;
  try {
    await sharedListRef(state.user.uid, listId).delete();
    await listCol().doc(listId).set({ shared: false }, { merge: true });
    list.shared = false;
  } catch (e) { console.error('unshareList', e); }
}

function itemsInList(listId) {
  return state.watchlist
    .filter(w => listsArr(w).includes(listId))
    .map(w => {
      // Older entries can lack tmdbId/type; the doc key always has both. Without
      // this, `id: undefined` reached Firestore and threw, failing the whole share.
      const k = fromKey(w.id);
      return clean({
        id: w.tmdbId != null ? w.tmdbId : k.tmdbId,
        type: w.type || k.type,
        title: w.title || '', poster: w.poster || '', year: w.year || '', rating: w.rating || 0,
      });
    })
    .filter(it => it.id != null && it.type);
}

async function writeSharedList(list) {
  const items = itemsInList(list.id);
  await sharedListRef(state.user.uid, list.id).set(clean({
    kind: 'list', listId: list.id, name: list.name || 'List', icon: list.icon || '📁',
    owner: state.user.uid,
    ownerName: state.user.displayName || (state.user.email || '').split('@')[0] || 'A friend',
    items, count: items.length, updatedAt: ts(),
  }));
}

export async function shareList(listId) {
  if (!state.user) return document.dispatchEvent(new Event('cv:open-auth'));
  const list = listById(listId);
  if (!list) return;
  // Publishing a snapshot of a PIN-locked list would defeat the lock entirely.
  if (list.lock?.hash) { toast('Remove the PIN before sharing this list', 'info'); return; }
  try {
    await writeSharedList(list);
    if (!list.shared) { list.shared = true; await listCol().doc(listId).set({ shared: true }, { merge: true }); }
    const link = `${location.origin}/shared-list/${state.user.uid}/${listId}`;
    let copied = false;
    if (navigator.clipboard) { try { await navigator.clipboard.writeText(link); copied = true; } catch (_) {} }
    toast(copied ? `“${list.name}” shared — link copied!` : `Shared! ${link}`, copied ? 'success' : 'info');
  } catch (e) { console.error('shareList', e); toast(`Could not share list${errCode(e)}`, 'error'); }
}

// Keep already-shared lists' snapshots fresh when the watchlist changes.
export async function republishSharedLists() {
  if (!state.user) return;
  for (const l of state.lists.filter(l => l.shared && !l.lock?.hash)) {
    try { await writeSharedList(l); } catch (e) { console.error('republishSharedLists', e); }
  }
}

// ----- Picker modal -----
let pickerTarget = null;   // { item, type, id }
let pickerRelease = null;
let creating = false;

function renderPickerRows() {
  const rows = $('listRows');
  if (!rows || !pickerTarget) return;
  const { id, type } = pickerTarget;
  // A locked list gets an "Add" button instead of a checkbox. A ticked box would
  // reveal whether the title is already inside, which is exactly what the PIN
  // hides — but ADDING leaks nothing, because the answer is the same either way
  // and the operation is idempotent. Removing still requires unlocking the list.
  rows.innerHTML = state.lists.map(l => {
    if (listIsLocked(l.id)) {
      return `<div class="list-row locked"><span class="list-ico">🔒</span><span class="list-nm">${esc(l.name)}</span><button type="button" class="list-add-locked" data-action="add-to-locked-list" data-list="${esc(l.id)}">Add</button></div>`;
    }
    const on = inList(id, type, l.id);
    return `<label class="list-row"><input type="checkbox" data-action="toggle-list-member" data-list="${esc(l.id)}" ${on ? 'checked' : ''}><span class="list-ico">${l.icon || '📁'}</span><span class="list-nm">${esc(l.name)}</span></label>`;
  }).join('');
  const create = $('listCreate');
  if (create) {
    create.innerHTML = creating
      ? `<div class="list-create-row"><input id="listNewName" type="text" placeholder="List name…" maxlength="30" autocomplete="off"><button class="btn-primary" style="height:40px" data-action="create-list-confirm">Add</button></div>`
      : `<button class="list-new-btn" data-action="create-list">＋ New list</button>`;
    if (creating) { const inp = $('listNewName'); if (inp) inp.focus(); }
  }
}

export function openListPicker(item, type) {
  if (!state.user) return document.dispatchEvent(new Event('cv:open-auth'));
  const trigger = document.activeElement;
  pickerTarget = { item, type, id: item.id != null ? item.id : item.tmdbId };
  creating = false;
  $('listSub').textContent = item.title || item.name || '';
  renderPickerRows();
  const ov = $('listOv');
  ov.classList.add('active');
  lockScroll();
  pickerRelease = trapFocus(ov, trigger);
}

export function closeListPicker() {
  const ov = $('listOv');
  if (!ov || !ov.classList.contains('active')) return;
  ov.classList.remove('active');
  unlockScroll();
  if (pickerRelease) { pickerRelease(); pickerRelease = null; }
  pickerTarget = null;
  creating = false;
}

export function isListPickerOpen() { const ov = $('listOv'); return !!ov && ov.classList.contains('active'); }

export function initLists() {
  const ov = $('listOv');
  if (ov) ov.addEventListener('click', e => { if (e.target === ov) closeListPicker(); });

  registerActions({
    'open-list-picker': (el, e) => { e.stopPropagation(); openListPicker(readItem(el), readItem(el).type); },
    'close-list-picker': () => closeListPicker(),
    'toggle-list-member': async (el) => {
      if (!pickerTarget) return;
      const listId = el.dataset.list;
      if (el.checked) await addToList(pickerTarget.item, pickerTarget.type, listId);
      else await removeFromList(pickerTarget.item, pickerTarget.type, listId);
      renderPickerRows();   // re-sync checkboxes (membership may have created/deleted the doc)
    },
    // Deliberately silent about prior membership: it always says "Added", whether
    // the title was already there or not, so the confirmation reveals nothing the
    // PIN is meant to keep hidden.
    'add-to-locked-list': async (el) => {
      if (!pickerTarget) return;
      el.disabled = true;
      await addToList(pickerTarget.item, pickerTarget.type, el.dataset.list, { silent: true });
      el.textContent = 'Added';
      el.classList.add('done');
      toast('Saved to your locked list', 'success');
    },
    'create-list': () => { creating = true; renderPickerRows(); },
    'create-list-confirm': async () => {
      const inp = $('listNewName');
      const name = (inp && inp.value || '').trim();
      if (!name) return;
      const list = await createList(name);
      creating = false;
      if (list && pickerTarget) await addToList(pickerTarget.item, pickerTarget.type, list.id);
      renderPickerRows();
    },
  });

  // Clear per-user list state on sign-out.
  document.addEventListener('cv:auth', () => { if (!state.user) { state.lists = []; state.wlList = 'watchlist'; } });
  // Keep any shared list snapshots current as the watchlist changes.
  let republishTimer = null;
  document.addEventListener('cv:wl-changed', () => {
    if (!state.user || !state.lists.some(l => l.shared)) return;
    clearTimeout(republishTimer);
    republishTimer = setTimeout(() => republishSharedLists(), 1500);
  });
}
