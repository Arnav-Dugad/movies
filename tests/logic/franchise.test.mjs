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

// ================= TV FAMILIES =================
// Name-derived, so the tests that matter are the ones about what it REFUSES to
// group. A false family is worse than a missed one: it invents a franchise and
// then reports the viewer as behind on it.
check('a colon declares a stem', fr.titleStem('Star Trek: Discovery') === 'Star Trek', fr.titleStem('Star Trek: Discovery'));
check('an em dash declares a stem', fr.titleStem('Fargo — Year Two') === 'Fargo');
check('a spaced hyphen declares a stem', fr.titleStem('Doctor Who - Series 1') === 'Doctor Who');
check('a plain title declares nothing', fr.titleStem('Breaking Bad') === '');
check('a hyphenated word is not a separator', fr.titleStem('Spider-Man') === '');
check('a comma is not a separator', fr.titleStem('Love, Death & Robots') === '');
check('a two-character stem is rejected', fr.titleStem('A: Something') === '');
check('an empty or missing title is handled', fr.titleStem('') === '' && fr.titleStem(null) === '' && fr.titleStem(undefined) === '');
check('a colon with nothing after it is not a stem', fr.titleStem('Weird:') === '');
check('a one-word stem is allowed when it is long enough', fr.titleStem('Alien: Earth') === 'Alien');

const tvWatched = {
  tv_1: { tmdbId: 1, type: 'tv', title: 'Star Trek: Discovery', poster: '/d.jpg' },
  tv_2: { tmdbId: 2, type: 'tv', title: 'Star Trek: Picard' },
  tv_3: { tmdbId: 3, type: 'tv', title: 'Star Trek' },              // joins by exact stem
  tv_4: { tmdbId: 4, type: 'tv', title: 'Breaking Bad' },           // declares nothing
  tv_5: { tmdbId: 5, type: 'tv', title: 'Fargo: Season Two' },      // only one member
  movie_6: { tmdbId: 6, type: 'movie', title: 'Star Trek: Nemesis' }, // wrong medium
};
const families = fr.tvFamilies({ watched: tvWatched });
check('a family forms from two declared members plus the bare title',
  families.length === 1 && families[0].name === 'Star Trek' && families[0].seen.length === 3,
  JSON.stringify(families.map(f => [f.name, f.seen.length])));
check('a title declaring nothing stays out', !families[0].seen.some(s => s.title === 'Breaking Bad'));
check('a film is never pulled into a TV family', !families[0].seen.some(s => s.key === 'movie_6'));
check('a family of one is not a family', !families.some(f => f.name === 'Fargo'));
check('a family carries the poster it has', families[0].seen.some(s => s.poster === '/d.jpg'));

check('a library with no declared stems produces no families',
  fr.tvFamilies({ watched: { tv_1: { tmdbId: 1, type: 'tv', title: 'Severance' }, tv_2: { tmdbId: 2, type: 'tv', title: 'Andor' } } }).length === 0);
check('an empty library produces no families', fr.tvFamilies({ watched: {} }).length === 0);
check('a bare title with no matching stem does not start a family',
  fr.tvFamilies({ watched: { tv_1: { tmdbId: 1, type: 'tv', title: 'Star Trek' }, tv_2: { tmdbId: 2, type: 'tv', title: 'Star Trek' } } }).length === 0);

// Case and punctuation must not split one family in two.
const cased = fr.tvFamilies({ watched: {
  tv_1: { tmdbId: 1, type: 'tv', title: 'Law & Order: SVU' },
  tv_2: { tmdbId: 2, type: 'tv', title: 'LAW AND ORDER: Criminal Intent' },
} });
check('folding ignores case and punctuation when matching stems',
  cased.length === 1 && cased[0].seen.length === 2, JSON.stringify(cased.map(f => [f.name, f.seen.length])));

summary();
