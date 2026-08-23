import { check, summary } from './harness.mjs';

const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const movie = await import(SRC + 'movie-progress.js');
const continuing = await import(SRC + 'continue-prefs.js');

state.user = { uid: 'movie-progress-test' };
state.watched = {};
state.movieProgress = {};

check('movie times accept HH:MM:SS', movie.parseMovieTime('1:07:09') === 4029);
check('movie times accept MM:SS', movie.parseMovieTime('37:45') === 2265);
check('movie times reject invalid seconds', movie.parseMovieTime('1:20:99') === null);

movie.startMovieProgress({ id: 7, title: 'Seven', poster: '/7.jpg', backdrop: '/b.jpg', runtime: 120 });
check('a movie can be saved without an exact time', movie.movieProgressEntry(7)?.position === 0 && movie.movieResumeQueue()[0]?.key === 'movie_7');
movie.setMovieProgressPosition(7, 3675, { runtime: 120 });
check('exact movie position is retained in seconds', movie.movieProgressEntry(7)?.position === 3675 && movie.formatMovieTime(3675) === '01:01:15');
movie.setMovieProgressPosition(7, 0, { runtime: 120 });
check('an exact position can be cleared back to zero', movie.movieProgressEntry(7)?.position === 0);
movie.removeMovieProgress(7);
check('removing progress hides the movie and records an offline-safe tombstone', movie.movieProgressEntry(7) === null && state.movieProgress.movie_7.deleted === true && movie.movieResumeQueue().length === 0);

continuing.hydrateContinuePrefs({ pinned: [44, 'movie_7'], hidden: ['tv_90'], clientUpdatedAt: 1 });
const ordered = continuing.applyContinuePrefs([
  { key: 'tv_44', id: 44 }, { key: 'tv_90', id: 90 }, { key: 'movie_7', id: 7 },
]);
check('legacy TV pins and typed movie pins share one stable order', ordered.map(row => row.key).join(',') === 'tv_44,movie_7', JSON.stringify(ordered));
continuing.togglePinned('movie_8');
const mirrored = JSON.parse(localStorage.getItem('cv_continue_prefs_movie-progress-test') || '{}');
check('continue pins are backed up immediately for Firebase retry', mirrored.pinned?.[0] === 'movie_8' && mirrored.clientUpdatedAt > 1, JSON.stringify(mirrored));

summary();
