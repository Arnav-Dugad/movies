// Collection completion. The rule that everything else follows from: an
// unreleased entry is never counted against you, so a percentage can always
// reach 100 and "complete" means what it says.
import { check, summary } from './harness.mjs';

// Resolved from this file so the suite runs from any checkout, on any OS.
const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const fr = await import(SRC + 'franchise.js');

const now = Date.parse('2026-08-22T12:00:00Z');
const day = 86400000;
const iso = ms => new Date(ms).toISOString().slice(0, 10);

// A four-film series: three out, one announced for next year.
const parts = [
  { id: 101, title: 'One', release_date: '2010-06-01' },
  { id: 102, title: 'Two', release_date: '2013-06-01' },
  { id: 103, title: 'Three', release_date: '2016-06-01' },
  { id: 104, title: 'Four', release_date: iso(now + 200 * day) },
];

state.user = { uid: 'u1' };
state.watchlist = [];

// ---------- released-only accounting ----------
state.watched = { movie_101: { tmdbId: 101, type: 'movie', title: 'One' } };
let p = fr.collectionProgress(parts, { now });
check('total counts every entry', p.total === 4, p.total);
check('released excludes the unreleased entry', p.released === 3, p.released);
check('upcoming names the unreleased entry', p.upcoming === 1, p.upcoming);
check('seen counts only watched released entries', p.seen === 1, p.seen);
check('percent is measured against released entries', Math.abs(p.percent - (1 / 3) * 100) < 1e-9, p.percent);
check('nextUp is the earliest unwatched released entry', p.nextUp?.id === 102, p.nextUp?.id);
check('unseen lists the remaining released entries in order',
  p.unseen.map(x => x.id).join(',') === '102,103', p.unseen.map(x => x.id).join(','));
check('a partly-seen collection is not complete', p.complete === false);

// Watching an UNRELEASED entry cannot happen, and must not inflate the count.
state.watched = { movie_101: {}, movie_104: {} };
p = fr.collectionProgress(parts, { now });
check('a watched-but-unreleased entry does not raise the count', p.seen === 1, p.seen);
check('and cannot push the percentage over 100', p.percent <= 100, p.percent);

// ---------- completion ----------
state.watched = { movie_101: {}, movie_102: {}, movie_103: {} };
p = fr.collectionProgress(parts, { now });
check('every released entry watched reads as complete', p.complete === true);
check('completion is 100% even with a sequel announced', p.percent === 100, p.percent);
check('nextUp is null once there is nothing left out', p.nextUp === null);
check('the label says "complete so far" when more is coming',
  fr.progressLabel(p) === 'Complete so far', fr.progressLabel(p));

const allOut = parts.slice(0, 3);
check('the label says plain "complete" when nothing is pending',
  fr.progressLabel(fr.collectionProgress(allOut, { now })) === 'Complete');
state.watched = { movie_101: {} };
check('an in-progress label counts released entries',
  fr.progressLabel(fr.collectionProgress(parts, { now })) === '1 of 3 seen',
  fr.progressLabel(fr.collectionProgress(parts, { now })));

// ---------- degenerate input ----------
check('an empty parts list is zeroed, not NaN', (() => {
  const e = fr.collectionProgress([], { now });
  return e.total === 0 && e.released === 0 && e.percent === 0 && e.complete === false && e.nextUp === null;
})());
check('a null parts list is handled', fr.collectionProgress(null, { now }).total === 0);
check('entries without ids are dropped', fr.collectionProgress([{ title: 'ghost' }, ...parts], { now }).total === 4);
check('an empty collection is never "complete"', fr.collectionProgress([], { now }).complete === false);
check('progressLabel on an empty collection is blank', fr.progressLabel(fr.collectionProgress([], { now })) === '');
check('a missing progress object does not throw', fr.progressLabel(null) === '');

// A part with no release date at all: treated as out, rather than hidden.
const undated = [{ id: 201, title: 'Undated' }, { id: 202, title: 'Old', release_date: '1999-01-01' }];
state.watched = { movie_201: {}, movie_202: {} };
check('an entry with no date counts as released', fr.collectionProgress(undated, { now }).released === 2);
check('and a fully-seen undated collection is complete', fr.collectionProgress(undated, { now }).complete === true);
check('an unparseable date is treated as released',
  fr.collectionProgress([{ id: 301, release_date: 'not-a-date' }], { now }).released === 1);

// A same-day release is out, not pending.
check('a release dated today counts as released',
  fr.collectionProgress([{ id: 401, release_date: iso(now) }], { now }).released === 1);

// ---------- grouping the watch history ----------
state.watched = {
  movie_1: { tmdbId: 1, type: 'movie', title: 'A', collectionId: 10, collectionName: 'Alpha', collectionPoster: '/a.jpg' },
  movie_2: { tmdbId: 2, type: 'movie', title: 'B', collectionId: 10 },
  movie_3: { tmdbId: 3, type: 'movie', title: 'C', collectionId: 20, collectionName: 'Beta' },
  movie_4: { tmdbId: 4, type: 'movie', title: 'D' },                       // no collection
  movie_5: { tmdbId: 5, type: 'movie', title: 'E', collectionId: 0 },      // explicit none
  tv_6: { tmdbId: 6, type: 'tv', title: 'Show', collectionId: 30 },        // TV has no collections
};
const groups = fr.watchedCollections();
check('only titles with a collection are grouped', groups.length === 2, groups.length);
check('TV entries are excluded from franchises', groups.every(g => g.id !== 30));
check('the largest group comes first', groups[0].id === 10 && groups[0].seen.length === 2);
check('a name found on any member is used for the group', groups[0].name === 'Alpha');
check('a poster found on any member is used for the group', groups[0].poster === '/a.jpg');
check('a group carries the keys it was built from',
  groups[0].seen.map(x => x.key).sort().join(',') === 'movie_1,movie_2');

state.watched = {};
check('an empty history produces no franchises', fr.watchedCollections().length === 0);

summary();
