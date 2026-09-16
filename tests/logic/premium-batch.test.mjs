// Drawn icons, poster colour, page-transition geometry, the completionist,
// cast milestones, the series finale and the season heatmap.
import { check, summary } from './harness.mjs';

const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const icons = await import(SRC + 'icons.js');
const ambient = await import(SRC + 'ambient.js');
const transitions = await import(SRC + 'transitions.js');
const completion = await import(SRC + 'completionist.js');
const cast = await import(SRC + 'cast-hours.js');
const finale = await import(SRC + 'series-finale.js');
const heatmap = await import(SRC + 'season-heatmap.js');

const DAY = 86400000;
state.user = { uid: 'u1' };
state.watched = {};

// ---------- icons ----------
check('an icon is a decorative 1em SVG by default', /^<svg class="cv-icon" viewBox="0 0 24 24"[^>]*aria-hidden="true"/.test(icons.icon('check')));
check('a labelled icon is announced as an image', /role="img" aria-label="Saved &quot;x&quot;"/.test(icons.icon('check', { label: 'Saved "x"' })));
check('an unknown icon name still draws something', icons.icon('no-such-icon').includes('<path'));
check('lists saved with an emoji keep a drawn icon', icons.listIconName('🍿', 'custom') === 'popcorn' && icons.listIconName('❤️', 'x') === 'heart');
check('built-in lists use their own icon whatever was stored', icons.listIconName('📋', 'watchlist') === 'bookmark' && icons.listIconName('', 'favorites') === 'heart');
check('a new list stores an icon name, and junk falls back to a folder', icons.listIconName('clapper', 'x') === 'clapper' && icons.listIconName('<script>', 'x') === 'folder');

// ---------- poster colour ----------
const pixels = (rgb, count, alpha = 255) => Array.from({ length: count }, () => [...rgb, alpha]).flat();
check('a grey poster has no colour', ambient.dominantColour(pixels([128, 128, 128], 400)) === null);
const flame = ambient.dominantColour([...pixels([70, 60, 50], 300), ...pixels([240, 120, 20], 100)]);
check('vivid colour beats a larger dull area', !!flame && flame[0] > flame[2] && flame[0] > 180, JSON.stringify(flame));
check('transparent pixels are ignored', ambient.dominantColour(pixels([0, 90, 255], 400, 0)) === null);
for (const rgb of [[240, 200, 20], [20, 120, 255], [230, 20, 90], [40, 200, 90]]) {
  const palette = ambient.ambientPalette(rgb);
  check(`button fill for rgb(${rgb}) keeps white text readable`, ambient.contrast(palette.solid, [255, 255, 255]) >= 4.5, ambient.contrast(palette.solid, [255, 255, 255]).toFixed(2));
}
check('no colour, no palette', ambient.ambientPalette(null) === null);
check('an unsampled poster has no cached tone', ambient.cachedTone('/never.jpg') === '');

// ---------- transition geometry ----------
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
check('a fully visible box is 100% on screen', transitions.visibleShare(rect(10, 10, 100, 150), [rect(0, 0, 1000, 800)]) === 1);
check('half a card scrolled out of its row is 50% visible', Math.abs(transitions.visibleShare(rect(-50, 10, 100, 150), [rect(0, 0, 1000, 800)]) - 0.5) < 1e-9);
check('a box outside any clip is not visible', transitions.visibleShare(rect(10, 900, 100, 150), [rect(0, 0, 1000, 800)]) === 0);
check('portrait artwork is a poster, wide artwork a backdrop', transitions.artKind(200, 300) === 'poster' && transitions.artKind(320, 180) === 'backdrop');
check('a box inside its clips needs no trim', transitions.insetFor(rect(10, 10, 100, 100), [rect(0, 0, 500, 500)]) === '');
check('a hero taller than its frame is trimmed at the bottom only', transitions.insetFor(rect(0, 0, 1000, 1000), [rect(0, 0, 1000, 800)]) === 'inset(0% 0% 20% 0%)', transitions.insetFor(rect(0, 0, 1000, 1000), [rect(0, 0, 1000, 800)]));

