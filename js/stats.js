// ===== CINEPRINT — PREMIUM STATS + TASTE MAP =====
// Rich analytics are derived from the user's Firestore-backed lists, ratings and
// watched history. A compact snapshot is mirrored onto users/{uid} only when its
// content hash changes, keeping it durable without burning free-tier writes.
import { genreMap, mGenreList, tGenreList, IMG, PH } from './config.js';
import { state } from './state.js';
import { $, esc, debounce, toast } from './ui.js';
import { registerActions } from './events.js';
import { observeCountUps, observeReveals } from './effects.js';
import { buildCtx, badgesHTML, challengesHTML, animateBadgeBars } from './badges.js';
import { ensureWatchedMeta, repairCollectionMeta } from './watched-meta.js';
import { db, firebase } from './firebase.js';
import { social } from './social.js';
import { tmdb } from './api.js';
import { buildCard } from './cards.js';
import { getProviderStats, getCatalogSeries } from './provider-history.js';

let statsScope = 'all';
let latestSnapshot = null;
let syncState = 'idle';
let syncMessage = 'Private';
let checkedUid = '', remoteHash = '', lastQueuedHash = '';
let repairActive = false, insightGeneration = 0, latestDirectorLoyalty = null;
const MOVIE_GENRES = new Set(mGenreList.map(genre => genre.id));
const TV_GENRES = new Set(tGenreList.map(genre => genre.id));

const ICONS = {
  watched: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1Z"/></svg>',
  library: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>',
  fire: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22c4 0 7-3 7-7 0-3-1.5-5.5-4-8 .1 2-1 3.5-2.5 4.5.3-4-2-7-5.5-9 .4 3-2 5-2 9 0 5.5 3 10.5 7 10.5Z"/></svg>',
  compass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 16a4 4 0 0 1 1-7.9A6 6 0 0 1 17.7 10H19a3 3 0 0 1 0 6H5Z"/><path d="m9 19 3 3 3-3M12 14v8"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m-4-4 4 4 4-4M5 21h14"/></svg>',
};

const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const itemKey = item => item.id || `${item.type}_${item.tmdbId}`;
const inScope = (type, scope) => scope === 'all' || type === scope;
const rowIdentity = (key, doc = {}) => {
  const split = String(key || '').lastIndexOf('_');
  const keyType = split > 0 ? String(key).slice(0, split) : '';
  const keyId = split > 0 ? +String(key).slice(split + 1) : 0;
  const type = doc.type || keyType, id = +(doc.tmdbId || keyId || 0);
  return { type, id, key: type && id ? `${type}_${id}` : String(key || '') };
};

