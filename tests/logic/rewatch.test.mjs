// Rewatch tracking. The load-bearing property is that entries written before
// this feature existed read as exactly one viewing — no migration, no zeros, and
// no title silently dropping out of a total.
import { check, summary } from './harness.mjs';

// Resolved from this file so the suite runs from any checkout, on any OS.
const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const rw = await import(SRC + 'rewatch.js');

const DAY = 86400000;
const secs = ms => ({ seconds: Math.floor(ms / 1000) });
const now = Date.now();

state.user = { uid: 'u1' };
state.watchlist = [];

// ---------- legacy shapes ----------
state.watched = {
  // No `plays` at all: the shape every existing account has.
  movie_1: { tmdbId: 1, type: 'movie', title: 'Legacy', runtime: 100, watchedAt: secs(now - 40 * DAY) },
  // A Firestore Timestamp rather than the {seconds} mirror.
  movie_2: { tmdbId: 2, type: 'movie', title: 'Stamped', runtime: 90, watchedAt: { toMillis: () => now - 10 * DAY } },
  // Explicitly rewatched.
  movie_3: { tmdbId: 3, type: 'movie', title: 'Repeat', runtime: 120, watchedAt: secs(now - 100 * DAY), plays: 3, playDates: [now - 100 * DAY, now - 50 * DAY, now - 2 * DAY] },
  // Garbage in the count field must not erase the viewing.
  movie_4: { tmdbId: 4, type: 'movie', title: 'Junk', runtime: 80, watchedAt: secs(now - 5 * DAY), plays: 'abc' },
  movie_5: { tmdbId: 5, type: 'movie', title: 'Zeroed', runtime: 60, watchedAt: secs(now - 6 * DAY), plays: 0 },
  // A TV show, to prove the model is type-agnostic.
  tv_9: { tmdbId: 9, type: 'tv', title: 'Series', runtime: 600, watchedAt: secs(now - 20 * DAY), plays: 2, playDates: [now - 20 * DAY, now - DAY] },
};

check('a doc with no plays field counts as one viewing', rw.playCount('movie_1') === 1, rw.playCount('movie_1'));
check('an unwatched title counts as zero', rw.playCount('movie_404') === 0, rw.playCount('movie_404'));
check('an explicit count is used as-is', rw.playCount('movie_3') === 3, rw.playCount('movie_3'));
check('a non-numeric plays field falls back to one', rw.playCount('movie_4') === 1, rw.playCount('movie_4'));
check('plays: 0 on a watched doc still means one viewing', rw.playCount('movie_5') === 1, rw.playCount('movie_5'));

check('a legacy entry reports its watchedAt as the only play date',
  rw.playDates('movie_1').length === 1 && Math.abs(rw.playDates('movie_1')[0] - (now - 40 * DAY)) < 1000);
check('a Firestore Timestamp resolves through toMillis',
  Math.abs(rw.firstPlayMs(state.watched.movie_2) - (now - 10 * DAY)) < 1000);
check('a bare number watchedAt is accepted', rw.firstPlayMs({ watchedAt: 1234 }) === 1234);
check('a missing watchedAt yields no date', rw.firstPlayMs({}) === 0 && rw.playDates('movie_404').length === 0);

check('play dates come back oldest first', (() => {
  const d = rw.playDates('movie_3');
  return d.length === 3 && d[0] < d[1] && d[1] < d[2];
})());
check('lastPlayMs is the newest date', Math.abs(rw.lastPlayMs('movie_3') - (now - 2 * DAY)) < 1000);
check('lastPlayMs on a single-play title is its first watch',
  Math.abs(rw.lastPlayMs('movie_1') - (now - 40 * DAY)) < 1000);

check('isRewatched is false for one viewing', rw.isRewatched('movie_1') === false);
check('isRewatched is true for three', rw.isRewatched('movie_3') === true);
check('isRewatched is false for an unwatched title', rw.isRewatched('movie_404') === false);

check('playLabel reads naturally at 1, 2, and 3',
  rw.playLabel('movie_1') === 'Seen once' && rw.playLabel('tv_9') === 'Seen twice' && rw.playLabel('movie_3') === 'Seen 3 times',
  `${rw.playLabel('movie_1')} / ${rw.playLabel('tv_9')} / ${rw.playLabel('movie_3')}`);