// ---------- completionist ----------
const now = new Date('2026-09-16T12:00:00');
const film = (id, extra = {}) => ({ id, title: `Film ${id}`, release_date: '2010-01-01', vote_count: 900, vote_average: 7, genre_ids: [18], poster_path: `/p${id}.jpg`, ...extra });
const directorCredits = {
  crew: [
    { ...film(1, { vote_average: 8.8 }), job: 'Director' },
    { ...film(1), job: 'Writer' },
    { ...film(2, { vote_average: 8.4 }), job: 'Director' },
    { ...film(3, { vote_average: 9.0 }), job: 'Director' },
    { ...film(4, { vote_count: 12 }), job: 'Director' },                      // too obscure to count…
    { ...film(5, { vote_count: 12 }), job: 'Director' },                      // …unless you saw it
    { ...film(6, { release_date: '2027-07-01' }), job: 'Director' },          // not out yet
    { ...film(7, { genre_ids: [99] }), job: 'Director' },                     // documentary
    { ...film(8), job: 'Producer' },
    { ...film(9, { vote_average: 8.4, vote_count: 2000 }), job: 'Director' },
  ],
};
const seen = new Set([2, 5]);
const nolan = completion.completionFor({ id: 525, name: 'Christopher Nolan' }, directorCredits, 'director', { watched: seen, now });
check('a film counts once however many jobs the person had on it', nolan.total === 6, JSON.stringify(nolan));
check('seen counts films you watched, obscure ones included', nolan.seen === 2);
check('gaps are the unseen films, best rated first, more votes breaking a tie', nolan.gaps.map(gap => gap.id).join(',') === '3,1,9,7', nolan.gaps.map(gap => gap.id).join(','));
check('unreleased and obscure unseen films are not gaps', !nolan.gaps.some(gap => [4, 6].includes(gap.id)));
const noDocs = completion.completionFor({ id: 525, name: 'Christopher Nolan' }, directorCredits, 'director', { watched: seen, now, excludeDocumentaries: true });
check('documentaries follow the Stats switch', noDocs.total === 5 && !noDocs.gaps.some(gap => gap.id === 7));
check('the headline reads as a sentence', completion.completionHeadline(noDocs) === "You've seen 2 of 5 Christopher Nolan films", completion.completionHeadline(noDocs));
check('a finished filmography says all', completion.completionHeadline({ name: 'Greta Gerwig', seen: 3, total: 3 }) === "You've seen all 3 Greta Gerwig films");
check('one film is singular', completion.completionHeadline({ name: 'X', seen: 0, total: 1 }) === "You've seen 0 of 1 X film");
const actorCredits = { cast: [
  film(20, { character: 'Mark Scout' }), film(21, { character: 'Himself' }), film(22, { character: 'Self - Guest' }),
  film(23, { character: 'Bartender (uncredited)' }), film(24, { character: 'Voice of Owl (voice)' }),
  { ...film(25), media_type: 'tv', character: 'Lead' },
] };
const actor = completion.completionFor({ id: 1, name: 'Adam Scott' }, actorCredits, 'actor', { watched: new Set([20]), now });
check('actors count acting roles, voice work included', actor.total === 2 && actor.seen === 1, JSON.stringify(actor));
check('appearances as themselves, uncredited cameos and TV are left out', !actor.gaps.some(gap => [21, 22, 23, 25].includes(gap.id)));
check('directors are measured on directing, everyone else on acting', completion.roleForDepartment('Directing') === 'director' && completion.roleForDepartment('Acting') === 'actor' && completion.roleForDepartment('Writing') === 'actor');

