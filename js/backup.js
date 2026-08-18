// ===== COLLECTION BACKUPS =====
// Portable, human-readable JSON. Restore is merge-only so importing a backup can
// never silently delete newer cloud data.
import { state } from './state.js';
import { db, firebase } from './firebase.js';
import { $, toast } from './ui.js';
import { registerActions } from './events.js';
import { loadWatchlist, loadWatched } from './watchlist.js';
import { loadRatings } from './ratings.js';
import { loadLists } from './lists.js';

const MAGIC = 'cineverse-collection-backup';
const WATCHED_MAGIC = 'cineverse-watched-export';
const VERSION = 1;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const safeId = value => /^[a-z0-9_-]{1,80}$/i.test(String(value || ''));
const mediaKey = value => /^(movie|tv)_\d+$/.test(String(value || ''));

function timestampISO(value) {
  const ms = value?.seconds ? value.seconds * 1000 : (typeof value?.toMillis === 'function' ? value.toMillis() : 0);
  return ms ? new Date(ms).toISOString() : null;
}

const pick = (source, keys) => Object.fromEntries(keys.filter(key => source?.[key] !== undefined).map(key => [key, source[key]]));

export function buildCollectionBackup() {
  const lists = state.lists.map(list => ({ id: list.id, ...pick(list, ['name', 'icon', 'color', 'order', 'shared']) }));
  const watchlist = state.watchlist.map(item => ({ id: item.id, ...pick(item, ['tmdbId', 'type', 'title', 'poster', 'rating', 'year', 'genres', 'keywords', 'runtime', 'language', 'country', 'releaseDate', 'lists', 'voteCount']), addedAt: timestampISO(item.added) }));
  const watched = Object.entries(state.watched).map(([id, item]) => ({ id, ...pick(item, ['tmdbId', 'type', 'title', 'poster', 'year', 'genres', 'keywords', 'runtime', 'episodeRuntime', 'episodeCount', 'language', 'country', 'releaseDate', 'tmdbRating', 'voteCount', 'director', 'directorId', 'directorProfile', 'cast', 'metaV', 'repairV']), watchedAt: timestampISO(item.watchedAt) }));
  const ratings = Object.entries(state.ratings).map(([id, score]) => ({ id, score: +score })).filter(item => mediaKey(item.id) && item.score >= 1 && item.score <= 10);
  const profile = pick(state.profile, ['avatar', 'headline', 'bio', 'location', 'favoriteFilm', 'favoriteFilmId', 'favoriteFilmPoster', 'pinnedBadges']);
  return { magic: MAGIC, version: VERSION, exportedAt: new Date().toISOString(), counts: { lists: lists.length, saved: watchlist.length, watched: watched.length, ratings: ratings.length }, lists, watchlist, watched, ratings, profile };
}

export function buildWatchedExport() {
  const watched = Object.entries(state.watched).map(([id, item]) => ({
    id, ...pick(item, ['tmdbId', 'type', 'title', 'poster', 'year', 'genres', 'keywords', 'runtime', 'episodeRuntime', 'episodeCount', 'language', 'country', 'releaseDate', 'tmdbRating', 'voteCount', 'director', 'directorId', 'directorProfile', 'cast', 'metaV', 'repairV']),
    watchedAt: timestampISO(item.watchedAt), userRating: +(state.ratings[id] || 0) || null,
  }));
  return { magic: WATCHED_MAGIC, version: VERSION, exportedAt: new Date().toISOString(), count: watched.length, watched };
}

export function validateWatchedExport(value) {
  // A full collection backup is also accepted, which makes the importer useful
  // even when the user no longer remembers which kind of export they created.
  if (value?.magic === MAGIC) return validateCollectionBackup(value);
  if (!value || value.magic !== WATCHED_MAGIC || value.version !== VERSION || !Array.isArray(value.watched)) throw new Error('This is not a supported CineVerse watched export');
  if (value.watched.length > 10000) throw new Error('Watched export is larger than the supported limit');
  return value;
}

export function validateCollectionBackup(value) {
  if (!value || value.magic !== MAGIC || value.version !== VERSION) throw new Error('This is not a supported CineVerse backup');
  ['lists', 'watchlist', 'watched', 'ratings'].forEach(key => { if (!Array.isArray(value[key])) throw new Error(`Backup is missing ${key}`); });
  if (value.lists.length > 250 || value.watchlist.length > 10000 || value.watched.length > 10000 || value.ratings.length > 10000) throw new Error('Backup is larger than the supported collection limits');
  return value;
}

