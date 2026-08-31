// Two devices, one show. The property that matters: edits to DIFFERENT episodes
// never lose each other, and an un-tick never comes back from the dead.
//
// Before tombstones existed the document was written whole, so the second device
// to write silently erased the first one's tick. Unioning the watched sets would
// have fixed that and broken un-ticking instead, because a union cannot tell
// "has not seen it yet" from "deliberately removed it".
import { check, summary } from './harness.mjs';

// Resolved from this file so the suite runs from any checkout, on any OS.
const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const ep = await import(SRC + 'episodes.js');

state.user = { uid: 'u1' };
state.watched = {};
state.episodeProgress = {};

const SHOW = {
  title: 'Merge', poster: '/p.jpg', episodeRuntime: 45,
  structure: { '1': 10, '2': 10 },
  aired: { season: 2, episode: 10 },
};

// Build a document the way a device would, then take it away so the next one
// starts clean — the module keeps one global map, not one per device.
// `at` pins updatedAt: documents built back to back can otherwise land in the
// same millisecond, and "which device edited last" is the merge's tie-break.
// Stating it makes each test's scenario explicit instead of clock-dependent.
function device(build, at = 0) {
  state.episodeProgress = {};
  build();
  const entry = ep.showEntry(1);
  const copy = entry ? JSON.parse(JSON.stringify(entry)) : null;
  if (copy && at) copy.updatedAt = at;
  state.episodeProgress = {};
  return copy;
}
const T0 = 1_700_000_000_000;

const watchedOf = (entry, season) => (entry?.seasons || {})[String(season)] || [];
const removedOf = (entry, season) => (entry?.removed || {})[String(season)] || [];

// ================= the bug this exists to fix ==============================
let phone = device(() => { ep.toggleEpisode(1, 1, 1, SHOW); ep.toggleEpisode(1, 1, 2, SHOW); });
let laptop = device(() => { ep.toggleEpisode(1, 1, 3, SHOW); ep.toggleEpisode(1, 1, 4, SHOW); });

let merged = ep.mergeEntries(phone, laptop);
check('ticks made on two devices are both kept',
  watchedOf(merged, 1).join(',') === '1,2,3,4', watchedOf(merged, 1).join(','));
check('the merge is order-independent',
  JSON.stringify(watchedOf(ep.mergeEntries(laptop, phone), 1)) === JSON.stringify(watchedOf(merged, 1)));
check('merging is idempotent',
  JSON.stringify(watchedOf(ep.mergeEntries(merged, merged), 1)) === '[1,2,3,4]',
  JSON.stringify(watchedOf(ep.mergeEntries(merged, merged), 1)));

// ================= an un-tick is not resurrected ===========================
// The laptop has seen episodes 1-4. The phone has un-ticked 2. A union would put
// it back; the tombstone is what stops that.
const seenAll = device(() => ep.markUpTo(1, 1, 4, SHOW), T0);
const unticked = device(() => { ep.markUpTo(1, 1, 4, SHOW); ep.toggleEpisode(1, 1, 2, SHOW); }, T0 + 1000);
check('the un-ticking device recorded a tombstone', removedOf(unticked, 1).includes(2));

merged = ep.mergeEntries(seenAll, unticked);
check('an un-tick survives a merge with a device that still has it',
  !watchedOf(merged, 1).includes(2) && watchedOf(merged, 1).join(',') === '1,3,4',
  watchedOf(merged, 1).join(','));
check('and the tombstone is carried forward', removedOf(merged, 1).includes(2));
check('the same result whichever way round',
  !watchedOf(ep.mergeEntries(unticked, seenAll), 1).includes(2),
  watchedOf(ep.mergeEntries(unticked, seenAll), 1).join(','));

// Re-ticking on the other device clears the tombstone and wins, because it is
// the more recent edit.
const reticked = JSON.parse(JSON.stringify(unticked));
state.episodeProgress = { tv_1: reticked };
ep.toggleEpisode(1, 1, 2, SHOW);
const back = JSON.parse(JSON.stringify(ep.showEntry(1)));
back.updatedAt = T0 + 2000;                      // the re-tick came after the un-tick
state.episodeProgress = {};
check('re-ticking clears the tombstone', !removedOf(back, 1).includes(2));
check('and the episode is watched again', watchedOf(back, 1).includes(2));
check('a merge with the older copy keeps it watched',
  watchedOf(ep.mergeEntries(unticked, back), 1).includes(2));

// ================= whole-season clear propagates ===========================
// The clearing device acted last; the other one has simply not caught up.
const stillHas = device(() => ep.setSeasonWatched(1, 1, true, SHOW), T0);
const cleared = device(() => { ep.setSeasonWatched(1, 1, true, SHOW); ep.setSeasonWatched(1, 1, false, SHOW); }, T0 + 1000);
check('clearing a season tombstones every episode it held',
  removedOf(cleared, 1).length === 10, removedOf(cleared, 1).length);
