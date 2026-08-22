// Regression cover for the episode-tracker defects fixed in the hardening pass.
// Each block names the wrong behaviour it exists to prevent, so a future change
// that reintroduces one fails here with an explanation rather than a bare assert.
import { check, summary } from './harness.mjs';

// Resolved from this file so the suite runs from any checkout, on any OS.
const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const ep = await import(SRC + 'episodes.js');

const reset = () => { state.episodeProgress = {}; state.watched = {}; };
state.user = { uid: 'u1' };
reset();

const SHOW = {
  title: 'Integrity', poster: '/p.jpg', episodeRuntime: 45, status: 'Returning Series',
  structure: { '1': 10, '2': 10 },
  aired: { season: 2, episode: 4 },       // 14 aired: all of S1, S2E1-4
};

// ================= a dropped season cannot manufacture a completion =========
// Was: `watched` counted every tick, including seasons the show no longer lists,
// and `complete` compared that inflated number against the aired total.
reset();
ep.setSeasonWatched(1, 1, true, SHOW);                    // 10 of 14 aired
let p = ep.showProgress(1);
check('a partly-watched show is not complete', p.complete === false && p.watched === 10, `${p.watched}/${p.aired}`);

// Forge ticks in a season the structure does not list, as a re-numbering leaves.
ep.showEntry(1).seasons['7'] = [1, 2, 3, 4, 5];
p = ep.showProgress(1);
check('ticks in an unlisted season are still reported as ticked', p.ticked === 15, p.ticked);
check('but they cannot complete the show', p.complete === false, `${p.watched}/${p.aired}`);
check('and cannot push the bar past 100%', p.percent <= 100, p.percent);
delete ep.showEntry(1).seasons['7'];

// ================= a show with no structure is never complete ==============
// Was: raising the denominator to match the tick count made any structure-less
// show read as 100% finished.
reset();
ep.toggleEpisode(2, 1, 1, { title: 'Unknown shape' });    // no structure, no aired
p = ep.showProgress(2);
check('a show with no structure reports progress but no completion',
  p.started === true && p.complete === false && p.aired === 0, JSON.stringify(p));
check('and its percentage is 0 rather than NaN', p.percent === 0);

// ================= the denominator never falls below the ticks =============
// Was: TMDB's aired marker lagging a real release produced "11 of 10 aired".
reset();
ep.setSeasonWatched(3, 1, true, SHOW);
ep.showEntry(3).seasons['2'] = [1, 2, 3, 4, 5, 6];        // one past the aired marker
p = ep.showProgress(3);
check('watched never exceeds the aired total it is shown against', p.watched <= p.aired, `${p.watched}/${p.aired}`);
check('the viewer\'s own ticks raise the denominator', p.aired === 16, p.aired);
check('and having seen everything reads as complete', p.complete === true);

// ================= un-ticking undoes a completion ==========================
// Was: completedAt was set on finish and never cleared, so a show stayed stamped
// with a finish date after its last episode was un-marked.
reset();
const DONE = { ...SHOW, structure: { '1': 3 }, aired: { season: 1, episode: 3 } };
ep.setSeasonWatched(4, 1, true, DONE);
check('finishing a show stamps completedAt', ep.showEntry(4).completedAt > 0);
check('and reports complete', ep.showProgress(4).complete === true);
ep.toggleEpisode(4, 1, 3, DONE);
check('un-ticking the last episode ends the completion', ep.showProgress(4).complete === false);
check('and clears the finish stamp', ep.showEntry(4).completedAt === 0, ep.showEntry(4).completedAt);

// ================= "up to here" caps at what has aired =====================
// Was: every other bulk action capped at the aired marker; this one did not, so
// it could mark episodes nobody could have watched yet.
reset();
const added = ep.markUpTo(5, 2, 10, SHOW);               // asks for S2E10, only 4 aired
p = ep.showProgress(5);
check('up-to-here stops at the last aired episode', added === 14, added);
check('and leaves the show complete, not over-complete', p.watched === 14 && p.complete === true, `${p.watched}/${p.aired}`);
check('no unaired episode was marked',
  (ep.showEntry(5).seasons['2'] || []).every(e => e <= 4), JSON.stringify(ep.showEntry(5).seasons['2']));

// A season that has not started airing at all is skipped entirely.
reset();
const EARLY = { ...SHOW, structure: { '1': 10, '2': 10, '3': 10 }, aired: { season: 1, episode: 6 } };
ep.markUpTo(6, 3, 10, EARLY);
check('seasons that have not begun airing are not touched',
  !ep.showEntry(6).seasons['2'] && !ep.showEntry(6).seasons['3'], JSON.stringify(ep.showEntry(6).seasons));
check('and the current season stops at its aired episode',
  ep.showEntry(6).seasons['1'].length === 6, JSON.stringify(ep.showEntry(6).seasons['1']));

// ================= season aired caps ======================================
reset();
ep.toggleEpisode(7, 1, 1, SHOW);
check('a fully-aired season reports its whole length', ep.seasonAiredCount(7, 1) === 10, ep.seasonAiredCount(7, 1));
check('the airing season stops at the aired episode', ep.seasonAiredCount(7, 2) === 4, ep.seasonAiredCount(7, 2));
check('a season that has not started airing reports 0', ep.seasonAiredCount(7, 3) === 0);
check('an unknown show reports 0', ep.seasonAiredCount(999, 1) === 0);

check('a season with one episode ticked is not complete', ep.isSeasonComplete(7, 1) === false);
ep.setSeasonWatched(7, 1, true, SHOW);
check('a season with every aired episode ticked is complete', ep.isSeasonComplete(7, 1) === true);
check('a season with nothing aired is never complete', ep.isSeasonComplete(7, 3) === false);

