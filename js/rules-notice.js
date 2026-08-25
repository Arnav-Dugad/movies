// ===== "THE RULES ARE NOT PUBLISHED YET" =====
// Firestore denies a write to a collection the deployed rules do not declare.
// The client is offline-first, so the write simply never lands: the feature keeps
// working on the device that made it and silently does not exist on any other.
// That is exactly how the same account shows a different Continue Watching rail
// on a phone and a laptop, with no error anywhere to explain it.
//
// A denial is never normal for an owner writing to their own document, so it is
// surfaced once per session, per collection, naming the collection and the fix.
// Nothing here retries or works around the denial — the rules have to be
// published, and pretending otherwise would hide the real problem for longer.
import { toast } from './ui.js';

const announced = new Set();

export const isPermissionDenied = error =>
  error?.code === 'permission-denied'
  || /permission[-_ ]denied|insufficient permissions/i.test(String(error?.message || ''));

/**
 * @param {unknown} error   the rejection from a Firestore write
 * @param {string} what     the subcollection it was writing to
 * @returns {boolean}       whether this was a rules denial
 */
export function reportRulesDenial(error, what) {
  if (!isPermissionDenied(error)) return false;
  console.error(
    `[CineVerse] Firestore denied a write to "${what}". The published security rules ` +
    'are older than this build. Copy firestore.rules into Firebase Console → Firestore ' +
    'Database → Rules → Publish. Until then this feature cannot sync between devices.',
    error,
  );
  if (announced.has(what)) return true;
  announced.add(what);
  toast(`${what} cannot sync yet — Firestore rules need publishing`, 'error');
  return true;
}

/** Test seam, and a reset when the account changes. */
export function resetRulesNotices() { announced.clear(); }
