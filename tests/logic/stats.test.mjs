// Arithmetic audit of computeStats against a collection whose every figure is
// known by hand. Anything that disagrees is a real reporting bug.
import { check, summary } from './harness.mjs';

// Resolved from this file so the suite runs from any checkout, on any OS.
const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const ep = await import(SRC + 'episodes.js');
const stats = await import(SRC + 'stats.js');

const DAY = 86400000;
const secs = ms => ({ seconds: Math.floor(ms / 1000) });
const now = Date.now();
// Local-midday timestamps so a day key never straddles a timezone boundary.
const dayAgo = n => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime() - n * DAY; };

state.user = { uid: 'u1' };
state.episodeProgress = {};

// 4 watched movies (90 + 120 + 150 + 60 = 420 min), 1 saved-only movie.
state.watched = {
  movie_1: { tmdbId: 1, type: 'movie', title: 'A', year: '2019', genres: [28, 18], language: 'en', runtime: 90, tmdbRating: 7, watchedAt: secs(dayAgo(0)) },
  movie_2: { tmdbId: 2, type: 'movie', title: 'B', year: '2001', genres: [18], language: 'hi', runtime: 120, tmdbRating: 8, watchedAt: secs(dayAgo(1)) },
  movie_3: { tmdbId: 3, type: 'movie', title: 'C', year: '1995', genres: [27], language: 'ko', runtime: 150, tmdbRating: 6, watchedAt: secs(dayAgo(2)) },
  movie_4: { tmdbId: 4, type: 'movie', title: 'D', year: '2019', genres: [35], language: 'en', runtime: 60, tmdbRating: 5, watchedAt: secs(dayAgo(40)) },
};
state.watchlist = [
  { id: 'movie_5', tmdbId: 5, type: 'movie', title: 'E', year: '2022', genres: [878], language: 'ja', runtime: 100, rating: 9 },
];
state.ratings = { movie_1: 9, movie_2: 8, movie_3: 4 };

let s = stats.computeStats('all');
check('watched count', s.watched.length === 4, String(s.watched.length));
check('saved count', s.saved.length === 1, String(s.saved.length));
check('rows is the union, not the sum', s.rows.length === 5, String(s.rows.length));
check('movies vs shows split', s.movies === 4 && s.shows === 0);
check('total minutes', s.totalMinutes === 420, String(s.totalMinutes));
check('hours floor', s.hours === 7, String(s.hours));
check('runtime coverage is 100%', s.runtimeCoverage === 100, String(s.runtimeCoverage));
check('completion = watched / union', s.completion === 80, String(s.completion));
check('average rating', Math.abs(s.avgRating - (9 + 8 + 4) / 3) < 1e-9, String(s.avgRating));
check('total rated', s.totalRated === 3);
check('rating coverage is watched-and-rated over watched', s.ratingCoverage === 75, String(s.ratingCoverage));
check('high scores counts 8 and above', s.highScores === 2, String(s.highScores));
check('positive rate', s.positiveRate === 67, String(s.positiveRate));
check('rating distribution bucket 9', s.ratingCounts[8] === 1 && s.ratingCounts[7] === 1 && s.ratingCounts[3] === 1);
check('distribution sums to the rating count', s.ratingCounts.reduce((a, b) => a + b, 0) === 3);
check('last 30 days excludes the 40-day-old watch', s.last30 === 3, String(s.last30));
check('current streak counts consecutive days', s.currentStreak === 3, String(s.currentStreak));
check('longest streak', s.longestStreak === 3, String(s.longestStreak));
check('genres cover every row', s.genres.reduce((sum, g) => sum + g.count, 0) === 6, JSON.stringify(s.genres.map(g => [g.name, g.count])));
check('decades are derived from year', s.decades.find(d => d.name === '2010s')?.count === 2, JSON.stringify(s.decades.map(d => [d.name, d.count])));
check('languages counted across the union', s.languages.length === 4, JSON.stringify(s.languages.map(l => l.name)));
check('release span uses min and max year', s.releaseSpan === '1995–2022', s.releaseSpan);
check('longest title is a movie', s.longestTitle?.title === 'C', String(s.longestTitle?.title));
check('diversity score is bounded', s.diversityScore >= 0 && s.diversityScore <= 100, String(s.diversityScore));
check('average runtime over movies', s.avgRuntime === Math.round(420 / 4), String(s.avgRuntime));

// ---------- the TV watch-time bug ----------
// A show marked from the detail page stores ONE episode's runtime. Before the
// fix that is all the stats counted; the episode ledger is authoritative.
state.watched.tv_100 = {
  tmdbId: 100, type: 'tv', title: 'Series', year: '2015', genres: [18], language: 'en',
  runtime: 45, episodeRuntime: 0, watchedAt: secs(dayAgo(0)),
};
s = stats.computeStats('all');
check('without a ledger the stored runtime is used', s.totalMinutes === 420 + 45, String(s.totalMinutes));

