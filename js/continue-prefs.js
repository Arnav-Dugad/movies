// ===== CONTINUE WATCHING: LIVE PINS, HIDES, AND ORDER =====
// Layout choices are optimistic locally and replayed as intent inside a Firestore
// transaction. This prevents one device replacing another device's newer layout.
import { db, firebase } from './firebase.js';
import { state } from './state.js';

const CAP = 40;
let saveTimer = null;
let unsubscribe = null;
let pendingOps = [];
let ownerUid = '';

const normal = value => {
  if (typeof value === 'number' || /^\d+$/.test(String(value || ''))) return `tv_${+value}`;
  const match = String(value || '').match(/^(tv|movie)_(\d+)$/);
  return match && +match[2] > 0 ? `${match[1]}_${+match[2]}` : '';
};
const clean = value => [...new Set((Array.isArray(value) ? value : []).map(normal).filter(Boolean))].slice(0, CAP);
const cacheKey = uid => `cv_continue_prefs_${uid}`;
const normalizePrefs = value => ({
  pinned: clean(value?.pinned), hidden: clean(value?.hidden),
  clientUpdatedAt: Math.max(0, +(value?.clientUpdatedAt || 0)),
});
const prefs = () => (state.continuePrefs ||= normalizePrefs());

function selectOwner(uid = state.user?.uid || '') {
  if (uid === ownerUid) return;
  clearTimeout(saveTimer); saveTimer = null;
  pendingOps = [];
  ownerUid = uid;
}

function cached(uid) {
  try { return JSON.parse(localStorage.getItem(cacheKey(uid)) || 'null'); } catch (_) { return null; }
}
function mirror(uid = state.user?.uid) {
  if (!uid) return;
  try { localStorage.setItem(cacheKey(uid), JSON.stringify({ ...prefs(), pendingOps })); } catch (_) {}
}

function applyOps(base, operations) {
  const next = normalizePrefs(base);
  for (const op of operations || []) {
    const key = normal(op.key);
    if (op.type === 'pin' && key) {
      next.pinned = next.pinned.filter(value => value !== key);
      if (op.value) next.pinned.unshift(key);
    } else if (op.type === 'hide' && key) {
      next.hidden = next.hidden.filter(value => value !== key);
      if (op.value) {
        next.hidden.unshift(key);
        next.pinned = next.pinned.filter(value => value !== key);
      }
    } else if (op.type === 'order') {
      const order = clean(op.value), held = new Set(order);
      next.pinned = [...order, ...next.pinned.filter(value => !held.has(value))].slice(0, CAP);
    } else if (op.type === 'reset') {
      next.pinned = []; next.hidden = [];
    }
    next.clientUpdatedAt = Math.max(next.clientUpdatedAt, +(op.at || 0));
  }
  return next;
}

// Pure merge surface used by regression tests and future import/repair tools.
// Keeping this identical to the transaction body prevents a test-only model.
export const mergeContinuePrefs = (base, operations) => applyOps(base, operations);

export function hydrateContinuePrefs(cloud) {
  selectOwner();
  const local = state.user?.uid ? cached(state.user.uid) : null;
  if (!pendingOps.length && Array.isArray(local?.pendingOps)) {
    pendingOps = local.pendingOps.filter(op => op && typeof op === 'object').slice(-CAP);
  }
  const chosen = cloud === null ? local : (pendingOps.length ? applyOps(cloud, pendingOps) : cloud);
  state.continuePrefs = normalizePrefs(chosen);
  mirror();
  if (cloud !== null && pendingOps.length) flush(state.user?.uid);
}

export const isPinned = id => prefs().pinned.includes(normal(id));
export const isHidden = id => prefs().hidden.includes(normal(id));
export const hasContinueEdits = () => prefs().pinned.length > 0 || prefs().hidden.length > 0;

