// ===== COLLABORATIVE LISTS =====
// A list two people both add to.
//
// This is deliberately NOT the same thing as sharing a list. A share publishes a
// snapshot under users/{uid}/shared/{doc}: the owner keeps the list, everyone
// else can read it and save a copy, and the moment either of them adds anything
// the two copies drift apart. That is the right shape for "look what I have
// been watching" and the wrong one for "what are we watching on Friday".
//
// So a collaborative list lives outside any one account, at collabLists/{id},
// with a members array. Every member writes to the same document, which means
// there is one list rather than two diverging ones, and no owner whose copy is
// the real one.
//
// Access is by link. The id is 20 random characters and the list document is
// readable by any signed-in user, because you have to be able to see a list's
// name before deciding to join it — but its ITEMS are members-only, so a link
// reveals a title and nothing about what these people actually watch. Every
// boundary here is enforced by firestore.rules, not by this file; see the
// "collaborative lists" suite in tests/rules.test.mjs.
import { db, firebase } from './firebase.js';
import { state } from './state.js';
import { toast } from './ui.js';
import { reportRulesDenial } from './rules-notice.js';

const MAX_MEMBERS = 12;      // matches the cap in firestore.rules
const MAX_ITEMS = 500;
const ts = () => firebase.firestore.FieldValue.serverTimestamp();
const col = () => db.collection('collabLists');
const listRef = id => col().doc(id);
const itemsRef = id => listRef(id).collection('items');

let unsubscribeLists = null;
const itemWatchers = new Map();

/** 20 random characters. Guessing one is the access control, so it has to be real randomness. */
function newListId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return [...bytes].map(byte => alphabet[byte % alphabet.length]).join('');
}

const myName = () => state.user?.displayName || (state.user?.email || '').split('@')[0] || 'Someone';
export const itemKey = (type, id) => `${type}_${+id}`;

/** Firestore rejects an undefined field value, and one bad row must not fail the write. */
const clean = value => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));

function normalizeList(id, data) {
  const members = [...new Set((Array.isArray(data?.members) ? data.members : []).filter(Boolean))];
  return {
    id,
    name: String(data?.name || 'Shared list').slice(0, 60),
    icon: String(data?.icon || '\u{1F37F}').slice(0, 8),
    createdBy: String(data?.createdBy || ''),
    members,
    memberNames: data?.memberNames && typeof data.memberNames === 'object' ? data.memberNames : {},
    count: Math.max(0, +data?.count || 0),
    createdAt: data?.createdAt?.seconds ? data.createdAt.seconds * 1000 : +data?.createdAt || 0,
    updatedAt: data?.updatedAt?.seconds ? data.updatedAt.seconds * 1000 : +data?.updatedAt || 0,
  };
}

export const collabListById = id => (state.collabLists || []).find(list => list.id === id) || null;
export const isCollabMember = (list, uid = state.user?.uid) => !!(list && uid && list.members.includes(uid));
export const collabLink = id => `${location.origin}/collab/${id}`;

/** A friendly "you and Sam" for the list header. */
export function membersLabel(list, uid = state.user?.uid) {
  const others = (list?.members || []).filter(member => member !== uid)
    .map(member => list.memberNames?.[member] || 'someone');
  if (!others.length) return 'Just you so far';
  if (others.length === 1) return `You and ${others[0]}`;
  return `You, ${others.slice(0, -1).join(', ')} and ${others[others.length - 1]}`;
}

// ---------- reading ----------

/**
 * Keep state.collabLists in step with the account. Sorting happens here rather
 * than in the query: `array-contains` plus `orderBy` would need a composite
 * index, and a dozen lists do not justify one.
 */
export function initCollabLists() {
  document.addEventListener('cv:auth', () => {
    unsubscribeLists?.(); unsubscribeLists = null;
    for (const stop of itemWatchers.values()) stop();
    itemWatchers.clear();
    const uid = state.user?.uid;
    if (!uid) { state.collabLists = []; document.dispatchEvent(new Event('cv:collab-lists')); return; }
    unsubscribeLists = col().where('members', 'array-contains', uid).onSnapshot(snapshot => {
      if (state.user?.uid !== uid) return;
      state.collabLists = snapshot.docs
        .map(document => normalizeList(document.id, document.data()))
        .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
      document.dispatchEvent(new Event('cv:collab-lists'));
    }, error => {
      if (!reportRulesDenial(error, 'shared lists')) console.warn('collab lists', error);
    });
  });
}

/** One-off read of a list document — used by the invite page, before joining. */
export async function fetchCollabList(id) {
  const snapshot = await listRef(id).get();
  return snapshot.exists ? normalizeList(snapshot.id, snapshot.data()) : null;
}

/** Live items for one list. Returns a teardown. */
export function watchCollabItems(id, onChange) {
  itemWatchers.get(id)?.();
  const stop = itemsRef(id).onSnapshot(snapshot => {
    onChange(snapshot.docs.map(document => ({ key: document.id, ...document.data() }))
      .sort((a, b) => (b.addedAt?.seconds || 0) - (a.addedAt?.seconds || 0)));
  }, error => {
    if (!reportRulesDenial(error, 'shared lists')) console.warn('collab items', error);
    onChange(null);
  });
  itemWatchers.set(id, stop);
  return () => { stop(); itemWatchers.delete(id); };
}

// ---------- writing ----------

export async function createCollabList(name, icon = '\u{1F37F}') {
  if (!state.user) { document.dispatchEvent(new Event('cv:open-auth')); return null; }
  const id = newListId();
  const uid = state.user.uid;
  try {
    await listRef(id).set({
      name: String(name || 'Shared list').trim().slice(0, 60) || 'Shared list',
      icon: String(icon).slice(0, 8),
      createdBy: uid, members: [uid], memberNames: { [uid]: myName() },
      count: 0, createdAt: ts(), updatedAt: ts(),
    });
    return id;
  } catch (error) {
    if (!reportRulesDenial(error, 'shared lists')) console.error('createCollabList', error);
    toast('Could not create the list', 'error');
    return null;
  }
}