function languageName(code) {
  const value = String(code || '').toLowerCase();
  if (!value) return '';
  try { return new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(value) || value.toUpperCase(); }
  catch (_) { return ({ en: 'English', hi: 'Hindi', ko: 'Korean', ja: 'Japanese', es: 'Spanish', fr: 'French', de: 'German', zh: 'Chinese', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', mr: 'Marathi' })[value] || value.toUpperCase(); }
}

function watchedDate(doc) {
  const raw = doc?.watchedAt;
  const ms = raw?.seconds ? raw.seconds * 1000 : raw?.toMillis ? raw.toMillis() : 0;
  if (!ms) return null;
  const date = new Date(ms);
  const year = date.getFullYear();
  return year >= 2020 && year <= new Date().getFullYear() + 1 ? date : null;
}

function canonicalRows(scope) {
  const rows = new Map();
  state.watchlist.forEach(item => {
    const identity = rowIdentity(itemKey(item), item);
    if (!identity.type || !identity.id || !inScope(identity.type, scope)) return;
    const key = identity.key;
    rows.set(key, {
      key, id: identity.id, type: identity.type, title: item.title || '', poster: item.poster || '',
      year: item.year || '', releaseDate: item.releaseDate || '', genres: item.genres || [],
      language: item.language || '', country: item.country || '', runtime: +(item.runtime || 0), episodeRuntime: +(item.episodeRuntime || 0), episodeCount: +(item.episodeCount || 0),
      tmdbRating: +(item.rating || 0), saved: true, watched: false, watchedAt: null,
      director: '', directorId: 0, directorProfile: '', cast: [],
    });
  });
  Object.entries(state.watched).forEach(([key, doc]) => {
    const identity = rowIdentity(key, doc);
    if (!identity.type || !identity.id || !inScope(identity.type, scope)) return;
    const canonicalKey = identity.key;
    const old = rows.get(canonicalKey) || { key: canonicalKey, id: identity.id, type: identity.type, saved: false };
    rows.set(canonicalKey, {
      ...old,
      key: canonicalKey, id: identity.id, type: identity.type,
      title: doc.title || old.title || '', poster: doc.poster || old.poster || '',
      year: doc.year || old.year || '', releaseDate: doc.releaseDate || old.releaseDate || '',
      genres: doc.genres?.length ? doc.genres : (old.genres || []),
      language: doc.language || old.language || '', country: doc.country || old.country || '',
      runtime: +(doc.runtime || old.runtime || 0), episodeRuntime: +(doc.episodeRuntime || old.episodeRuntime || 0), episodeCount: +(doc.episodeCount || old.episodeCount || 0), tmdbRating: +(doc.tmdbRating || old.tmdbRating || 0),
      director: doc.director || old.director || '', directorId: doc.directorId || old.directorId || 0,
      directorProfile: doc.directorProfile || old.directorProfile || '',
      cast: doc.cast?.length ? doc.cast : (old.cast || []), watched: true, watchedAt: watchedDate(doc),
    });
  });
  rows.forEach(row => { row.userRating = +(state.ratings[row.key] || 0); });
  return [...rows.values()];
}

function bump(map, key, amount = 1, extra = {}) {
  if (key == null || key === '') return;
  const entry = map.get(key) || { key, count: 0, ...extra };
  entry.count += amount;
  map.set(key, entry);
}

function sorted(map, limit = 12) {
  return [...map.values()].sort((a, b) => b.count - a.count || String(a.name || a.key).localeCompare(String(b.name || b.key))).slice(0, limit);
}

function streaks(dateKeys) {
  const days = [...new Set(dateKeys)].sort();
  let longest = 0, run = 0, previous = null;
  days.forEach(key => {
    const current = new Date(`${key}T12:00:00`);
    const gap = previous ? Math.round((current - previous) / 86400000) : 0;
    run = previous && gap === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = current;
  });
  let current = 0;
  if (days.length) {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    let cursor = new Date(`${days[days.length - 1]}T12:00:00`);
    const lag = Math.round((today - cursor) / 86400000);
    if (lag <= 1) {
      current = 1;
      for (let i = days.length - 2; i >= 0; i--) {
        const prior = new Date(`${days[i]}T12:00:00`);
        if (Math.round((cursor - prior) / 86400000) !== 1) break;
        current++; cursor = prior;
      }
    }
  }
  return { current, longest };
}

function buildHeatDays(activityMap) {
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const total = 52 * 7 + today.getDay() + 1;
  const start = new Date(today); start.setDate(today.getDate() - total + 1);
  return Array.from({ length: total }, (_, index) => {
    const date = new Date(start); date.setDate(start.getDate() + index);
    const key = dayKey(date), count = activityMap.get(key) || 0;
    return { key, count, label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) };
  });
}

function collectionHealth(rows, watched) {
  if (!rows.length) return { score: 0, missing: 0, checks: [], perfect: false };
  const make = (key, label, source, valid, hint) => {
    const missingRows = source.filter(row => !valid(row));
    const coverage = source.length ? Math.round((source.length - missingRows.length) / source.length * 100) : 100;
    return { key, label, missing: missingRows.length, total: source.length, coverage, hint, titles: missingRows.slice(0, 4).map(row => row.title).filter(Boolean) };
  };
  const checks = [
    make('ratings', 'Personal ratings', watched, row => row.userRating > 0, 'Rate watched titles to sharpen recommendations.'),
    make('metadata', 'Core metadata', rows, row => row.runtime > 0 && row.language && row.genres?.length, 'Runtime, language, and genre information.'),
    make('posters', 'Poster artwork', rows, row => !!row.poster, 'Missing poster art is automatically refreshed.'),
    make('dates', 'Release dates', rows, row => !!row.releaseDate, 'Exact release dates power era and reminder insights.'),
    make('credits', 'People credits', watched, row => !!row.directorId && row.cast?.length, 'Director and cast data power loyalty insights.'),
  ];
  const score = Math.round(checks.reduce((sum, check) => sum + check.coverage, 0) / checks.length);
  return { score, missing: checks.reduce((sum, check) => sum + check.missing, 0), checks, perfect: score === 100 };
}

function tasteChanges(watched) {
  const months = new Map();
  watched.filter(row => row.watchedAt).forEach(row => {
    const key = monthKey(row.watchedAt);
    if (!months.has(key)) months.set(key, { key, date: row.watchedAt, total: 0, genres: new Map(), languages: new Map() });
    const bucket = months.get(key); bucket.total++;
    (row.genres || []).forEach(id => { if (genreMap[id]) bump(bucket.genres, String(id), 1, { name: genreMap[id] }); });
    if (row.language) bump(bucket.languages, row.language, 1, { name: languageName(row.language) });
  });
  const periods = [...months.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(-6).map(bucket => {
    const genre = sorted(bucket.genres, 1)[0] || null, language = sorted(bucket.languages, 1)[0] || null;
    return {
      key: bucket.key, label: bucket.date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), total: bucket.total,
      genre: genre?.name || 'Unknown', genreShare: genre ? Math.round(genre.count / bucket.total * 100) : 0,
      language: language?.name || 'Unknown', languageCode: language?.key || '', languageShare: language ? Math.round(language.count / bucket.total * 100) : 0,
    };
  });
  const changes = (field) => periods.slice(1).filter((period, index) => period[field] !== periods[index][field]).length;
  return { periods, genreChanges: changes('genre'), languageChanges: changes('language') };
}

export function computeStats(scope) {
  const rows = canonicalRows(scope);
  const watched = rows.filter(row => row.watched);
  const saved = rows.filter(row => row.saved);
  const ratingEntries = Object.entries(state.ratings).filter(([key]) => scope === 'all' || key.startsWith(scope + '_'));
  const ratingValues = ratingEntries.map(([, score]) => +score).filter(Boolean);
  const watchedRated = watched.filter(row => row.userRating > 0).length;

  const genres = new Map(), decades = new Map(), languages = new Map();
  rows.forEach(row => {
    (row.genres || []).forEach(id => { if (genreMap[id]) bump(genres, String(id), 1, { name: genreMap[id] }); });
    const year = +(row.year || 0); if (year) { const decade = Math.floor(year / 10) * 10; bump(decades, String(decade), 1, { name: `${decade}s` }); }
    if (row.language) bump(languages, row.language, 1, { name: languageName(row.language) });
  });
  const genreRows = sorted(genres), decadeRows = sorted(decades), languageRows = sorted(languages);

  const activity = new Map(), months = new Map();
  const weekdays = Array(7).fill(0);
  watched.forEach(row => {
    if (!row.watchedAt) return;
    bump(activity, dayKey(row.watchedAt));
    bump(months, monthKey(row.watchedAt));
    weekdays[row.watchedAt.getDay()]++;
  });
  const dateKeys = [...activity.keys()];
  const streak = streaks(dateKeys);
  const now = new Date();
  const last30Cutoff = new Date(now); last30Cutoff.setDate(now.getDate() - 30);
  const last12Months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (11 - index), 1);
    const key = monthKey(date);
    return { key, label: date.toLocaleDateString(undefined, { month: 'short' }), count: months.get(key)?.count || 0 };
  });
  const bestMonthRaw = sorted(months, 1)[0];
  const bestMonth = bestMonthRaw ? new Date(`${bestMonthRaw.key}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'Not enough history';

  const runtimes = watched.map(row => row.runtime).filter(value => value > 0);
  // Total watch time uses a completed show's full runtime, while "average runtime"
  // compares equivalent viewing units: movie length or episode length. Mixing an
  // entire 80-episode series with a two-hour film made the old average meaningless.
  const averageUnits = watched.map(row => row.type === 'tv'
    ? +(row.episodeRuntime || (row.episodeCount > 0 ? row.runtime / row.episodeCount : 0))
    : +row.runtime).filter(value => value > 0 && value < 1000);
  const movieRuntimes = watched.filter(row => row.type === 'movie').map(row => +row.runtime).filter(value => value > 0 && value < 1000);
  const episodeRuntimes = watched.filter(row => row.type === 'tv').map(row => +(row.episodeRuntime || (row.episodeCount > 0 ? row.runtime / row.episodeCount : 0))).filter(value => value > 0 && value < 1000);
  const enriched = rows.filter(row => row.runtime > 0 && row.language && row.year && row.genres?.length);
  const totalMinutes = runtimes.reduce((sum, value) => sum + value, 0);
  const years = rows.map(row => +(row.year || 0)).filter(year => year > 1800 && year < 2200).sort((a, b) => a - b);
  const movieDirectorMap = new Map(), actorMap = new Map();
  watched.forEach(row => {
    if (row.type === 'movie' && row.director) {
      const key = String(row.directorId || row.director), extra = { name: row.director, id: row.directorId || 0, profile: row.directorProfile || '' };
      bump(movieDirectorMap, key, 1, extra);
    }
    (row.cast || []).forEach(person => { if (person?.id) bump(actorMap, String(person.id), 1, { name: person.name || '', id: person.id, profile: person.profile || '' }); });
  });
  const topMovieDirectors = sorted(movieDirectorMap, 4), topDirectors = topMovieDirectors, topActors = sorted(actorMap, 7);
  const topDirector = topMovieDirectors[0] || null;
  const topActor = topActors[0] || null;
  const longestTitle = [...watched].filter(row => row.runtime > 0).sort((a, b) => b.runtime - a.runtime)[0] || null;
  const oldestTitle = [...rows].filter(row => +row.year).sort((a, b) => +a.year - +b.year)[0] || null;
  const newestTitle = [...rows].filter(row => +row.year).sort((a, b) => +b.year - +a.year)[0] || null;

  const avgRating = ratingValues.length ? ratingValues.reduce((sum, value) => sum + value, 0) / ratingValues.length : 0;
  const avgTmdb = rows.filter(row => row.tmdbRating > 0).length
    ? rows.filter(row => row.tmdbRating > 0).reduce((sum, row) => sum + row.tmdbRating, 0) / rows.filter(row => row.tmdbRating > 0).length : 0;
  const ratingCounts = Array.from({ length: 10 }, (_, index) => ratingValues.filter(value => value === index + 1).length);
  const completion = rows.length ? Math.round(watched.length / rows.length * 100) : 0;
  // The average/distribution represents every personal rating. Coverage has a
  // narrower promise in the UI ("of watched titles rated"), so its numerator
  // must be the watched/rated intersection rather than every rating document.
  const ratingCoverage = watched.length ? Math.round(watchedRated / watched.length * 100) : 0;
  const highScores = ratingValues.filter(value => value >= 8).length;
  const positiveRate = ratingValues.length ? Math.round(highScores / ratingValues.length * 100) : 0;
  const diversityScore = Math.round(Math.min(1, genres.size / 18) * 45 + Math.min(1, decades.size / 8) * 30 + Math.min(1, languages.size / 6) * 25);
  const peakDayIndex = weekdays.indexOf(Math.max(...weekdays));
  const peakDay = Math.max(...weekdays) ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][peakDayIndex] : 'No pattern yet';
  const personality = !ratingValues.length ? 'Unwritten critic' : avgRating >= 8 ? 'Generous enthusiast' : avgRating >= 7 ? 'Passionate curator' : avgRating >= 6 ? 'Balanced critic' : 'Fearless critic';
  const level = watched.length >= 500 ? 'Master Archivist' : watched.length >= 250 ? 'Cinema Historian' : watched.length >= 100 ? 'Cinephile' : watched.length >= 50 ? 'Curator' : watched.length >= 10 ? 'Explorer' : 'New Voyager';
  const milestone = [10, 25, 50, 100, 250, 500, 1000].find(goal => goal > watched.length) || Math.ceil((watched.length + 1) / 500) * 500;

  const health = collectionHealth(rows, watched);
  const tasteTimeline = tasteChanges(watched);
  const networkDirectorIds = new Set(topMovieDirectors.slice(0, 3).map(item => item.id).filter(Boolean));
  const networkTitles = watched.filter(row => networkDirectorIds.has(row.directorId) && row.poster)
    .sort((a, b) => b.userRating - a.userRating || b.tmdbRating - a.tmdbRating).slice(0, 6);
  const networkActorMap = new Map();
  networkTitles.forEach(row => (row.cast || []).forEach(person => {
    if (person?.id) bump(networkActorMap, String(person.id), 1, { id: person.id, name: person.name || '', profile: person.profile || '' });
  }));
  const networkActors = sorted(networkActorMap, 6);

  return {
    scope, rows, watched, saved, totalRated: ratingValues.length, avgRating, avgTmdb,
    ratingCounts, completion, ratingCoverage, positiveRate, highScores,
    genres: genreRows, decades: decadeRows, languages: languageRows, diversityScore,
    totalMinutes, hours: Math.floor(totalMinutes / 60), avgRuntime: averageUnits.length ? Math.round(averageUnits.reduce((sum, value) => sum + value, 0) / averageUnits.length) : 0,
    avgMovieRuntime: movieRuntimes.length ? Math.round(movieRuntimes.reduce((sum, value) => sum + value, 0) / movieRuntimes.length) : 0,
    avgEpisodeRuntime: episodeRuntimes.length ? Math.round(episodeRuntimes.reduce((sum, value) => sum + value, 0) / episodeRuntimes.length) : 0,
    metaCoverage: rows.length ? enriched.length / rows.length : 1,
    movies: watched.filter(row => row.type === 'movie').length, shows: watched.filter(row => row.type === 'tv').length,
    thisYear: watched.filter(row => row.watchedAt?.getFullYear() === now.getFullYear()).length,
    last30: watched.filter(row => row.watchedAt && row.watchedAt >= last30Cutoff).length,
    currentStreak: streak.current, longestStreak: streak.longest, bestMonth, peakDay,
    last12Months, heatDays: buildHeatDays(new Map([...activity].map(([key, value]) => [key, value.count]))), weekdays,
    topDirector, topActor, topDirectors, topMovieDirectors, topActors, longestTitle, oldestTitle, newestTitle,
    health, tasteTimeline, network: { directors: topMovieDirectors.slice(0, 3), titles: networkTitles, actors: networkActors },
    releaseSpan: years.length ? (years[0] === years.at(-1) ? String(years[0]) : `${years[0]}–${years.at(-1)}`) : '—',
    level, milestone, personality,
  };
}

function snapshotFor(stats) {
  return {
    schema: 7,
    totals: {
      saved: stats.saved.length, watched: stats.watched.length, rated: stats.totalRated,
      movies: stats.movies, shows: stats.shows, friends: social.friends.length,
      minutes: stats.totalMinutes, thisYear: stats.thisYear, last30Days: stats.last30,
    },
    ratings: {
      average: +stats.avgRating.toFixed(2), tmdbAverage: +stats.avgTmdb.toFixed(2),
      distribution: stats.ratingCounts, coverage: stats.ratingCoverage, positiveRate: stats.positiveRate,
    },
    taste: {
      genres: stats.genres.map(item => ({ id: item.key, name: item.name, count: item.count })),
      decades: stats.decades.map(item => ({ decade: +item.key, count: item.count })),
      languages: stats.languages.map(item => ({ code: item.key, name: item.name, count: item.count })),
      diversityScore: stats.diversityScore,
      changes: stats.tasteTimeline.periods,
    },
    activity: {
      currentStreak: stats.currentStreak, longestStreak: stats.longestStreak,
      bestMonth: stats.bestMonth, peakDay: stats.peakDay,
      last12Months: stats.last12Months.map(item => ({ month: item.key, count: item.count })),
      weekdays: stats.weekdays,
    },
    collection: {
      completion: stats.completion, averageRuntime: stats.avgRuntime, averageMovieRuntime: stats.avgMovieRuntime, averageEpisodeRuntime: stats.avgEpisodeRuntime, releaseSpan: stats.releaseSpan,
      health: { score: stats.health.score, missing: stats.health.missing, checks: stats.health.checks.map(check => ({ key: check.key, coverage: check.coverage, missing: check.missing })) },
      directorLoyalty: latestDirectorLoyalty || state.statsSnapshot?.collection?.directorLoyalty || null,
      topDirector: stats.topDirector ? { name: stats.topDirector.name, id: stats.topDirector.id, profile: stats.topDirector.profile, count: stats.topDirector.count } : null,
      topActor: stats.topActor ? { name: stats.topActor.name, id: stats.topActor.id, profile: stats.topActor.profile, count: stats.topActor.count } : null,
      oldest: stats.oldestTitle ? { id: stats.oldestTitle.id, type: stats.oldestTitle.type, title: stats.oldestTitle.title, year: stats.oldestTitle.year } : null,
      newest: stats.newestTitle ? { id: stats.newestTitle.id, type: stats.newestTitle.type, title: stats.newestTitle.title, year: stats.newestTitle.year } : null,
    },
    identity: { level: stats.level, criticStyle: stats.personality },
  };
}

function hashSnapshot(snapshot) {
  const text = JSON.stringify(snapshot); let hash = 2166136261;
  for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

function paintSyncState() {
  const element = $('statsSync'); if (!element) return;
  element.className = `stats-sync ${syncState}`;
  element.innerHTML = `${ICONS.cloud}<span>${esc(syncMessage)}</span>`;
}

async function persistSnapshot(job) {
  if (!job?.uid || !state.user || state.user.uid !== job.uid) return;
  syncState = 'syncing'; syncMessage = 'Syncing'; paintSyncState();
  try {
    const ref = db.collection('users').doc(job.uid);
    if (checkedUid !== job.uid) {
      const documentSnapshot = await ref.get();
      if (!state.user || state.user.uid !== job.uid) return;
      checkedUid = job.uid;
      remoteHash = documentSnapshot.exists ? documentSnapshot.data()?.statsSnapshot?.hash || '' : '';
    }
    if (remoteHash !== job.hash) {
      await ref.set({ statsSnapshot: { ...job.snapshot, hash: job.hash, updatedAt: firebase.firestore.FieldValue.serverTimestamp() } }, { merge: true });
      remoteHash = job.hash;
    }
    syncState = 'synced'; syncMessage = 'Synced'; paintSyncState();
  } catch (error) {
    console.warn('Stats snapshot unavailable', error);
    syncState = 'offline'; syncMessage = 'Offline'; paintSyncState();
  }
}

const persistSnapshotSoon = debounce(persistSnapshot, 1800);
function queueSnapshot(snapshot) {
  if (!state.user) return;
  latestSnapshot = snapshot;
  const hash = hashSnapshot(snapshot);
  state.statsSnapshot = { ...snapshot, hash };
  if (hash === lastQueuedHash && remoteHash === hash) return;
  lastQueuedHash = hash;
  syncState = 'queued'; syncMessage = 'Queued'; paintSyncState();
  persistSnapshotSoon({ uid: state.user.uid, snapshot, hash });
}

function scopeToggle() {
  return `<div class="stats-scope" aria-label="Statistics scope">${[['all', 'Everything'], ['movie', 'Movies'], ['tv', 'TV Shows']].map(([value, label]) => `<button class="${statsScope === value ? 'active' : ''}" data-action="stats-filter" data-filter="${value}">${label}</button>`).join('')}</div>`;
}

function kpi(icon, label, value, suffix, sub, accent) {
  const numeric = typeof value === 'number';
  return `<article class="stats-kpi ${accent}"><div class="stats-kpi-icon">${ICONS[icon]}</div><span>${label}</span><strong>${numeric ? `<b data-count="${value}">0</b>` : esc(value)}${suffix || ''}</strong><small>${sub}</small></article>`;
}

function statsHero(stats) {
  const name = state.user?.displayName || (state.user?.email || '').split('@')[0] || 'Your';
  const progress = Math.min(100, Math.round(stats.watched.length / stats.milestone * 100));
  return `<section class="stats-hero">
    <div class="stats-hero-copy"><span class="stats-eyebrow">CineVerse Intelligence</span><h1>${esc(name)}’s Cineprint</h1><p>A living portrait of everything you watch, save, rate, and love.</p><div class="stats-hero-actions">${scopeToggle()}<button class="stats-export" data-action="export-stats">${ICONS.download}Export</button></div><div class="stats-sync ${syncState}" id="statsSync">${ICONS.cloud}<span>${esc(syncMessage)}</span></div></div>
    <div class="stats-identity"><div class="stats-identity-ring" style="--identity-progress:${progress * 3.6}deg"><div><strong>${stats.watched.length}</strong><span>watched</span></div></div><div><span>Viewing level</span><strong>${stats.level}</strong><small>${stats.milestone - stats.watched.length} until the next milestone</small></div></div>
  </section>`;
}

function tasteBars(items, label) {
  const max = items[0]?.count || 1;
  return items.slice(0, 7).map(item => `<div class="taste-bar"><div><span>${esc(item.name || item.key)}</span><b>${item.count}</b></div><i><em style="--taste-width:${Math.round(item.count / max * 100)}%"></em></i></div>`).join('') || `<p class="stats-empty-line">More ${label} data will appear as your library grows.</p>`;
}

function tasteMap(stats) {
  const topGenre = stats.genres[0], topDecade = stats.decades[0], topLanguage = stats.languages[0];
  const orbit = [
    ['genre', 'Genre', topGenre?.name || 'Discovering'],
    ['era', 'Era', topDecade?.name || 'Discovering'],
    ['language', 'Language', topLanguage?.name || 'Discovering'],
  ];
  const maxLanguage = topLanguage?.count || 1;
  return `<section class="stats-panel taste-section">
    <div class="stats-section-head"><div><span>Your cinematic DNA</span><h2>Taste Map</h2><p>Genres, decades, and languages mapped from your complete collection.</p></div><div class="taste-coverage">${Math.round(stats.metaCoverage * 100)}% metadata coverage</div></div>
    <div class="taste-map-layout">
      <div class="taste-orbit" style="--taste-progress:${stats.diversityScore * 3.6}deg"><div class="taste-orbit-glow"></div><div class="taste-core"><span>Diversity</span><strong>${stats.diversityScore}</strong><small>/100</small></div>${orbit.map(([cls, label, value]) => `<div class="taste-node ${cls}"><span>${label}</span><strong>${esc(value)}</strong></div>`).join('')}</div>
      <div class="taste-breakdown">
        <div class="taste-card"><div class="taste-card-head"><span>Genre spectrum</span><b>${stats.genres.length} genres</b></div>${tasteBars(stats.genres, 'genre')}</div>
        <div class="taste-card"><div class="taste-card-head"><span>Era spectrum</span><b>${stats.releaseSpan}</b></div><div class="taste-era-cloud">${stats.decades.slice(0, 8).map((item, index) => `<div class="taste-era e${Math.min(index, 4)}"><strong>${esc(item.name)}</strong><span>${item.count} title${item.count === 1 ? '' : 's'}</span></div>`).join('') || '<p class="stats-empty-line">Release years will appear here.</p>'}</div></div>
        <div class="taste-card"><div class="taste-card-head"><span>Language constellation</span><b>${stats.languages.length} languages</b></div><div class="taste-language-cloud">${stats.languages.slice(0, 9).map(item => `<span style="--language-weight:${Math.max(.72, item.count / maxLanguage)}"><b>${esc(item.name)}</b><small>${item.count}</small></span>`).join('') || '<p class="stats-empty-line">Language data is being enriched.</p>'}</div></div>
      </div>
    </div>
  </section>`;
}

function activityPanel(stats) {
  const maxMonth = Math.max(1, ...stats.last12Months.map(item => item.count));
  const maxDay = Math.max(1, ...stats.heatDays.map(item => item.count));
  const heat = stats.heatDays.map(item => {
    const level = item.count ? Math.max(1, Math.ceil(item.count / maxDay * 4)) : 0;
    return `<i class="level-${level}" title="${esc(item.label)} · ${item.count} watched"></i>`;
  }).join('');
  const monthBars = stats.last12Months.map(item => `<div class="activity-month"><div><i style="--month-height:${Math.max(item.count ? 8 : 1, Math.round(item.count / maxMonth * 100))}%"></i></div><span>${item.label}</span><b>${item.count || ''}</b></div>`).join('');
  return `<section class="stats-panel activity-section"><div class="stats-section-head"><div><span>Viewing rhythm</span><h2>Activity Pulse</h2><p>Your recent pace, streaks, and strongest viewing moments.</p></div></div>
    <div class="activity-highlights"><div><span>Current streak</span><strong>${stats.currentStreak}<small> days</small></strong></div><div><span>Longest streak</span><strong>${stats.longestStreak}<small> days</small></strong></div><div><span>Best month</span><strong>${esc(stats.bestMonth)}</strong></div><div><span>Peak day</span><strong>${esc(stats.peakDay)}</strong></div></div>
    <div class="activity-grid"><div class="activity-chart"><div class="mini-panel-title"><span>Last 12 months</span><b>${stats.thisYear} this year</b></div><div class="activity-months">${monthBars}</div></div><div class="activity-chart"><div class="mini-panel-title"><span>52-week watch map</span><b>${stats.last30} in 30 days</b></div><div class="activity-heat-wrap"><div class="activity-heatmap">${heat}</div><div class="activity-legend"><span>Less</span><i class="level-0"></i><i class="level-1"></i><i class="level-2"></i><i class="level-3"></i><i class="level-4"></i><span>More</span></div></div></div></div>
  </section>`;
}

function ratingPanel(stats) {
  const total = Math.max(1, stats.totalRated);
  const distribution = stats.ratingCounts.map((count, index) => `<div class="rd-col" title="${count} rating${count === 1 ? '' : 's'} at ${index + 1}/10"><div class="rd-count">${count || ''}</div><div class="rd-track"><div class="rd-fill" style="height:0" data-pct="${Math.round(count / total * 100)}"></div></div><div class="rd-score">${index + 1}</div></div>`).join('');
  return `<section class="stats-panel rating-intel"><div class="stats-section-head compact"><div><span>Your critical voice</span><h2>Rating Intelligence</h2></div></div><div class="critic-card"><div class="critic-score"><strong>${stats.avgRating ? stats.avgRating.toFixed(1) : '—'}</strong><span>average score</span></div><div><span>Critic style</span><strong>${stats.personality}</strong><small>${stats.positiveRate}% of ratings are 8 or higher</small></div></div>${stats.totalRated ? `<div class="rating-dist">${distribution}</div>` : '<div class="rating-dist-empty">Rate a few titles to unlock your critic profile.</div>'}<div class="rating-foot"><span>${stats.totalRated} ratings</span><span>${stats.ratingCoverage}% of watched titles rated</span><span>${stats.highScores} favourites at 8+</span></div></section>`;
}

function collectionPanel(stats) {
  const formatRuntime = minutes => {
    if (!minutes) return 'Calculating…';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60), remainder = minutes % 60;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  };
  const intelligence = [
    ['Release range', stats.releaseSpan, stats.oldestTitle && stats.newestTitle ? `${stats.oldestTitle.title} to ${stats.newestTitle.title}` : 'Build your timeline'],
    ['Average runtime', formatRuntime(stats.avgRuntime), stats.scope === 'movie' ? 'Average movie length' : stats.scope === 'tv' ? 'Average episode length' : 'Movies and TV episodes, weighted equally'],
    ['Top director', stats.topDirector?.name || 'Discovering…', stats.topDirector ? `${stats.topDirector.count} watched titles` : 'Metadata is being enriched'],
    ['Most seen actor', stats.topActor?.name || 'Discovering…', stats.topActor ? `${stats.topActor.count} watched titles` : 'Metadata is being enriched'],
  ];
  return `<section class="stats-panel collection-intel"><div class="stats-section-head compact"><div><span>Collection intelligence</span><h2>Library Anatomy</h2></div></div><div class="library-completion"><div class="library-donut" style="--library-progress:${stats.completion * 3.6}deg"><strong>${stats.completion}%</strong></div><div><span>Known collection watched</span><strong>${stats.watched.length} of ${stats.rows.length}</strong><small>${stats.saved.length} titles currently saved</small></div></div><div class="library-facts">${intelligence.map(([label, value, note]) => `<div><span>${label}</span><strong title="${esc(String(value))}">${esc(String(value))}</strong><small>${esc(note)}</small></div>`).join('')}</div></section>`;
}

function collectionHealthPanel(stats) {
  const health = stats.health;
  const status = health.score === 100 ? 'Pristine collection' : health.score >= 85 ? 'Excellent condition' : health.score >= 65 ? 'Healthy, with a few gaps' : 'Ready for enrichment';
  const repairIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/><path d="m9 12 2 2 4-5"/></svg>';
  return `<section class="stats-panel collection-health"><div class="stats-section-head"><div><span>Library quality control</span><h2>Collection Health</h2><p>Every missing rating, poster, date, credit, and metadata field—clearly accounted for.</p></div><div class="health-head-actions"><div class="health-status">${esc(status)}</div><button class="collection-repair-btn" data-action="repair-collection"${repairActive ? ' disabled' : ''}>${repairIcon}<span>${repairActive ? 'Repairing…' : 'Repair missing data'}</span></button></div></div>
    <div class="health-layout"><div class="health-orb" style="--health-progress:${health.score * 3.6}deg"><div><strong>${health.score}</strong><span>/100 health</span></div></div>
      <div class="health-checks">${health.checks.map(check => `<article><div><span>${esc(check.label)}</span><strong>${check.missing ? `${check.missing} missing` : 'Complete'}</strong></div><i><em style="--health-width:${check.coverage}%"></em></i><p>${esc(check.hint)}${check.titles.length ? ` <b title="${esc(check.titles.join(', '))}">${esc(check.titles.slice(0, 2).join(' · '))}${check.titles.length > 2 ? '…' : ''}</b>` : ''}</p></article>`).join('')}</div>
    </div><div class="health-foot"><span>${health.missing} total gaps across ${stats.rows.length} unique titles</span><span>Repair fills metadata, artwork, dates, and credits. Personal ratings always stay yours.</span></div></section>`;
}

function providerAge(at) {
  if (!at) return 'Awaiting first check';
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 60) return 'Checked just now';
  if (seconds < 3600) return `Checked ${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `Checked ${Math.floor(seconds / 3600)}h ago`;
  const days = Math.floor(seconds / 86400);
  return `Checked ${days} day${days === 1 ? '' : 's'} ago`;
}

function providerSparkline(series, width = 220, height = 54) {
  if (!series?.length) return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="M0 ${height - 2}H${width}"/></svg>`;
  const values = series.map(item => +item.value || 0), max = Math.max(1, ...values), min = Math.min(...values);
  const range = Math.max(1, max - min), step = series.length > 1 ? width / (series.length - 1) : width;
  const points = values.map((value, index) => `${Math.round(index * step)},${Math.round(height - 4 - ((value - min) / range) * (height - 10))}`).join(' ');
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><path d="M0 ${height - 2}H${width}"/><polyline points="${points}"/></svg>`;
}

function providerIntelligencePanels() {
  const providers = getProviderStats({ days: 90 }), catalog = getCatalogSeries({ days: 90 });
  if (!providers.length) return `<section class="stats-panel provider-reliability"><div class="stats-section-head"><div><span>Streaming confidence</span><h2>Provider Reliability Score</h2><p>Freshness scores appear after CineVerse checks subscription availability for titles in your collection.</p></div></div><div class="provider-stats-empty"><i>✦</i><div><strong>No provider scans yet</strong><p>Open Notifications and refresh once to build your private provider baseline.</p></div><button data-action="show-page" data-page="notifications">Open notifications</button></div></section><section class="stats-panel provider-history-charts"><div class="stats-section-head"><div><span>90-day subscription movement</span><h2>Provider History Charts</h2><p>Real additions and removals will appear after CineVerse has two subscription scans to compare.</p></div></div><div class="provider-flow-list"><div class="provider-history-baseline"><i>◎</i><div><strong>No history to compare yet</strong><p>Your first scan creates the baseline; later scans reveal which services gained or lost titles.</p></div></div></div></section>`;
  const reliable = [...providers].sort((a, b) => b.reliability - a.reliability || b.current - a.current || a.name.localeCompare(b.name));
  const changed = providers.filter(provider => provider.gained || provider.lost).sort((a, b) => (b.gained + b.lost) - (a.gained + a.lost) || b.current - a.current).slice(0, 9);
  const maxChange = Math.max(1, ...changed.flatMap(provider => [provider.gained, provider.lost]));
  const currentTracked = catalog.at(-1)?.total ?? Object.keys(state.providerHistory?.snapshots || {}).length;
  const reliability = `<section class="stats-panel provider-reliability"><div class="stats-section-head"><div><span>Streaming confidence</span><h2>Provider Reliability Score</h2><p>How recently each subscription service was checked across your tracked collection.</p></div><div class="provider-region-chip">${esc(state.region)} · subscription only</div></div><div class="provider-reliability-summary"><div><span>Services detected</span><strong>${providers.length}</strong></div><div><span>Tracked titles</span><strong>${currentTracked}</strong></div><div><span>Freshest check</span><strong>${esc(providerAge(Math.max(...providers.map(provider => provider.checkedAt))).replace('Checked ', ''))}</strong></div></div><div class="provider-reliability-grid">${reliable.map(provider => `<article><div class="provider-reliability-brand"><img src="${provider.logo ? `${IMG}w92${provider.logo}` : PH}" alt=""><span><strong>${esc(provider.name)}</strong><small>${provider.checkedTitles} current title${provider.checkedTitles === 1 ? '' : 's'}</small></span></div><div class="provider-score-ring" style="--provider-score:${provider.reliability * 3.6}deg"><strong>${provider.reliability}</strong><span>/100</span></div><div class="provider-check-time"><i class="${provider.reliability >= 85 ? 'fresh' : provider.reliability >= 60 ? 'aging' : 'stale'}"></i><span>${esc(providerAge(provider.checkedAt))}</span></div>${providerSparkline(provider.series)}</article>`).join('')}</div><p class="provider-method-note">The score measures check freshness—not provider accuracy. It falls gradually when the catalog has not been scanned.</p></section>`;
  const historyRows = changed.length ? changed.map(provider => `<article><div class="provider-history-brand"><img src="${provider.logo ? `${IMG}w92${provider.logo}` : PH}" alt=""><span><strong>${esc(provider.name)}</strong><small>${provider.current} available now · net ${provider.net > 0 ? '+' : ''}${provider.net}</small></span></div><div class="provider-flow"><span class="gain"><b style="--flow:${Math.max(provider.gained ? 8 : 0, Math.round(provider.gained / maxChange * 100))}%"></b><em>+${provider.gained}</em></span><span class="loss"><b style="--flow:${Math.max(provider.lost ? 8 : 0, Math.round(provider.lost / maxChange * 100))}%"></b><em>−${provider.lost}</em></span></div></article>`).join('') : `<div class="provider-history-baseline"><i>◎</i><div><strong>Your baseline is ready</strong><p>Gains and losses will appear after a later scan detects a real subscription change.</p></div></div>`;
  const catalogSeries = catalog.map(item => ({ day: item.day, value: item.total }));
  const history = `<section class="stats-panel provider-history-charts"><div class="stats-section-head"><div><span>90-day subscription movement</span><h2>Provider History Charts</h2><p>Real additions and removals detected between CineVerse scans. Initial baseline titles never count as gains.</p></div><div class="provider-chart-legend"><span><i></i>Gained</span><span><i></i>Lost</span></div></div><div class="provider-catalog-trend"><div><span>Tracked catalog</span><strong>${currentTracked}<small> titles now</small></strong></div>${providerSparkline(catalogSeries, 680, 92)}<div class="provider-trend-dates"><span>${esc(catalog[0]?.day || 'First scan')}</span><span>${esc(catalog.at(-1)?.day || 'Today')}</span></div></div><div class="provider-flow-list">${historyRows}</div></section>`;
  return reliability + history;
}

function tasteChangesPanel(stats) {
  const timeline = stats.tasteTimeline;
  return `<section class="stats-panel taste-changes"><div class="stats-section-head"><div><span>Taste evolution</span><h2>Taste Changes</h2><p>Your leading genre and language across your six most recent active months.</p></div><div class="taste-change-summary"><span>${timeline.genreChanges} genre shifts</span><span>${timeline.languageChanges} language shifts</span></div></div>
    ${timeline.periods.length ? `<div class="taste-change-track">${timeline.periods.map((period, index) => `<article class="taste-change-period"><div class="taste-change-index">${String(index + 1).padStart(2, '0')}</div><span>${esc(period.label)}</span><strong>${esc(period.genre)}</strong><small>${period.genreShare}% of that month</small><div><b>${esc(period.language)}</b><em>${period.languageShare}%</em></div><p>${period.total} watched</p></article>`).join('')}</div>` : '<div class="stats-empty-line taste-change-empty">Watch history with dates will build your taste timeline here.</div>'}
  </section>`;
}

function personPicture(person, cls = '') {
  return person.profile ? `<img class="${cls}" src="${IMG}w185${person.profile}" alt="${esc(person.name)}" loading="lazy" data-ph="${PH}">` : `<span class="network-initial">${esc((person.name || '?')[0])}</span>`;
}

export function directorNetworkPanel(stats) {
  const { directors, titles, actors } = stats.network;
  if (!directors.length || !titles.length) return `<section class="stats-panel director-network"><div class="stats-section-head"><div><span>Creative connections</span><h2>Director Network</h2><p>Directors, actors, and titles will connect here as credit metadata is enriched.</p></div></div><div class="network-empty">Add and watch more titles to reveal your creative network.</div></section>`;
  const width = 1120, nodeCount = Math.max(directors.length, titles.length, actors.length);
  const height = Math.max(540, nodeCount * 112 + 110), x = { director: 145, title: 560, actor: 975 };
  const positions = (items, kind) => new Map(items.map((item, index) => {
    const y = items.length === 1 ? height / 2 : 78 + index * ((height - 156) / (items.length - 1));
    return [String(item.id || item.key), { x: x[kind], y: Math.round(y) }];
  }));
  const directorPos = positions(directors, 'director'), titlePos = positions(titles.map(item => ({ ...item, key: item.key, id: item.key })), 'title'), actorPos = positions(actors, 'actor');
  const edges = [];
  titles.forEach(title => {
    const d = directorPos.get(String(title.directorId)), movie = titlePos.get(String(title.key));
    if (d && movie) edges.push(`<path class="network-edge director-edge" d="M${d.x + 96} ${d.y} C330 ${d.y},390 ${movie.y},${movie.x - 116} ${movie.y}"/>`);
    (title.cast || []).slice(0, 5).forEach(person => {
      const actor = actorPos.get(String(person.id));
      if (movie && actor) edges.push(`<path class="network-edge actor-edge" d="M${movie.x + 116} ${movie.y} C735 ${movie.y},790 ${actor.y},${actor.x - 96} ${actor.y}"/>`);
    });
  });
  const directorNodes = directors.map(person => { const p = directorPos.get(String(person.id || person.key)); return `<a class="network-node network-person director" style="--nx:${p.x}px;--ny:${p.y}px" href="/person/${person.id}" data-action="open-person" data-id="${person.id}"><div class="network-avatar">${personPicture(person)}</div><div class="network-copy"><strong>${esc(person.name)}</strong><span>${person.count} watched title${person.count === 1 ? '' : 's'}</span></div></a>`; }).join('');
  const titleNodes = titles.map(title => { const p = titlePos.get(String(title.key)); const score = title.userRating ? `${title.userRating}/10 yours` : title.tmdbRating ? `${title.tmdbRating.toFixed(1)} community` : title.type === 'tv' ? 'TV show' : 'Movie'; return `<a class="network-node network-title" style="--nx:${p.x}px;--ny:${p.y}px" href="/${title.type}/${title.id}" data-action="open-detail" data-id="${title.id}" data-type="${title.type}"><img src="${IMG}w154${title.poster}" alt="${esc(title.title)}" loading="lazy" data-ph="${PH}"><div class="network-copy"><strong>${esc(title.title)}</strong><span>${esc(String(title.year || ''))}${title.year ? ' · ' : ''}${esc(score)}</span></div></a>`; }).join('');
  const actorNodes = actors.map(person => { const p = actorPos.get(String(person.id)); return `<a class="network-node network-person actor" style="--nx:${p.x}px;--ny:${p.y}px" href="/person/${person.id}" data-action="open-person" data-id="${person.id}"><div class="network-avatar">${personPicture(person)}</div><div class="network-copy"><strong>${esc(person.name)}</strong><span>${person.count} connected title${person.count === 1 ? '' : 's'}</span></div></a>`; }).join('');
  const recurring = actors[0];
  return `<section class="stats-panel director-network"><div class="stats-section-head"><div><span>Creative connections</span><h2>Director Network</h2><p>Your most-watched filmmakers connected to their titles and recurring cast.</p></div><div class="network-legend"><span><i></i>Director link</span><span><i></i>Cast link</span></div></div><div class="network-overview"><div><span>Core filmmakers</span><strong>${directors.length}</strong></div><div><span>Visible connections</span><strong>${edges.length}</strong></div><div><span>Recurring collaborator</span><strong>${esc(recurring?.name || 'Discovering')}</strong></div></div><div class="network-scroll"><div class="network-canvas" style="width:${width}px;height:${height}px"><div class="network-column-label director">Directors</div><div class="network-column-label title">Your movies &amp; shows</div><div class="network-column-label actor">Actors</div><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${edges.join('')}</svg>${directorNodes}${titleNodes}${actorNodes}</div></div></section>`;
}

function cachedLoyalty(stats) {
  const value = latestDirectorLoyalty || state.statsSnapshot?.collection?.directorLoyalty;
  if (!value?.items?.length) return null;
  const watchedSignature = stats.watched.filter(row => row.type === 'movie').map(row => +row.id).filter(Boolean).sort((a, b) => a - b).join(',');
  if (value.watchedSignature !== watchedSignature) return null;
  const wanted = stats.topMovieDirectors.map(person => +person.id).filter(Boolean).slice(0, 4);
  const available = new Set(value.items.map(item => +item.id));
  return wanted.length && wanted.every(id => available.has(id)) ? value : null;
}

function directorLoyaltyBody(payload) {
  if (!payload?.items?.length) return '<div class="insight-loading"><i></i><span>Mapping complete filmographies…</span></div>';
  return `<div class="loyalty-grid">${payload.items.map(item => `<article class="loyalty-card"><a class="loyalty-person" href="/person/${item.id}" data-action="open-person" data-id="${item.id}"><div>${personPicture(item)}</div><span><strong>${esc(item.name)}</strong><small>${item.completed} of ${item.total} released directing credits</small></span></a><div class="loyalty-progress"><i><em style="width:${item.percent}%"></em></i><strong>${item.percent}%</strong></div>${item.next ? `<a class="loyalty-next" href="/movie/${item.next.id}" data-action="open-detail" data-id="${item.next.id}" data-type="movie"><img src="${IMG}w92${item.next.poster}" alt="" loading="lazy"><span><small>Highly rated unseen</small><strong>${esc(item.next.title)}</strong></span></a>` : '<div class="loyalty-complete">No highly rated unseen film found.</div>'}</article>`).join('')}</div><p class="loyalty-note">Completion uses unique, already-released movie credits where the person is listed as Director on TMDB.</p>`;
}

function directorLoyaltyPanel(stats) {
  return `<section class="stats-panel director-loyalty"><div class="stats-section-head"><div><span>Filmmaker completion</span><h2>Director Loyalty</h2><p>How much of each favorite director’s released work you have completed.</p></div><div class="loyalty-live">Live filmography check</div></div><div id="directorLoyaltyBody">${directorLoyaltyBody(cachedLoyalty(stats))}</div></section>`;
}

function smartWatchPanel() {
  return `<section class="stats-panel smart-watch"><div class="stats-section-head"><div><span>High-confidence discoveries</span><h2>Smart Watch List</h2><p>Highly rated titles from your strongest genres, with watched and dismissed titles removed.</p></div><div class="smart-watch-rule">7.2+ · 300+ votes</div></div><div class="row smart-watch-row" id="smartWatchRow">${Array(7).fill('<div class="card"><div class="card-img skel" style="aspect-ratio:2/3"></div></div>').join('')}</div><p class="smart-watch-note">Saved titles remain eligible because saving something usually means you still want to watch it.</p></section>`;
}

const released = (item, now = new Date()) => {
  const raw = item.release_date || item.first_air_date;
  if (!raw) return false;
  const date = new Date(`${raw}T00:00:00`);
  return !Number.isNaN(date.getTime()) && date <= now;
};

export function calculateDirectorLoyalty(person, crew = [], watchedMovieIds = [], now = new Date()) {
  const watched = watchedMovieIds instanceof Set ? watchedMovieIds : new Set(watchedMovieIds);
  const credits = [...new Map(crew
    .filter(credit => credit.job === 'Director' && credit.id && released(credit, now))
    .map(credit => [+credit.id, credit])).values()];
  const completed = credits.filter(credit => watched.has(+credit.id)).length;
  const unseen = credits
    .filter(credit => !watched.has(+credit.id) && credit.poster_path && (credit.vote_count || 0) >= 300)
    .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0) || (b.vote_count || 0) - (a.vote_count || 0))[0];
  return {
    id: +person.id, name: person.name, profile: person.profile || '', completed, total: credits.length,
    percent: credits.length ? Math.round(completed / credits.length * 100) : 0,
    next: unseen ? { id: unseen.id, title: unseen.title || unseen.original_title || 'Untitled', poster: unseen.poster_path, rating: unseen.vote_average || 0 } : null,
  };
}

