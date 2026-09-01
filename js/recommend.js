// ===== ADVANCED RECOMMENDER =====
// Builds a taste profile from every available signal — watchlist, WATCHED history
// (with its backfilled cast/director/runtime/decade metadata), ratings, and
// recently-viewed — generates candidates from several TMDB sources, scores and
// ranks them once, drops watched titles, and renders diversified rows. Saved and
// recently viewed titles remain eligible: a recommendation can still be useful
// after it has been added to a list; only confirmed watches are excluded.
//
// Key TMDB constraint: /discover results carry NO cast/crew. So actor and director
// affinity enters through `with_cast`/`with_people` QUERY params plus a per-source
// bonus — never a per-candidate /credits fetch (that would be 20+ extra requests).
import { tmdb } from './api.js';
import { genreMap, mGenreList, tGenreList, IMG, PH } from './config.js';
import { state } from './state.js';
import { esc, $, toast } from './ui.js';
import { buildCard, skelCards } from './cards.js';
import { observeReveals } from './effects.js';
import { db, firebase } from './firebase.js';
import { registerActions } from './events.js';
import { ensureWatchedMeta } from './watched-meta.js';

const MOVIE_GENRES = new Set(mGenreList.map(g => g.id));
const TV_GENRES = new Set(tGenreList.map(g => g.id));
let auditOpen = false;
let lastAudit = null;
const HISTORY_LIMIT = 100;
const ROTATION_IDLE_MS = 3 * 86400000;
const ACTIVITY_WRITE_GAP = 6 * 60 * 60 * 1000;
const SIGNAL_REFRESH_MS = 24 * 60 * 60 * 1000;
let lastSignalSlot = -1;
let recommendationRun = 0;
let recommendationSignature = '';

// ----- Per-visit freshness -----
// Every time CineVerse is OPENED the rails show a different slice of the ranked
// pool. The counter is a device-local integer bumped once per page load, so it
// costs no Firestore write, and it is deliberately not bumped on in-app
// navigation — rails that reshuffled while you browsed would feel broken.
// The stored (cross-device) rotation is still added on top.
const SESSION_KEY = () => `cv_rec_session_${state.user?.uid || 'guest'}`;
let sessionRotation = null;

function visitRotation() {
  if (sessionRotation !== null) return sessionRotation;
  let stored = 0;
  // Math.max(0, NaN) is NaN, so a non-numeric value here (a truncated write, an
  // older build, a corrupted profile) used to flow straight into pageFor() and
  // send `page=NaN` to TMDB — every personalised row came back 400 and the rail
  // was silently empty. Worse, String(NaN) was written back, so it stayed
  // broken on that device for good. The value is now checked, not just coerced.
  try {
    const raw = Number(localStorage.getItem(SESSION_KEY()));
    stored = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  } catch (_) { stored = 0; }
  sessionRotation = (stored + 1) % 100000;
  try { localStorage.setItem(SESSION_KEY(), String(sessionRotation)); } catch (_) {}
  return sessionRotation;
}

// The raw pool is varied too, not just the window over it: a rotation that only
// re-sliced the same 40 candidates would keep showing the same titles in a new
// order. Pages 1-3 all hold quality results for these queries.
const pageFor = (offset = 0) => 1 + ((visitRotation() + offset) % 3);

function splitKey(key) { const i = key.lastIndexOf('_'); return [key.slice(0, i), +key.slice(i + 1)]; }

function seedMetaForKey(type, id) {
  const w = state.watchlist.find(x => x.type === type && String(x.tmdbId) === String(id));
  if (w) return { title: w.title, genres: w.genres || [], keywords: w.keywords || [], poster: w.poster || '' };
  const watched = state.watched[`${type}_${id}`];
  if (watched) return { title: watched.title, genres: watched.genres || [], keywords: watched.keywords || [], poster: watched.poster || '' };
  const r = state.recentlyViewed.find(x => x.type === type && String(x.id) === String(id));
  return r ? { title: r.title, genres: r.genres || [], keywords: r.keywords || [], poster: r.poster || '' } : null;
}

// A rating recentres on 5: a 10 adds +5, a 3 subtracts 2. Unrated contributes 0,
// so an unrated title still counts via its base weight.
const ratingW = (s) => (s ? s - 5 : 0);
const decadeOf = (year) => Math.floor(year / 10) * 10;
const yearOf = (c) => parseInt((c.release_date || c.first_air_date || '').slice(0, 4)) || 0;
const timestampMs = value => value?.seconds ? value.seconds * 1000 : (typeof value?.toMillis === 'function' ? value.toMillis() : 0);
const recencyWeight = value => {
  const ms = timestampMs(value); if (!ms) return 1;
  const ageDays = Math.max(0, (Date.now() - ms) / 86400000);
  return .75 + .65 * Math.exp(-ageDays / 365);
};
const keywordList = value => (value || []).map(keyword => typeof keyword === 'object' ? keyword : { id: +keyword, name: '' }).filter(keyword => +keyword.id);

// Sort a {key: weight} map into [{id, name, w}], strongest first, keeping only
// signals strong enough to be a real preference rather than a single watch.
function topOf(weights, names, min = 1.5, images = {}) {
  return Object.entries(weights)
    .filter(([, w]) => w >= min)
    .sort((a, b) => b[1] - a[1])
    .map(([id, w]) => ({ id: +id, name: names[id] || '', w, image: images[id] || '' }));
}

