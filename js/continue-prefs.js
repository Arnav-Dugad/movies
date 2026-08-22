// ===== CONTINUE WATCHING: PINS, HIDES, AND ORDER =====
// The rail ordered itself strictly by what was watched most recently, which is a
// good default and a bad rule. Somebody working through one show while dipping
// into three others wants the one they are committed to first, and a show they
// have abandoned gone entirely — without losing the episode progress, which is a
// separate fact about what they have seen.
//
// Two lists do all of it:
//
//   pinned  ordered ids that come first, in exactly that order
//   hidden  ids the rail never shows
//
// Moving a card IS pinning it to that position, so arbitrary ordering and
// "keep this at the front" are one concept rather than two. Unpin and a show
// returns to the automatic order, in the right place, with nothing to undo.
import { db } from './firebase.js';
import { state } from './state.js';

const CAP = 40;
let saveTimer = null;

const clean = value => [...new Set((Array.isArray(value) ? value : []).map(Number).filter(id => Number.isInteger(id) && id > 0))].slice(0, CAP);

export function hydrateContinuePrefs(cloud) {
  state.continuePrefs = {
    pinned: clean(cloud?.pinned),
    hidden: clean(cloud?.hidden),
  };
}

const prefs = () => (state.continuePrefs ||= { pinned: [], hidden: [] });

export const isPinned = id => prefs().pinned.includes(+id);
export const isHidden = id => prefs().hidden.includes(+id);
export const hasContinueEdits = () => prefs().pinned.length > 0 || prefs().hidden.length > 0;

/**
 * Apply the two lists to a queue that is already in recency order.
 * Pinned shows lead in their stored order; everything else keeps the order it
 * arrived in, so unpinning never scrambles the rest of the rail.
 */
export function applyContinuePrefs(queue) {
  const { pinned, hidden } = prefs();
  const visible = queue.filter(row => !hidden.includes(+row.id));
  if (!pinned.length) return visible;
  const rank = new Map(pinned.map((id, index) => [id, index]));
  const first = visible.filter(row => rank.has(+row.id)).sort((a, b) => rank.get(+a.id) - rank.get(+b.id));
  const rest = visible.filter(row => !rank.has(+row.id));
  return [...first, ...rest];
}

// ---------- mutations ----------
export function togglePinned(id) {
  const list = prefs().pinned, index = list.indexOf(+id);
  if (index >= 0) list.splice(index, 1);
  else list.unshift(+id);          // a newly pinned show goes to the front
  prefs().pinned = list.slice(0, CAP);
  save();
  return isPinned(id);
}

/**
 * Move a show one place along the rail. A show that was following the automatic
 * order becomes pinned at the position it just moved to — which is the only way
 * a manual position can survive the next episode being ticked elsewhere.
 */
export function moveContinue(id, direction, visibleIds) {
  const target = +id;
  const order = visibleIds.map(Number);
  const from = order.indexOf(target);
  const to = from + (direction < 0 ? -1 : 1);
  if (from < 0 || to < 0 || to >= order.length) return false;
  order.splice(to, 0, ...order.splice(from, 1));
  // Everything up to and including the moved card is now explicit; leaving the
  // tail automatic would let it reshuffle around a position the user just chose.
  prefs().pinned = order.slice(0, Math.max(to + 1, prefs().pinned.length)).slice(0, CAP);
  save();
  return true;
}

export function toggleHidden(id) {
  const { hidden, pinned } = prefs();
  const index = hidden.indexOf(+id);
  if (index >= 0) hidden.splice(index, 1);
  else {
    hidden.unshift(+id);
    // A hidden show has no position to hold on to.
    const pinIndex = pinned.indexOf(+id);
    if (pinIndex >= 0) pinned.splice(pinIndex, 1);
  }
  prefs().hidden = hidden.slice(0, CAP);
  save();
  return isHidden(id);
}

export function resetContinuePrefs() {
  state.continuePrefs = { pinned: [], hidden: [] };
  save();
}

// One debounced write on the profile document, which sign-in already reads — so
// remembering the layout costs no extra read and at most one write per session.
function save() {
  document.dispatchEvent(new Event('cv:continue-prefs'));
  const uid = state.user?.uid;
  if (!uid) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (state.user?.uid !== uid) return;
    db.collection('users').doc(uid).set({ continueWatching: prefs() }, { merge: true })
      .catch(error => console.warn('continue prefs save', error));
  }, 900);
}