merged = ep.mergeEntries(stillHas, cleared);
check('a cleared season stays cleared after merging with a device that has it',
  watchedOf(merged, 1).length === 0, JSON.stringify(watchedOf(merged, 1)));

// An explicit reset is an intent too, not an absence.
const stale = device(() => ep.markUpTo(1, 2, 10, SHOW), T0);
const reset = device(() => { ep.markUpTo(1, 2, 10, SHOW); ep.clearShowProgress(1); }, T0 + 1000);
check('reset records tombstones rather than deleting the document', reset !== null);
check('reset clears everything watched',
  watchedOf(reset, 1).length === 0 && watchedOf(reset, 2).length === 0);
check('a device that has not edited since cannot undo the reset',
  ep.mergeEntries(stale, reset).seasons['1'] === undefined,
  JSON.stringify(ep.mergeEntries(stale, reset).seasons));
// The reverse is the intended behaviour, not a bug: a device that ticked
// episodes AFTER the reset is expressing the later intent.
const afterReset = device(() => ep.markUpTo(1, 1, 3, SHOW), T0 + 5000);
check('but an edit made after the reset does win',
  ep.mergeEntries(reset, afterReset).seasons['1'].join(',') === '1,2,3',
  JSON.stringify(ep.mergeEntries(reset, afterReset).seasons));

// A genuine tie — two devices editing the same episode in the same millisecond —
// resolves to removal, deterministically and in both directions.
const tieWatched = device(() => ep.toggleEpisode(1, 1, 5, SHOW), T0);
const tieRemoved = device(() => { ep.toggleEpisode(1, 1, 5, SHOW); ep.toggleEpisode(1, 1, 5, SHOW); }, T0);
check('a same-millisecond conflict resolves to removal',
  !watchedOf(ep.mergeEntries(tieWatched, tieRemoved), 1).includes(5));
check('and resolves the same way in the other direction',
  !watchedOf(ep.mergeEntries(tieRemoved, tieWatched), 1).includes(5));

// ================= seasons in isolation ====================================
const s1 = device(() => ep.setSeasonWatched(1, 1, true, SHOW));
const s2 = device(() => ep.setSeasonWatched(1, 2, true, SHOW));
merged = ep.mergeEntries(s1, s2);
check('two devices working on different seasons keep both',
  watchedOf(merged, 1).length === 10 && watchedOf(merged, 2).length === 10,
  `${watchedOf(merged, 1).length}/${watchedOf(merged, 2).length}`);
check('and the show reads as caught up', (state.episodeProgress = { tv_1: merged }, ep.showProgress(1).caughtUp) === true);
state.episodeProgress = {};

// ================= metadata and history ====================================
const rich = device(() => ep.toggleEpisode(1, 1, 1, { ...SHOW, structure: { '1': 10, '2': 10, '3': 8 } }));
const thin = device(() => ep.toggleEpisode(1, 1, 2, { title: 'Merge' }));
merged = ep.mergeEntries(thin, rich);
check('the fuller structure wins regardless of which wrote last',
  Object.keys(merged.structure).length === 3, JSON.stringify(merged.structure));
check('a title is never lost to a thinner document', merged.title === 'Merge');
check('a poster is never lost to a thinner document', merged.poster === '/p.jpg');

check('log rows from both devices are kept',
  ep.mergeEntries(phone, laptop).log.length === 4, ep.mergeEntries(phone, laptop).log.length);
check('a duplicated log row is collapsed to one',
  ep.mergeEntries(phone, phone).log.length === 2, ep.mergeEntries(phone, phone).log.length);
check('the earliest stamp survives deduplication', (() => {
  const early = { ...phone, log: [[1, 1, 1000, 0], [1, 2, 2000, 0]] };
  const late = { ...phone, log: [[1, 1, 9000, 0], [1, 2, 2000, 0]] };
  const out = ep.mergeEntries(early, late);
  return out.log.find(row => row[1] === 1)[2] === 1000;
})());

// Rewatch counts only ever climb, so the higher number has seen more history.
const played = device(() => { ep.setSeasonWatched(1, 1, true, SHOW); ep.logSeasonRewatch(1, 1, SHOW); ep.logSeasonRewatch(1, 1, SHOW); });
const once = device(() => ep.setSeasonWatched(1, 1, true, SHOW));
check('the higher season rewatch count wins', ep.mergeEntries(once, played).seasonPlays['1'] === 3,
  JSON.stringify(ep.mergeEntries(once, played).seasonPlays));
check('and it does not matter which side holds it',
  ep.mergeEntries(played, once).seasonPlays['1'] === 3);