// ----- Taste profile -----
// Parameterized so it can build a profile for the signed-in user (default),
// or for any explicit {watchlist, ratings, watched, recentlyViewed} set (used
// by the Watch-Party matcher to build a profile from a friend's stored data).
export function buildTasteProfile(sources = state) {
  const watchlist = sources.watchlist || [];
  const ratings = sources.ratings || {};
  const watched = sources.watched || {};
  const recentlyViewed = sources.recentlyViewed || [];

  const genreWeights = {}, actorWeights = {}, directorWeights = {}, decadeWeights = {}, keywordWeights = {}, languageWeights = {};
  const actorNames = {}, directorNames = {}, keywordNames = {};
  const actorImages = {}, directorImages = {};
  const addG = (genres, w) => (genres || []).forEach(g => { if (g == null) return; genreWeights[g] = (genreWeights[g] || 0) + w; });
  const bump = (map, key, w) => { if (key == null || key === '') return; map[key] = (map[key] || 0) + w; };

  // Declared at sign-up, when there is nothing else to go on. Weighted so it
  // decides the first session and is outvoted by real viewing soon after: each
  // watched title contributes 1.5 or more, so a dozen of them bury a 1.4 seed.
  (sources.profile?.seedGenres || []).forEach(id => bump(genreWeights, +id, 1.4));

  // Watchlist — an explicit "I want to see this": the strongest genre signal.
  watchlist.forEach(w => {
    const weight = (2 + ratingW(ratings[`${w.type}_${w.tmdbId}`])) * recencyWeight(w.added);
    addG(w.genres, weight);
    keywordList(w.keywords).forEach(keyword => { bump(keywordWeights, keyword.id, weight * .72); if (keyword.name) keywordNames[keyword.id] = keyword.name; });
    if (w.language) bump(languageWeights, w.language, weight * .35);
  });

  // Watched — what you actually consumed. This is where the cast/director/decade
  // signal lives (watched-meta.js backfills it), and it was previously used only
  // to EXCLUDE titles, never to inform taste.
  Object.entries(watched).forEach(([key, d]) => {
    if (!d) return;
    const rw = ratingW(ratings[key]), recent = recencyWeight(d.watchedAt), signal = (1.5 + rw) * recent;
    addG(d.genres, signal);          // a poorly-rated genre can go negative
    keywordList(d.keywords).forEach(keyword => { bump(keywordWeights, keyword.id, signal * .85); if (keyword.name) keywordNames[keyword.id] = keyword.name; });
    if (d.language) bump(languageWeights, d.language, signal * .4);
    const y = parseInt(d.year);
    if (y) bump(decadeWeights, decadeOf(y), 1 + 0.3 * rw);
    if (d.directorId) {
      bump(directorWeights, d.directorId, 1 + 0.5 * rw);
      if (d.director) directorNames[d.directorId] = d.director;
      if (d.directorProfile) directorImages[d.directorId] = d.directorProfile;
    }
    (d.cast || []).slice(0, 5).forEach(p => {
      if (!p || !p.id) return;
      bump(actorWeights, p.id, 1 + 0.5 * rw);
      if (p.name) actorNames[p.id] = p.name;
      if (p.profile) actorImages[p.id] = p.profile;
    });
  });

  recentlyViewed.forEach(r => {
    const signal = .7 + .5 * Math.exp(-Math.max(0, Date.now() - +(r.ts || 0)) / (14 * 86400000));
    addG(r.genres, signal);
    keywordList(r.keywords).forEach(keyword => { bump(keywordWeights, keyword.id, signal * .55); if (keyword.name) keywordNames[keyword.id] = keyword.name; });
  });

  // A dismissal is a soft negative taste signal, never a permanent genre ban.
  // This lets one bad pick teach the system without erasing a whole category.
  (sources.recommendationFeedback?.history || []).slice(0, 100).forEach(item => {
    (item.genres || []).forEach(id => bump(genreWeights, id, -.3));
    (item.keywords || []).forEach(id => bump(keywordWeights, id, -.5));
  });

  let movie = 0, tv = 0;
  watchlist.forEach(w => (w.type === 'tv' ? tv++ : movie++));
  recentlyViewed.forEach(r => (r.type === 'tv' ? tv++ : movie++));
  Object.values(watched).forEach(d => { if (d) (d.type === 'tv' ? tv++ : movie++); });

  // Seeds for /recommendations: highly-rated titles first, then most-recent.
  const seedIds = [];
  Object.entries(ratings).forEach(([key, score]) => {
    if (score >= 8) { const [type, id] = splitKey(key); if (type && id) seedIds.push({ id, type, score, reason: 'liked' }); }
  });
  seedIds.sort((a, b) => b.score - a.score);
  recentlyViewed.slice(0, 2).forEach(r => {
    if (!seedIds.some(s => s.id === r.id && s.type === r.type)) seedIds.push({ id: r.id, type: r.type, score: 0, reason: 'viewed', title: r.title });
  });

  // "Seen" means actually watched. Being in a list or recently opened should not
  // hide a strong recommendation; it often means the user is considering it.
  const dismissed = new Set(sources.recommendationFeedback?.dismissed || []);
  const seen = new Set([...Object.keys(watched), ...dismissed]);

  const topGenres = Object.entries(genreWeights).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).map(([g]) => +g);
  const topActors = topOf(actorWeights, actorNames, 1.5, actorImages);
  const topDirectors = topOf(directorWeights, directorNames, 1.5, directorImages);
  const topKeywords = topOf(keywordWeights, keywordNames, 1.1).filter(keyword => keyword.name).slice(0, 12);
  const topDecade = Object.entries(decadeWeights).sort((a, b) => b[1] - a[1]).map(([d]) => +d)[0] || null;

  return {
    genreWeights, topGenres, seedIds, seen, dismissed, movieBias: movie >= tv,
    keywordWeights, keywordNames, topKeywords, languageWeights,
    actorWeights, actorNames, actorImages, topActors,
    directorWeights, directorNames, directorImages, topDirectors,
    decadeWeights, topDecade,
    hasSignal: topGenres.length > 0 || seedIds.length > 0 || topActors.length > 0 || topKeywords.length > 0,
  };
}

// Every profile-shaped object carries these, so scoreCandidate/fetchCandidates can
// read them without guards no matter which builder produced the profile.
const EMPTY_PEOPLE = { actorWeights: {}, actorNames: {}, topActors: [], directorWeights: {}, directorNames: {}, topDirectors: [], decadeWeights: {}, topDecade: null, keywordWeights: {}, keywordNames: {}, topKeywords: [], languageWeights: {} };

// Build a profile-shape from a friend's stored "shared taste" doc (see social.js).
// That doc is genre-level only, so the people/decade maps stay empty.
export function profileFromShared(shared) {
  const genreWeights = shared?.genreWeights || {};
  const topGenres = (shared?.topGenres || []).map(Number);
  const seen = new Set(shared?.seen || []);
  return { ...EMPTY_PEOPLE, genreWeights, topGenres, seedIds: [], seen, movieBias: shared?.movieBias !== false, hasSignal: topGenres.length > 0 };
}

