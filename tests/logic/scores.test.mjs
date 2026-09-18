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
check('a refusal from OMDb is no scores', JSON.stringify(scores.parseOmdb({ Response: 'False', Error: 'Invalid API key!' })) === JSON.stringify({ imdb: 0, rt: 0, rtAverage: 0, metacritic: 0 }));
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

// ---------- every rating on the page: the heatmap's Numbers view ----------
check('three ways to read the grid, Rating first', heatmap.MODES.length === 3 && heatmap.MODES[0][0] === 'rating' && heatmap.MODE_NAMES.includes('numbers'));
check('each mode has a label', heatmap.MODES.every(([value, label]) => value && label));
check('a stored mode this build does not draw falls back to Rating', heatmap.modeName('grid') === 'rating' && heatmap.modeName(null) === 'rating' && heatmap.modeName('numbers') === 'numbers');
const drawnGrid = heatmap.heatmapHTML(7, heatmap.heatmapModel([
  { season_number: 1, episodes: [{ episode_number: 1, vote_average: 8.4, vote_count: 400, air_date: '2020-01-01' }, { episode_number: 2, vote_average: 9.1, vote_count: 400, air_date: '2020-01-08' }] },
  { season_number: 2, episodes: [{ episode_number: 1, vote_average: 7.6, vote_count: 400, air_date: '2021-01-01' }] },
]), { mode: 'numbers' });
check('Numbers mode carries every rating in the markup', /data-n="8\.4"/.test(drawnGrid) && /data-n="9\.1"/.test(drawnGrid) && /data-n="7\.6"/.test(drawnGrid));
check('...and the season averages stay where they were', /8\.8/.test(drawnGrid) && /7\.6/.test(drawnGrid));
check('the grid says which mode it is in', /hm-mode-numbers/.test(drawnGrid) && !/hm-mode-rating/.test(drawnGrid));
check('an unrated episode carries no number', !/data-n="0"/.test(heatmap.heatmapHTML(7, heatmap.heatmapModel([
  { season_number: 1, episodes: [{ episode_number: 1, vote_average: 0, vote_count: 0, air_date: '2020-01-01' }] },
]), { mode: 'numbers' })));

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
