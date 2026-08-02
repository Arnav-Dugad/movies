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

const MOVIE_GENRES = new Set(mGenreList.map(g => g.id));
const TV_GENRES = new Set(tGenreList.map(g => g.id));
let auditOpen = false;
let lastAudit = null;
const HISTORY_LIMIT = 100;

function splitKey(key) { const i = key.lastIndexOf('_'); return [key.slice(0, i), +key.slice(i + 1)]; }

function seedMetaForKey(type, id) {
  const w = state.watchlist.find(x => x.type === type && String(x.tmdbId) === String(id));
  if (w) return { title: w.title, genres: w.genres || [] };
  const watched = state.watched[`${type}_${id}`];
  if (watched) return { title: watched.title, genres: watched.genres || [] };
  const r = state.recentlyViewed.find(x => x.type === type && String(x.id) === String(id));
  return r ? { title: r.title, genres: r.genres || [] } : null;
}

// A rating recentres on 5: a 10 adds +5, a 3 subtracts 2. Unrated contributes 0,
// so an unrated title still counts via its base weight.
const ratingW = (s) => (s ? s - 5 : 0);
const decadeOf = (year) => Math.floor(year / 10) * 10;
const yearOf = (c) => parseInt((c.release_date || c.first_air_date || '').slice(0, 4)) || 0;

// Sort a {key: weight} map into [{id, name, w}], strongest first, keeping only
// signals strong enough to be a real preference rather than a single watch.
function topOf(weights, names, min = 1.5) {
  return Object.entries(weights)
    .filter(([, w]) => w >= min)
    .sort((a, b) => b[1] - a[1])
    .map(([id, w]) => ({ id: +id, name: names[id] || '', w }));
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

  const genreWeights = {}, actorWeights = {}, directorWeights = {}, decadeWeights = {};
  const actorNames = {}, directorNames = {};
  const addG = (genres, w) => (genres || []).forEach(g => { if (g == null) return; genreWeights[g] = (genreWeights[g] || 0) + w; });
  const bump = (map, key, w) => { if (key == null || key === '') return; map[key] = (map[key] || 0) + w; };

  // Watchlist — an explicit "I want to see this": the strongest genre signal.
  watchlist.forEach(w => addG(w.genres, 2 + ratingW(ratings[`${w.type}_${w.tmdbId}`])));

  // Watched — what you actually consumed. This is where the cast/director/decade
  // signal lives (watched-meta.js backfills it), and it was previously used only
  // to EXCLUDE titles, never to inform taste.
  Object.entries(watched).forEach(([key, d]) => {
    if (!d) return;
    const rw = ratingW(ratings[key]);
    addG(d.genres, 1.5 + rw);          // a poorly-rated genre can go negative
    const y = parseInt(d.year);
    if (y) bump(decadeWeights, decadeOf(y), 1 + 0.3 * rw);
    if (d.directorId) { bump(directorWeights, d.directorId, 1 + 0.5 * rw); if (d.director) directorNames[d.directorId] = d.director; }
    (d.cast || []).slice(0, 5).forEach(p => { if (p && p.id) { bump(actorWeights, p.id, 1 + 0.5 * rw); if (p.name) actorNames[p.id] = p.name; } });
  });

  recentlyViewed.forEach(r => addG(r.genres, 1));

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
  const topActors = topOf(actorWeights, actorNames);
  const topDirectors = topOf(directorWeights, directorNames);
  const topDecade = Object.entries(decadeWeights).sort((a, b) => b[1] - a[1]).map(([d]) => +d)[0] || null;

  return {
    genreWeights, topGenres, seedIds, seen, dismissed, movieBias: movie >= tv,
    actorWeights, actorNames, topActors,
    directorWeights, directorNames, topDirectors,
    decadeWeights, topDecade,
    hasSignal: topGenres.length > 0 || seedIds.length > 0 || topActors.length > 0,
  };
}