// Blend N profiles into one group profile. Genres liked by MORE members rank
// higher (consensus), and `seen` is the union so nothing anyone has watched is
// recommended. Feeds the existing fetchCandidates/rankAndDedupe unchanged.
export function blendProfiles(profiles) {
  const list = (profiles || []).filter(Boolean);
  const n = list.length || 1;
  const genreWeights = {};
  const decadeWeights = {};
  const seen = new Set();
  let movie = 0, tv = 0;
  const genreMembers = {}; // genre id -> # members with positive weight
  list.forEach(p => {
    Object.entries(p.genreWeights || {}).forEach(([g, w]) => {
      genreWeights[g] = (genreWeights[g] || 0) + w;
      if (w > 0) genreMembers[g] = (genreMembers[g] || 0) + 1;
    });
    Object.entries(p.decadeWeights || {}).forEach(([d, w]) => { decadeWeights[d] = (decadeWeights[d] || 0) + w; });
    (p.seen || new Set()).forEach(k => seen.add(k));
    p.movieBias ? movie++ : tv++;
  });
  // Consensus scaling: multiply each genre's summed weight by the fraction of
  // members who like it, so mutual tastes dominate.
  Object.keys(genreWeights).forEach(g => { genreWeights[g] = genreWeights[g] * ((genreMembers[g] || 0) / n); });
  const topGenres = Object.entries(genreWeights).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).map(([g]) => +g);
  // Seeds: pool everyone's liked seeds so /recommendations pulls broadly-loved titles.
  const seedIds = [];
  list.forEach(p => (p.seedIds || []).forEach(s => { if (s.score >= 8 && !seedIds.some(x => x.id === s.id && x.type === s.type)) seedIds.push(s); }));
  return { ...EMPTY_PEOPLE, genreWeights, decadeWeights, topGenres, seedIds: seedIds.slice(0, 3), seen, movieBias: movie >= tv, hasSignal: topGenres.length > 0, genreMembers, members: n };
}

// ----- Candidate generation -----
export function tag(results, type, source, provenance = {}) {
  return (results || []).map(r => ({ ...r, ...provenance, __type: r.media_type || type, __source: source }));
}

// A recommendation you can't watch yet isn't a recommendation. Requires a real,
// past date — a candidate with no date at all is unknown/unreleased, so it goes.
export function isOut(c) {
  const raw = c.release_date || c.first_air_date;
  if (!raw) return false;
  const d = new Date(raw + 'T00:00:00');
  return !isNaN(d) && d.getTime() <= Date.now();
}
// Obscure titles with a handful of votes are noise, not discoveries.
const MIN_VOTES = 50;
const today = () => new Date().toISOString().slice(0, 10);

// `only` restricts candidates to a single media type ('movie' | 'tv'); null
// keeps the default blended behavior (movies always, TV when not movie-biased).
// The Watch-Party matcher passes only='movie'/'tv' for its dedicated toggles.
//
// Genres are OR-joined ('|'), not comma-joined: a comma means AND in TMDB, which
// demanded a title match ALL your top genres and starved the candidate pool.
export async function fetchCandidates(profile, { only = null } = {}) {
  const calls = [];
  const wantMovie = only !== 'tv', wantTV = only !== 'movie';
  const topGenres = profile.topGenres || [];
  const movieG = topGenres.filter(g => MOVIE_GENRES.has(g)).slice(0, 3);
  const tvG = topGenres.filter(g => TV_GENRES.has(g)).slice(0, 3);
  const actors = profile.topActors || [];
  const directors = profile.topDirectors || [];
  const push = (p, type, source, provenance = {}) => calls.push(p.then(d => tag(d.results, type, source, provenance)).catch(() => []));
  // Filter unreleased at the source too, so a page isn't half-wasted on titles
  // the client-side guard would only throw away again.
  const outM = { 'release_date.lte': today() };
  const outT = { 'first_air_date.lte': today() };

  if (wantMovie && movieG.length) {
    const or = movieG.join('|');
    push(tmdb('/discover/movie', { with_genres: or, sort_by: 'popularity.desc', 'vote_count.gte': 150, page: pageFor(0), ...outM }), 'movie', 'genre');
    push(tmdb('/discover/movie', { with_genres: or, sort_by: 'popularity.desc', 'vote_count.gte': 150, page: pageFor(1), ...outM }), 'movie', 'genre');
    push(tmdb('/discover/movie', { with_genres: or, sort_by: 'vote_average.desc', 'vote_count.gte': 500, page: pageFor(2), ...outM }), 'movie', 'quality');
  }
  if (wantMovie && actors.length) {
    // The TOP actor gets its own call so the "Starring X" row is always accurate;
    // the next two only widen the pool.
    push(tmdb('/discover/movie', { with_cast: String(actors[0].id), sort_by: 'popularity.desc', page: pageFor(1), ...outM }), 'movie', 'cast');
    const more = actors.slice(1, 3).map(a => a.id);
    if (more.length) push(tmdb('/discover/movie', { with_cast: more.join('|'), sort_by: 'popularity.desc', ...outM }), 'movie', 'castmore');
  }
  if (wantMovie && directors.length) {
    // NOT discover's `with_people` — that matches ANY cast-or-crew credit, so a
    // "From Christopher Nolan" row filled up with films he merely produced (Man of
    // Steel, Batman v Superman, Justice League). His actual filmography comes from
    // person credits, filtered to the Director job.
    calls.push(tmdb(`/person/${directors[0].id}/movie_credits`)
      .then(d => tag((d.crew || []).filter(c => c.job === 'Director'), 'movie', 'director'))
      .catch(() => []));
  }
  // Story themes are much more specific than genre buckets. Each call keeps its
  // exact keyword provenance so the UI can truthfully promise “Because you enjoy…”.
  (profile.topKeywords || []).slice(0, 2).forEach(keyword => {
    if (wantMovie) push(tmdb('/discover/movie', { with_keywords: String(keyword.id), sort_by: 'popularity.desc', 'vote_count.gte': 80, page: pageFor(2), ...outM }), 'movie', 'keyword', { __keywordIds: [+keyword.id] });
    if (wantTV && (only === 'tv' || !profile.movieBias)) push(tmdb('/discover/tv', { with_keywords: String(keyword.id), sort_by: 'popularity.desc', 'vote_count.gte': 80, ...outT }), 'tv', 'keyword', { __keywordIds: [+keyword.id] });
  });
  if (wantTV && tvG.length && (only === 'tv' || !profile.movieBias)) {
    const or = tvG.join('|');
    push(tmdb('/discover/tv', { with_genres: or, sort_by: 'popularity.desc', 'vote_count.gte': 150, page: pageFor(0), ...outT }), 'tv', 'genre');
    if (only === 'tv') push(tmdb('/discover/tv', { with_genres: or, sort_by: 'vote_average.desc', 'vote_count.gte': 300, ...outT }), 'tv', 'quality');
  }
  (profile.seedIds || []).slice(0, 3).filter(s => !only || s.type === only)
    .forEach(s => calls.push(tmdb(`/${s.type}/${s.id}/recommendations`)
      .then(d => tag(d.results, s.type, 'rec', { __seedKey: `${s.type}_${s.id}` }))
      .catch(() => [])));

  const groups = await Promise.all(calls);
  return groups.flat();
}

// ----- Scoring & ranking -----
// Where a candidate CAME FROM is itself evidence: a TMDB "more like this" off a
// title you rated 9 is a better bet than a broad popularity sweep.
const SOURCE_BONUS = { rec: 1.4, keyword: 1.3, cast: 1.2, castmore: 1.15, director: 1.1, quality: 0.7, genre: 0.6, trending: 0.4 };

