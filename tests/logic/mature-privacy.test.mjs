// What you watch after dark stays yours. These rules pin the promise made in
// Settings: adult titles never shape recommendations unless the owner opts in,
// never come back as recommendations, and never reach the friend-visible taste
// summary at all. Also here: filter state in the URL, and region certificates —
// the other two things a shared link or a preview can get wrong.
import { check, summary } from './harness.mjs';

// A verdict learned on an earlier visit, remembered on this device. Planted
// before any module reads the store.
localStorage.setItem('cv_mature_titles_v1', JSON.stringify({ movie_900: 1, movie_901: 0 }));

const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const prefsModule = await import(SRC + 'prefs.js');
const rec = await import(SRC + 'recommend.js');
const { certificationFor } = await import(SRC + 'config.js');
const urlState = await import(SRC + 'url-state.js');

const EROTIC = 256466, HEIST = 10051, ROMANCE = 10749, ACTION = 28;
const past = '2015-01-01';

function seedLibrary() {
  state.watchlist = [];
  state.ratings = { movie_1: 9, movie_2: 9 };
  state.watched = {
    // Adult by its stored keywords; its only genre is Romance.
    movie_1: { tmdbId: 1, type: 'movie', title: 'Private Title', genres: [ROMANCE], keywords: [{ id: EROTIC, name: 'erotic' }], cast: [{ id: 77, name: 'Only In Adult' }], directorId: 88, director: 'Adult Director', year: '1999' },
    // An ordinary title: Action, a heist.
    movie_2: { tmdbId: 2, type: 'movie', title: 'Heist Night', genres: [ACTION], keywords: [{ id: HEIST, name: 'heist' }], year: '2015' },
  };
  state.recentlyViewed = [
    { id: 1, type: 'movie', title: 'Private Title', genres: [ROMANCE], keywords: [{ id: EROTIC, name: 'erotic' }], ts: Date.now() },
    { id: 2, type: 'movie', title: 'Heist Night', genres: [ACTION], keywords: [{ id: HEIST, name: 'heist' }], ts: Date.now() - 1000 },
  ];
  state.recommendationFeedback = { dismissed: [], history: [], rotation: 0 };
}

// ================= recommendations, by default =================
seedLibrary();
prefsModule.updatePref('mature', false);
{
  const profile = rec.buildTasteProfile();
  check('default: an adult title adds no genre weight', !(profile.genreWeights[ROMANCE] > 0) && profile.genreWeights[ACTION] > 0);
  check('default: its keywords never become a story theme', !(EROTIC in profile.keywordWeights) && profile.keywordWeights[HEIST] > 0);
  check('default: its cast and director never head a rail', !(77 in profile.actorWeights) && !(88 in profile.directorWeights));
  check('default: a 9/10 rating on it is not a "Because you liked" seed', profile.seedIds.every(seed => +seed.id !== 1) && profile.seedIds.some(seed => +seed.id === 2));
  check('default: opening it cannot head "Because you viewed"', profile.recent.every(item => item.id !== 1));
  check('default: it is still never recommended back (it stays in seen)', profile.seen.has('movie_1'));
  check('default: the profile says it excludes mature titles', profile.excludeMature === true);
}

// ================= opting in =================
prefsModule.updatePref('mature', true);
check('mature content on alone is not an opt-in', rec.matureShapesTaste() === false && rec.buildTasteProfile().genreWeights[ROMANCE] === undefined);
prefsModule.updatePref('matureInRecs', true);
{
  const profile = rec.buildTasteProfile();
  check('opted in: the adult title shapes taste like any other', profile.genreWeights[ROMANCE] > 0 && profile.keywordWeights[EROTIC] > 0 && profile.excludeMature === false);
  const forFriends = rec.buildTasteProfile(state, { includeMature: false });
  check('opted in: the friend-facing build still excludes it', !(profile === forFriends) && !(forFriends.genreWeights[ROMANCE] > 0) && !(EROTIC in forFriends.keywordWeights));
}
prefsModule.updatePref('mature', false);
check('switching mature content off withdraws the opt-in', rec.matureShapesTaste() === false);

// ================= nothing adult is recommended back =================
{
  const profile = rec.buildTasteProfile();
  const base = { poster_path: '/p.jpg', release_date: past, vote_count: 400, vote_average: 7, genre_ids: [ACTION], __type: 'movie', __source: 'genre' };
  const ranked = rec.rankAndDedupe([
    { ...base, id: 500, title: 'Flagged', adult: true },
    { ...base, id: 501, title: 'Fetched by an erotic keyword', __keywordIds: [EROTIC], __source: 'keyword' },
    { ...base, id: 900, title: 'Known adult on this device' },
    { ...base, id: 901, title: 'Known clean on this device' },
    { ...base, id: 502, title: 'Ordinary' },
  ], profile);
  const titles = ranked.map(item => item.title).sort().join(' | ');
  check('adult-flagged, mature-keyword, and known-adult candidates are all dropped', titles === 'Known clean on this device | Ordinary', titles);
  check('the audit counts them honestly', ranked.__auditSummary.rejected.mature === 3);

  const opted = { ...profile, excludeMature: false };
  check('an opted-in profile keeps them', rec.rankAndDedupe([{ ...base, id: 503, title: 'Flagged', adult: true }], opted).length === 1);
}

