// ===== CSV IMPORT (Letterboxd · Trakt · IMDb) =====
// Bringing an existing history in is the single biggest barrier to using a new
// tracker, so this accepts the exports people actually have rather than a
// CineVerse-specific format.
//
// Everything is merge-only: an import can add watched entries, ratings, and
// saved titles, and can never delete or downgrade anything already in the
// account. Titles are resolved to TMDB by id first (tmdb_id, then imdb_id) and
// only fall back to a title+year search, so a match is exact wherever the export
// gave us something exact.
import { tmdb, pool } from './api.js';
import { state } from './state.js';
import { db, firebase } from './firebase.js';
import { $, esc, toast, trapFocus, lockScroll, unlockScroll } from './ui.js';
import { registerActions } from './events.js';
import { loadWatchlist, loadWatched } from './watchlist.js';
import { loadRatings } from './ratings.js';
import { adultFlag } from './prefs.js';

const MAX_ROWS = 4000;
const MAX_BYTES = 12 * 1024 * 1024;
const BATCH_LIMIT = 400;          // Firestore allows 500 writes per batch

let job = null;                   // { step, rows, source, stats, target, ... }
let releaseFocus = null;

// ---------- CSV ----------
// RFC 4180: quoted fields may contain commas, newlines, and doubled quotes.
export function parseCSV(text) {
  const source = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char !== '"') { field += char; continue; }
      if (source[index + 1] === '"') { field += '"'; index++; continue; }
      quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (char === '\r') continue;
    field += char;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(cells => cells.some(cell => cell.trim() !== ''));
}

const COLUMNS = {
  title: ['name', 'title', 'movie title', 'film', 'show', 'series title', 'original title'],
  year: ['year', 'release year', 'released', 'movie year'],
  rating: ['rating', 'your rating', 'rating10', 'score', 'my rating'],
  tmdb: ['tmdb_id', 'tmdbid', 'tmdb id', 'tmdb'],
  imdb: ['imdb_id', 'imdbid', 'imdb id', 'const', 'imdb'],
  type: ['type', 'title type', 'media type', 'media_type'],
  watched: ['watched date', 'watched_at', 'date watched', 'last watched at', 'date rated', 'date'],
};

function columnMap(header) {
  const lower = header.map(cell => cell.trim().toLowerCase());
  const map = {};
  for (const [key, names] of Object.entries(COLUMNS)) {
    // Longest name first so "watched date" wins over the generic "date".
    for (const name of [...names].sort((a, b) => b.length - a.length)) {
      const index = lower.indexOf(name);
      if (index >= 0) { map[key] = index; break; }
    }
  }
  return { map, lower };
}

export function detectSource(headerLower) {
  const has = name => headerLower.some(cell => cell.includes(name));
  if (has('letterboxd uri')) return 'Letterboxd';
  if (headerLower.includes('const') && has('your rating')) return 'IMDb';
  if (has('trakt')) return 'Trakt';
  if (has('tmdb')) return 'Trakt or TMDB export';
  return 'CSV';
}

const TYPE_HINTS = [
  [/tvseries|tvminiseries|tvepisode|tv series|^show$|^tv$|series/i, 'tv'],
  [/movie|film|feature/i, 'movie'],
];

function normalizeType(value, source) {
  const text = String(value || '').trim();
  for (const [pattern, type] of TYPE_HINTS) if (pattern.test(text)) return type;
  return source === 'Letterboxd' ? 'movie' : '';
}

// Letterboxd and other five-star exports need doubling; Trakt and IMDb are
// already out of ten. Detected from the file rather than assumed, and shown in
// the preview so the reader can see which scale was applied.
function ratingScale(values) {
  const numbers = values.filter(value => value > 0);
  if (!numbers.length) return 1;
  return Math.max(...numbers) <= 5 ? 2 : 1;
}

