// Outside scores (IMDb, Rotten Tomatoes, Metacritic), the whole-series ratings
// grid, and the moving backdrops.
import { check, summary } from './harness.mjs';

const SRC = new URL('../../js/', import.meta.url).href;
const scores = await import(SRC + 'scores.js');
const badges = await import(SRC + 'score-badges.js');
const heatmap = await import(SRC + 'season-heatmap.js');
const backdrops = await import(SRC + 'backdrops.js');

// ---------- reading a rating ----------
check('a string rating becomes a number', scores.normaliseRating('8.8') === 8.8);
check('junk is no rating', scores.normaliseRating('n/a') === 0 && scores.normaliseRating('') === 0 && scores.normaliseRating(null) === 0);
check('an impossible rating is no rating', scores.normaliseRating(11) === 0 && scores.normaliseRating(-3) === 0);
check('bands run great to poor', ['great', 'good', 'fair', 'weak', 'poor'].join() === [9.4, 8.2, 7.1, 6.5, 4].map(scores.bandFor).join());
check('nothing rated has its own band', scores.bandFor(0) === 'none' && scores.bandFor(undefined) === 'none');
check('a key that is not one is ignored', scores.cleanOmdbKey(' 1a2b3c4d ') === '1a2b3c4d' && scores.cleanOmdbKey('no') === '' && scores.cleanOmdbKey('') === '' && scores.cleanOmdbKey(null) === '');

// ---------- a key that stops working ----------
check('a spent quota and a dead key are told apart', scores.omdbVerdict({ Response: 'False', Error: 'Request limit reached!' }) === 'quota'
  && scores.omdbVerdict({ Response: 'False', Error: 'Invalid API key!' }) === 'invalid'
  && scores.omdbVerdict({}, 401) === 'invalid');
check('a title OMDb does not have says nothing about the key', scores.omdbVerdict({ Response: 'False', Error: 'Incorrect IMDb ID.' }) === 'ok'
  && scores.omdbVerdict({ Response: 'True', imdbRating: '8.1' }) === 'ok');
check('each refusal has its own sentence', new Set(['quota', 'invalid', 'error'].map(scores.omdbTroubleMessage)).size === 3
  && scores.omdbTroubleMessage('quota').includes('OMDb'));

// ---------- Wikidata ----------
const bindings = [
  { byLabel: { value: 'Metacritic' }, score: { value: '74/100' } },
  { byLabel: { value: 'Rotten Tomatoes' }, score: { value: '8.1/10' } },
  { byLabel: { value: 'Rotten Tomatoes' }, score: { value: '87%' } },
  { byLabel: { value: 'IMDb' }, score: { value: '8.8/10' } },
];
const parsed = scores.parseWikidataScores(bindings);
check('the Tomatometer is the percentage, not the average', parsed.rt === 87 && parsed.rtAverage === 8.1);
check('Metacritic is out of 100', parsed.metacritic === 74);
check('another site\'s score is ignored here', !('imdb' in parsed));
check('no scores, no numbers', JSON.stringify(scores.parseWikidataScores([])) === JSON.stringify({ rt: 0, rtAverage: 0, metacritic: 0 }));
check('a malformed score is skipped', scores.parseWikidataScores([{ byLabel: { value: 'Rotten Tomatoes' }, score: { value: 'fresh' } }]).rt === 0);
check('the highest of repeated scores wins', scores.parseWikidataScores([
  { byLabel: { value: 'Rotten Tomatoes' }, score: { value: '80%' } },
  { byLabel: { value: 'Rotten Tomatoes' }, score: { value: '92%' } },
]).rt === 92);
check('a cached entry goes stale after a day', scores.fresh({ at: 1000 }, 1000 + 1000) && !scores.fresh({ at: 1000 }, 1000 + 25 * 3600 * 1000) && !scores.fresh(null));

// ---------- OMDb ----------
const omdb = scores.parseOmdb({
  Response: 'True', imdbRating: '9.5', Metascore: '87',
  Ratings: [
    { Source: 'Internet Movie Database', Value: '9.5/10' },
    { Source: 'Rotten Tomatoes', Value: '96%' },
    { Source: 'Metacritic', Value: '87/100' },
  ],
});
check('OMDb carries all three scores', omdb.imdb === 9.5 && omdb.rt === 96 && omdb.metacritic === 87);
check('critics and audience are two different numbers', (() => {
  const both = scores.parseOmdb({ Response: 'True', tomatoMeter: '94', tomatoUserMeter: '78', tomatoRating: '8.2' });
  return both.rt === 94 && both.rtAudience === 78 && both.rtAverage === 8.2;
})());
check('"N/A" is not an audience score', scores.parseOmdb({ Response: 'True', tomatoUserMeter: 'N/A' }).rtAudience === 0);
check('the Ratings array still wins for the critics', scores.parseOmdb({ Response: 'True', tomatoMeter: '10', Ratings: [{ Source: 'Rotten Tomatoes', Value: '96%' }] }).rt === 96);
check('an audience score survives the merge', scores.mergeScores({ rtAudience: 78 }, { rt: 94 }).rtAudience === 78);
check('a refusal from OMDb is no scores', JSON.stringify(scores.parseOmdb({ Response: 'False', Error: 'Invalid API key!' })) === JSON.stringify({ imdb: 0, rt: 0, rtAverage: 0, rtAudience: 0, metacritic: 0 }));
check('OMDb without a Ratings array still gives the Metascore', scores.parseOmdb({ Response: 'True', Metascore: '61' }).metacritic === 61);
check('"N/A" is not a score', scores.parseOmdb({ Response: 'True', imdbRating: 'N/A', Metascore: 'N/A' }).imdb === 0);
check('a key fills the gaps without overwriting what is known', (() => {
  const merged = scores.mergeScores({ imdb: 0, rt: 96, metacritic: 87 }, { imdb: 9.5, rt: 0, rtAverage: 8.8, metacritic: 0 });
  return merged.imdb === 9.5 && merged.rt === 96 && merged.metacritic === 87 && merged.rtAverage === 8.8;
})());