// ---------- cast milestones ----------
const payload = {
  credits: { cast: [{ id: 1, name: 'Adam Scott', profile_path: '/adam.jpg' }, { id: 2, name: 'Britt Lower', profile_path: '' }] },
  episodes: [
    { episode_number: 1, runtime: 57, air_date: '2022-02-18', guest_stars: [{ id: 3, name: 'Guest One', order: 1 }, { id: 1, name: 'Adam Scott', order: 0 }] },
    { episode_number: 2, runtime: 0, air_date: '2022-02-18', guest_stars: [{ id: 4, name: 'Guest Two', order: 0 }] },
    { episode_number: 3, runtime: 44, air_date: '2022-02-25', guest_stars: [] },
  ],
};
const compact = cast.compactSeason(payload, new Date('2026-01-01').getTime());
check('a season keeps its regulars, each episode its runtime and guests', compact.regulars.join(',') === '1,2' && compact.eps[1][0] === 57 && compact.eps[1][1].join(',') === '3', JSON.stringify(compact.eps));
check('a regular listed as a guest is not counted twice', !compact.eps[1][1].includes(1));
check('a season aired long ago is settled', compact.settled === true);
check('a season still airing is not settled', cast.compactSeason({ ...payload, episodes: [{ ...payload.episodes[0], air_date: '2025-12-30' }] }, new Date('2026-01-01').getTime()).settled === false);
const shows = [{ id: 95396, runtime: 50, seasons: { 1: [1, 2, 3], 2: [1] } }];
const hours = cast.castHours(shows, (showId, season) => (season === 1 ? compact : null));
const adam = hours.people.find(row => row.id === 1), guestOne = hours.people.find(row => row.id === 3), guestTwo = hours.people.find(row => row.id === 4);
check('regulars count every watched episode; a missing runtime uses the show length', adam.minutes === 57 + 50 + 44 && adam.episodes === 3, JSON.stringify(adam));
check('guests count only their own episode', guestOne.minutes === 57 && guestOne.episodes === 1 && guestTwo.minutes === 50);
check('coverage reports seasons not yet known', hours.needed === 2 && hours.known === 1);
check('people are ranked by time', hours.people[0].id === 1 || hours.people[0].minutes >= hours.people[1].minutes);
check('crossing 30 hours is a 30-hour milestone', cast.crossedMilestone(29 * 60 + 10, 30 * 60 + 5) === 30);
check('a jump past several milestones names the highest', cast.crossedMilestone(9 * 60, 21 * 60) === 20);
check('no crossing, no milestone (and never on the way down)', cast.crossedMilestone(31 * 60, 32 * 60) === 0 && cast.crossedMilestone(31 * 60, 29 * 60) === 0);
const band = cast.milestoneBand(35 * 60);
check('the band runs from the last milestone to the next', band.reached === 30 && band.next === 40 && Math.abs(band.progress - 0.5) < 1e-9, JSON.stringify(band));
check('hours read as hours and minutes', cast.hoursLabel(151) === '2h 31m' && cast.hoursLabel(120) === '2h' && cast.hoursLabel(45) === '45m');