function dateOrServer(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : firebase.firestore.FieldValue.serverTimestamp();
}

function cleanList(item) {
  return pick(item, ['name', 'icon', 'color', 'order', 'shared']);
}

function cleanPortableMedia(item, keys) {
  const data = pick(item, keys), match = String(item.id || '').match(/^(movie|tv)_(\d+)$/);
  if (match) { data.type = match[1]; data.tmdbId = +match[2]; }
  data.title = String(data.title || '').slice(0, 300);
  data.poster = /^\/[\w.-]+$/.test(String(data.poster || '')) ? data.poster : '';
  data.year = /^\d{4}$/.test(String(data.year || '')) ? String(data.year) : '';
  data.language = String(data.language || '').slice(0, 12);
  data.country = String(data.country || '').slice(0, 12);
  data.releaseDate = /^\d{4}-\d{2}-\d{2}$/.test(String(data.releaseDate || '')) ? data.releaseDate : '';
  data.genres = [...new Set((Array.isArray(data.genres) ? data.genres : []).map(Number).filter(value => value > 0))].slice(0, 30);
  data.keywords = (Array.isArray(data.keywords) ? data.keywords : []).map(keyword => ({ id: +(keyword?.id || 0), name: String(keyword?.name || '').slice(0, 120) })).filter(keyword => keyword.id && keyword.name).slice(0, 30);
  return data;
}

function cleanWatchlist(item) {
  const data = cleanPortableMedia(item, ['tmdbId', 'type', 'title', 'poster', 'rating', 'year', 'genres', 'keywords', 'runtime', 'language', 'country', 'releaseDate', 'lists', 'voteCount']);
  data.lists = (Array.isArray(data.lists) ? data.lists : []).map(String).filter(safeId).slice(0, 100);
  data.added = dateOrServer(item.addedAt);
  return data;
}

function cleanWatched(item) {
  const data = cleanPortableMedia(item, ['tmdbId', 'type', 'title', 'poster', 'year', 'genres', 'keywords', 'runtime', 'episodeRuntime', 'episodeCount', 'language', 'country', 'releaseDate', 'tmdbRating', 'voteCount', 'director', 'directorId', 'directorProfile', 'cast', 'metaV', 'repairV']);
  data.director = String(data.director || '').slice(0, 200);
  data.directorProfile = /^\/[\w.-]+$/.test(String(data.directorProfile || '')) ? data.directorProfile : '';
  data.cast = (Array.isArray(data.cast) ? data.cast : []).map(person => ({ id: +(person?.id || 0), name: String(person?.name || '').slice(0, 200), profile: /^\/[\w.-]+$/.test(String(person?.profile || '')) ? person.profile : '' })).filter(person => person.id && person.name).slice(0, 20);
  data.watchedAt = dateOrServer(item.watchedAt);
  return data;
}

async function commitWrites(writes) {
  for (let start = 0; start < writes.length; start += 400) {
    const batch = db.batch();
    writes.slice(start, start + 400).forEach(write => batch.set(write.ref, write.data, { merge: true }));
    await batch.commit();
  }
}

export async function restoreWatchedExport(raw) {
  if (!state.user) throw new Error('Sign in before importing watched titles');
  const data = validateWatchedExport(raw), root = db.collection('users').doc(state.user.uid), writes = [];
  data.watched.filter(item => item && mediaKey(item.id)).forEach(item => {
    writes.push({ ref: root.collection('watched').doc(item.id), data: cleanWatched(item) });
    const score = +(item.userRating || 0);
    if (score >= 1 && score <= 10) writes.push({ ref: root.collection('ratings').doc(item.id), data: { score, updated: firebase.firestore.FieldValue.serverTimestamp() } });
  });
  // Ratings are separate in a full collection backup, so preserve those too—but
  // only for titles that are actually in its watched payload.
  if (data.magic === MAGIC) {
    const watchedIds = new Set(data.watched.filter(Boolean).map(item => item.id));
    data.ratings.filter(item => item && watchedIds.has(item.id) && mediaKey(item.id) && +item.score >= 1 && +item.score <= 10)
      .forEach(item => writes.push({ ref: root.collection('ratings').doc(item.id), data: { score: +item.score, updated: firebase.firestore.FieldValue.serverTimestamp() } }));
  }
  await commitWrites(writes);
  await Promise.all([loadWatched(), loadRatings()]);
  document.dispatchEvent(new Event('cv:wl-changed'));
  document.dispatchEvent(new Event('cv:meta-backfilled'));
  return { writes: writes.length, watched: data.watched.filter(item => item && mediaKey(item.id)).length };
}