export function normalizeRows(rows) {
  if (rows.length < 2) throw new Error('That file has no rows under its header.');
  const { map, lower } = columnMap(rows[0]);
  if (map.title === undefined && map.tmdb === undefined && map.imdb === undefined) {
    throw new Error('No title, TMDB id, or IMDb id column found. Export again from Letterboxd, Trakt, or IMDb.');
  }
  const source = detectSource(lower);
  const body = rows.slice(1, MAX_ROWS + 1);
  const cell = (row, key) => (map[key] === undefined ? '' : String(row[map[key]] ?? '').trim());

  const raw = body.map(row => {
    const ratingText = cell(row, 'rating').replace(',', '.');
    return {
      title: cell(row, 'title'),
      year: +String(cell(row, 'year')).slice(0, 4) || 0,
      rating: Number.parseFloat(ratingText) || 0,
      tmdbId: +cell(row, 'tmdb') || 0,
      imdbId: /^tt\d+$/i.test(cell(row, 'imdb')) ? cell(row, 'imdb') : '',
      type: normalizeType(cell(row, 'type'), source),
      watchedAt: Date.parse(cell(row, 'watched')) || 0,
    };
  }).filter(item => item.title || item.tmdbId || item.imdbId);

  const scale = ratingScale(raw.map(item => item.rating));
  const seen = new Set();
  const items = [];
  for (const item of raw) {
    // The same title can appear many times in a diary export (rewatches). Keep
    // the newest date and the highest rating rather than importing duplicates.
    const key = item.tmdbId ? `t${item.tmdbId}` : item.imdbId ? `i${item.imdbId}` : `n${item.title.toLowerCase()}|${item.year}`;
    const rating = item.rating ? Math.max(1, Math.min(10, Math.round(item.rating * scale))) : 0;
    const existing = seen.has(key) ? items.find(row => row.key === key) : null;
    if (existing) {
      existing.watchedAt = Math.max(existing.watchedAt, item.watchedAt);
      existing.rating = Math.max(existing.rating, rating);
      continue;
    }
    seen.add(key);
    items.push({ ...item, key, rating });
  }
  return { source, scale, items, truncated: body.length >= MAX_ROWS };
}

// ---------- TMDB resolution ----------
const normalTitle = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function resolveItem(item) {
  try {
    if (item.tmdbId) {
      const type = item.type || 'movie';
      const detail = await tmdb(`/${type}/${item.tmdbId}`).catch(() => null);
      if (detail?.id) return { ...detail, __type: type, __exact: true };
      if (!item.type) {
        const show = await tmdb(`/tv/${item.tmdbId}`).catch(() => null);
        if (show?.id) return { ...show, __type: 'tv', __exact: true };
      }
    }
    if (item.imdbId) {
      const found = await tmdb(`/find/${item.imdbId}`, { external_source: 'imdb_id' }).catch(() => null);
      const movie = (found?.movie_results || [])[0], show = (found?.tv_results || [])[0];
      if (movie) return { ...movie, __type: 'movie', __exact: true };
      if (show) return { ...show, __type: 'tv', __exact: true };
    }
    if (!item.title) return null;
    const endpoint = item.type === 'tv' ? '/search/tv' : item.type === 'movie' ? '/search/movie' : '/search/multi';
    const params = { query: item.title, include_adult: adultFlag(), page: 1 };
    if (item.year) params[item.type === 'tv' ? 'first_air_date_year' : 'year'] = item.year;
    let results = (await tmdb(endpoint, params).catch(() => null))?.results || [];
    // A year filter that returns nothing is worse than no year filter: retry
    // wide before giving up on a title that clearly exists.
    if (!results.length && item.year) results = ((await tmdb(endpoint, { query: item.title, include_adult: adultFlag(), page: 1 }).catch(() => null))?.results) || [];
    const candidates = results.filter(row => !row.media_type || ['movie', 'tv'].includes(row.media_type));
    if (!candidates.length) return null;
    const wanted = normalTitle(item.title);
    const exact = candidates.filter(row => normalTitle(row.title || row.name) === wanted);
    const pick = (item.year && exact.find(row => +String(row.release_date || row.first_air_date || '').slice(0, 4) === item.year))
      || exact[0] || candidates[0];
    const type = pick.media_type || (item.type === 'tv' ? 'tv' : 'movie');
    return { ...pick, __type: type, __exact: normalTitle(pick.title || pick.name) === wanted };
  } catch (_) { return null; }
}