/**
 * Add yourself to a list you have a link to.
 *
 * The rules allow exactly one shape of join — the member array gaining you and
 * nothing else — so this reads the current members and writes them back with
 * one addition rather than using arrayUnion, which would also let a stale
 * client resurrect somebody who had left.
 */
export async function joinCollabList(id) {
  if (!state.user) { document.dispatchEvent(new Event('cv:open-auth')); return 'signed-out'; }
  const uid = state.user.uid;
  try {
    return await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(listRef(id));
      if (!snapshot.exists) return 'missing';
      const data = snapshot.data();
      const members = [...new Set([...(data.members || [])])];
      if (members.includes(uid)) return 'already';
      if (members.length >= MAX_MEMBERS) return 'full';
      transaction.set(listRef(id), {
        ...data,
        members: [...members, uid],
        memberNames: { ...(data.memberNames || {}), [uid]: myName() },
        updatedAt: ts(),
      });
      return 'joined';
    });
  } catch (error) {
    if (!reportRulesDenial(error, 'shared lists')) console.error('joinCollabList', error);
    return 'error';
  }
}

/** Leave without destroying it for everyone else. */
export async function leaveCollabList(id) {
  if (!state.user) return false;
  const uid = state.user.uid;
  try {
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(listRef(id));
      if (!snapshot.exists) return;
      const data = snapshot.data();
      const members = (data.members || []).filter(member => member !== uid);
      const memberNames = { ...(data.memberNames || {}) };
      delete memberNames[uid];
      transaction.set(listRef(id), { ...data, members, memberNames, updatedAt: ts() });
    });
    return true;
  } catch (error) {
    if (!reportRulesDenial(error, 'shared lists')) console.error('leaveCollabList', error);
    return false;
  }
}

export async function renameCollabList(id, name, icon) {
  const list = collabListById(id);
  if (!list || !state.user) return false;
  try {
    await listRef(id).set({
      name: String(name || list.name).trim().slice(0, 60) || list.name,
      icon: String(icon || list.icon).slice(0, 8),
      createdBy: list.createdBy, members: list.members, updatedAt: ts(),
    }, { merge: true });
    return true;
  } catch (error) {
    if (!reportRulesDenial(error, 'shared lists')) console.error('renameCollabList', error);
    return false;
  }
}

/** Only whoever made it can remove it for everybody; everyone else leaves. */
export async function deleteCollabList(id) {
  const list = collabListById(id);
  if (!list || list.createdBy !== state.user?.uid) return false;
  try {
    // No recursive delete on the client, so the titles go first — otherwise they
    // would be orphaned rows nobody can read or remove.
    const snapshot = await itemsRef(id).get();
    for (let index = 0; index < snapshot.docs.length; index += 400) {
      const batch = db.batch();
      snapshot.docs.slice(index, index + 400).forEach(document => batch.delete(document.ref));
      await batch.commit();
    }
    await listRef(id).delete();
    return true;
  } catch (error) {
    if (!reportRulesDenial(error, 'shared lists')) console.error('deleteCollabList', error);
    return false;
  }
}

/**
 * Put a title on a shared list.
 * @param {string} id    list id
 * @param {object} item  { tmdbId, type, title, poster, year, rating }
 * @returns {'added'|'already'|'full'|'error'|'signed-out'}
 */
export async function addToCollabList(id, item) {
  if (!state.user) { document.dispatchEvent(new Event('cv:open-auth')); return 'signed-out'; }
  const list = collabListById(id);
  if (!list) return 'error';
  if (list.count >= MAX_ITEMS) return 'full';
  const tmdbId = +item?.tmdbId || +item?.id;
  const type = item?.type === 'tv' ? 'tv' : 'movie';
  if (!(tmdbId > 0)) return 'error';
  const key = itemKey(type, tmdbId);
  try {
    const existing = await itemsRef(id).doc(key).get();
    if (existing.exists) return 'already';
    await itemsRef(id).doc(key).set(clean({
      tmdbId, type,
      title: String(item.title || item.name || '').slice(0, 180),
      poster: String(item.poster || item.poster_path || ''),
      year: String(item.year || '').slice(0, 4),
      rating: +item.rating || +item.vote_average || 0,
      // Shown on every row, and the rules will not let it be anyone else.
      addedBy: state.user.uid, addedByName: myName(), addedAt: ts(),
    }));
    await touch(id, 1);
    return 'added';
  } catch (error) {
    if (!reportRulesDenial(error, 'shared lists')) console.error('addToCollabList', error);
    return 'error';
  }
}

export async function removeFromCollabList(id, key) {
  if (!state.user) return false;
  try {
    await itemsRef(id).doc(key).delete();
    await touch(id, -1);
    return true;
  } catch (error) {
    if (!reportRulesDenial(error, 'shared lists')) console.error('removeFromCollabList', error);
    return false;
  }
}

/**
 * Keep the count and the sort order on the list document current.
 *
 * Best-effort on purpose: the items are the truth, and a failed counter must
 * never make an otherwise successful add look like a failure.
 */
async function touch(id, delta) {
  const list = collabListById(id);
  if (!list) return;
  try {
    await listRef(id).set({
      createdBy: list.createdBy, members: list.members,
      count: Math.max(0, list.count + delta), updatedAt: ts(),
    }, { merge: true });
  } catch (error) { console.warn('collab touch', error); }
}