// Genres that DEFINE a title's audience rather than just flavour it. Sharing a
// broad bucket like Comedy or Adventure means little — an animated kids' film and
// an adult road-trip dramedy both carry those tags. But a title tagged with one of
// these, when you've shown zero interest in that genre, is almost never a real
// match. This is what filled "Because you liked Zindagi Na Milegi Dobara" with
// SpongeBob, Ice Age and Hotel Transylvania.
const DEFINING_GENRES = new Set([16, 99, 10751, 10762, 10770, 10764, 10763, 10767]); // Animation, Documentary, Family, Kids, TV Movie, Reality, News, Talk

// Count a candidate's defining genres you've never engaged with (weight not > 0).
export function offTasteCount(c, profile) {
  const gw = profile.genreWeights || {};
  return (c.genre_ids || []).filter(g => DEFINING_GENRES.has(+g) && !(gw[g] > 0)).length;
}

export function hasCandidateSource(candidate, source) {
  return (candidate.__sources || [candidate.__source]).includes(source);
}

// A title-specific row has a much stricter promise than a general taste row:
// the candidate must come from that exact TMDB seed, substantially overlap its
// genres, and not suddenly switch to a different defining audience category.
export function isRelatedToSeed(candidate, seed) {
  if (!seed || !hasCandidateSource(candidate, 'rec')) return false;
  const key = `${seed.type}_${seed.id}`;
  if (!(candidate.__seedKeys || []).includes(key)) return false;
  const seedGenres = new Set((seed.genres || []).map(Number));
  if (!seedGenres.size) return true;
  const genres = (candidate.genre_ids || []).map(Number);
  const overlap = genres.filter(genre => seedGenres.has(genre)).length;
  const minimum = seedGenres.size >= 3 ? 2 : 1;
  return overlap >= minimum && !genres.some(genre => DEFINING_GENRES.has(genre) && !seedGenres.has(genre));
}

export function scoreBreakdown(c, profile, norms = {}) {
  const gw = profile.genreWeights || {};
  const kw = profile.keywordWeights || {};
  const maxG = norms.maxG || 1, maxDec = norms.maxDec || 1, maxKw = norms.maxKw || 1, maxLang = norms.maxLang || 1;
  let g = 0; (c.genre_ids || []).forEach(id => { g += (gw[id] || 0); });
  const genreScore = g / maxG;
  const sourceBonus = SOURCE_BONUS[c.__source] != null ? SOURCE_BONUS[c.__source] : 0.6;
  const keywordScore = (c.__keywordIds || []).reduce((sum, id) => sum + (kw[id] || 0), 0) / maxKw * .9;
  // Confidence rises logarithmically: 8.2/10 from 20,000 votes should carry more
  // trust than the same rating from 60 votes, without letting popularity dominate.
  const confidence = Math.min(1, Math.log10(Math.max(10, +(c.vote_count || 0))) / 4.5);
  const quality = (((+(c.vote_average || 0) - 5) / 5) * confidence * .75) + Math.min(Math.log10(1 + +(c.popularity || 0)) / 4, .22);
  const y = yearOf(c);
  const decadeScore = y ? ((profile.decadeWeights || {})[decadeOf(y)] || 0) / maxDec * 0.4 : 0;
  const language = c.original_language ? ((profile.languageWeights || {})[c.original_language] || 0) / maxLang * .28 : 0;
  const offPenalty = offTasteCount(c, profile) * 0.6;
  const sources = c.__sources || [c.__source];
  const consensus = Math.max(0, new Set(sources.filter(Boolean)).size - 1) * .22;
  const hash = ((+c.id * 2654435761 + +(profile.rotation || 0) * 1013904223) >>> 0) / 4294967295;
  const serendipity = (hash - .5) * .18;
  return {
    genre: genreScore, keyword: keywordScore, source: sourceBonus, quality, decade: decadeScore, language, consensus, serendipity,
    penalty: offPenalty, total: genreScore + keywordScore + sourceBonus + quality + decadeScore + language + consensus + serendipity - offPenalty,
    matchedGenres: (c.genre_ids || []).filter(id => (gw[id] || 0) > 0).map(id => genreMap[id]).filter(Boolean),
  };
}

export function scoreCandidate(c, profile, norms = {}) {
  return scoreBreakdown(c, profile, norms).total;
}

export function rankAndDedupe(cands, profile) {
  const norms = {
    maxG: Math.max(1, ...Object.values(profile.genreWeights || {}).map(Math.abs)),
    maxDec: Math.max(1, ...Object.values(profile.decadeWeights || {}).map(Math.abs)),
    maxKw: Math.max(1, ...Object.values(profile.keywordWeights || {}).map(Math.abs)),
    maxLang: Math.max(1, ...Object.values(profile.languageWeights || {}).map(Math.abs)),
  };
  const byId = new Map();
  const audit = { considered: (cands || []).length, accepted: 0, rejected: { invalid: 0, unreleased: 0, lowVotes: 0, seen: 0 }, duplicates: 0, decisions: [] };
  const decision = (c, result, reason) => audit.decisions.push({
    title: c?.title || c?.name || 'Untitled', type: c?.__type || c?.media_type || 'movie',
    id: c?.id || 0, result, reason,
  });
  cands.forEach(c => {
    if (!c || !c.id || !c.poster_path) { audit.rejected.invalid++; decision(c, 'Filtered', 'Missing poster or card data'); return; }
    const type = c.__type || 'movie';
    if (type === 'person') { audit.rejected.invalid++; decision(c, 'Filtered', 'People are not watchable titles'); return; }
    // Shared chokepoint for every recommendation surface (rows AND the watch-party
    // matcher): never suggest something that isn't out yet, or something so
    // obscure it's noise rather than a discovery.
    if (!isOut(c)) { audit.rejected.unreleased++; decision(c, 'Filtered', 'Not released or release date unknown'); return; }
    if ((c.vote_count || 0) < MIN_VOTES) { audit.rejected.lowVotes++; decision(c, 'Filtered', `Only ${c.vote_count || 0} community votes`); return; }
    const key = `${type}_${c.id}`;
    if (profile.seen.has(key)) {
      audit.rejected.seen++;
      decision(c, 'Filtered', profile.dismissed?.has(key) ? 'Marked not interested' : 'Already watched');
      return;
    }
    const breakdown = scoreBreakdown(c, profile, norms), sc = breakdown.total;
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, {
        ...c, __type: type, __score: sc, __audit: breakdown,
        __sources: [c.__source], __seedKeys: c.__seedKey ? [c.__seedKey] : [], __keywordIds: c.__keywordIds || [],
      });
      return;
    }
    audit.duplicates++;
    decision(c, 'Merged', `Duplicate from ${c.__source || 'another source'}`);
    // A title can arrive through several paths. Preserve every origin so a card
    // does not lose its exact seed/actor/director relationship during deduping.
    const sources = [...new Set([...(existing.__sources || [existing.__source]), c.__source].filter(Boolean))];
    const seedKeys = [...new Set([...(existing.__seedKeys || []), c.__seedKey].filter(Boolean))];
    const keywordIds = [...new Set([...(existing.__keywordIds || []), ...(c.__keywordIds || [])])];
    byId.set(key, sc > existing.__score
      ? { ...c, __type: type, __score: sc, __audit: breakdown, __sources: sources, __seedKeys: seedKeys, __keywordIds: keywordIds }
      : { ...existing, __sources: sources, __seedKeys: seedKeys, __keywordIds: keywordIds });
  });
  // Re-score merged titles so independent agreement (genre + actor + theme, for
  // example) becomes measurable evidence instead of discarded provenance.
  const ranked = [...byId.values()].map(item => {
    const breakdown = scoreBreakdown(item, profile, norms);
    return { ...item, __score: breakdown.total, __audit: breakdown };
  }).sort((a, b) => b.__score - a.__score);
  audit.accepted = ranked.length;
  Object.defineProperty(ranked, '__auditSummary', { value: audit, enumerable: false });
  return ranked;
}