// ---------- writing ----------
function watchedDoc(match, item) {
  const releaseDate = match.release_date || match.first_air_date || '';
  return {
    tmdbId: match.id, type: match.__type, title: match.title || match.name || item.title || 'Untitled',
    poster: match.poster_path || '', year: releaseDate.slice(0, 4) || String(item.year || ''),
    genres: match.genres ? match.genres.map(genre => genre.id) : (match.genre_ids || []),
    runtime: match.runtime || (match.episode_run_time || [])[0] || 0,
    language: match.original_language || '', releaseDate,
    tmdbRating: match.vote_average || 0, voteCount: match.vote_count || 0,
    watchedAt: item.watchedAt
      ? firebase.firestore.Timestamp.fromMillis(item.watchedAt)
      : firebase.firestore.FieldValue.serverTimestamp(),
    importedFrom: job?.source || 'CSV',
  };
}

function savedDoc(match, item) {
  const releaseDate = match.release_date || match.first_air_date || '';
  return {
    tmdbId: match.id, type: match.__type, title: match.title || match.name || item.title || 'Untitled',
    poster: match.poster_path || '', rating: match.vote_average || 0,
    year: releaseDate.slice(0, 4) || String(item.year || ''),
    genres: match.genres ? match.genres.map(genre => genre.id) : (match.genre_ids || []),
    runtime: match.runtime || (match.episode_run_time || [])[0] || 0,
    language: match.original_language || '', releaseDate,
    added: firebase.firestore.FieldValue.serverTimestamp(), lists: ['watchlist'],
  };
}

async function commit(writes) {
  for (let index = 0; index < writes.length; index += BATCH_LIMIT) {
    const batch = db.batch();
    for (const write of writes.slice(index, index + BATCH_LIMIT)) batch.set(write.ref, write.data, { merge: true });
    await batch.commit();
  }
}

// ---------- modal ----------
export function isImportOpen() { return !!$('importOverlay')?.classList.contains('active'); }

export function closeImport() {
  const overlay = $('importOverlay');
  if (!overlay || !overlay.classList.contains('active')) return;
  if (job?.step === 'running') { toast('Import is still running', 'info'); return; }
  overlay.classList.remove('active');
  unlockScroll();
  if (releaseFocus) { releaseFocus(); releaseFocus = null; }
  job = null;
}