export async function restoreCollectionBackup(raw) {
  if (!state.user) throw new Error('Sign in before restoring a backup');
  const data = validateCollectionBackup(raw), root = db.collection('users').doc(state.user.uid), writes = [];
  data.lists.filter(item => item && safeId(item.id)).forEach(item => writes.push({ ref: root.collection('lists').doc(item.id), data: cleanList(item) }));
  data.watchlist.filter(item => item && mediaKey(item.id)).forEach(item => writes.push({ ref: root.collection('watchlist').doc(item.id), data: cleanWatchlist(item) }));
  data.watched.filter(item => item && mediaKey(item.id)).forEach(item => writes.push({ ref: root.collection('watched').doc(item.id), data: cleanWatched(item) }));
  data.ratings.filter(item => item && mediaKey(item.id) && +item.score >= 1 && +item.score <= 10).forEach(item => writes.push({ ref: root.collection('ratings').doc(item.id), data: { score: +item.score, updated: firebase.firestore.FieldValue.serverTimestamp() } }));
  const profile = pick(data.profile || {}, ['avatar', 'headline', 'bio', 'location', 'favoriteFilm', 'favoriteFilmId', 'favoriteFilmPoster', 'pinnedBadges']);
  if (!(Number.isInteger(+profile.favoriteFilmId) && +profile.favoriteFilmId > 0)) profile.favoriteFilmId = null;
  if (!/^\/[\w.-]+$/.test(String(profile.favoriteFilmPoster || ''))) profile.favoriteFilmPoster = '';
  if (Object.keys(profile).length) writes.push({ ref: root, data: profile });
  await commitWrites(writes);
  await Promise.all([loadWatchlist(), loadWatched(), loadRatings(), loadLists()]);
  state.profile = { ...state.profile, ...profile };
  document.dispatchEvent(new Event('cv:auth'));
  document.dispatchEvent(new Event('cv:wl-changed'));
  return { writes: writes.length, ...data.counts };
}

function downloadBackup() {
  if (!state.user) return document.dispatchEvent(new Event('cv:open-auth'));
  const data = JSON.stringify(buildCollectionBackup(), null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `cineverse-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Collection backup downloaded', 'success');
}

function downloadWatched() {
  if (!state.user) return document.dispatchEvent(new Event('cv:open-auth'));
  const data = JSON.stringify(buildWatchedExport(), null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `cineverse-watched-${new Date().toISOString().slice(0, 10)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exported ${Object.keys(state.watched).length} watched titles`, 'success');
}

async function restoreFile(file, input) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) { toast('Backup file is too large', 'error'); input.value = ''; return; }
  try {
    const result = await restoreCollectionBackup(JSON.parse(await file.text()));
    toast(`Restored ${result.writes} collection records`, 'success');
  } catch (error) {
    console.error('restore backup', error); toast(error.message || 'Could not restore this backup', 'error');
  } finally { input.value = ''; }
}

async function restoreWatchedFile(file, input) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) { toast('Watched file is too large', 'error'); input.value = ''; return; }
  try {
    const result = await restoreWatchedExport(JSON.parse(await file.text()));
    toast(`Imported ${result.watched} watched titles`, 'success');
  } catch (error) {
    console.error('restore watched', error); toast(error.message || 'Could not import watched titles', 'error');
  } finally { input.value = ''; }
}

export function initBackups() {
  registerActions({
    'download-backup': () => downloadBackup(),
    'choose-backup': () => $('settingsBackupFile')?.click(),
    'download-watched': () => downloadWatched(),
    'choose-watched-import': () => $('watchedImportFile')?.click(),
  });
  const input = $('settingsBackupFile');
  if (input) input.addEventListener('change', () => restoreFile(input.files?.[0], input));
  const watchedInput = $('watchedImportFile');
  if (watchedInput) watchedInput.addEventListener('change', () => restoreWatchedFile(watchedInput.files?.[0], watchedInput));
}