// Greedy MMR: pick the best remaining candidate after penalising genres already
// represented, so a row isn't twenty variations of the same thing.
export function diversify(ranked, n = 20, lambda = 0.35) {
  const pool = ranked.slice();
  const out = [];
  const used = {};
  while (out.length < n && pool.length) {
    let bestI = 0, bestV = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const gs = pool[i].genre_ids || [];
      const pen = gs.length ? gs.reduce((s, g) => s + (used[g] || 0), 0) / gs.length : 0;
      const v = (pool[i].__score || 0) - lambda * pen;
      if (v > bestV) { bestV = v; bestI = i; }
    }
    const [pick] = pool.splice(bestI, 1);
    (pick.genre_ids || []).forEach(g => { used[g] = (used[g] || 0) + 1; });
    out.push(pick);
  }
  return out;
}

// A match percentage that actually separates the row. Scoring `score / top` put
// every card between 97% and 99% — the scores inside one ranked window are all
// within a few percent of each other, so the badge printed "99% match" on
// everything and told a viewer nothing. Spreading the window's own range across
// 72-99% keeps the ordering honest while making the difference between the first
// pick and the twentieth visible.
//
// `range` is the [lowest, highest] score in the set being rendered. A set whose
// scores are genuinely identical collapses to the top of the band rather than
// dividing by zero.
export function matchBadge(score, range) {
  const [low, high] = Array.isArray(range) ? range : [0, range];
  const span = (+high || 0) - (+low || 0);
  const ratio = span > 1e-6 ? ((+score || 0) - low) / span : 1;
  const pct = Math.round(72 + Math.max(0, Math.min(1, ratio)) * 27);
  return `${pct}% match`;
}

// The lowest and highest score in a ranked set, for matchBadge.
export const scoreRange = items => {
  const scores = items.map(item => +item.__score || 0);
  return scores.length ? [Math.min(...scores), Math.max(...scores)] : [0, 1];
};

function pickLabeledSeed(profile) {
  for (const s of profile.seedIds) {
    if (s.score >= 8) {
      const meta = seedMetaForKey(s.type, s.id);
      if (meta?.title) return { id: s.id, type: s.type, title: meta.title, genres: meta.genres, poster: meta.poster || '', reason: 'liked' };
    }
  }
  const r = state.recentlyViewed[0];
  return r ? { id: r.id, type: r.type, title: r.title, genres: r.genres || [], poster: r.poster || '', reason: 'viewed' } : null;
}

function shell(d) {
  const art = d.art
    ? (d.art.kind === 'face'
      ? `<a class="rail-face" href="/person/${d.art.personId}" data-action="open-person" data-id="${d.art.personId}" aria-label="${esc(d.art.alt)}"><img src="${d.art.src}" alt="" loading="lazy"></a>`
      : `<a class="rail-poster" href="/${d.art.type}/${d.art.id}" data-action="open-detail" data-id="${d.art.id}" data-type="${d.art.type}" aria-label="${esc(d.art.alt)}"><img src="${d.art.src}" alt="" loading="lazy"></a>`)
    : `<span class="rail-glyph" aria-hidden="true">${d.icon}</span>`;
  return `<div class="section reveal rec-section"><div class="section-head rec-head">
      ${art}
      <div class="rec-head-copy">
        <h2 class="section-title">${esc(d.title)}</h2>
        ${d.kicker ? `<p class="rec-kicker">${esc(d.kicker)}</p>` : ''}
      </div>
    </div><div class="row" id="${d.id}">${skelCards(8)}</div></div>`;
}

function feedbackState() {
  if (!state.recommendationFeedback) state.recommendationFeedback = { dismissed: [], history: [], rotation: 0, lastRecommendationActivityAt: 0, lastRotatedAt: 0 };
  return state.recommendationFeedback;
}