function paint() {
  const body = $('importBody'); if (!body || !job) return;
  const { step } = job;

  if (step === 'choose') {
    body.innerHTML = `<div class="import-head"><span>Bring your history</span><h2>Import from Letterboxd, Trakt, or IMDb</h2><p>Drop the CSV you exported. CineVerse matches every row to TMDB and merges the results — nothing already in your account is removed or overwritten with something older.</p></div>
      <div class="import-sources">
        <div><strong>Letterboxd</strong><small>Settings → Import &amp; Export → Export your data. Use <code>watched.csv</code>, <code>ratings.csv</code>, <code>diary.csv</code>, or <code>watchlist.csv</code>.</small></div>
        <div><strong>Trakt</strong><small>Any CSV export with a <code>tmdb_id</code>, <code>imdb_id</code>, or title column.</small></div>
        <div><strong>IMDb</strong><small>Your Ratings → Export. The <code>Const</code> column matches exactly.</small></div>
      </div>
      <button class="import-drop" data-action="import-pick" id="importDrop"><b>Choose a CSV file</b><span>or drop it here · up to ${MAX_ROWS.toLocaleString()} rows</span></button>
      <p class="import-note">Ratings are converted to CineVerse's 1–10 scale. Five-star exports are doubled; the detected scale is shown before anything is written.</p>`;
    return;
  }

  if (step === 'preview') {
    const { stats, source, scale, items, truncated } = job;
    const sample = items.slice(0, 6).map(item => `<li>${esc(item.title || `TMDB ${item.tmdbId}`)}${item.year ? ` <em>${item.year}</em>` : ''}${item.rating ? ` <b>${item.rating}/10</b>` : ''}</li>`).join('');
    return void (body.innerHTML = `<div class="import-head"><span>${esc(source)} export</span><h2>${items.length.toLocaleString()} row${items.length === 1 ? '' : 's'} ready</h2><p>Choose what to bring across. Every write merges — existing entries keep their own data.</p></div>
      <div class="import-stats">
        <div><span>Rows</span><strong>${items.length.toLocaleString()}</strong></div>
        <div><span>With ratings</span><strong>${stats.rated.toLocaleString()}</strong></div>
        <div><span>Exact ids</span><strong>${stats.ids.toLocaleString()}</strong><small>tmdb / imdb</small></div>
        <div><span>Rating scale</span><strong>${scale === 2 ? '5★ → 10' : '1–10'}</strong><small>detected</small></div>
      </div>
      ${truncated ? `<p class="import-warn">Only the first ${MAX_ROWS.toLocaleString()} rows will be imported.</p>` : ''}
      <ul class="import-sample">${sample}</ul>
      <fieldset class="import-targets">
        <legend>What should these rows become?</legend>
        <label><input type="radio" name="importTarget" value="watched" checked data-action="import-target"><span><b>Watched history</b><small>Adds each title to Watched, with its date when the export has one.</small></span></label>
        <label><input type="radio" name="importTarget" value="watchlist" data-action="import-target"><span><b>Watchlist</b><small>Saves each title to your Watchlist instead.</small></span></label>
      </fieldset>
      <label class="import-check"><input type="checkbox" id="importRatings" ${stats.rated ? 'checked' : 'disabled'}><span>Also import ${stats.rated.toLocaleString()} rating${stats.rated === 1 ? '' : 's'}</span></label>
      <div class="import-actions"><button class="btn-glass" data-action="close-import">Cancel</button><button class="btn-primary" data-action="import-run">Import ${items.length.toLocaleString()} row${items.length === 1 ? '' : 's'}</button></div>`);
  }

  if (step === 'running') {
    const percent = job.total ? Math.round(job.done / job.total * 100) : 0;
    return void (body.innerHTML = `<div class="import-head"><span>Working</span><h2>Matching your library</h2><p>${job.phase}</p></div>
      <div class="import-progress"><i style="width:${percent}%"></i></div>
      <div class="import-progress-meta"><span>${job.done.toLocaleString()} of ${job.total.toLocaleString()}</span><b>${percent}%</b></div>
      <p class="import-note">Keep this tab open. Matching runs against TMDB and writes in batches.</p>`);
  }

  const { result } = job;
  body.innerHTML = `<div class="import-head"><span>Done</span><h2>${result.imported.toLocaleString()} title${result.imported === 1 ? '' : 's'} imported</h2><p>Your library, stats, and recommendations have already been refreshed.</p></div>
    <div class="import-stats">
      <div><span>Imported</span><strong>${result.imported.toLocaleString()}</strong></div>
      <div><span>Ratings</span><strong>${result.ratings.toLocaleString()}</strong></div>
      <div><span>Already had</span><strong>${result.skipped.toLocaleString()}</strong></div>
      <div><span>Not matched</span><strong>${result.unmatched.length.toLocaleString()}</strong></div>
    </div>
    ${result.unmatched.length ? `<details class="import-unmatched"><summary>${result.unmatched.length} row${result.unmatched.length === 1 ? '' : 's'} could not be matched</summary><ul>${result.unmatched.slice(0, 60).map(item => `<li>${esc(item.title || `TMDB ${item.tmdbId}`)}${item.year ? ` <em>${item.year}</em>` : ''}</li>`).join('')}</ul><p>These usually have a title TMDB spells differently. Add them by searching, or re-export with ids included.</p></details>` : ''}
    <div class="import-actions"><button class="btn-primary" data-action="close-import">Done</button></div>`;
}

function openImport() {
  if (!state.user) return document.dispatchEvent(new Event('cv:open-auth'));
  const overlay = $('importOverlay'); if (!overlay) return;
  const trigger = document.activeElement;
  job = { step: 'choose', target: 'watched' };
  paint();
  overlay.classList.add('active');
  lockScroll();
  releaseFocus = trapFocus(overlay, trigger);
}