// ---------- series finale ----------
const t0 = new Date('2026-06-01T20:00:00').getTime();
const show = {
  tmdbId: 5, title: 'Finale Show', episodeRuntime: 50, structure: { 1: 4, 2: 4, 3: 8 }, aired: { season: 3, episode: 8 },
  seasons: { 1: [1, 2, 3, 4], 2: [1, 2, 3, 4], 3: [1, 2, 3, 4, 5, 6, 7, 8] },
  log: [
    [1, 1, t0, 0], [1, 2, t0 + 2 * DAY, 0], [1, 3, t0 + 4 * DAY, 0], [1, 4, t0 + 6 * DAY, 0],               // 4 eps over 7 days
    [2, 1, t0 + 10 * DAY, 0], [2, 2, t0 + 10 * DAY + 3e6, 0], [2, 3, t0 + 10 * DAY + 6e6, 0], [2, 4, t0 + 11 * DAY, 0], // 4 eps over 2 days
    // Season 3: eight episodes (400 minutes) in one press is bookkeeping, not a sitting.
    ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => [3, n, t0 + 20 * DAY, 1]),
  ],
};
const payloads = {
  1: { episodes: [1, 2, 3, 4].map(n => ({ episode_number: n, runtime: 50, vote_average: 8 + n / 10, vote_count: 20 })) },
  2: { episodes: [1, 2, 3, 4].map(n => ({ episode_number: n, runtime: 55, vote_average: n === 3 ? 9.6 : 8, vote_count: n === 3 ? 40 : 20, name: n === 3 ? 'The One' : '' })) },
  3: { episodes: [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ episode_number: n, runtime: 60, vote_average: 9.9, vote_count: 1 })) },
};
const run = finale.seriesRecap(show, payloads);
check('the finale covers every season and episode', run.seasonCount === 3 && run.episodes === 16, JSON.stringify({ s: run.seasonCount, e: run.episodes }));
check('total time sums every season', run.minutes === 4 * 50 + 4 * 55 + 8 * 60, String(run.minutes));
check('the fastest season has the highest pace among paced seasons', run.fastest?.season === 2 && run.fastest.spanDays === 2, JSON.stringify(run.fastest));
check('a season marked in one press has no pace and cannot be fastest', run.seasons.find(season => season.season === 3).marked);
check('overall pace uses viewing only, across the whole run', run.viewingEpisodes === 8 && Math.abs(run.pace - 8 / 12) < 1e-9, `${run.viewingEpisodes} ${run.pace} ${run.spanDays}`);
check('the best episode ignores near-unrated ones', run.topEpisode?.season === 2 && run.topEpisode.number === 3 && run.topEpisode.rating === 9.6, JSON.stringify(run.topEpisode));
check('finale figures lead with seasons and episodes, at most six', finale.finaleFigures(run)[0][0] === 'Seasons' && finale.finaleFigures(run).length <= 6 && finale.finaleFigures(run).some(([label]) => label === 'Overall pace'));
check('the fastest line reads naturally', finale.fastestLine(run.fastest) === 'Season 2 · 2 episodes a day over 2 days', finale.fastestLine(run.fastest));
const single = finale.seriesRecap({ ...show, seasons: { 1: [1, 2, 3, 4] }, log: show.log.slice(0, 4) }, payloads);
check('a one-season show has no fastest season', single.fastest === null && single.seasonCount === 1);
check('specials are not a season', finale.seriesRecap({ ...show, seasons: { ...show.seasons, 0: [1] } }, payloads).seasonCount === 3);

// ---------- season heatmap ----------
check('ratings fall into fixed bands', heatmap.ratingBand(5.2, 10) === 0 && heatmap.ratingBand(7.49, 10) === 2 && heatmap.ratingBand(7.5, 10) === 3 && heatmap.ratingBand(9.4, 10) === 6);
check('an episode with no votes has no band', heatmap.ratingBand(8, 0) === -1 && heatmap.ratingBand(0, 10) === -1);
const seasonsPayload = [
  { season_number: 2, name: 'Season 2', episodes: [{ episode_number: 1, vote_average: 9.1, vote_count: 80, air_date: '2025-01-17', name: 'Hello' }, { episode_number: 2, vote_average: 0, vote_count: 0, air_date: '2030-01-01' }] },
  { season_number: 0, name: 'Specials', episodes: [{ episode_number: 1, vote_average: 10, vote_count: 900, air_date: '2022-01-01' }] },
  { season_number: 1, name: 'Season 1', episodes: [{ episode_number: 1, vote_average: 8.0, vote_count: 50, air_date: '2022-02-18' }, { episode_number: 2, vote_average: 9.8, vote_count: 2, air_date: '2022-02-18' }] },
];
const model = heatmap.heatmapModel(seasonsPayload, { isWatched: (season, episode) => season === 1 && episode === 1, now: new Date('2026-09-16').getTime() });
check('rows are seasons in order, specials left out', model.rows.map(row => row.season).join(',') === '1,2');
check("a row's average uses rated episodes only", model.rows[1].mean === 9.1 && model.rows[0].mean === 8.9, JSON.stringify(model.rows.map(row => row.mean)));
check('best rated needs enough votes', model.best?.season === 2 && model.best.episode === 1, JSON.stringify(model.best));
check('ticks and aired counts come from the ledger and air dates', model.watched === 1 && model.aired === 3 && model.total === 4);
const html = heatmap.heatmapHTML(95396, model);
check('every episode is a labelled square', (html.match(/class="hm-cell[ "]/g) || []).length === 4 && html.includes('aria-label="Season 1 episode 1') && html.includes(', watched"'));
check('an unaired episode is outlined, not coloured', /hm-cell unaired/.test(html));
check('the note says how much you have seen', html.includes("You've seen 1 of 3 aired episodes"));

summary();