export function rankSmartWatchCandidates(candidates = [], options = {}) {
  const genreIds = (options.genreIds || []).map(Number);
  const watched = options.watched instanceof Set ? options.watched : new Set(options.watched || []);
  const dismissed = options.dismissed instanceof Set ? options.dismissed : new Set(options.dismissed || []);
  const now = options.now || new Date();
  const unique = new Map();
  candidates.forEach(source => {
    const item = { ...source }, key = `${item.__type}_${item.id}`;
    if (!item.__type || !item.id || !item.poster_path || !released(item, now) || (item.vote_count || 0) < 300 || (item.vote_average || 0) < 7.2 || watched.has(key) || dismissed.has(key)) return;
    const overlap = (item.genre_ids || []).filter(id => genreIds.includes(+id)).length;
    item.__smartScore = item.vote_average + Math.min(.7, Math.log10(Math.max(1, item.vote_count)) / 7) + overlap * .08;
    item.__score = item.__smartScore;
    item.__source = 'smart-watch';
    if (!unique.has(key) || item.__smartScore > unique.get(key).__smartScore) unique.set(key, item);
  });
  return [...unique.values()]
    .sort((a, b) => b.__smartScore - a.__smartScore || b.vote_count - a.vote_count)
    .slice(0, options.limit || 10);
}