// Every profile-shaped object carries these, so scoreCandidate/fetchCandidates can
// read them without guards no matter which builder produced the profile.
const EMPTY_PEOPLE = { actorWeights: {}, actorNames: {}, topActors: [], directorWeights: {}, directorNames: {}, topDirectors: [], decadeWeights: {}, topDecade: null };

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
  const push = (p, type, source) => calls.push(p.then(d => tag(d.results, type, source)).catch(() => []));
  // Filter unreleased at the source too, so a page isn't half-wasted on titles
  // the client-side guard would only throw away again.
  const outM = { 'release_date.lte': today() };
  const outT = { 'first_air_date.lte': today() };

  if (wantMovie && movieG.length) {
    const or = movieG.join('|');
    push(tmdb('/discover/movie', { with_genres: or, sort_by: 'popularity.desc', 'vote_count.gte': 150, ...outM }), 'movie', 'genre');
    push(tmdb('/discover/movie', { with_genres: or, sort_by: 'popularity.desc', 'vote_count.gte': 150, page: 2, ...outM }), 'movie', 'genre');
    push(tmdb('/discover/movie', { with_genres: or, sort_by: 'vote_average.desc', 'vote_count.gte': 500, ...outM }), 'movie', 'quality');
  }
  if (wantMovie && actors.length) {
    // The TOP actor gets its own call so the "Starring X" row is always accurate;
    // the next two only widen the pool.
    push(tmdb('/discover/movie', { with_cast: String(actors[0].id), sort_by: 'popularity.desc', ...outM }), 'movie', 'cast');
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
  if (wantTV && tvG.length && (only === 'tv' || !profile.movieBias)) {
    const or = tvG.join('|');
    push(tmdb('/discover/tv', { with_genres: or, sort_by: 'popularity.desc', 'vote_count.gte': 150, ...outT }), 'tv', 'genre');
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
const SOURCE_BONUS = { rec: 1.4, cast: 1.2, castmore: 1.15, director: 1.1, quality: 0.7, genre: 0.6, trending: 0.4 };

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
  const maxG = norms.maxG || 1, maxDec = norms.maxDec || 1;
  let g = 0; (c.genre_ids || []).forEach(id => { g += (gw[id] || 0); });
  const genreScore = g / maxG;
  const sourceBonus = SOURCE_BONUS[c.__source] != null ? SOURCE_BONUS[c.__source] : 0.6;
  const quality = (c.vote_average || 0) / 10 * 0.5 + Math.min((c.popularity || 0) / 500, 1) * 0.3;
  const y = yearOf(c);
  const decadeScore = y ? ((profile.decadeWeights || {})[decadeOf(y)] || 0) / maxDec * 0.4 : 0;
  const offPenalty = offTasteCount(c, profile) * 0.6;
  return {
    genre: genreScore, source: sourceBonus, quality, decade: decadeScore,
    penalty: offPenalty, total: genreScore + sourceBonus + quality + decadeScore - offPenalty,
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
        __sources: [c.__source], __seedKeys: c.__seedKey ? [c.__seedKey] : [],
      });
      return;
    }
    audit.duplicates++;
    decision(c, 'Merged', `Duplicate from ${c.__source || 'another source'}`);
    // A title can arrive through several paths. Preserve every origin so a card
    // does not lose its exact seed/actor/director relationship during deduping.
    const sources = [...new Set([...(existing.__sources || [existing.__source]), c.__source].filter(Boolean))];
    const seedKeys = [...new Set([...(existing.__seedKeys || []), c.__seedKey].filter(Boolean))];
    byId.set(key, sc > existing.__score
      ? { ...c, __type: type, __score: sc, __audit: breakdown, __sources: sources, __seedKeys: seedKeys }
      : { ...existing, __sources: sources, __seedKeys: seedKeys });
  });
  const ranked = [...byId.values()].sort((a, b) => b.__score - a.__score);
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

export function matchBadge(score, top) { const pct = Math.max(60, Math.min(99, Math.round((score / (top || 1)) * 100))); return `${pct}% match`; }

function pickLabeledSeed(profile) {
  for (const s of profile.seedIds) {
    if (s.score >= 8) {
      const meta = seedMetaForKey(s.type, s.id);
      if (meta?.title) return { id: s.id, type: s.type, title: meta.title, genres: meta.genres, reason: 'liked' };
    }
  }
  const r = state.recentlyViewed[0];
  return r ? { id: r.id, type: r.type, title: r.title, genres: r.genres || [], reason: 'viewed' } : null;
}

function shell(d) {
  return `<div class="section reveal"><div class="section-head"><h2 class="section-title"><span>${d.icon}</span> ${esc(d.title)}</h2></div><div class="row" id="${d.id}">${skelCards(8)}</div></div>`;
}

function feedbackState() {
  if (!state.recommendationFeedback) state.recommendationFeedback = { dismissed: [], history: [] };
  return state.recommendationFeedback;
}