// ---------- summary arithmetic ----------
// By hand: 6 watched titles. Plays = 1+1+3+1+1+2 = 9. Extra = 0+0+2+0+0+1 = 3.
// Rewatched titles = movie_3 and tv_9 = 2.
const runtimeOf = doc => +doc.runtime || 0;
const s = rw.rewatchSummary({ runtimeOf });

check('titles counts every watched entry', s.titles === 6, s.titles);
check('totalPlays sums the counts', s.totalPlays === 9, s.totalPlays);
check('extraPlays excludes first viewings', s.extraPlays === 3, s.extraPlays);
check('rewatchedTitles counts titles, not plays', s.rewatchedTitles === 2, s.rewatchedTitles);
check('rewatchRate is titles returned to over titles watched',
  Math.abs(s.rewatchRate - (2 / 6) * 100) < 1e-9, s.rewatchRate);
check('repeatShare is repeats over all viewings',
  Math.abs(s.repeatShare - (3 / 9) * 100) < 1e-9, s.repeatShare);
// movie_3: 120 min x 2 extra = 240. tv_9: 600 x 1 = 600. Total 840.
check('extraMinutes multiplies runtime by REPEATS, not by plays', s.extraMinutes === 840, s.extraMinutes);
check('timedTitles reports how many had a known runtime', s.timedTitles === 2, s.timedTitles);
check('the ranking is by play count, highest first',
  s.top.length === 2 && s.top[0].key === 'movie_3' && s.top[1].key === 'tv_9',
  s.top.map(t => t.key).join(','));
check('only rewatched titles appear in the ranking', s.top.every(t => t.plays > 1));
check('a ranked row carries what a card needs',
  s.top[0].id === 3 && s.top[0].type === 'movie' && s.top[0].title === 'Repeat' && s.top[0].extra === 2);
check('no NaN anywhere in the summary',
  [s.titles, s.totalPlays, s.extraPlays, s.rewatchedTitles, s.rewatchRate, s.repeatShare, s.extraMinutes].every(Number.isFinite));

const noTime = rw.rewatchSummary();
check('omitting runtimeOf leaves time at zero rather than guessing',
  noTime.extraMinutes === 0 && noTime.timedTitles === 0 && noTime.extraPlays === 3);

// ---------- recency window ----------
// movie_3 has repeats at -50d and -2d; tv_9 has one at -1d.
check('rewatchesSince(7) counts only repeats inside the window', rw.rewatchesSince(7, now) === 2, rw.rewatchesSince(7, now));
check('rewatchesSince(60) widens correctly', rw.rewatchesSince(60, now) === 3, rw.rewatchesSince(60, now));
check('rewatchesSince never counts the first viewing', rw.rewatchesSince(3650, now) === 3, rw.rewatchesSince(3650, now));
check('a future-dated play is not counted as recent',
  (() => {
    state.watched.movie_6 = { tmdbId: 6, type: 'movie', title: 'Future', runtime: 90, watchedAt: secs(now - DAY), plays: 2, playDates: [now - DAY, now + 5 * DAY] };
    // 60 days, so movie_3's two repeats and tv_9's one are all inside the window
    // and the only thing that could change the count is the future-dated play.
    const n = rw.rewatchesSince(60, now);
    delete state.watched.movie_6;
    return n === 3;
  })());

// ---------- empty library ----------
state.watched = {};
const empty = rw.rewatchSummary({ runtimeOf });
check('an empty library produces zeros, not NaN',
  empty.titles === 0 && empty.totalPlays === 0 && empty.rewatchRate === 0 && empty.repeatShare === 0 && empty.top.length === 0);
check('rewatchesSince on an empty library is zero', rw.rewatchesSince(30, now) === 0);

// ---------- guards on the write path ----------
const unwatched = await rw.logPlay(999, 'movie');
check('logging a rewatch of an unwatched title is refused', unwatched === 0, unwatched);
state.user = null;
state.watched = { movie_1: { tmdbId: 1, type: 'movie', title: 'A', watchedAt: secs(now) } };
check('logging a rewatch signed out is refused', (await rw.logPlay(1, 'movie')) === 0);
state.user = { uid: 'u1' };
check('undo never drops below the original viewing', (await rw.removeLastPlay(1, 'movie')) === 1);

summary();