async function persistFeedback() {
  const uid = state.user?.uid || 'guest';
  const feedback = feedbackState();
  // A client timestamp lets loadProfile resolve an offline device write against
  // an older cloud copy and safely retry it on the next successful profile read.
  const payload = {
    dismissed: feedback.dismissed.slice(0, 150), history: feedback.history.slice(0, HISTORY_LIMIT),
    rotation: Math.max(0, Math.floor(+(feedback.rotation || 0))),
    lastRecommendationActivityAt: Math.max(0, +(feedback.lastRecommendationActivityAt || 0)),
    lastRotatedAt: Math.max(0, +(feedback.lastRotatedAt || 0)), clientUpdatedAt: Date.now(),
  };
  try { localStorage.setItem(`cv_rec_feedback_${uid}`, JSON.stringify(payload)); } catch (_) {}
  if (!state.user) return;
  try {
    await db.collection('users').doc(state.user.uid).set({
      recommendationFeedback: { ...payload, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
    }, { merge: true });
  } catch (error) {
    console.error('persist recommendation feedback', error);
    toast('Saved on this device; cloud sync will retry next time', 'info');
  }
}

function prepareRecommendationRotation() {
  const feedback = feedbackState(), now = Date.now();
  if (!feedback.lastRotatedAt) {
    feedback.lastRotatedAt = now;
    feedback.lastRecommendationActivityAt ||= now;
    persistFeedback();
  } else {
    const quietSince = Math.max(+(feedback.lastRecommendationActivityAt || 0), +(feedback.lastRotatedAt || 0));
    if (now - quietSince >= ROTATION_IDLE_MS) {
      feedback.rotation = (Math.max(0, Math.floor(+(feedback.rotation || 0))) + 1) % 100000;
      feedback.lastRotatedAt = now;
      persistFeedback();
    }
  }
  return Math.max(0, Math.floor(+(feedback.rotation || 0)));
}

function rotatedWindow(items, rotation, size = 20) {
  if (!items.length) return [];
  const premium = items.slice(0, Math.min(items.length, Math.max(size, size * 2)));
  if (!rotation || premium.length <= size) return premium.slice(0, size);
  // 7 is coprime with every window length we produce, so successive rotations
  // land on genuinely different starting points instead of cycling early.
  const offset = (rotation * 7) % premium.length;
  return [...premium.slice(offset), ...premium.slice(0, offset)].slice(0, size);
}

// The stored rotation keeps long-term drift consistent across devices; the visit
// counter guarantees a different slice every time the app is opened. Entirely
// silent by design — the rails simply differ, with no banner explaining why.
function activeRotation() {
  return prepareRecommendationRotation() + visitRotation();
}

const currentSignalSlot = () => Math.floor(Date.now() / SIGNAL_REFRESH_MS);
function rotateList(values, offset) {
  const list = [...(values || [])];
  if (list.length < 2) return list;
  const start = ((offset % list.length) + list.length) % list.length;
  return [...list.slice(start), ...list.slice(0, start)];
}

// Named rails must evolve too, not only the cards inside them. The strongest
// small pool remains taste-ranked; its starting signal rotates per visit and at
// least once a day, so Because/From/theme rails do not fossilise indefinitely.
export function rotateRecommendationSignals(profile, rotation = 0, slot = currentSignalSlot()) {
  const cycle = Math.max(0, Math.floor(rotation)) + Math.max(0, Math.floor(slot));
  return {
    ...profile,
    seedIds: rotateList((profile.seedIds || []).slice(0, 8), cycle),
    topDirectors: rotateList((profile.topDirectors || []).slice(0, 6), cycle + 1),
    topActors: rotateList((profile.topActors || []).slice(0, 6), cycle + 2),
    topKeywords: rotateList((profile.topKeywords || []).slice(0, 10), cycle + 3),
    topGenres: rotateList((profile.topGenres || []).slice(0, 8), cycle + 4),
  };
}

function touchRecommendationActivity() {
  const feedback = feedbackState(), now = Date.now();
  if (now - +(feedback.lastRecommendationActivityAt || 0) < ACTIVITY_WRITE_GAP) return;
  feedback.lastRecommendationActivityAt = now;
  persistFeedback();
}

function auditNumber(value) { return Number(value || 0).toFixed(2); }
function sourceLabel(source) {
  return ({ rec: 'Exact title seed', keyword: 'Story-theme affinity', cast: 'Favorite actor', castmore: 'Actor affinity', director: 'Favorite director', quality: 'Quality discovery', genre: 'Genre discovery', trending: 'Trending' })[source] || source || 'Discovery';
}

function auditHTML(profile, ranked, seed, { closable = true } = {}) {
  const summary = ranked?.__auditSummary || { considered: 0, accepted: 0, duplicates: 0, rejected: {}, decisions: [] };
  const rejected = summary.rejected || {};
  const history = feedbackState().history || [];
  const candidates = ranked || [];
  return `<div class="rec-audit-head"><div><span>Private diagnostics</span><h3>Recommendation Audit</h3><p>Every score component, source, and filter decision used for this session.</p></div>${closable ? '<button data-action="toggle-rec-audit" aria-label="Close recommendation audit">&times;</button>' : ''}</div>
    <div class="rec-audit-metrics"><div><span>Fetched</span><strong>${summary.considered || 0}</strong></div><div><span>Ranked</span><strong>${summary.accepted || 0}</strong></div><div><span>Duplicates merged</span><strong>${summary.duplicates || 0}</strong></div><div><span>Dismissed</span><strong>${feedbackState().dismissed.length}</strong></div></div>
    <div class="rec-audit-grid">
      <section><div class="mini-panel-title"><span>Filter decisions</span><b>before ranking</b></div><div class="audit-filters">
        ${[['Missing card data', rejected.invalid], ['Not released', rejected.unreleased], ['Too few community votes', rejected.lowVotes], ['Watched or not interested', rejected.seen]].map(([label, count]) => `<div><span>${label}</span><strong>${count || 0}</strong></div>`).join('')}
      </div><details class="audit-decisions"><summary>Every filter decision <b>${(summary.decisions || []).length}</b></summary><div>${(summary.decisions || []).length ? summary.decisions.map(item => `<p><strong>${esc(item.title)}</strong><span>${esc(item.result)} · ${esc(item.reason)}</span></p>`).join('') : '<p><span>No candidates were filtered or merged.</span></p>'}</div></details><p class="audit-formula">Score = genres + story themes + source trust + confidence-weighted quality + era + language + multi-signal agreement + controlled discovery − off-taste penalty.</p>${seed ? `<p class="audit-seed">Title row seed: <strong>${esc(seed.title)}</strong> · requires exact seed provenance and real genre overlap.</p>` : ''}</section>
      <section><div class="mini-panel-title"><span>Not interested history</span><b>Firestore backed</b></div><div class="audit-history">${history.length ? history.map(item => `<div><img src="${item.poster ? `${IMG}w92${item.poster}` : PH}" alt=""><span><strong>${esc(item.title || 'Untitled')}</strong><small>${new Date(item.dismissedAt || Date.now()).toLocaleDateString()}</small></span><button data-action="restore-recommendation" data-key="${esc(item.key)}">Restore</button></div>`).join('') : '<p>No dismissed recommendations yet.</p>'}</div></section>
    </div>
    <div class="mini-panel-title audit-ranked-title"><span>Every ranked candidate</span><b>${candidates.length} scores</b></div>
    <div class="audit-ranked">${candidates.length ? candidates.map((item, index) => { const a = item.__audit || {}; const title = item.title || item.name || 'Untitled'; return `<article><span class="audit-rank">${index + 1}</span><img src="${item.poster_path ? `${IMG}w92${item.poster_path}` : ''}" alt=""><div class="audit-candidate-copy"><strong>${esc(title)}</strong><small>${(item.__sources || [item.__source]).map(sourceLabel).join(' · ')}</small><em>${(a.matchedGenres || []).join(', ') || 'No positive genre signal'}</em></div><div class="audit-score"><strong>${auditNumber(item.__score)}</strong><span>Genre ${auditNumber(a.genre)} · Theme ${auditNumber(a.keyword)} · Source ${auditNumber(a.source)} · Quality ${auditNumber(a.quality)} · Era ${auditNumber(a.decade)} · Language ${auditNumber(a.language)} · Agreement ${auditNumber(a.consensus)} · Discovery ${auditNumber(a.serendipity)} · Penalty −${auditNumber(a.penalty)}</span></div></article>`; }).join('') : '<p class="stats-empty-line">Candidates are still being calculated.</p>'}</div>`;
}

function paintAudit(profile, ranked, seed) {
  lastAudit = { profile, ranked, seed };
  const panel = $('recAudit'); if (!panel) return;
  panel.classList.toggle('active', auditOpen);
  panel.setAttribute('aria-hidden', auditOpen ? 'false' : 'true');
  panel.innerHTML = auditHTML(profile, ranked, seed);
}

async function dismissRecommendation(element, event) {
  event?.stopPropagation();
  const key = `${element.dataset.type}_${element.dataset.id}`;
  const feedback = feedbackState();
  let genres = [], keywords = [];
  try { genres = JSON.parse(element.dataset.genres || '[]').map(Number).filter(Boolean); } catch (_) {}
  try { keywords = JSON.parse(element.dataset.keywords || '[]').map(Number).filter(Boolean); } catch (_) {}
  const record = {
    key, id: +element.dataset.id, type: element.dataset.type,
    title: element.dataset.title || '', poster: element.dataset.poster || '',
    source: element.dataset.source || '', genres, keywords, score: +(element.dataset.score || 0), dismissedAt: Date.now(),
  };
  feedback.dismissed = [...new Set([key, ...feedback.dismissed])].slice(0, 150);
  feedback.history = [record, ...feedback.history.filter(item => item.key !== key)].slice(0, HISTORY_LIMIT);
  feedback.lastRecommendationActivityAt = Date.now();
  document.querySelectorAll('[data-recommendation-key]').forEach(card => {
    if (card.dataset.recommendationKey !== key) return;
    const row = card.closest('.row'); card.remove();
    if (row && !row.querySelector('[data-recommendation-key]')) row.closest('.section')?.remove();
  });
  if (lastAudit) {
    const next = lastAudit.ranked.filter(item => `${item.__type}_${item.id}` !== key);
    Object.defineProperty(next, '__auditSummary', { value: lastAudit.ranked.__auditSummary, enumerable: false });
    paintAudit(lastAudit.profile, next, lastAudit.seed);
  }
  toast('Removed from your recommendations', 'success');
  await persistFeedback();
  document.dispatchEvent(new Event('cv:recommendation-feedback'));
}

async function restoreRecommendation(key) {
  const feedback = feedbackState();
  feedback.dismissed = feedback.dismissed.filter(value => value !== key);
  feedback.history = feedback.history.filter(item => item.key !== key);
  feedback.lastRecommendationActivityAt = Date.now();
  await persistFeedback();
  document.dispatchEvent(new Event('cv:recommendation-feedback'));
  toast('Recommendation restored', 'success');
  renderRecommendations();
  if ($('recommendationProfileInsights')) renderRecommendationInsights();
}

function recommendationCard(candidate, opts = {}) {
  return buildCard(candidate, candidate.__type, { ...opts, dismissible: true });
}

async function fillRow(id, fn, run = recommendationRun) {
  try {
    const inner = await fn();
    if (run !== recommendationRun) return;
    const el = $(id); if (!el) return;
    if (inner) el.innerHTML = inner; else el.closest('.section')?.remove();
  } catch (e) {
    if (run !== recommendationRun) return;
    const el = $(id); if (el) el.closest('.section')?.remove();
  }
}

// ----- Public entry (home.js re-exports this as renderPersonalRows) -----
export async function renderRecommendations() {
  const wrap = $('personalRows');
  if (!wrap) return;
  if (!state.authReady) return;
  // Rendering never waits for old watched records to be enriched. When the
  // one-time metadata pass lands, its event refreshes these rails with themes.
  ensureWatchedMeta();
  let profile = buildTasteProfile();
  if (!profile.hasSignal) {
    recommendationRun++;
    recommendationSignature = `empty:${state.user?.uid || 'guest'}`;
    if (wrap.firstChild) wrap.innerHTML = '';
    return;
  }
  const rotation = activeRotation();
  const signalSlot = currentSignalSlot();
  const sourceSignature = JSON.stringify({
    uid: state.user?.uid || 'guest', rotation, signalSlot,
    watchlist: state.watchlist.map(item => item.id).sort(),
    watched: Object.keys(state.watched).sort(),
    ratings: Object.entries(state.ratings).sort(([a], [b]) => a.localeCompare(b)),
    dismissed: [...(state.recommendationFeedback?.dismissed || [])].sort(),
  });
  if (sourceSignature === recommendationSignature && wrap.firstElementChild) return;
  recommendationSignature = sourceSignature;
  const run = ++recommendationRun;
  profile = rotateRecommendationSignals(profile, rotation, signalSlot);
  profile.rotation = rotation;
  lastSignalSlot = signalSlot;

  const seed = pickLabeledSeed(profile);
  const topActor = (profile.topActors || []).find(a => a.name);
  const topDirector = (profile.topDirectors || []).find(d => d.name);
  const topKeyword = (profile.topKeywords || [])[0];
  const genreId = profile.topGenres.find(g => MOVIE_GENRES.has(g));

  const descriptors = [{ id: 'rowTopPicks', icon: '✨', title: 'Top Picks for You', kicker: 'Ranked from everything you have watched, saved, and rated' }];
  if (seed) descriptors.push({
    id: 'rowSeed', icon: seed.reason === 'liked' ? '⭐' : '🍿',
    title: `Because you ${seed.reason} ${seed.title}`,
    kicker: seed.reason === 'liked' ? 'Titles with real overlap, not just a shared genre' : 'Following the last thing you opened',
    art: seed.poster ? { kind: 'poster', src: `${IMG}w154${seed.poster}`, alt: seed.title, id: seed.id, type: seed.type } : null,
  });
  if (topActor) descriptors.push({
    id: 'rowActor', icon: '🌟', title: `Starring ${topActor.name}`,
    kicker: 'Appears across your watch history',
    art: topActor.image ? { kind: 'face', src: `${IMG}w185${topActor.image}`, alt: topActor.name, personId: topActor.id } : null,
  });
  if (topDirector) descriptors.push({
    id: 'rowDirector', icon: '🎥', title: `From ${topDirector.name}`,
    kicker: 'A filmmaker you keep returning to',
    art: topDirector.image ? { kind: 'face', src: `${IMG}w185${topDirector.image}`, alt: topDirector.name, personId: topDirector.id } : null,
  });
  if (topKeyword) descriptors.push({ id: 'rowTheme', icon: '✦', title: `Because you enjoy ${topKeyword.name}`, kicker: 'A story theme, not a genre — the sharper signal of the two' });
  if (genreId && genreMap[genreId]) descriptors.push({ id: 'rowGenre', icon: '🎬', title: `More ${genreMap[genreId]}`, kicker: 'Your strongest genre by weight' });

  const shellHTML = descriptors.map(shell).join('');
  // Keep populated rows in place while an updated recommendation pool resolves.
  // Rebuild shells only when their visible labels actually changed.
  if (!wrap.firstElementChild || wrap.dataset.shellSignature !== shellHTML) {
    wrap.innerHTML = shellHTML;
    wrap.dataset.shellSignature = shellHTML;
    observeReveals(wrap);
  }

  // ONE pool fetch + ONE ranking pass, shared by every row. The old code refetched
  // (and re-ranked) per row, which was both slower and inconsistent between rows.
  const pool = fetchCandidates(profile).then(c => rankAndDedupe(c, profile)).catch(() => []);
  // The full scoring explanation intentionally lives on Profile. Home stays a
  // clean discovery surface and only renders the recommendation rails.

  fillRow('rowTopPicks', async () => {
    const picks = rotatedWindow(diversify(await pool, 40), rotation, 20);
    if (!picks.length) return null;
    const range = scoreRange(picks);
    return picks.map(c => recommendationCard(c, { badge: matchBadge(c.__score, range) })).join('');
  }, run);

  const rowFrom = async (pred, min = 1) => {
    const items = rotatedWindow((await pool).filter(pred), rotation, 20);
    return items.length >= min ? items.map(c => recommendationCard(c)).join('') : null;
  };

  // The label and every card now share the exact same recommendation seed.
  // Strict similarity removes the row entirely if fewer than four honest matches
  // remain; a missing row is better than a confident but misleading explanation.
  if (seed) fillRow('rowSeed', () => rowFrom(c => isRelatedToSeed(c, seed), 4), run);
  if (topActor) fillRow('rowActor', () => rowFrom(c => hasCandidateSource(c, 'cast')), run);
  if (topDirector) fillRow('rowDirector', () => rowFrom(c => hasCandidateSource(c, 'director')), run);
  if (topKeyword) fillRow('rowTheme', () => rowFrom(c => hasCandidateSource(c, 'keyword') && (c.__keywordIds || []).includes(+topKeyword.id), 4), run);
  if (genreId && genreMap[genreId]) fillRow('rowGenre', () => rowFrom(c => (c.genre_ids || []).includes(genreId)), run);
}

function signalName(id) { return genreMap[id] || 'Discovering'; }

// Profile-only explanation. It uses the exact same pool and ranking pass as Home,
// so the audit describes real decisions rather than a simplified marketing copy.
export async function renderRecommendationInsights() {
  const host = $('recommendationProfileInsights');
  if (!host) return;
  const profile = buildTasteProfile();
  if (!profile.hasSignal) {
    host.innerHTML = `<div class="profile-rec-empty"><span>Private recommendation map</span><h3>Your taste is ready to learn.</h3><p>Watch or rate a few titles and this page will explain every recommendation signal.</p><button class="btn-glass" data-action="show-page" data-page="discover">Start discovering</button></div>`;
    return;
  }
  const seed = pickLabeledSeed(profile);
  const topGenres = profile.topGenres.slice(0, 4).map(signalName);
  const topThemes = (profile.topKeywords || []).slice(0, 4).map(keyword => keyword.name);
  const leadingPeople = [...(profile.topDirectors || []).slice(0, 2).map(person => `${person.name} · director`), ...(profile.topActors || []).slice(0, 2).map(person => `${person.name} · actor`)].filter(name => !name.startsWith(' ·'));
  host.innerHTML = `<div class="profile-rec-map">
    <article><span>Strongest genres</span><strong>${topGenres.map(esc).join(' · ') || 'Still learning'}</strong><p>Built from what you watched, saved, opened and rated.</p></article>
    <article><span>Story-theme fingerprint</span><strong>${topThemes.map(esc).join(' · ') || 'Still learning'}</strong><p>Specific themes separate a true match from a title that only shares a broad genre.</p></article>
    <article><span>Trusted people</span><strong>${leadingPeople.map(esc).join(' · ') || 'Still learning'}</strong><p>Recurring directors and cast add a focused source bonus.</p></article>
    <article><span>Title seed</span><strong>${esc(seed?.title || 'Quality discovery')}</strong><p>${seed ? `Real similarity must overlap with this ${seed.reason} title.` : 'High-quality discoveries fill gaps without inventing a link.'}</p></article>
    <article><span>Privacy rule</span><strong>Watched titles stay out</strong><p>Saved titles can remain useful; watched and dismissed titles are filtered.</p></article>
    <article><span>Freshness rhythm</span><strong>A new slice every visit</strong><p>Opening CineVerse rotates the window over your ranked pool, and Shuffle skips ahead on demand. Ranking itself never changes randomly — only which part of it you see first.</p></article>
  </div><aside class="rec-audit active profile-rec-audit" id="recAudit" aria-hidden="false">${auditHTML(profile, null, seed, { closable: false })}</aside>`;
  try {
    const ranked = rankAndDedupe(await fetchCandidates(profile), profile);
    if (host.isConnected) {
      const panel = $('recAudit');
      if (panel && host.contains(panel)) panel.innerHTML = auditHTML(profile, ranked, seed, { closable: false });
    }
  } catch (error) { console.warn('recommendation explanation', error); }
}

export function initRecommendations() {
  registerActions({
    'dismiss-recommendation': (element, event) => dismissRecommendation(element, event),
    'toggle-rec-audit': () => {
      auditOpen = !auditOpen;
      const panel = $('recAudit');
      if (panel) { panel.classList.toggle('active', auditOpen); panel.setAttribute('aria-hidden', auditOpen ? 'false' : 'true'); }
    },
    'restore-recommendation': element => restoreRecommendation(element.dataset.key),
  });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-action="dismiss-recommendation"]')) return;
    if (event.target.closest('[data-recommendation-key]')) touchRecommendationActivity();
  }, true);
  document.addEventListener('cv:auth', () => { auditOpen = false; lastAudit = null; });
  // A tab left open for days refreshes the named taste signals when it returns
  // to the foreground. The short poll does no network work unless the day slot
  // actually changed and Home's recommendation host is present.
  const refreshNamedRails = () => {
    if (document.hidden || currentSignalSlot() === lastSignalSlot || !$('personalRows')) return;
    renderRecommendations();
  };
  document.addEventListener('visibilitychange', refreshNamedRails);
  setInterval(refreshNamedRails, 30 * 60 * 1000);
  document.addEventListener('cv:meta-backfilled', () => {
    if ($('personalRows')) renderRecommendations();
    if ($('recommendationProfileInsights')) renderRecommendationInsights();
  });
}
