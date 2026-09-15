// The Adult filter. One definition of "adult" is shared by every filter bar in
// the app, so the rules pinned here are what keep Movies, Search, My List,
// Watched and a filmography agreeing about the same title — and what keep the
// filter from doing anything at all while mature content is off.
import { check, summary } from './harness.mjs';

// The shim's document swallows events. These suites need `cv:mature` to really
// reach its listeners, so a minimal emitter stands in for the two methods.
const listeners = new Map();
document.addEventListener = (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); };
document.dispatchEvent = event => { (listeners.get(event.type) || []).forEach(fn => fn(event)); return true; };

// Resolved from this file so the suite runs from any checkout, on any OS.
const SRC = new URL('../../js/', import.meta.url).href;
const prefsModule = await import(SRC + 'prefs.js');
const filter = await import(SRC + 'mature-filter.js');
const { applyWatchedFilters } = await import(SRC + 'watched.js');
const { MATURE_KEYWORDS } = await import(SRC + 'config.js');

const EROTIC = 256466, THRILLER = 207767, UNRELATED = 9715;
const setMature = on => prefsModule.updatePref('mature', on);
const idsOf = query => String(query).split('|').map(Number).sort((a, b) => a - b).join(',');
const everyId = MATURE_KEYWORDS.map(keyword => keyword.id).sort((a, b) => a - b).join(',');

// ================= while mature content is off =================
setMature(false);
check('off: every control value reads as "no filter"', ['only', 'hide', '', 'junk', undefined].every(value => filter.adultMode(value) === ''));
{
  const params = { include_adult: false, sort_by: 'popularity.desc' };
  filter.applyAdultParams(params, 'only');
  check('off: a leftover "only" cannot change a request', JSON.stringify(params) === JSON.stringify({ include_adult: false, sort_by: 'popularity.desc' }));
}
check('off: the select is never built', filter.syncAdultSelect({ id: 'x', host: null }) === false);

// ================= the request parameters =================
setMature(true);
check('on: only/hide are kept, anything else is no filter', filter.adultMode('only') === 'only' && filter.adultMode('hide') === 'hide' && filter.adultMode('everything') === '');
check('the keyword query names every mature keyword exactly once', idsOf(filter.MATURE_KEYWORD_QUERY) === everyId);
check('it is pipe-separated, which TMDB reads as OR', !filter.MATURE_KEYWORD_QUERY.includes(','));
{
  const only = filter.applyAdultParams({ include_adult: false }, 'only');
  check('"only" asks for any mature keyword', idsOf(only.with_keywords) === everyId);
  check('"only" includes adult-flagged titles', only.include_adult === true);
  const hide = filter.applyAdultParams({ include_adult: true }, 'hide');
  check('"hide" excludes every mature keyword', idsOf(hide.without_keywords) === everyId);
  check('"hide" drops adult-flagged titles too', hide.include_adult === false);
  const merged = filter.applyAdultParams({ without_keywords: '999' }, 'hide');
  check('"hide" keeps an existing exclusion instead of overwriting it', merged.without_keywords.split('|')[0] === '999' && merged.without_keywords.split('|').length === MATURE_KEYWORDS.length + 1);
  const none = filter.applyAdultParams({ include_adult: true, with_genres: '18' }, '');
  check('no filter leaves the request alone', JSON.stringify(none) === JSON.stringify({ include_adult: true, with_genres: '18' }));
}

// ================= what stored keywords prove =================
check('a mature keyword object proves adult', filter.matureFromKeywords([{ id: UNRELATED, name: 'x' }, { id: EROTIC, name: 'erotic' }]) === true);
check('a bare mature keyword id proves adult', filter.matureFromKeywords([UNRELATED, THRILLER]) === true);
check('a short list without one proves not adult', filter.matureFromKeywords([{ id: UNRELATED }, { id: 1 }]) === false);
check('no keywords proves nothing', filter.matureFromKeywords([]) === null && filter.matureFromKeywords(undefined) === null);
{
  // Stored documents keep the first 15 keywords; the 16th could be "erotic".
  const fifteen = Array.from({ length: filter.STORED_KEYWORD_LIMIT }, (_, index) => ({ id: 1000 + index }));
  check('a list cut at the storage limit cannot prove absence', filter.matureFromKeywords(fifteen) === null);
  check('the same list from TMDB in full can', filter.matureFromKeywords(fifteen, { complete: true }) === false);
}

// ================= classifying a title =================
filter.resetMatureVerdicts();
check('TMDB\'s adult flag is adult, whatever the keywords', filter.matureStatus('movie', 1, { adult: true, keywords: [{ id: UNRELATED }] }) === true);
check('keywords decide when they can', filter.matureStatus('movie', 2, { keywords: [{ id: EROTIC }] }) === true && filter.matureStatus('movie', 3, { keywords: [{ id: UNRELATED }] }) === false);
check('an unknown title is null, not false', filter.matureStatus('movie', 4, {}) === null);
check('people and malformed ids are never classified', filter.matureStatus('person', 5, { adult: true }) === null && filter.matureStatus('movie', 0, { adult: true }) === null);

check('"only" admits adult and nothing else', filter.adultPass(true, 'only') && !filter.adultPass(false, 'only') && !filter.adultPass(null, 'only'));
check('"hide" admits proven non-adult and holds unknown titles back', filter.adultPass(false, 'hide') && !filter.adultPass(true, 'hide') && !filter.adultPass(null, 'hide'));
check('no filter admits everything', [true, false, null].every(status => filter.adultPass(status, '')));

