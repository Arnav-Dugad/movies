import { check, summary } from './harness.mjs';

// Resolved from this file so the suite runs from any checkout, on any OS.
const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const ep = await import(SRC + 'episodes.js');

state.user = { uid: 'u1' };
state.watched = {};
state.episodeProgress = {};

const META = {
  title: 'Test Show', poster: '/p.jpg', backdrop: '/b.jpg', episodeRuntime: 45, status: 'Ended',
  structure: { '1': 7, '2': 13, '3': 13 },
  aired: { season: 3, episode: 4 },
};
const FULL = { ...META, structure: { '1': 7, '2': 13 }, aired: { season: 2, episode: 13 } };

// ---------- log honesty ----------
ep.toggleEpisode(1, 1, 1, META);
ep.toggleEpisode(1, 1, 2, META);
let entry = ep.showEntry(1);
check('single ticks are logged', entry.log.length === 2, JSON.stringify(entry.log));
check('single ticks are not flagged bulk', entry.log.every(row => row[3] === 0), JSON.stringify(entry.log));
check('log rows carry season and episode', entry.log[0][0] === 1 && entry.log[0][1] === 1);

ep.toggleEpisode(1, 1, 2, META);
check('un-ticking removes its log row', ep.showEntry(1).log.length === 1, JSON.stringify(ep.showEntry(1).log));

ep.setSeasonWatched(1, 1, true, META);
entry = ep.showEntry(1);
check('bulk season mark is flagged bulk', entry.log.filter(row => row[3] === 1).length === 6, JSON.stringify(entry.log.map(r => r[3])));
check('the original single tick keeps its flag', entry.log.filter(row => row[3] === 0).length === 1);
check('a bulk mark shares one timestamp', new Set(entry.log.filter(row => row[3] === 1).map(row => row[2])).size === 1);

ep.setSeasonWatched(1, 1, false, META);
check('unmarking a season clears its log rows', ep.showEntry(1) === null || !(ep.showEntry(1).log || []).some(row => row[0] === 1));

// ---------- markShowWatched ----------
state.episodeProgress = {};
const added = await ep.markShowWatched(2, META);
check('markShowWatched fills every aired episode', added === 7 + 13 + 4, String(added));
check('progress reads complete', ep.showProgress(2).complete && ep.showProgress(2).percent === 100);
check('unaired episodes stay unmarked', !ep.isEpisodeWatched(2, 3, 5));
check('completedAt is stamped', ep.showEntry(2).completedAt > 0);
check('marking again adds nothing', (await ep.markShowWatched(2, META)) === 0);

// Without a structure and without a fetcher it must decline rather than guess.
state.episodeProgress = {};
check('no structure and no fetcher is a no-op', (await ep.markShowWatched(3, { title: 'X' }, { fetchStructure: null })) === 0 && ep.showEntry(3) === null);
const fetched = await ep.markShowWatched(3, { title: 'X' }, { fetchStructure: async () => META });
check('a fetcher supplies the structure', fetched === 24 && ep.showProgress(3).complete, String(fetched));

// ---------- stampFrom keeps history honest ----------
state.episodeProgress = {};
const threeYearsAgo = Date.now() - 3 * 365 * 86400000;
await ep.markShowWatched(4, FULL, { stampFrom: threeYearsAgo });
const old = ep.showEntry(4);
check('back-filled episodes carry the original date', old.log.every(row => row[2] === threeYearsAgo), String(old.log[0]?.[2]));
check('back-filled episodes are flagged bulk', old.log.every(row => row[3] === 1));
check('lastWatched uses the original date too', old.lastWatched.at === threeYearsAgo);

// ---------- legacy back-fill ----------
state.episodeProgress = {};
state.watched = {
  tv_10: { tmdbId: 10, type: 'tv', title: 'Legacy One', watchedAt: { seconds: Math.floor(threeYearsAgo / 1000) } },
  tv_11: { tmdbId: 11, type: 'tv', title: 'Legacy Two', watchedAt: { seconds: Math.floor(Date.now() / 1000) } },
  movie_12: { tmdbId: 12, type: 'movie', title: 'A Film' },
};
check('pending legacy shows finds only TV', ep.pendingLegacyShows().map(row => row.id).sort().join(',') === '10,11', JSON.stringify(ep.pendingLegacyShows().map(r => r.id)));

let fetches = 0;
const result = await ep.backfillLegacyShows(async id => { fetches++; return FULL; });
check('back-fill filled both shows', result.filled === 2, JSON.stringify(result));
check('back-fill counted episodes', result.episodes === 40, String(result.episodes));
check('it fetched once per show', fetches === 2, String(fetches));
check('legacy show 10 now reads complete', ep.showProgress(10).complete);
check('legacy show 11 now reads complete', ep.showProgress(11).complete);
// Firestore stores seconds, so the round trip is second-precision by design.
check('show 10 kept its original watch date', Math.abs(ep.showEntry(10).log[0][2] - threeYearsAgo) < 1000, String(ep.showEntry(10).log[0][2] - threeYearsAgo));
check('nothing is pending afterwards', ep.pendingLegacyShows().length === 0);

const second = await ep.backfillLegacyShows(async () => FULL);
check('a second run does nothing', second.filled === 0);

// A show TMDB cannot resolve is recorded so it is not retried forever.
state.watched.tv_13 = { tmdbId: 13, type: 'tv', title: 'Gone' };
const missing = await ep.backfillLegacyShows(async () => null);
check('an unresolvable show is skipped, not filled', missing.filled === 0);
check('and is not offered again', ep.pendingLegacyShows().length === 0);

// ---------- episodeStats ----------
const stats = ep.episodeStats();
check('stats count every episode', stats.episodes === 40, JSON.stringify({ e: stats.episodes }));
check('stats count shows', stats.shows === 2);
check('stats count completions', stats.completed === 2 && stats.inProgress === 0);
check('completion rate is 100%', stats.completionRate === 100);
check('runtime coverage is reported', stats.runtimeCoverage === 100, String(stats.runtimeCoverage));
check('minutes derive from runtime', stats.minutes === 40 * 45, String(stats.minutes));
check('the month series is dense', stats.series.length === 12 && stats.series.every(point => typeof point.count === 'number'));
check('bulk-only history has no binge record', stats.binge === null, JSON.stringify(stats.binge));
check('busiest day is still reported', stats.busiest && stats.busiest.count === 20, JSON.stringify(stats.busiest));
check('byShow is sorted by percent', stats.byShow.length === 2 && stats.byShow[0].percent >= stats.byShow[1].percent);

// A real one-at-a-time session should produce a binge record.
state.episodeProgress = {}; state.watched = {};
for (let index = 1; index <= 5; index++) ep.toggleEpisode(20, 1, index, META);
const binge = ep.episodeStats();
check('single ticks produce a binge record', binge.binge?.count === 5, JSON.stringify(binge.binge));
check('an in-progress show is counted as such', binge.inProgress === 1 && binge.completed === 0);
check('nextUp is carried per show', JSON.stringify(binge.byShow[0].next) === JSON.stringify({ season: 1, episode: 6 }));

// A show with no reported runtime must not inflate the hours figure.
ep.toggleEpisode(21, 1, 1, { ...META, episodeRuntime: 0 });
const mixed = ep.episodeStats();
check('unknown runtime is excluded from minutes', mixed.minutes === 5 * 45, String(mixed.minutes));
check('and coverage says so', mixed.runtimeCoverage === Math.round(5 / 6 * 100), String(mixed.runtimeCoverage));

summary();