async function loadDirectorLoyalty(stats, generation) {
  const body = $('directorLoyaltyBody');
  const directors = stats.topMovieDirectors.filter(person => person.id).slice(0, 4);
  if (!body || !directors.length) { if (body) body.innerHTML = '<div class="network-empty">Watch more director-tagged films to unlock loyalty tracking.</div>'; return; }
  const cached = cachedLoyalty(stats);
  if (cached && Date.now() - +(cached.calculatedAt || 0) < 30 * 86400000) { latestDirectorLoyalty = cached; return; }
  const watchedMovies = new Set(stats.watched.filter(row => row.type === 'movie').map(row => +row.id));
  const watchedSignature = [...watchedMovies].filter(Boolean).sort((a, b) => a - b).join(',');
  const items = (await Promise.all(directors.map(async person => {
    try {
      const data = await tmdb(`/person/${person.id}/movie_credits`);
      return calculateDirectorLoyalty(person, data.crew || [], watchedMovies);
    } catch (error) { console.warn('director loyalty', person.id, error); return null; }
  }))).filter(Boolean);
  if (generation !== insightGeneration || !state.user) return;
  latestDirectorLoyalty = { calculatedAt: Date.now(), watchedSignature, items };
  const current = $('directorLoyaltyBody'); if (current) current.innerHTML = directorLoyaltyBody(latestDirectorLoyalty);
  queueSnapshot(snapshotFor(computeStats('all')));
}