// ================= looking titles up =================
const calls = [];
let failFor = new Set();
globalThis.fetch = async url => {
  const path = new URL(url).pathname;
  calls.push(path);
  const id = +path.split('/')[3];   // /3/{type}/{id}/keywords
  if (failFor.has(id)) return { ok: false, status: 404, json: async () => ({}) };
  await new Promise(resolve => setTimeout(resolve, 5));
  const tagged = id % 2 === 0;   // even ids are erotic, odd ids are not
  return { ok: true, status: 200, json: async () => ({ id, keywords: tagged ? [{ id: UNRELATED, name: 'x' }, { id: EROTIC, name: 'erotic' }] : [{ id: UNRELATED, name: 'x' }] }) };
};

filter.resetMatureVerdicts();
{
  const titles = [10, 11, 12, 13].map(id => ({ type: 'movie', id }));
  check('every unknown title is pending before a lookup', filter.pendingMature(titles).length === 4 && filter.checkingMature(titles).length === 4);
  // Two surfaces asking at once, one of them twice over the same titles.
  const [first, second] = await Promise.all([filter.resolveMature(titles), filter.resolveMature([...titles, ...titles])]);
  check('concurrent lookups fetch each title exactly once', calls.filter(path => path.endsWith('/keywords')).length === 4);
  check('the verdicts are learned once, and the second caller still waited for them', first + second === 4 && titles.every(title => filter.matureStatus(title.type, title.id) !== null));
  check('each verdict matches the keywords TMDB returned', filter.matureStatus('movie', 10) === true && filter.matureStatus('movie', 11) === false && filter.matureStatus('movie', 12) === true);
  check('verdicts are remembered on the device', JSON.parse(localStorage.getItem('cv_mature_titles_v1'))['movie_13'] === 0);
  check('nothing is pending or being checked afterwards', !filter.pendingMature(titles).length && !filter.checkingMature(titles).length);

  calls.length = 0;
  await filter.resolveMature(titles);
  check('a known title is never looked up again', calls.length === 0);
}
{
  failFor = new Set([21]);
  calls.length = 0;
  const titles = [{ type: 'tv', id: 20 }, { type: 'tv', id: 21 }];
  await filter.resolveMature(titles);
  check('a failed lookup leaves the title unknown', filter.matureStatus('tv', 21) === null && filter.matureStatus('tv', 20) === true);
  check('and is reported as unresolved rather than still checking', filter.unresolvedMature(titles).length === 1 && !filter.checkingMature(titles).length);
  const before = calls.length;
  await filter.resolveMature(titles);
  check('it is not retried in a loop by the next repaint', calls.length === before && !filter.pendingMature(titles).length);
  failFor = new Set();
}
{
  // A title whose stored keywords already settle it costs no request at all.
  calls.length = 0;
  await filter.resolveMature([{ type: 'movie', id: 30, keywords: [{ id: THRILLER }] }, { type: 'movie', id: 31, adult: true }]);
  check('titles settled by stored data are never fetched', calls.length === 0);
}

// ================= the Watched page =================
{
  const now = new Date('2026-09-15T12:00:00Z');
  const base = { genres: [], cast: [], keywords: [], ts: 1, plays: 1 };
  const items = [
    { ...base, id: 1, type: 'movie', title: 'Adult', mature: true },
    { ...base, id: 2, type: 'movie', title: 'Clean', mature: false },
    { ...base, id: 3, type: 'tv', title: 'Unknown', mature: null },
  ];
  const titles = filters => applyWatchedFilters(items, { now, ...filters }).map(item => item.title).sort().join(',');
  check('Watched: no adult filter keeps every title', titles({}) === 'Adult,Clean,Unknown');
  check('Watched: "only" keeps adult titles', titles({ adult: 'only' }) === 'Adult');
  check('Watched: "hide" keeps proven non-adult titles', titles({ adult: 'hide' }) === 'Clean');
  check('Watched: items built before the field existed are unaffected by no filter', applyWatchedFilters([{ ...base, id: 9, type: 'movie', title: 'Old' }], { now }).length === 1);
}

// ================= announcing the preference =================
{
  let fired = 0;
  const toggles = [];
  document.addEventListener('cv:mature', () => { fired++; });
  filter.onMatureToggle(on => toggles.push(on));
  setMature(true);
  check('setting the same value announces nothing', fired === 0 && !toggles.length);
  prefsModule.updatePref('matureBlur', !prefsModule.prefs.matureBlur);
  check('a blur change is announced as cv:mature…', fired === 1);
  check('…but is not a mature toggle', !toggles.length);
  prefsModule.updatePref('density', 'compact');
  check('an unrelated preference announces nothing', fired === 1);
  setMature(false);
  check('switching it off is announced and toggles', fired === 2 && toggles.join() === 'false');
  prefsModule.hydratePrefs({ ...prefsModule.prefs, mature: true, _updatedAt: Date.now() + 60000 });
  check('a preference arriving from another device is announced too', fired === 3 && toggles.join() === 'false,true');
  prefsModule.resetPrefs();
  check('a reset back to the default is announced', fired === 4 && toggles.join() === 'false,true,false');
}

summary();