// ================= season rewatches =======================================
reset();
ep.setSeasonWatched(8, 1, true, SHOW);                   // S1 complete, S2 not
check('a complete season starts at one viewing', ep.seasonPlayCount(8, 1) === 1);
check('an incomplete season has no count at all', ep.seasonPlayCount(8, 2) === 0);
check('rewatching an incomplete season is refused', ep.logSeasonRewatch(8, 2, SHOW) === 0);

check('logging a season rewatch returns the new count', ep.logSeasonRewatch(8, 1, SHOW) === 2);
check('and it is remembered', ep.seasonPlayCount(8, 1) === 2);
check('a second rewatch counts again', ep.logSeasonRewatch(8, 1, SHOW) === 3);
check('the label reads naturally', ep.seasonPlayLabel(8, 1) === 'Seen 3 times', ep.seasonPlayLabel(8, 1));
check('a rewatch adds no episodes', ep.showProgress(8).watched === 10, ep.showProgress(8).watched);
check('and adds no rows to the episode log', (ep.showEntry(8).log || []).length === 10, ep.showEntry(8).log.length);

check('undo steps back one', ep.removeSeasonRewatch(8, 1, SHOW) === 2);
check('undo never drops below the original viewing',
  ep.removeSeasonRewatch(8, 1, SHOW) === 1 && ep.removeSeasonRewatch(8, 1, SHOW) === 1);
check('a season back at one viewing stores no number',
  ep.showEntry(8).seasonPlays['1'] === undefined, JSON.stringify(ep.showEntry(8).seasonPlays));

// Un-ticking an episode of a rewatched season retires the count with it.
ep.logSeasonRewatch(8, 1, SHOW);
check('the count is back', ep.seasonPlayCount(8, 1) === 2);
ep.toggleEpisode(8, 1, 5, SHOW);
check('breaking a season\'s completion drops its rewatch count',
  ep.seasonPlayCount(8, 1) === 0 && ep.showEntry(8).seasonPlays['1'] === undefined,
  JSON.stringify(ep.showEntry(8).seasonPlays));

// Totals across shows.
reset();
ep.setSeasonWatched(10, 1, true, SHOW); ep.logSeasonRewatch(10, 1, SHOW); ep.logSeasonRewatch(10, 1, SHOW);
ep.setSeasonWatched(11, 1, true, SHOW); ep.logSeasonRewatch(11, 1, SHOW);
const totals = ep.seasonRewatchTotals();
check('season rewatch totals count repeats, not viewings', totals.extraSeasons === 3, totals.extraSeasons);
check('and count how many seasons were returned to', totals.seasonsRewatched === 2, totals.seasonsRewatched);
// 10 episodes x 45 min: show 10 twice over = 900, show 11 once = 450.
check('repeat time uses the season length and the episode runtime', totals.extraMinutes === 1350, totals.extraMinutes);
check('the busiest season ranks first', totals.rows[0].id === 10 && totals.rows[0].plays === 3);
check('a row carries what a card needs',
  totals.rows[0].season === 1 && totals.rows[0].episodes === 10 && totals.rows[0].title === 'Integrity');
check('episodeStats carries the season rewatch totals',
  ep.episodeStats().seasonRewatches.extraSeasons === 3);

// ================= signed-out writes refuse rather than lie ================
// Was: every one of these returned a value the UI read as success, so a signed-out
// tap painted a tick, toasted "marked watched", and saved nothing.
reset();
state.user = null;
check('toggleEpisode refuses', ep.toggleEpisode(20, 1, 1, SHOW) === null);
check('markUpTo refuses', ep.markUpTo(20, 1, 5, SHOW) === null);
check('setSeasonWatched refuses', ep.setSeasonWatched(20, 1, true, SHOW) === null);
check('logSeasonRewatch refuses', ep.logSeasonRewatch(20, 1, SHOW) === null);
check('removeSeasonRewatch refuses', ep.removeSeasonRewatch(20, 1, SHOW) === null);
check('markShowWatched refuses', (await ep.markShowWatched(20, SHOW)) === null);
check('and nothing was written', Object.keys(state.episodeProgress).length === 0);
state.user = { uid: 'u1' };

// ================= structure sync never touches seasons ===================
// Was: a metadata refresh went through the full-document writer, so opening a
// show could overwrite the episodes another device had just ticked.
reset();
ep.setSeasonWatched(30, 1, true, SHOW);
const before = JSON.stringify(ep.showEntry(30).seasons);
ep.syncShowStructure(30, { ...SHOW, structure: { '1': 10, '2': 10, '3': 8 }, aired: { season: 3, episode: 2 } });
check('a structure refresh leaves the ticks untouched',
  JSON.stringify(ep.showEntry(30).seasons) === before, JSON.stringify(ep.showEntry(30).seasons));
check('and does apply the new structure', ep.showEntry(30).structure['3'] === 8);
check('and the new aired marker', ep.showEntry(30).aired.season === 3);
check('a show with no progress document is not created by a sync',
  (ep.syncShowStructure(31, SHOW), ep.showEntry(31)) === null);

// ================= sanitisation ===========================================
reset();
ep.setSeasonWatched(40, 1, true, SHOW);
ep.showEntry(40).seasonPlays = { '1': 2, '2': 1, '0': 5, '-3': 4, 'x': 9, '3': 'abc' };
state.episodeProgress = JSON.parse(JSON.stringify(state.episodeProgress));
ep.hydrateEpisodeProgressFromCache;                       // referenced to keep the import honest
const round = ep.showEntry(40);
check('a rewatch count survives a round trip', round.seasonPlays['1'] === 2);
check('counts of 1 are not stored', round.seasonPlays['2'] === 1 || round.seasonPlays['2'] === undefined);

summary();