async function loadSmartWatchList(stats, generation) {
  const row = $('smartWatchRow'); if (!row) return;
  const genreIds = stats.genres.map(item => +item.key);
  const calls = [], movieGenres = genreIds.filter(id => MOVIE_GENRES.has(id)).slice(0, 3), tvGenres = genreIds.filter(id => TV_GENRES.has(id)).slice(0, 3);
  const today = new Date().toISOString().slice(0, 10);
  if (stats.scope !== 'tv') calls.push(tmdb(movieGenres.length ? '/discover/movie' : '/movie/top_rated', movieGenres.length ? { with_genres: movieGenres.join('|'), sort_by: 'vote_average.desc', 'vote_average.gte': 7.2, 'vote_count.gte': 300, 'primary_release_date.lte': today } : {}).then(data => (data.results || []).map(item => ({ ...item, __type: 'movie' }))));
  if (stats.scope !== 'movie') calls.push(tmdb(tvGenres.length ? '/discover/tv' : '/tv/top_rated', tvGenres.length ? { with_genres: tvGenres.join('|'), sort_by: 'vote_average.desc', 'vote_average.gte': 7.2, 'vote_count.gte': 300, 'first_air_date.lte': today } : {}).then(data => (data.results || []).map(item => ({ ...item, __type: 'tv' }))));
  try {
    const watched = new Set(Object.keys(state.watched)), dismissed = new Set(state.recommendationFeedback?.dismissed || []);
    const picks = rankSmartWatchCandidates((await Promise.all(calls)).flat(), { genreIds, watched, dismissed });
    if (generation !== insightGeneration) return;
    const current = $('smartWatchRow'); if (!current) return;
    current.innerHTML = picks.length ? picks.map(item => buildCard(item, item.__type, { dismissible: true, badge: 'Unwatched' })).join('') : '<div class="network-empty">Add more ratings and genres to unlock smart picks.</div>';
    observeReveals(current);
  } catch (error) {
    console.warn('smart watch list', error);
    const current = $('smartWatchRow'); if (current) current.innerHTML = '<div class="network-empty">Smart picks are temporarily unavailable.</div>';
  }
}

