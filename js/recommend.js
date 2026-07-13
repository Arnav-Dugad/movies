// ===== ADVANCED RECOMMENDER =====
// Builds a taste profile from every available signal (watchlist genres, ratings,
// recently-viewed), generates candidates from multiple TMDB sources, scores &
// ranks them, excludes anything already seen, and renders blended rows.
import { tmdb } from './api.js';
import { genreMap, mGenreList, tGenreList } from './config.js';
import { state } from './state.js';
import { esc, $ } from './ui.js';
import { buildCard, skelCards } from './cards.js';
import { observeReveals } from './effects.js';

const MOVIE_GENRES = new Set(mGenreList.map(g => g.id));
const TV_GENRES = new Set(tGenreList.map(g => g.id));

function splitKey(key) { const i = key.lastIndexOf('_'); return [key.slice(0, i), +key.slice(i + 1)]; }

function titleForKey(type, id) {
  const w = state.watchlist.find(x => x.type === type && String(x.tmdbId) === String(id));
  if (w) return w.title;
  const r = state.recentlyViewed.find(x => x.type === type && String(x.id) === String(id));
  return r ? r.title : null;
}

// ----- Taste profile -----
function buildTasteProfile() {
  const genreWeights = {};
  const add = (genres, w) => (genres || []).forEach(g => { genreWeights[g] = (genreWeights[g] || 0) + w; });

  state.watchlist.forEach(w => {
    add(w.genres, 2);
    const score = state.ratings[`${w.type}_${w.tmdbId}`];
    if (score) add(w.genres, score - 5); // ratings signal: liked → boost, disliked → penalize
  });
  state.recentlyViewed.forEach(r => add(r.genres, 1));

  let movie = 0, tv = 0;
  state.watchlist.forEach(w => (w.type === 'tv' ? tv++ : movie++));
  state.recentlyViewed.forEach(r => (r.type === 'tv' ? tv++ : movie++));

  // Seeds for /recommendations: highly-rated titles first, then most-recent.
  const seedIds = [];
  Object.entries(state.ratings).forEach(([key, score]) => {
    if (score >= 8) { const [type, id] = splitKey(key); if (type && id) seedIds.push({ id, type, score, reason: 'liked' }); }
  });
  seedIds.sort((a, b) => b.score - a.score);
  state.recentlyViewed.slice(0, 2).forEach(r => {
    if (!seedIds.some(s => s.id === r.id && s.type === r.type)) seedIds.push({ id: r.id, type: r.type, score: 0, reason: 'viewed', title: r.title });
  });

  const seen = new Set();
  state.watchlist.forEach(w => seen.add(`${w.type}_${w.tmdbId}`));
  Object.keys(state.watched).forEach(k => seen.add(k));
  state.recentlyViewed.forEach(r => seen.add(`${r.type}_${r.id}`));

  const topGenres = Object.entries(genreWeights).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).map(([g]) => +g);
  return { genreWeights, topGenres, seedIds, seen, movieBias: movie >= tv, hasSignal: topGenres.length > 0 || seedIds.length > 0 };
}

// ----- Candidate generation -----
function tag(results, type, source) { return (results || []).map(r => ({ ...r, __type: r.media_type || type, __source: source })); }

async function fetchCandidates(profile) {
  const calls = [];
  const movieG = profile.topGenres.filter(g => MOVIE_GENRES.has(g)).slice(0, 3);
  const tvG = profile.topGenres.filter(g => TV_GENRES.has(g)).slice(0, 3);
  if (movieG.length) calls.push(tmdb('/discover/movie', { with_genres: movieG.join(','), sort_by: 'popularity.desc', 'vote_count.gte': 150 }).then(d => tag(d.results, 'movie', 'discover')).catch(() => []));
  if (tvG.length && !profile.movieBias) calls.push(tmdb('/discover/tv', { with_genres: tvG.join(','), sort_by: 'popularity.desc', 'vote_count.gte': 150 }).then(d => tag(d.results, 'tv', 'discover')).catch(() => []));
  profile.seedIds.slice(0, 3).forEach(s => calls.push(tmdb(`/${s.type}/${s.id}/recommendations`).then(d => tag(d.results, s.type, 'rec')).catch(() => [])));
  const groups = await Promise.all(calls);
  return groups.flat();
}

