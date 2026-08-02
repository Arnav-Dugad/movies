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
  const watchlist = state.watchlist.map(item => ({ id: item.id, ...pick(item, ['tmdbId', 'type', 'title', 'poster', 'rating', 'year', 'genres', 'runtime', 'language', 'country', 'releaseDate', 'lists', 'voteCount']), addedAt: timestampISO(item.added) }));
  const watched = Object.entries(state.watched).map(([id, item]) => ({ id, ...pick(item, ['tmdbId', 'type', 'title', 'poster', 'year', 'genres', 'runtime', 'episodeRuntime', 'episodeCount', 'language', 'country', 'releaseDate', 'tmdbRating', 'voteCount', 'director', 'directorId', 'directorProfile', 'cast', 'metaV', 'repairV']), watchedAt: timestampISO(item.watchedAt) }));
  const ratings = Object.entries(state.ratings).map(([id, score]) => ({ id, score: +score })).filter(item => mediaKey(item.id) && item.score >= 1 && item.score <= 10);
  const profile = pick(state.profile, ['avatar', 'headline', 'bio', 'location', 'favoriteFilm', 'pinnedBadges']);
  return { magic: MAGIC, version: VERSION, exportedAt: new Date().toISOString(), counts: { lists: lists.length, saved: watchlist.length, watched: watched.length, ratings: ratings.length }, lists, watchlist, watched, ratings, profile };
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

function cleanWatchlist(item) {
  const data = pick(item, ['tmdbId', 'type', 'title', 'poster', 'rating', 'year', 'genres', 'runtime', 'language', 'country', 'releaseDate', 'lists', 'voteCount']);
  data.added = dateOrServer(item.addedAt);
  return data;
}

function cleanWatched(item) {
  const data = pick(item, ['tmdbId', 'type', 'title', 'poster', 'year', 'genres', 'runtime', 'episodeRuntime', 'episodeCount', 'language', 'country', 'releaseDate', 'tmdbRating', 'voteCount', 'director', 'directorId', 'directorProfile', 'cast', 'metaV', 'repairV']);
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

export async function restoreCollectionBackup(raw) {
  if (!state.user) throw new Error('Sign in before restoring a backup');
  const data = validateCollectionBackup(raw), root = db.collection('users').doc(state.user.uid), writes = [];
  data.lists.filter(item => safeId(item.id)).forEach(item => writes.push({ ref: root.collection('lists').doc(item.id), data: cleanList(item) }));
  data.watchlist.filter(item => mediaKey(item.id)).forEach(item => writes.push({ ref: root.collection('watchlist').doc(item.id), data: cleanWatchlist(item) }));
  data.watched.filter(item => mediaKey(item.id)).forEach(item => writes.push({ ref: root.collection('watched').doc(item.id), data: cleanWatched(item) }));
  data.ratings.filter(item => mediaKey(item.id) && +item.score >= 1 && +item.score <= 10).forEach(item => writes.push({ ref: root.collection('ratings').doc(item.id), data: { score: +item.score, updated: firebase.firestore.FieldValue.serverTimestamp() } }));
  const profile = pick(data.profile || {}, ['avatar', 'headline', 'bio', 'location', 'favoriteFilm', 'pinnedBadges']);
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

export function initBackups() {
  registerActions({
    'download-backup': () => downloadBackup(),
    'choose-backup': () => $('settingsBackupFile')?.click(),
  });
  const input = $('settingsBackupFile');
  if (input) input.addEventListener('change', () => restoreFile(input.files?.[0], input));
}