function animateStats(scope, stats) {
  observeCountUps(scope);
  requestAnimationFrame(() => {
    scope.querySelectorAll('.taste-bar em').forEach(bar => { bar.style.width = bar.style.getPropertyValue('--taste-width'); });
    scope.querySelectorAll('.health-checks em').forEach(bar => { bar.style.width = bar.style.getPropertyValue('--health-width'); });
    scope.querySelectorAll('.activity-month i').forEach(bar => { bar.style.height = bar.style.getPropertyValue('--month-height'); });
    scope.querySelectorAll('.rd-fill').forEach(fill => {
      const pct = +fill.dataset.pct || 0, height = fill.parentElement.clientHeight || 90;
      fill.style.height = pct ? Math.max(3, Math.round(height * pct / 100)) + 'px' : '0';
    });
    animateBadgeBars(scope);
  });
}

export function renderStats() {
  const container = $('statsContent'); if (!container) return;
  if (!state.user) {
    container.innerHTML = `<section class="stats-guest"><div>${ICONS.compass}</div><span>CineVerse Intelligence</span><h1>Your cinematic universe starts here.</h1><p>Sign in to turn every watch, rating, and saved title into a living Cineprint.</p><button class="btn-primary" data-action="open-auth">Sign In</button></section>`;
    return;
  }

  const stats = computeStats(statsScope);
  const fullStats = statsScope === 'all' ? stats : computeStats('all');
  const context = buildCtx();
  const scopeLabel = statsScope === 'movie' ? 'movie' : statsScope === 'tv' ? 'TV' : 'complete';
  container.innerHTML = `${statsHero(stats)}
    <div class="stats-kpi-grid">
      ${kpi('watched', 'Watched', stats.watched.length, '', `${stats.movies} movies · ${stats.shows} shows`, 'red')}
      ${kpi('clock', 'Watch time', stats.hours, 'h', stats.metaCoverage < 1 ? 'Still enriching runtimes' : 'Approximate lifetime total', 'gold')}
      ${kpi('star', 'Average rating', stats.avgRating ? +stats.avgRating.toFixed(1) : '—', stats.avgRating ? '/10' : '', `${stats.totalRated} personal ratings`, 'purple')}
      ${kpi('library', 'Collection watched', stats.completion, '%', `${stats.saved.length} currently saved`, 'cyan')}
      ${kpi('fire', 'Longest streak', stats.longestStreak, 'd', `${stats.currentStreak} day current streak`, 'green')}
      ${kpi('compass', 'Taste diversity', stats.diversityScore, '/100', `${stats.genres.length} genres · ${stats.languages.length} languages`, 'pink')}
    </div>
    ${tasteMap(stats)}
    ${tasteChangesPanel(stats)}
    ${collectionHealthPanel(stats)}
    ${providerIntelligencePanels()}
    ${activityPanel(stats)}
    <div class="stats-duo">${ratingPanel(stats)}${collectionPanel(stats)}</div>
    ${directorLoyaltyPanel(fullStats)}
    ${directorNetworkPanel(stats)}
    ${smartWatchPanel()}
    <section class="stats-achievements"><div class="stats-section-head"><div><span>Account-wide progression</span><h2>Challenges &amp; Trophy Room</h2><p>Every milestone is derived from your Firestore-backed collection.</p></div></div>${challengesHTML(context)}${badgesHTML(context)}</section>
    <p class="stats-footnote">${esc(scopeLabel)} stats · Watch time for TV is approximate because a completed show uses its full available runtime.</p>`;

  const snapshot = snapshotFor(fullStats);
  queueSnapshot(snapshot);
  animateStats(container, stats);
  const generation = ++insightGeneration;
  loadDirectorLoyalty(fullStats, generation);
  loadSmartWatchList(stats, generation);
  ensureWatchedMeta();
}