async function handleFile(file) {
  if (!file) return;
  if (file.size > MAX_BYTES) { toast('That file is larger than the 12 MB limit', 'error'); return; }
  try {
    const text = await file.text();
    const parsed = normalizeRows(parseCSV(text));
    if (!parsed.items.length) { toast('No usable rows found in that CSV', 'error'); return; }
    job = {
      ...job, step: 'preview', ...parsed,
      stats: {
        rated: parsed.items.filter(item => item.rating > 0).length,
        ids: parsed.items.filter(item => item.tmdbId || item.imdbId).length,
      },
      target: 'watched', withRatings: true,
    };
    paint();
  } catch (error) {
    console.error('csv import', error);
    toast(error.message || 'That file could not be read', 'error');
  }
}

async function runImport() {
  if (!job || !state.user) return;
  const importRatings = $('importRatings')?.checked !== false && job.stats.rated > 0;
  const target = job.target;
  const items = job.items;
  job = { ...job, step: 'running', done: 0, total: items.length, phase: 'Matching titles on TMDB…' };
  paint();

  const uid = state.user.uid;
  const matched = [];
  const unmatched = [];
  await pool(items, async item => {
    const match = await resolveItem(item);
    if (match?.id) matched.push({ item, match }); else unmatched.push(item);
    job.done++;
    if (job.done % 5 === 0 || job.done === job.total) paint();
  }, 4);

  if (!state.user || state.user.uid !== uid) return;
  job.phase = 'Writing to your collection…';
  paint();

  const userRef = db.collection('users').doc(uid);
  const writes = [];
  let skipped = 0, ratings = 0;
  for (const { item, match } of matched) {
    const key = `${match.__type}_${match.id}`;
    if (target === 'watched') {
      if (state.watched[key]) skipped++;
      else writes.push({ ref: userRef.collection('watched').doc(key), data: watchedDoc(match, item) });
    } else {
      if (state.watchlist.some(entry => entry.id === key)) skipped++;
      else writes.push({ ref: userRef.collection('watchlist').doc(key), data: savedDoc(match, item) });
    }
    // An existing rating is never overwritten: yours beats the imported one.
    if (importRatings && item.rating && !state.ratings[key]) {
      ratings++;
      writes.push({
        ref: userRef.collection('ratings').doc(key),
        data: { score: item.rating, tmdbId: match.id, type: match.__type, title: match.title || match.name || '', updated: firebase.firestore.FieldValue.serverTimestamp() },
      });
    }
  }

  try {
    await commit(writes);
  } catch (error) {
    console.error('import commit', error);
    job.step = 'done';
    job.result = { imported: 0, ratings: 0, skipped, unmatched };
    paint();
    toast('Could not write the import. Check your connection and try again.', 'error');
    return;
  }

  await Promise.all([loadWatched(), loadWatchlist(), loadRatings()]);
  document.dispatchEvent(new Event('cv:wl-changed'));
  job.step = 'done';
  job.result = { imported: matched.length - skipped, ratings, skipped, unmatched };
  paint();
  toast(`Imported ${job.result.imported} title${job.result.imported === 1 ? '' : 's'}`, 'success');
}

export function initImportCSV() {
  registerActions({
    'open-import': () => openImport(),
    'close-import': () => closeImport(),
    'import-pick': () => $('importFile')?.click(),
    'import-target': element => { if (job) job.target = element.value; },
    'import-run': element => { element.disabled = true; runImport(); },
  });

  const input = $('importFile');
  input?.addEventListener('change', () => { const file = input.files?.[0]; input.value = ''; handleFile(file); });

  const overlay = $('importOverlay');
  overlay?.addEventListener('click', event => { if (event.target === overlay) closeImport(); });

  // Drag and drop onto the picker, which is where people expect to drop a file.
  overlay?.addEventListener('dragover', event => {
    if (!job || job.step !== 'choose') return;
    event.preventDefault();
    $('importDrop')?.classList.add('over');
  });
  overlay?.addEventListener('dragleave', () => $('importDrop')?.classList.remove('over'));
  overlay?.addEventListener('drop', event => {
    if (!job || job.step !== 'choose') return;
    event.preventDefault();
    $('importDrop')?.classList.remove('over');
    handleFile(event.dataTransfer?.files?.[0]);
  });
}
