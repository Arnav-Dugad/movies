// ===== MOVIE CONTINUE WATCHING =====
// One compact private document per in-progress movie. A position is optional:
// starting a movie at 0 seconds still remembers it, while an exact timestamp can
// be added later. Client timestamps make offline/newer-device reconciliation
// deterministic without a separate version document.
import { state } from './state.js';
import { db, firebase } from './firebase.js';

const KEY = id => `movie_${+id}`;
const cacheKey = uid => `cv_movie_progress_${uid || state.user?.uid || 'guest'}`;
const col = uid => db.collection('users').doc(uid || state.user.uid).collection('movieProgress');
const timers = new Map();

const finite = value => Number.isFinite(+value) ? +value : 0;
function sanitize(value) {
  if (!value || typeof value !== 'object' || !(+value.tmdbId > 0)) return null;
  // Deletes are replicated as tiny tombstones. A failed/offline delete can no
  // longer let an older cloud document resurrect on the next sign-in.
  if (value.deleted === true) return {
    tmdbId: +value.tmdbId, deleted: true,
    updatedAt: Math.max(0, finite(value.updatedAt)),
  };
  const runtime = Math.max(0, Math.round(finite(value.runtime)));
  const maximum = runtime > 1 ? runtime - 1 : Number.MAX_SAFE_INTEGER;
  return {
    tmdbId: +value.tmdbId, title: String(value.title || '').slice(0, 180),
    poster: String(value.poster || ''), backdrop: String(value.backdrop || ''),
    runtime, position: Math.max(0, Math.min(maximum, Math.round(finite(value.position)))),
    startedAt: Math.max(0, finite(value.startedAt)), updatedAt: Math.max(0, finite(value.updatedAt)),
  };
}

function mirror(uid = state.user?.uid) {
  if (!uid) return;
  try { localStorage.setItem(cacheKey(uid), JSON.stringify(state.movieProgress || {})); } catch (_) {}
}

function localRows(uid) {
  try {
    const raw = JSON.parse(localStorage.getItem(cacheKey(uid)) || '{}'), out = {};
    Object.entries(raw).forEach(([key, value]) => { const row = sanitize(value); if (row) out[key] = row; });
    return out;
  } catch (_) { return {}; }
}

function emit(key) {
  mirror();
  document.dispatchEvent(new CustomEvent('cv:movie-progress', { detail: { key } }));
}

async function write(key, entry, uid) {
  await col(uid).doc(key).set({ ...entry, serverUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
}

function persist(key) {
  emit(key);
  const uid = state.user?.uid;
  if (!uid) return;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(async () => {
    if (state.user?.uid !== uid) return;
    const entry = state.movieProgress[key];
    try {
      if (entry) await write(key, entry, uid);
    } catch (error) { console.warn('movie progress sync', error); }
  }, 350));
}

export async function loadMovieProgress() {
  if (!state.user) { state.movieProgress = {}; return; }
  const uid = state.user.uid, local = localRows(uid);
  state.movieProgress = local; mirror(uid);
  try {
    const snapshot = await col(uid).get();
    if (state.user?.uid !== uid) return;
    const server = {};
    snapshot.docs.forEach(doc => { const row = sanitize(doc.data()); if (row) server[doc.id] = row; });
    const merged = {};
    for (const key of new Set([...Object.keys(server), ...Object.keys(local)])) {
      const a = local[key], b = server[key];
      if (!b) merged[key] = a;
      else if (!a) merged[key] = b;
      else if (a.updatedAt > b.updatedAt) merged[key] = a;
      else if (b.updatedAt > a.updatedAt) merged[key] = b;
      else merged[key] = a.deleted ? a : b; // an equal-time remove wins deterministically
    }
    state.movieProgress = Object.fromEntries(Object.entries(merged).filter(([, value]) => value));
    mirror(uid);
    await Promise.all(Object.entries(local)
      .filter(([key, value]) => !server[key] || value.updatedAt > server[key].updatedAt || (value.updatedAt === server[key].updatedAt && value.deleted && !server[key].deleted))
      .map(([key, value]) => write(key, value, uid).catch(error => console.warn('movie progress reconcile', error))));
  } catch (error) { console.warn('load movie progress', error); }
  document.dispatchEvent(new Event('cv:movie-progress'));
}

export function resetMovieProgressForAuth() {
  timers.forEach(clearTimeout); timers.clear(); state.movieProgress = {};
}

export const movieProgressEntry = id => {
  const entry = state.movieProgress?.[KEY(id)];
  return entry?.deleted ? null : entry || null;
};

export function startMovieProgress(meta, position = 0) {
  if (!state.user) { document.dispatchEvent(new Event('cv:open-auth')); return null; }
  const id = +meta?.tmdbId || +meta?.id;
  if (!id) return null;
  const key = KEY(id), now = Date.now(), old = movieProgressEntry(id);
  const nextPosition = Number.isFinite(+position) ? Math.max(0, +position) : (old?.position || 0);
  const entry = sanitize({
    ...old, tmdbId: id, title: meta.title || old?.title, poster: meta.poster ?? old?.poster,
    backdrop: meta.backdrop ?? old?.backdrop, runtime: Math.max(0, Math.round((+meta.runtime || 0) * 60)) || old?.runtime,
    position: nextPosition, startedAt: old?.startedAt || now, updatedAt: now,
  });
  state.movieProgress[key] = entry; persist(key); return entry;
}

export function setMovieProgressPosition(id, seconds, meta = {}) {
  const old = movieProgressEntry(id);
  return startMovieProgress({ ...old, ...meta, id, runtime: (+meta.runtime || 0) || (old?.runtime || 0) / 60 }, seconds);
}

export function removeMovieProgress(id) {
  const key = KEY(id);
  if (!movieProgressEntry(id)) return false;
  state.movieProgress[key] = { tmdbId: +id, deleted: true, updatedAt: Date.now() };
  persist(key); return true;
}

export function movieResumeQueue(limit = 100) {
  return Object.entries(state.movieProgress || {}).map(([key, entry]) => {
    const percent = entry.runtime ? Math.min(99, Math.round(entry.position / entry.runtime * 100)) : 0;
    return { key, type: 'movie', id: entry.tmdbId, entry, progress: { percent }, position: entry.position, left: Math.max(0, entry.runtime - entry.position), lastAt: entry.updatedAt || entry.startedAt || 0 };
  }).filter(row => !row.entry.deleted && !state.watched[`movie_${row.id}`]).sort((a, b) => b.lastAt - a.lastAt).slice(0, limit);
}

export function parseMovieTime(value) {
  const parts = String(value || '').trim().split(':');
  if (!parts.length || parts.length > 3 || parts.some(part => !/^\d{1,2}$/.test(part))) return null;
  const numbers = parts.map(Number);
  let hours = 0, minutes = 0, seconds = 0;
  if (numbers.length === 3) [hours, minutes, seconds] = numbers;
  else if (numbers.length === 2) [minutes, seconds] = numbers;
  else minutes = numbers[0];
  if ((minutes >= 60 && numbers.length === 3) || seconds >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatMovieTime(seconds, { compact = false } = {}) {
  const total = Math.max(0, Math.round(+seconds || 0));
  const hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), secs = total % 60;
  if (compact) return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function initMovieProgress() {
  document.addEventListener('cv:watched-toggled', event => {
    if (event.detail?.type === 'movie' && state.watched[`movie_${event.detail.id}`]) removeMovieProgress(event.detail.id);
  });
}