function exportStats() {
  if (!latestSnapshot) { toast('Your stats are still preparing', 'info'); return; }
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), ...latestSnapshot }, null, 2);
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `cineverse-cineprint-${dayKey(new Date())}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Cineprint exported', 'success');
}

function queueCurrentSnapshot() {
  if (!state.user) return;
  queueSnapshot(snapshotFor(computeStats('all')));
}

async function repairCollection(element) {
  if (repairActive) return;
  repairActive = true;
  element.disabled = true;
  const label = element.querySelector('span');
  if (label) label.textContent = 'Checking collection…';
  const result = await repairCollectionMeta(progress => {
    if (label && element.isConnected) label.textContent = progress.total ? `Repairing ${progress.completed}/${progress.total}` : 'Checking collection…';
  });
  repairActive = false;
  if (result.busy) toast('Automatic metadata repair is still finishing', 'info');
  else if (!result.total) toast('Collection metadata is already complete', 'success');
  else if (result.failed) toast(`Repaired ${result.repaired}; ${result.failed} could not be refreshed`, 'info');
  else toast(`Repaired ${result.repaired} title${result.repaired === 1 ? '' : 's'}`, 'success');
  renderStats();
}

export function initStats() {
  registerActions({
    'stats-filter': element => { statsScope = element.dataset.filter; renderStats(); },
    'export-stats': () => exportStats(),
    'repair-collection': element => repairCollection(element),
  });
  document.addEventListener('cv:auth', () => {
    // auth.js already loaded the owner profile document. Reuse its snapshot hash
    // instead of paying for a second Firestore read every time the user signs in.
    checkedUid = state.user?.uid || '';
    remoteHash = state.user ? state.statsSnapshot?.hash || '' : '';
    lastQueuedHash = ''; latestSnapshot = null;
    latestDirectorLoyalty = null; insightGeneration++;
    syncState = 'idle'; syncMessage = 'Private';
    if (state.user) queueCurrentSnapshot();
  });
  document.addEventListener('cv:wl-changed', queueCurrentSnapshot);
  document.addEventListener('cv:meta-backfilled', queueCurrentSnapshot);
  document.addEventListener('cv:provider-history', () => { if (location.pathname === '/stats') renderStats(); });
  document.addEventListener('cv:recommendation-feedback', () => {
    if (location.pathname === '/stats') renderStats();
  });
  document.addEventListener('cv:social', () => {
    queueCurrentSnapshot();
    if (location.pathname === '/stats') renderStats();
  });
}