export function applyContinuePrefs(queue) {
  const { pinned, hidden } = prefs();
  const visible = queue.filter(row => !hidden.includes(normal(row.key || row.id)));
  if (!pinned.length) return visible;
  const rank = new Map(pinned.map((id, index) => [id, index]));
  const first = visible.filter(row => rank.has(normal(row.key || row.id)))
    .sort((a, b) => rank.get(normal(a.key || a.id)) - rank.get(normal(b.key || b.id)));
  return [...first, ...visible.filter(row => !rank.has(normal(row.key || row.id)))];
}

function save(operation) {
  selectOwner();
  const at = Date.now();
  prefs().clientUpdatedAt = at;
  pendingOps.push({ ...operation, at, id: `${at}_${Math.random().toString(36).slice(2, 8)}` });
  pendingOps = pendingOps.slice(-CAP);
  mirror();
  document.dispatchEvent(new Event('cv:continue-prefs'));
  const uid = state.user?.uid;
  if (!uid) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flush(uid), 180);
}

export function togglePinned(id) {
  const key = normal(id); if (!key) return false;
  const list = prefs().pinned, index = list.indexOf(key), pin = index < 0;
  if (pin) list.unshift(key); else list.splice(index, 1);
  prefs().pinned = list.slice(0, CAP);
  save({ type: 'pin', key, value: pin });
  return pin;
}

export function moveContinue(id, direction, visibleIds) {
  const target = normal(id), order = visibleIds.map(normal).filter(Boolean);
  const from = order.indexOf(target), to = from + (direction < 0 ? -1 : 1);
  if (from < 0 || to < 0 || to >= order.length) return false;
  order.splice(to, 0, ...order.splice(from, 1));
  prefs().pinned = order.slice(0, Math.max(to + 1, prefs().pinned.length)).slice(0, CAP);
  save({ type: 'order', value: prefs().pinned });
  return true;
}

export function toggleHidden(id) {
  const key = normal(id); if (!key) return false;
  const { hidden, pinned } = prefs(), index = hidden.indexOf(key), hide = index < 0;
  if (hide) {
    hidden.unshift(key);
    const pinIndex = pinned.indexOf(key); if (pinIndex >= 0) pinned.splice(pinIndex, 1);
  } else hidden.splice(index, 1);
  prefs().hidden = hidden.slice(0, CAP);
  save({ type: 'hide', key, value: hide });
  return hide;
}

export function resetContinuePrefs() {
  state.continuePrefs = { pinned: [], hidden: [], clientUpdatedAt: Date.now() };
  save({ type: 'reset' });
}

async function flush(uid) {
  if (!uid || state.user?.uid !== uid || !pendingOps.length) return;
  const batch = [...pendingOps], ids = new Set(batch.map(op => op.id));
  const ref = db.collection('users').doc(uid);
  try {
    const committed = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const remote = snapshot.exists ? snapshot.data()?.continueWatching : null;
      const value = applyOps(remote, batch);
      transaction.set(ref, { continueWatching: { ...value, updatedAt: firebase.firestore.FieldValue.serverTimestamp() } }, { merge: true });
      return value;
    });
    if (state.user?.uid !== uid) return;
    pendingOps = pendingOps.filter(op => !ids.has(op.id));
    state.continuePrefs = pendingOps.length ? applyOps(committed, pendingOps) : normalizePrefs(committed);
    mirror(uid);
    document.dispatchEvent(new Event('cv:continue-prefs'));
    if (pendingOps.length) flush(uid);
  } catch (error) {
    console.warn('continue prefs save', error);
    mirror(uid);
  }
}

/** Keep the layout live on every signed-in device, including already-open tabs. */
export function initContinuePrefsSync() {
  document.addEventListener('cv:auth', () => {
    unsubscribe?.(); unsubscribe = null;
    const uid = state.user?.uid;
    selectOwner(uid || '');
    if (!uid) return;
    unsubscribe = db.collection('users').doc(uid).onSnapshot(snapshot => {
      if (state.user?.uid !== uid) return;
      hydrateContinuePrefs(snapshot.exists ? (snapshot.data()?.continueWatching || {}) : {});
      document.dispatchEvent(new Event('cv:continue-prefs'));
    }, error => console.warn('continue prefs live sync', error));
  });
}