// ================= group picks =================
{
  const mine = { ...rec.buildTasteProfile(), excludeMature: false };
  const friend = rec.profileFromShared({ genreWeights: { [ACTION]: 3 }, topGenres: [ACTION], seen: [] });
  check('a friend\'s shared profile never admits mature titles', friend.excludeMature === true);
  check('a group containing anyone who excludes them excludes them', rec.blendProfiles([mine, friend]).excludeMature === true);
  check('a solo opted-in party keeps the owner\'s choice', rec.blendProfiles([mine]).excludeMature === false);
}

// ================= what friends can see =================
check('keyIsMature recognises a library title by its stored keywords', rec.keyIsMature('movie_1') === true && rec.keyIsMature('movie_2') === false);
check('keyIsMature uses a verdict remembered on the device', rec.keyIsMature('movie_900') === true && rec.keyIsMature('movie_901') === false);

// ================= certificates follow the streaming region =================
{
  const movie = { release_dates: { results: [
    { iso_3166_1: 'US', release_dates: [{ certification: '' }, { certification: 'R' }] },
    { iso_3166_1: 'IN', release_dates: [{ certification: 'A' }] },
  ] } };
  check('the region\'s own certificate wins', certificationFor(movie, 'movie', 'IN') === 'A');
  check('a region with none falls back to the US', certificationFor(movie, 'movie', 'GB') === 'R');
  check('a blank first entry is skipped, not returned', certificationFor(movie, 'movie', 'US') === 'R');
  const show = { content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }, { iso_3166_1: 'KR', rating: '19' }] } };
  check('TV uses content ratings the same way', certificationFor(show, 'tv', 'kr') === '19' && certificationFor(show, 'tv', 'IN') === 'TV-MA');
  check('nothing anywhere is an empty string, not an error', certificationFor({}, 'movie', 'IN') === '' && certificationFor(null, 'tv') === '');
}

// ================= filter state in the URL =================
{
  const controls = {
    mGenres: { value: '', options: ['', '28', 'adult'] },
    mSort: { value: 'popularity.desc', options: ['popularity.desc', 'vote_average.desc'] },
    mYear: { value: '', options: ['', '2020'] },
    discoverStreaming: { type: 'checkbox', checked: true },
  };
  // A select only takes a value one of its options offers — like the real thing.
  Object.values(controls).forEach(control => {
    if (control.type === 'checkbox') return;
    let current = control.value;
    Object.defineProperty(control, 'value', { get: () => current, set: next => { current = control.options.includes(next) ? next : ''; } });
  });
  document.getElementById = id => controls[id] || null;
  globalThis.history = { state: null, replaceState: (_, __, url) => { const parsed = new URL(url, 'https://x.test'); location.pathname = parsed.pathname; location.search = parsed.search; } };
  const FIELDS = [['genre', 'mGenres'], ['sort', 'mSort', 'popularity.desc'], ['year', 'mYear']];

  location.pathname = '/movies'; location.search = '';
  urlState.writeFilterQuery('/movies', FIELDS);
  check('an untouched page keeps a clean URL', location.search === '');

  controls.mGenres.value = '28'; controls.mSort.value = 'vote_average.desc';
  urlState.writeFilterQuery('/movies', FIELDS);
  check('only non-default values are written', location.search === '?genre=28&sort=vote_average.desc', location.search);

  urlState.writeFilterQuery('/tv', FIELDS);
  check('a page never writes into another page\'s URL', location.pathname === '/movies' && location.search === '?genre=28&sort=vote_average.desc');

  location.search = '?genre=adult&year=2020';
  check('a URL naming any filter is recognised', urlState.urlNamesFilters(FIELDS));
  const accepted = urlState.applyFilterQuery(FIELDS);
  check('a shared link decides every field, resetting the ones it does not name', controls.mGenres.value === 'adult' && controls.mYear.value === '2020' && controls.mSort.value === 'popularity.desc');
  check('it reports how many values it accepted', accepted === 2);

  location.search = '?genre=99999';
  urlState.applyFilterQuery(FIELDS);
  check('a value no option offers falls back to the default', controls.mGenres.value === '');

  location.search = '?streaming=0';
  urlState.applyFilterQuery([['streaming', 'discoverStreaming', '1']]);
  check('a checkbox restores off from the URL', controls.discoverStreaming.checked === false);
  location.pathname = '/discover'; location.search = '';
  urlState.writeFilterQuery('/discover', [['streaming', 'discoverStreaming', '1']], { preset: 'hidden' });
  check('a checkbox at its default is not written; extra state is', location.search === '?streaming=0&preset=hidden', location.search);
  urlState.writeFilterQuery('/discover', [], { preset: '' });
  check('an empty extra removes its param and keeps the others', location.search === '?streaming=0', location.search);
}

summary();
