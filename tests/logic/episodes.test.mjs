import { check, summary } from './harness.mjs';

// Resolved from this file so the suite runs from any checkout, on any OS.
const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const ep = await import(SRC + 'episodes.js');

state.user = { uid: 'u1' };
state.watched = {};

// Breaking Bad shape: 5 seasons, currently aired up to S3E4.
const META = {
  title: 'Test Show', poster: '/p.jpg', backdrop: '/b.jpg', episodeRuntime: 45, status: 'Returning Series',
  structure: { '1': 7, '2': 13, '3': 13 },
  aired: { season: 3, episode: 4 },
};

check('no entry before anything is tracked', ep.showEntry(1) === null);
check('progress of an untracked show is zero', ep.showProgress(1).percent === 0 && !ep.showProgress(1).started);
check('nextUp of an untracked show is null', ep.nextUp(1) === null);

ep.toggleEpisode(1, 1, 1, META);
check('first tick creates the entry', !!ep.showEntry(1));
check('the episode reads as watched', ep.isEpisodeWatched(1, 1, 1));
check('an untouched episode does not', !ep.isEpisodeWatched(1, 1, 2));
check('aired total counts full seasons plus the airing one', ep.showProgress(1).aired === 7 + 13 + 4, String(ep.showProgress(1).aired));
check('nextUp is S1E2', JSON.stringify(ep.nextUp(1)) === JSON.stringify({ season: 1, episode: 2 }), JSON.stringify(ep.nextUp(1)));

check('toggle is reversible', ep.toggleEpisode(1, 1, 1, META) === false && !ep.isEpisodeWatched(1, 1, 1));
// The document survives with a tombstone rather than being deleted: another
// device holding a stale copy would otherwise re-add the episode on its next
// merge, silently undoing the un-tick.
check('emptying the entry leaves nothing watched', ep.showProgress(1).watched === 0 && ep.showProgress(1).started === false);
check('and records the un-tick so it survives a merge',
  (ep.showEntry(1).removed || {})['1']?.includes(1) === true, JSON.stringify(ep.showEntry(1)?.removed));

// markUpTo fills every prior season too.
const added = ep.markUpTo(1, 2, 5, META);
check('markUpTo fills S1 fully and S2 up to 5', added === 12, `added ${added}`);
check('S1E7 is watched', ep.isEpisodeWatched(1, 1, 7));
check('S2E5 is watched', ep.isEpisodeWatched(1, 2, 5));
check('S2E6 is not', !ep.isEpisodeWatched(1, 2, 6));
check('nextUp is S2E6', JSON.stringify(ep.nextUp(1)) === JSON.stringify({ season: 2, episode: 6 }));
check('progress counts 12 of 24 aired', ep.showProgress(1).watched === 12 && ep.showProgress(1).aired === 24);
check('percent is 50', ep.showProgress(1).percent === 50, String(ep.showProgress(1).percent));
check('markUpTo again adds nothing', ep.markUpTo(1, 2, 5, META) === 0);

// A whole-season mark must never tick unaired episodes.
ep.setSeasonWatched(1, 3, true, META);
check('season 3 stops at the last aired episode', ep.seasonWatchedCount(1, 3) === 4, String(ep.seasonWatchedCount(1, 3)));
check('S3E5 (unaired) is not marked', !ep.isEpisodeWatched(1, 3, 5));
ep.setSeasonWatched(1, 3, false, META);
check('unmarking a season clears it', ep.seasonWatchedCount(1, 3) === 0);

// Completion fires once every aired episode is ticked.
let completed = null;
ep.onShowComplete((id, meta, progress) => { completed = { id, progress }; });
ep.markUpTo(1, 3, 4, META);
check('progress reports complete', ep.showProgress(1).complete && ep.showProgress(1).percent === 100);
check('nextUp is null when caught up', ep.nextUp(1) === null);
check('completion hook fired', completed?.id === 1 && completed.progress.aired === 24, JSON.stringify(completed));

// A completed show leaves the resume queue.
check('completed shows are not in the resume queue', !ep.resumeQueue().some(row => row.id === 1));
ep.toggleEpisode(1, 3, 4, META);
check('un-ticking the last episode puts it back', ep.resumeQueue().some(row => row.id === 1));
check('queue carries the next episode', JSON.stringify(ep.resumeQueue()[0].next) === JSON.stringify({ season: 3, episode: 4 }));

// A shrinking structure must not produce >100%.
ep.markUpTo(1, 3, 4, META);
ep.syncShowStructure(1, { ...META, structure: { '1': 7, '2': 13, '3': 2 }, aired: { season: 3, episode: 2 } });
const shrunk = ep.showProgress(1);
check('a re-numbered season cannot exceed 100%', shrunk.percent <= 100, `${shrunk.watched}/${shrunk.aired} = ${shrunk.percent}%`);

// Totals for stats.
ep.clearShowProgress(1);
ep.markUpTo(1, 1, 7, META);
ep.markUpTo(2, 1, 3, { ...META, title: 'Second Show', structure: { '1': 10 }, aired: { season: 1, episode: 10 } });
const totals = ep.episodeTotals();
check('episodeTotals counts every episode', totals.episodes === 10, JSON.stringify(totals));
check('episodeTotals counts shows', totals.shows === 2);
check('episodeTotals derives minutes from runtime', totals.minutes === 10 * 45, String(totals.minutes));

// Guests must not silently write.
state.user = null;
ep.resetEpisodeProgressForAuth();
check('signing out clears progress', Object.keys(state.episodeProgress).length === 0);
check('a guest tick is a no-op', (ep.toggleEpisode(9, 1, 1, META), ep.showEntry(9) === null));

summary();