state.episodeProgress = {
  tv_100: {
    tmdbId: 100, title: 'Series', poster: '', backdrop: '', episodeRuntime: 45, status: 'Ended',
    seasons: { 1: Array.from({ length: 10 }, (_, i) => i + 1), 2: [1, 2, 3] },
    structure: { 1: 10, 2: 10 }, aired: { season: 2, episode: 10 },
    lastWatched: { season: 2, episode: 3, at: now }, log: [], completedAt: 0, legacy: false, updatedAt: now,
  },
};
s = stats.computeStats('all');
check('the ledger drives TV watch time', s.totalMinutes === 420 + 13 * 45, String(s.totalMinutes));
check('and the hours follow', s.hours === Math.floor((420 + 585) / 60), String(s.hours));
check('average episode runtime comes from the ledger when the watched row is incomplete', s.avgEpisodeRuntime === 45, String(s.avgEpisodeRuntime));
check('mixed average compares movies with episode units', s.avgRuntime === Math.round((90 + 120 + 150 + 60 + 45) / 5), String(s.avgRuntime));
check('a series never becomes the longest title', s.longestTitle?.title === 'C');

// ---------- scope filtering ----------
const movieScope = stats.computeStats('movie');
check('movie scope excludes TV', movieScope.watched.every(row => row.type === 'movie') && movieScope.shows === 0);
check('movie scope keeps movie minutes only', movieScope.totalMinutes === 420, String(movieScope.totalMinutes));
const tvScope = stats.computeStats('tv');
check('tv scope keeps only the show', tvScope.watched.length === 1 && tvScope.shows === 1);
check('tv scope minutes come from the ledger', tvScope.totalMinutes === 13 * 45, String(tvScope.totalMinutes));
check('tv scope ratings are scoped too', tvScope.totalRated === 0, String(tvScope.totalRated));

// ---------- empty collection ----------
state.watched = {}; state.watchlist = []; state.ratings = {}; state.episodeProgress = {};
const empty = stats.computeStats('all');
check('empty: no division by zero', Number.isFinite(empty.completion) && Number.isFinite(empty.avgRating));
check('empty: completion is 0', empty.completion === 0);
check('empty: coverage does not divide by zero', empty.ratingCoverage === 0 && empty.positiveRate === 0);
check('empty: runtime coverage is 100 rather than NaN', empty.runtimeCoverage === 100, String(empty.runtimeCoverage));
check('empty: streaks are zero', empty.currentStreak === 0 && empty.longestStreak === 0);
check('empty: peak day says so', empty.peakDay === 'No pattern yet', empty.peakDay);
check('empty: release span placeholder', empty.releaseSpan === '—');
check('empty: milestone still advances', empty.milestone === 10, String(empty.milestone));
check('empty: hours is 0 not NaN', empty.hours === 0);
check('empty: avgRuntime is 0 not NaN', empty.avgRuntime === 0);
check('empty: diversity is 0', empty.diversityScore === 0);

// ---------- malformed data must not produce NaN or >100% ----------
state.watched = {
  movie_9: { tmdbId: 9, type: 'movie', title: 'Bad', year: 'nope', genres: null, language: '', runtime: -5, tmdbRating: 'x', watchedAt: null },
  tv_9: { tmdbId: 9, type: 'tv', title: 'Odd', year: '3999', genres: [999999], runtime: 99999, watchedAt: secs(now) },
};
state.watchlist = []; state.ratings = { movie_9: 99 };
const messy = stats.computeStats('all');
check('a negative runtime is ignored', messy.totalMinutes >= 0 && Number.isFinite(messy.totalMinutes), String(messy.totalMinutes));
check('percentages stay within 0-100', [messy.completion, messy.ratingCoverage, messy.positiveRate, messy.runtimeCoverage].every(v => v >= 0 && v <= 100), JSON.stringify([messy.completion, messy.ratingCoverage, messy.positiveRate, messy.runtimeCoverage]));
check('an unknown genre id is dropped', !messy.genres.some(g => g.name === undefined), JSON.stringify(messy.genres));
check('an out-of-range year is excluded from the span', !String(messy.releaseSpan).includes('3999'), messy.releaseSpan);
check('no NaN anywhere in the numeric summary', [messy.hours, messy.avgRuntime, messy.avgRating, messy.diversityScore].every(Number.isFinite), JSON.stringify([messy.hours, messy.avgRuntime, messy.avgRating, messy.diversityScore]));

summary();