// ----- Scoring & ranking -----
function scoreCandidate(c, profile, maxW) {
  let g = 0; (c.genre_ids || []).forEach(id => { g += (profile.genreWeights[id] || 0); });
  const genreScore = maxW > 0 ? g / maxW : 0;
  const sourceBonus = c.__source === 'rec' ? 1.2 : 0.6;
  const quality = (c.vote_average || 0) / 10 * 0.5 + Math.min((c.popularity || 0) / 500, 1) * 0.3;
  return genreScore + sourceBonus + quality;
}

function rankAndDedupe(cands, profile) {
  const maxW = Math.max(1, ...Object.values(profile.genreWeights).map(Math.abs));
  const byId = new Map();
  cands.forEach(c => {
    if (!c || !c.id || !c.poster_path) return;
    const type = c.__type || 'movie';
    if (type === 'person') return;
    const key = `${type}_${c.id}`;
    if (profile.seen.has(key)) return;
    const sc = scoreCandidate(c, profile, maxW);
    const existing = byId.get(key);
    if (!existing || sc > existing.__score) byId.set(key, { ...c, __type: type, __score: sc });
  });
  return [...byId.values()].sort((a, b) => b.__score - a.__score);
}

function matchBadge(score, top) { const pct = Math.max(60, Math.min(99, Math.round((score / (top || 1)) * 100))); return `${pct}% match`; }

function pickLabeledSeed(profile) {
  for (const s of profile.seedIds) {
    if (s.score >= 8) { const title = titleForKey(s.type, s.id); if (title) return { id: s.id, type: s.type, title, reason: 'liked' }; }
  }
  const r = state.recentlyViewed[0];
  return r ? { id: r.id, type: r.type, title: r.title, reason: 'viewed' } : null;
}

function shell(d) {
  return `<div class="section reveal"><div class="section-head"><h2 class="section-title"><span>${d.icon}</span> ${esc(d.title)}</h2></div><div class="row" id="${d.id}">${skelCards(8)}</div></div>`;
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

  const descriptors = [{ id: 'rowTopPicks', icon: '✨', title: 'Top Picks for You' }];
  const seed = pickLabeledSeed(profile);
  if (seed) descriptors.push({ id: 'rowSeed', icon: seed.reason === 'liked' ? '⭐' : '🍿', title: `Because you ${seed.reason} ${seed.title}` });
  const genreId = profile.topGenres.find(g => MOVIE_GENRES.has(g));
  if (genreId && genreMap[genreId]) descriptors.push({ id: 'rowGenre', icon: '🎬', title: `More ${genreMap[genreId]}` });

  wrap.innerHTML = descriptors.map(shell).join('');
  observeReveals(wrap);

  fillRow('rowTopPicks', async () => {
    const ranked = rankAndDedupe(await fetchCandidates(profile), profile).slice(0, 20);
    if (!ranked.length) return null;
    const top = ranked[0].__score || 1;
    return ranked.map(c => buildCard(c, c.__type, { badge: matchBadge(c.__score, top) })).join('');
  });

  if (seed) fillRow('rowSeed', async () => {
    const d = await tmdb(`/${seed.type}/${seed.id}/recommendations`);
    const items = (d.results || []).filter(x => x.poster_path && (x.media_type || seed.type) !== 'person' && !profile.seen.has(`${x.media_type || seed.type}_${x.id}`)).slice(0, 20);
    return items.length ? items.map(x => buildCard(x, x.media_type || seed.type)).join('') : null;
  });

  if (genreId && genreMap[genreId]) fillRow('rowGenre', async () => {
    const d = await tmdb('/discover/movie', { with_genres: String(genreId), sort_by: 'vote_average.desc', 'vote_count.gte': 300 });
    const items = (d.results || []).filter(x => x.poster_path && !profile.seen.has(`movie_${x.id}`)).slice(0, 20);
    return items.length ? items.map(x => buildCard(x, 'movie')).join('') : null;
  });
}