// ================= completion dates ========================================
check('the earliest finish date wins', (() => {
  const a = { ...seenAll, completedAt: 5000 }, b = { ...seenAll, completedAt: 9000 };
  return ep.mergeEntries(a, b).completedAt === 5000;
})());
check('a missing finish date does not become Infinity', (() => {
  const out = ep.mergeEntries({ ...seenAll, completedAt: 0 }, { ...seenAll, completedAt: 0 });
  return out.completedAt === 0 && Number.isFinite(out.completedAt);
})());
check('one side having a date is enough', (() => {
  const out = ep.mergeEntries({ ...seenAll, completedAt: 0 }, { ...seenAll, completedAt: 7000 });
  return out.completedAt === 7000;
})());
check('a newer episode arrival can clear stale completion milestones', (() => {
  const finished = { ...seenAll, caughtUpAt: 5000, completedAt: 5000, updatedAt: 100 };
  const reopened = { ...seenAll, caughtUpAt: 0, completedAt: 0, updatedAt: 200 };
  const out = ep.mergeEntries(finished, reopened);
  return out.caughtUpAt === 0 && out.completedAt === 0;
})());

// ================= degenerate input ========================================
check('merging with nothing on the server returns the local copy', ep.mergeEntries(null, phone) === phone);
check('merging with no local copy returns the server copy', ep.mergeEntries(phone, null) === phone);
check('merging two empty documents does not throw',
  JSON.stringify(ep.mergeEntries({ seasons: {} }, { seasons: {} }).seasons) === '{}');
check('watched and removed never overlap after a merge', (() => {
  const out = ep.mergeEntries(seenAll, unticked);
  for (const season of Object.keys(out.seasons || {})) {
    const watched = new Set(out.seasons[season]);
    if ((out.removed?.[season] || []).some(episode => watched.has(episode))) return false;
  }
  return true;
})());

// ================= dropping a show ==========================================
// "I walked away from this" and "I picked it back up" are both decisions, so a
// merge has to be able to tell them apart from a device that simply has not
// heard about either yet.

let dropPhone = device(() => { ep.toggleEpisode(1, 1, 1, SHOW); ep.setDropped(1, true, SHOW); }, T0 + 2000);
let dropLaptop = device(() => { ep.toggleEpisode(1, 1, 1, SHOW); }, T0 + 1000);

check('a drop reaches a device that never saw it',
  ep.mergeEntries(dropLaptop, dropPhone).dropped === true);
check('and that is order-independent',
  ep.mergeEntries(dropPhone, dropLaptop).dropped === true);

// The newer document decides. A device still holding the drop must not undo a
// later change of mind.
let resumed = device(() => { ep.toggleEpisode(1, 1, 1, SHOW); ep.setDropped(1, true, SHOW); ep.setDropped(1, false, SHOW); }, T0 + 3000);
check('picking a show back up beats an older device still holding the drop',
  ep.mergeEntries(dropPhone, resumed).dropped === false);
check('and that is order-independent',
  ep.mergeEntries(resumed, dropPhone).dropped === false);

// An exact tie has no "newer", so both sides must agree — which errs toward the
// show staying visible, the smaller mistake of the two.
let tieDropped = device(() => { ep.toggleEpisode(1, 1, 1, SHOW); ep.setDropped(1, true, SHOW); }, T0 + 5000);
let tieWatching = device(() => { ep.toggleEpisode(1, 1, 2, SHOW); }, T0 + 5000);
check('an exact tie leaves the show in Continue Watching',
  ep.mergeEntries(tieDropped, tieWatching).dropped === false);
check('a tie where both agree keeps it dropped',
  ep.mergeEntries(tieDropped, device(() => { ep.toggleEpisode(1, 1, 2, SHOW); ep.setDropped(1, true, SHOW); }, T0 + 5000)).dropped === true);
check('the tie-break is symmetric',
  ep.mergeEntries(tieWatching, tieDropped).dropped === ep.mergeEntries(tieDropped, tieWatching).dropped);

check('dropping never loses an episode the viewer watched',
  watchedOf(ep.mergeEntries(dropPhone, dropLaptop), 1).join(',') === '1',
  watchedOf(ep.mergeEntries(dropPhone, dropLaptop), 1).join(','));
check('the decision timestamp survives the merge',
  ep.mergeEntries(dropLaptop, dropPhone).droppedAt === dropPhone.droppedAt);
check('merging a drop is idempotent', (() => {
  const once = ep.mergeEntries(dropPhone, dropLaptop);
  return ep.mergeEntries(once, once).dropped === once.dropped;
})());

// A document holding only "I dropped this" still has something to say.
state.episodeProgress = {};
ep.setDropped(1, true, SHOW);
check('a show can be dropped without a single episode ticked',
  ep.showEntry(1)?.dropped === true, JSON.stringify(ep.showEntry(1)?.dropped));
state.episodeProgress = {};

summary();
