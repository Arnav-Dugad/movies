const SERVER_KEY = 'cv_test_progress_server';
const VERSION_KEY = 'cv_test_show_version';
let offline = sessionStorage.getItem('cv_test_offline') === '1';

const readServer = () => { try { return JSON.parse(localStorage.getItem(SERVER_KEY) || '{}'); } catch (_) { return {}; } };
const writeServer = value => localStorage.setItem(SERVER_KEY, JSON.stringify(value));
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function progressCollection(uid) {
  return {
    async get() {
      if (offline) throw new Error('offline');
      const rows = readServer()[uid] || {};
      return { docs: Object.entries(rows).map(([id, value]) => ({ id, data: () => clone(value) })) };
    },
    doc(key) {
      return {
        uid, key,
        async get() {
          if (offline) throw new Error('offline');
          const value = readServer()[uid]?.[key];
          return { exists: !!value, data: () => clone(value) };
        },
        async set(value, options = {}) {
          if (offline) throw new Error('offline');
          const all = readServer(), old = all[uid]?.[key] || {};
          all[uid] = all[uid] || {};
          all[uid][key] = options.merge ? { ...old, ...clone(value) } : clone(value);
          writeServer(all);
        },
        async delete() {
          if (offline) throw new Error('offline');
          const all = readServer();
          if (all[uid]) delete all[uid][key];
          writeServer(all);
        },
      };
    },
  };
}

const fakeDb = {
  collection(name) {
    if (name !== 'users') throw new Error(`Unexpected collection ${name}`);
    return { doc: uid => ({ collection: name2 => {
      if (name2 !== 'progress') throw new Error(`Unexpected subcollection ${name2}`);
      return progressCollection(uid);
    } }) };
  },
  async runTransaction(worker) {
    if (offline) throw new Error('offline');
    return worker({
      get: ref => ref.get(),
      set: (ref, value) => ref.set(value),
    });
  },
};

const firestore = () => fakeDb;
firestore.FieldValue = { serverTimestamp: () => Date.now(), increment: value => value };
window.firebase = { initializeApp() {}, auth: () => ({}), firestore };

const past = offset => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
const future = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const version = () => Math.max(1, +(localStorage.getItem(VERSION_KEY) || 2));
const episode = (season, number, airDate = past(20 - season * 4 - number)) => ({
  id: season * 100 + number, season_number: season, episode_number: number,
  name: `Season ${season} Episode ${number}`, air_date: airDate, runtime: 45,
  overview: `Fixture episode ${season}-${number}`, vote_average: 8, still_path: '',
});

function showPayload() {
  const count = version();
  return {
    id: 1, name: 'Tracker Fixture', original_name: 'Tracker Fixture', overview: 'A deterministic show used to exercise the real CineVerse detail tracker.',
    first_air_date: past(200), status: 'Returning Series', poster_path: '', backdrop_path: '', vote_average: 8.4,
    genres: [{ id: 18, name: 'Drama' }], origin_country: ['IN'], original_language: 'en', episode_run_time: [45],
    seasons: [{ season_number: 1, name: 'Season 1', episode_count: 3, air_date: past(190), poster_path: '' }, { season_number: 2, name: 'Season 2', episode_count: 3, air_date: past(40), poster_path: '' }],
    last_episode_to_air: { season_number: 2, episode_number: count, air_date: past(1), runtime: 45 },
    next_episode_to_air: count < 3 ? { season_number: 2, episode_number: count + 1, name: `Season 2 Episode ${count + 1}`, air_date: future(2) } : null,
    number_of_episodes: 6, number_of_seasons: 2, created_by: [], networks: [], production_companies: [], spoken_languages: [],
    images: { logos: [], backdrops: [], posters: [] }, recommendations: { results: [] }, keywords: { results: [] },
    external_ids: {}, content_ratings: { results: [] }, alternative_titles: { results: [] }, 'watch/providers': { results: {} },
  };
}

window.fetch = async input => {
  const url = new URL(String(input));
  if (url.hostname === 'api.tvmaze.com') return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  if (url.hostname !== 'api.themoviedb.org') return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  const path = url.pathname.replace('/3', '');
  let body = {};
  if (path === '/tv/1') body = showPayload();
  else if (path === '/tv/1/season/1') body = { season_number: 1, episodes: [episode(1, 1), episode(1, 2), episode(1, 3)] };
  else if (path === '/tv/1/season/2') body = { season_number: 2, episodes: [episode(2, 1), episode(2, 2), episode(2, 3, version() >= 3 ? past(1) : future(2))] };
  else if (path.endsWith('/credits')) body = { cast: [], crew: [] };
  else if (path.endsWith('/videos') || path.endsWith('/similar') || path.endsWith('/reviews')) body = { results: [] };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

window.IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
window.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia ||= () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
window.scrollTo ||= () => {};

const { state } = await import('/js/state.js');
const episodes = await import('/js/episodes.js');
const { initDelegation } = await import('/js/events.js');
const detail = await import('/js/detail.js');
const { initHScroll } = await import('/js/hscroll.js');

initDelegation();
detail.initDetail();
initHScroll();

async function signIn(uid) {
  episodes.resetEpisodeProgressForAuth();
  state.user = uid ? { uid } : null;
  sessionStorage.setItem('cv_test_uid', uid || '');
  if (uid) await episodes.loadEpisodeProgress();
  document.dispatchEvent(new Event('cv:auth'));
}

const initialUid = sessionStorage.getItem('cv_test_uid') || 'alice';
await signIn(initialUid);

window.cvTest = {
  ready: true,
  async signIn(uid) { await signIn(uid); },
  async open() { await detail.openDetail(1, 'tv'); },
  setVersion(value) { localStorage.setItem(VERSION_KEY, String(value)); },
  setOffline(value) { offline = !!value; sessionStorage.setItem('cv_test_offline', value ? '1' : '0'); },
  async load() { await episodes.loadEpisodeProgress(); },
  async refresh() { return episodes.refreshTrackedShows({ force: true }); },
  entry() { return clone(episodes.showEntry(1)); },
  progress() { return clone(episodes.showProgress(1)); },
  next() { return clone(episodes.nextUp(1)); },
  seedLocal(uid, value) { localStorage.setItem(`cv_episode_progress_${uid}`, JSON.stringify(value ? { tv_1: value } : {})); },
  seedServer(uid, value) { const all = readServer(); all[uid] = value ? { tv_1: value } : {}; writeServer(all); },
  server(uid) { return clone(readServer()[uid]?.tv_1 || null); },
};