async function persistFeedback() {
  const uid = state.user?.uid || 'guest';
  const feedback = feedbackState();
  // A client timestamp lets loadProfile resolve an offline device write against
  // an older cloud copy and safely retry it on the next successful profile read.
  const payload = { dismissed: feedback.dismissed.slice(0, 150), history: feedback.history.slice(0, HISTORY_LIMIT), clientUpdatedAt: Date.now() };
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

function auditNumber(value) { return Number(value || 0).toFixed(2); }
function sourceLabel(source) {
  return ({ rec: 'Exact title seed', cast: 'Favorite actor', castmore: 'Actor affinity', director: 'Favorite director', quality: 'Quality discovery', genre: 'Genre discovery', trending: 'Trending' })[source] || source || 'Discovery';
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
      </div><details class="audit-decisions"><summary>Every filter decision <b>${(summary.decisions || []).length}</b></summary><div>${(summary.decisions || []).length ? summary.decisions.map(item => `<p><strong>${esc(item.title)}</strong><span>${esc(item.result)} · ${esc(item.reason)}</span></p>`).join('') : '<p><span>No candidates were filtered or merged.</span></p>'}</div></details><p class="audit-formula">Score = genre affinity + source trust + quality + decade affinity − off-taste penalty.</p>${seed ? `<p class="audit-seed">Title row seed: <strong>${esc(seed.title)}</strong> · requires exact seed provenance and real genre overlap.</p>` : ''}</section>
      <section><div class="mini-panel-title"><span>Not interested history</span><b>Firestore backed</b></div><div class="audit-history">${history.length ? history.map(item => `<div><img src="${item.poster ? `${IMG}w92${item.poster}` : PH}" alt=""><span><strong>${esc(item.title || 'Untitled')}</strong><small>${new Date(item.dismissedAt || Date.now()).toLocaleDateString()}</small></span><button data-action="restore-recommendation" data-key="${esc(item.key)}">Restore</button></div>`).join('') : '<p>No dismissed recommendations yet.</p>'}</div></section>
    </div>
    <div class="mini-panel-title audit-ranked-title"><span>Every ranked candidate</span><b>${candidates.length} scores</b></div>
    <div class="audit-ranked">${candidates.length ? candidates.map((item, index) => { const a = item.__audit || {}; const title = item.title || item.name || 'Untitled'; return `<article><span class="audit-rank">${index + 1}</span><img src="${item.poster_path ? `${IMG}w92${item.poster_path}` : ''}" alt=""><div class="audit-candidate-copy"><strong>${esc(title)}</strong><small>${(item.__sources || [item.__source]).map(sourceLabel).join(' · ')}</small><em>${(a.matchedGenres || []).join(', ') || 'No positive genre signal'}</em></div><div class="audit-score"><strong>${auditNumber(item.__score)}</strong><span>Genre ${auditNumber(a.genre)} · Source ${auditNumber(a.source)} · Quality ${auditNumber(a.quality)} · Era ${auditNumber(a.decade)} · Penalty −${auditNumber(a.penalty)}</span></div></article>`; }).join('') : '<p class="stats-empty-line">Candidates are still being calculated.</p>'}</div>`;
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
  const record = {
    key, id: +element.dataset.id, type: element.dataset.type,
    title: element.dataset.title || '', poster: element.dataset.poster || '',
    source: element.dataset.source || '', score: +(element.dataset.score || 0), dismissedAt: Date.now(),
  };
  feedback.dismissed = [...new Set([key, ...feedback.dismissed])].slice(0, 150);
  feedback.history = [record, ...feedback.history.filter(item => item.key !== key)].slice(0, HISTORY_LIMIT);
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
  await persistFeedback();
  document.dispatchEvent(new Event('cv:recommendation-feedback'));
  toast('Recommendation restored', 'success');
  renderRecommendations();
  if ($('recommendationProfileInsights')) renderRecommendationInsights();
}

function recommendationCard(candidate, opts = {}) {
  return buildCard(candidate, candidate.__type, { ...opts, dismissible: true });
}

async function fillRow(id, fn) {
  try {
    const inner = await fn();
    const el = $(id); if (!el) return;
    if (inner) el.innerHTML = inner; else el.closest('.section')?.remove();
  } catch (e) { const el = $(id); if (el) el.closest('.section')?.remove(); }
}

// ----- Public entry (home.js re-exports this as renderPersonalRows) -----
export async function renderRecommendations() {
  const wrap = $('personalRows');
  if (!wrap) return;
  const profile = buildTasteProfile();
  if (!profile.hasSignal) { wrap.innerHTML = ''; return; }

  const seed = pickLabeledSeed(profile);
  const topActor = (profile.topActors || []).find(a => a.name);
  const topDirector = (profile.topDirectors || []).find(d => d.name);
  const genreId = profile.topGenres.find(g => MOVIE_GENRES.has(g));

  const descriptors = [{ id: 'rowTopPicks', icon: '✨', title: 'Top Picks for You' }];
  if (seed) descriptors.push({ id: 'rowSeed', icon: seed.reason === 'liked' ? '⭐' : '🍿', title: `Because you ${seed.reason} ${seed.title}` });
  if (topActor) descriptors.push({ id: 'rowActor', icon: '🌟', title: `Starring ${topActor.name}` });
  if (topDirector) descriptors.push({ id: 'rowDirector', icon: '🎥', title: `From ${topDirector.name}` });
  if (genreId && genreMap[genreId]) descriptors.push({ id: 'rowGenre', icon: '🎬', title: `More ${genreMap[genreId]}` });

  wrap.innerHTML = `<div class="rec-controlbar reveal"><div><span>Made for your taste</span><strong>Your recommendations adapt to every watch, rating, and dismissal.</strong></div><button data-action="open-recommendation-profile"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/><path d="M9 7h7M9 11h7"/></svg>Why these picks?</button></div>${descriptors.map(shell).join('')}`;
  observeReveals(wrap);

  // ONE pool fetch + ONE ranking pass, shared by every row. The old code refetched
  // (and re-ranked) per row, which was both slower and inconsistent between rows.
  const pool = fetchCandidates(profile).then(c => rankAndDedupe(c, profile)).catch(() => []);
  // The full scoring explanation intentionally lives on Profile. Home stays a
  // clean discovery surface and only renders the recommendation rails.

  fillRow('rowTopPicks', async () => {
    const picks = diversify(await pool, 20);
    if (!picks.length) return null;
    const top = picks[0].__score || 1;
    return picks.map(c => recommendationCard(c, { badge: matchBadge(c.__score, top) })).join('');
  });

  const rowFrom = async (pred, min = 1) => {
    const items = (await pool).filter(pred).slice(0, 20);
    return items.length >= min ? items.map(c => recommendationCard(c)).join('') : null;
  };

  // The label and every card now share the exact same recommendation seed.
  // Strict similarity removes the row entirely if fewer than four honest matches
  // remain; a missing row is better than a confident but misleading explanation.
  if (seed) fillRow('rowSeed', () => rowFrom(c => isRelatedToSeed(c, seed), 4));
  if (topActor) fillRow('rowActor', () => rowFrom(c => hasCandidateSource(c, 'cast')));
  if (topDirector) fillRow('rowDirector', () => rowFrom(c => hasCandidateSource(c, 'director')));
  if (genreId && genreMap[genreId]) fillRow('rowGenre', () => rowFrom(c => (c.genre_ids || []).includes(genreId)));
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
  const leadingPeople = [...(profile.topDirectors || []).slice(0, 2).map(person => `${person.name} · director`), ...(profile.topActors || []).slice(0, 2).map(person => `${person.name} · actor`)].filter(name => !name.startsWith(' ·'));
  host.innerHTML = `<div class="profile-rec-map">
    <article><span>Strongest genres</span><strong>${topGenres.map(esc).join(' · ') || 'Still learning'}</strong><p>Built from what you watched, saved, opened and rated.</p></article>
    <article><span>Trusted people</span><strong>${leadingPeople.map(esc).join(' · ') || 'Still learning'}</strong><p>Recurring directors and cast add a focused source bonus.</p></article>
    <article><span>Title seed</span><strong>${esc(seed?.title || 'Quality discovery')}</strong><p>${seed ? `Real similarity must overlap with this ${seed.reason} title.` : 'High-quality discoveries fill gaps without inventing a link.'}</p></article>
    <article><span>Privacy rule</span><strong>Watched titles stay out</strong><p>Saved titles can remain useful; watched and dismissed titles are filtered.</p></article>
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
  document.addEventListener('cv:auth', () => { auditOpen = false; lastAudit = null; });
}
