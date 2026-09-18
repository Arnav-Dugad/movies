// Outside scores (IMDb, Rotten Tomatoes, Metacritic), the whole-series ratings
// grid, and the moving backdrops.
import { check, summary } from './harness.mjs';

const SRC = new URL('../../js/', import.meta.url).href;
const scores = await import(SRC + 'scores.js');
const badges = await import(SRC + 'score-badges.js');
const grid = await import(SRC + 'episode-grid.js');
const backdrops = await import(SRC + 'backdrops.js');

// ---------- reading a rating ----------
check('a string rating becomes a number', scores.normaliseRating('8.8') === 8.8);
check('junk is no rating', scores.normaliseRating('n/a') === 0 && scores.normaliseRating('') === 0 && scores.normaliseRating(null) === 0);
check('an impossible rating is no rating', scores.normaliseRating(11) === 0 && scores.normaliseRating(-3) === 0);
check('bands run great to poor', ['great', 'good', 'fair', 'weak', 'poor'].join() === [9.4, 8.2, 7.1, 6.5, 4].map(scores.bandFor).join());
check('nothing rated has its own band', scores.bandFor(0) === 'none' && scores.bandFor(undefined) === 'none');
check('the grid bands agree with the badges', [9.4, 8.2, 7.1, 6.5, 4, 0].every(value => grid.bandFor(value) === scores.bandFor(value)));

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

// ---------- badges ----------
const drawn = badges.badgesFor({ imdb: 8.8, rt: 87, rtAverage: 8.1, metacritic: 74 }, { imdbId: 'tt1375666' });
check('three badges, IMDb first', drawn.length === 3 && drawn[0].key === 'imdb' && drawn[0].value === '8.8');
check('the Tomatometer is fresh at 60 and up', drawn[1].key === 'rt fresh' && badges.badgesFor({ rt: 41 })[0].key === 'rt rotten');
check('Metacritic is toned by its own bands', badges.badgesFor({ metacritic: 75 })[0].key === 'mc good'
  && badges.badgesFor({ metacritic: 45 })[0].key === 'mc mixed'
  && badges.badgesFor({ metacritic: 20 })[0].key === 'mc poor');
check('only IMDb links out, and only with an id', drawn[0].href.includes('tt1375666') && !drawn[1].href && !badges.badgesFor({ imdb: 8 })[0].href);
check('no scores, no badges', badges.badgesFor({}).length === 0 && badges.badgesFor({ imdb: 0, rt: 0, metacritic: 0 }).length === 0);
check('every badge says what it means', drawn.every(badge => badge.title.length > 10));

// ---------- the grid ----------
const payloads = [
  { season_number: 1, episodes: [{ episode_number: 1, vote_average: 8.4 }, { episode_number: 2, vote_average: 9.1 }, { episode_number: 3, vote_average: 0 }] },
  { season_number: 2, episodes: [{ episode_number: 1, vote_average: 7.6 }, { episode_number: 2, vote_average: 8 }] },
  { season_number: 0, episodes: [{ episode_number: 1, vote_average: 9.9 }] },
];
const model = grid.gridModel(payloads);
check('a column per season, specials excluded', model.seasons.join() === '1,2');
check('as many rows as the longest season', model.rows === 2);
check('unrated episodes leave a hole', model.rated === 4 && !model.cells['1-3']);
check('each season averages its own episodes', model.averages[1] === 8.8 && model.averages[2] === 7.8);
check('the best episode is found', model.best === '1-2');
check('the sentence names the best and worst seasons', /Season 1 rates highest \(8\.8\), season 2 lowest \(7\.8\) · best S1 E2 \(9\.1\)/.test(grid.gridHeadline(model)), grid.gridHeadline(model));
const single = grid.gridModel([payloads[0]]);
check('one season reads differently', /2 episodes rated · best S1 E2/.test(grid.gridHeadline(single)), grid.gridHeadline(single));
check('nothing rated, nothing to say', grid.gridModel([]).rated === 0 && grid.gridHeadline(grid.gridModel([])) === '');
check('a season with no ratings is not a column', grid.gridModel([{ season_number: 3, episodes: [{ episode_number: 1, vote_average: 0 }] }]).seasons.length === 0);
check('every band has a label', grid.BANDS.length === 6 && grid.BANDS.every(([band, label]) => band && label));

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