// ---------- badges ----------
const drawn = badges.badgesFor({ imdb: 8.8, rt: 87, rtAverage: 8.1, metacritic: 74 }, { imdbId: 'tt1375666' });
check('three badges, IMDb first', drawn.length === 3 && drawn[0].key === 'imdb' && drawn[0].value === '8.8');
check('the Tomatometer is fresh at 60 and up, and reads as a percentage', drawn[1].key === 'rt' && drawn[1].tone === 'fresh' && drawn[1].value === '87%'
  && badges.badgesFor({ rt: 41 })[0].tone === 'rotten');
check('Metacritic is toned by its own bands', badges.badgesFor({ metacritic: 75 })[0].tone === 'good'
  && badges.badgesFor({ metacritic: 45 })[0].tone === 'mixed'
  && badges.badgesFor({ metacritic: 20 })[0].tone === 'poor');
check('only IMDb links out, and only with an id', drawn[0].href.includes('tt1375666') && !drawn[1].href && !badges.badgesFor({ imdb: 8 })[0].href);
check('no scores, no badges', badges.badgesFor({}).length === 0 && badges.badgesFor({ imdb: 0, rt: 0, metacritic: 0 }).length === 0);
check('every badge says what it means', drawn.every(badge => badge.title.length > 10));

// ---------- every rating in its square, over either colouring ----------
check('two ways to colour the grid, Rating first', heatmap.MODES.length === 2 && heatmap.MODES[0][0] === 'rating' && heatmap.MODES[1][0] === 'standouts');
check('each mode has a label', heatmap.MODES.every(([value, label]) => value && label));
check('a stored mode this build does not draw falls back to Rating', heatmap.modeName('grid') === 'rating' && heatmap.modeName(null) === 'rating');
check('the old Numbers mode comes back as Rating with the numbers on', heatmap.modeName('numbers') === 'rating' && heatmap.numbersOn('numbers') === true);
check('the numbers switch reads its stored value', heatmap.numbersOn('1') && heatmap.numbersOn(true) && !heatmap.numbersOn('0') && !heatmap.numbersOn(null));
const model3 = heatmap.heatmapModel([
  { season_number: 1, episodes: [{ episode_number: 1, vote_average: 8.4, vote_count: 400, air_date: '2020-01-01' }, { episode_number: 2, vote_average: 9.1, vote_count: 400, air_date: '2020-01-08' }] },
  { season_number: 2, episodes: [{ episode_number: 1, vote_average: 7.6, vote_count: 400, air_date: '2021-01-01' }] },
]);
const drawnGrid = heatmap.heatmapHTML(7, model3, { mode: 'rating', numbers: true });
check('every rating is in the markup whichever colouring is on', /data-n="8\.4"/.test(drawnGrid) && /data-n="9\.1"/.test(drawnGrid) && /data-n="7\.6"/.test(drawnGrid)
  && /data-n="8\.4"/.test(heatmap.heatmapHTML(7, model3, { mode: 'standouts', numbers: true })));
check('...and the season averages stay where they were', /8\.8/.test(drawnGrid) && /7\.6/.test(drawnGrid));
check('the numbers are a switch over the colouring, not a mode of their own', /hm-mode-rating/.test(drawnGrid) && /hm-showing-numbers/.test(drawnGrid)
  && /hm-mode-standouts/.test(heatmap.heatmapHTML(7, model3, { mode: 'standouts', numbers: true })));
check('with the switch off the grid is unchanged but still carries the numbers', (() => {
  const off = heatmap.heatmapHTML(7, model3, { mode: 'rating' });
  return !/hm-showing-numbers/.test(off) && /data-n="8\.4"/.test(off) && /aria-pressed="false"/.test(off);
})());
check('an unrated episode carries no number', !/data-n="0"/.test(heatmap.heatmapHTML(7, heatmap.heatmapModel([
  { season_number: 1, episodes: [{ episode_number: 1, vote_average: 0, vote_count: 0, air_date: '2020-01-01' }] },
]), { mode: 'rating', numbers: true })));

// ---------- backdrops ----------
check('six styles, Aurora first', backdrops.BACKDROPS.length === 6 && backdrops.BACKDROPS[0][0] === 'aurora');
check('each one has a name and a line', backdrops.BACKDROPS.every(([key, label, note]) => key && label && note.length > 8));
check('an unknown stored style falls back to the default', backdrops.backdropName('rainbow') === 'aurora' && backdrops.backdropName('') === 'aurora' && backdrops.backdropName(undefined) === 'aurora');
check('a known style is kept', backdrops.BACKDROPS.every(([key]) => backdrops.backdropName(key) === key));
check('the preview carries the style and its layers', backdrops.previewHTML('silk').includes('data-style="silk"')
  && backdrops.previewHTML('silk').split('bd-layer').length - 1 === backdrops.LAYERS);
check('a preview of nonsense still renders the default', backdrops.previewHTML('nope').includes('data-style="aurora"'));

const prefsModule = await import(SRC + 'prefs.js');
check('the backdrop is a stored preference', prefsModule.DEFAULT_PREFS.backdrop === 'aurora');

summary();
