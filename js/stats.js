// ===== CINEPRINT — PREMIUM STATS + TASTE MAP =====
// Rich analytics are derived from the user's Firestore-backed lists, ratings and
// watched history. A compact snapshot is mirrored onto users/{uid} only when its
// content hash changes, keeping it durable without burning free-tier writes.
import { genreMap } from './config.js';
import { state } from './state.js';
import { $, esc, debounce, toast } from './ui.js';
import { registerActions } from './events.js';
import { observeCountUps } from './effects.js';
import { buildCtx, badgesHTML, challengesHTML, animateBadgeBars } from './badges.js';
import { ensureWatchedMeta } from './watched-meta.js';
import { db, firebase } from './firebase.js';
import { social } from './social.js';

let statsScope = 'all';
let latestSnapshot = null;
let syncState = 'idle';
let syncMessage = 'Protected Firestore snapshot';
let checkedUid = '', remoteHash = '', lastQueuedHash = '';

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
    if (!inScope(item.type, scope)) return;
    const key = itemKey(item);
    rows.set(key, {
      key, id: item.tmdbId, type: item.type, title: item.title || '', poster: item.poster || '',
      year: item.year || '', releaseDate: item.releaseDate || '', genres: item.genres || [],
      language: item.language || '', country: item.country || '', runtime: +(item.runtime || 0),
      tmdbRating: +(item.rating || 0), saved: true, watched: false, watchedAt: null,
      director: '', directorId: 0, cast: [],
    });
  });
  Object.entries(state.watched).forEach(([key, doc]) => {
    if (!inScope(doc.type, scope)) return;
    const old = rows.get(key) || { key, id: doc.tmdbId, type: doc.type, saved: false };
    rows.set(key, {
      ...old,
      id: doc.tmdbId ?? old.id, type: doc.type || old.type,
      title: doc.title || old.title || '', poster: doc.poster || old.poster || '',
      year: doc.year || old.year || '', releaseDate: doc.releaseDate || old.releaseDate || '',
      genres: doc.genres?.length ? doc.genres : (old.genres || []),
      language: doc.language || old.language || '', country: doc.country || old.country || '',
      runtime: +(doc.runtime || old.runtime || 0), tmdbRating: +(doc.tmdbRating || old.tmdbRating || 0),
      director: doc.director || old.director || '', directorId: doc.directorId || old.directorId || 0,
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

function computeStats(scope) {
  const rows = canonicalRows(scope);
  const watched = rows.filter(row => row.watched);
  const saved = rows.filter(row => row.saved);
  const ratingEntries = Object.entries(state.ratings).filter(([key]) => scope === 'all' || key.startsWith(scope + '_'));
  const ratingValues = ratingEntries.map(([, score]) => +score).filter(Boolean);

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
  const enriched = watched.filter(row => row.runtime > 0 && row.language && row.year && row.genres?.length);
  const totalMinutes = runtimes.reduce((sum, value) => sum + value, 0);
  const years = rows.map(row => +(row.year || 0)).filter(year => year > 1800 && year < 2200).sort((a, b) => a - b);
  const directorMap = new Map(), actorMap = new Map();
  watched.forEach(row => {
    if (row.director) bump(directorMap, row.director, 1, { name: row.director, id: row.directorId || 0 });
    (row.cast || []).forEach(person => { if (person?.id) bump(actorMap, String(person.id), 1, { name: person.name || '', id: person.id }); });
  });
  const topDirector = sorted(directorMap, 1)[0] || null;
  const topActor = sorted(actorMap, 1)[0] || null;
  const longestTitle = [...watched].filter(row => row.runtime > 0).sort((a, b) => b.runtime - a.runtime)[0] || null;
  const oldestTitle = [...rows].filter(row => +row.year).sort((a, b) => +a.year - +b.year)[0] || null;
  const newestTitle = [...rows].filter(row => +row.year).sort((a, b) => +b.year - +a.year)[0] || null;

  const avgRating = ratingValues.length ? ratingValues.reduce((sum, value) => sum + value, 0) / ratingValues.length : 0;
  const avgTmdb = rows.filter(row => row.tmdbRating > 0).length
    ? rows.filter(row => row.tmdbRating > 0).reduce((sum, row) => sum + row.tmdbRating, 0) / rows.filter(row => row.tmdbRating > 0).length : 0;
  const ratingCounts = Array.from({ length: 10 }, (_, index) => ratingValues.filter(value => value === index + 1).length);
  const completion = rows.length ? Math.round(watched.length / rows.length * 100) : 0;
  const ratingCoverage = watched.length ? Math.min(100, Math.round(ratingValues.length / watched.length * 100)) : 0;
  const highScores = ratingValues.filter(value => value >= 8).length;
  const positiveRate = ratingValues.length ? Math.round(highScores / ratingValues.length * 100) : 0;
  const diversityScore = Math.round(Math.min(1, genres.size / 18) * 45 + Math.min(1, decades.size / 8) * 30 + Math.min(1, languages.size / 6) * 25);
  const peakDayIndex = weekdays.indexOf(Math.max(...weekdays));
  const peakDay = Math.max(...weekdays) ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][peakDayIndex] : 'No pattern yet';
  const personality = !ratingValues.length ? 'Unwritten critic' : avgRating >= 8 ? 'Generous enthusiast' : avgRating >= 7 ? 'Passionate curator' : avgRating >= 6 ? 'Balanced critic' : 'Fearless critic';
  const level = watched.length >= 500 ? 'Master Archivist' : watched.length >= 250 ? 'Cinema Historian' : watched.length >= 100 ? 'Cinephile' : watched.length >= 50 ? 'Curator' : watched.length >= 10 ? 'Explorer' : 'New Voyager';
  const milestone = [10, 25, 50, 100, 250, 500, 1000].find(goal => goal > watched.length) || Math.ceil((watched.length + 1) / 500) * 500;

  return {
    scope, rows, watched, saved, totalRated: ratingValues.length, avgRating, avgTmdb,
    ratingCounts, completion, ratingCoverage, positiveRate, highScores,
    genres: genreRows, decades: decadeRows, languages: languageRows, diversityScore,
    totalMinutes, hours: Math.round(totalMinutes / 60), avgRuntime: runtimes.length ? Math.round(totalMinutes / runtimes.length) : 0,
    metaCoverage: watched.length ? enriched.length / watched.length : 1,
    movies: watched.filter(row => row.type === 'movie').length, shows: watched.filter(row => row.type === 'tv').length,
    thisYear: watched.filter(row => row.watchedAt?.getFullYear() === now.getFullYear()).length,
    last30: watched.filter(row => row.watchedAt && row.watchedAt >= last30Cutoff).length,
    currentStreak: streak.current, longestStreak: streak.longest, bestMonth, peakDay,
    last12Months, heatDays: buildHeatDays(new Map([...activity].map(([key, value]) => [key, value.count]))), weekdays,
    topDirector, topActor, longestTitle, oldestTitle, newestTitle,
    releaseSpan: years.length ? (years[0] === years.at(-1) ? String(years[0]) : `${years[0]}–${years.at(-1)}`) : '—',
    level, milestone, personality,
  };
}

function snapshotFor(stats) {
  return {
    schema: 3,
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
    },
    activity: {
      currentStreak: stats.currentStreak, longestStreak: stats.longestStreak,
      bestMonth: stats.bestMonth, peakDay: stats.peakDay,
      last12Months: stats.last12Months.map(item => ({ month: item.key, count: item.count })),
      weekdays: stats.weekdays,
    },
    collection: {
      completion: stats.completion, averageRuntime: stats.avgRuntime, releaseSpan: stats.releaseSpan,
      topDirector: stats.topDirector ? { name: stats.topDirector.name, id: stats.topDirector.id, count: stats.topDirector.count } : null,
      topActor: stats.topActor ? { name: stats.topActor.name, id: stats.topActor.id, count: stats.topActor.count } : null,
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
  syncState = 'syncing'; syncMessage = 'Checking your Firestore snapshot…'; paintSyncState();
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
    syncState = 'synced'; syncMessage = 'Synced to Firestore · writes only when stats change'; paintSyncState();
  } catch (error) {
    console.warn('Stats snapshot unavailable', error);
    syncState = 'offline'; syncMessage = 'Live stats ready · cloud snapshot will retry later'; paintSyncState();
  }
}

const persistSnapshotSoon = debounce(persistSnapshot, 1800);
function queueSnapshot(snapshot) {
  if (!state.user) return;
  latestSnapshot = snapshot;
  const hash = hashSnapshot(snapshot);
  if (hash === lastQueuedHash && remoteHash === hash) return;
  lastQueuedHash = hash;
  syncState = 'queued'; syncMessage = 'Preparing secure Firestore snapshot…'; paintSyncState();
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
  const formatRuntime = minutes => minutes ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : 'Calculating…';
  const intelligence = [
    ['Release range', stats.releaseSpan, stats.oldestTitle && stats.newestTitle ? `${stats.oldestTitle.title} to ${stats.newestTitle.title}` : 'Build your timeline'],
    ['Average runtime', formatRuntime(stats.avgRuntime), 'Across watched titles'],
    ['Top director', stats.topDirector?.name || 'Discovering…', stats.topDirector ? `${stats.topDirector.count} watched titles` : 'Metadata is being enriched'],
    ['Most seen actor', stats.topActor?.name || 'Discovering…', stats.topActor ? `${stats.topActor.count} watched titles` : 'Metadata is being enriched'],
  ];
  return `<section class="stats-panel collection-intel"><div class="stats-section-head compact"><div><span>Collection intelligence</span><h2>Library Anatomy</h2></div></div><div class="library-completion"><div class="library-donut" style="--library-progress:${stats.completion * 3.6}deg"><strong>${stats.completion}%</strong></div><div><span>Known collection watched</span><strong>${stats.watched.length} of ${stats.rows.length}</strong><small>${stats.saved.length} titles currently saved</small></div></div><div class="library-facts">${intelligence.map(([label, value, note]) => `<div><span>${label}</span><strong title="${esc(String(value))}">${esc(String(value))}</strong><small>${esc(note)}</small></div>`).join('')}</div></section>`;
}

function animateStats(scope, stats) {
  observeCountUps(scope);
  requestAnimationFrame(() => {
    scope.querySelectorAll('.taste-bar em').forEach(bar => { bar.style.width = bar.style.getPropertyValue('--taste-width'); });
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
      ${kpi('star', 'Average rating', stats.avgRating ? +stats.avgRating.toFixed(1) : 0, '/10', `${stats.totalRated} personal ratings`, 'purple')}
      ${kpi('library', 'Collection watched', stats.completion, '%', `${stats.saved.length} currently saved`, 'cyan')}
      ${kpi('fire', 'Longest streak', stats.longestStreak, 'd', `${stats.currentStreak} day current streak`, 'green')}
      ${kpi('compass', 'Taste diversity', stats.diversityScore, '/100', `${stats.genres.length} genres · ${stats.languages.length} languages`, 'pink')}
    </div>
    ${tasteMap(stats)}
    ${activityPanel(stats)}
    <div class="stats-duo">${ratingPanel(stats)}${collectionPanel(stats)}</div>
    <section class="stats-achievements"><div class="stats-section-head"><div><span>Account-wide progression</span><h2>Challenges &amp; Trophy Room</h2><p>Every milestone is derived from your Firestore-backed collection.</p></div></div>${challengesHTML(context)}${badgesHTML(context)}</section>
    <p class="stats-footnote">${esc(scopeLabel)} stats · Watch time for TV is approximate because a completed show uses its full available runtime.</p>`;

  const snapshot = snapshotFor(fullStats);
  queueSnapshot(snapshot);
  animateStats(container, stats);
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

export function initStats() {
  registerActions({
    'stats-filter': element => { statsScope = element.dataset.filter; renderStats(); },
    'export-stats': () => exportStats(),
  });
  document.addEventListener('cv:auth', () => {
    checkedUid = ''; remoteHash = ''; lastQueuedHash = ''; latestSnapshot = null;
    syncState = 'idle'; syncMessage = 'Protected Firestore snapshot';
    if (state.user) queueCurrentSnapshot();
  });
  document.addEventListener('cv:wl-changed', queueCurrentSnapshot);
  document.addEventListener('cv:meta-backfilled', queueCurrentSnapshot);
  document.addEventListener('cv:social', () => {
    queueCurrentSnapshot();
    if (location.pathname === '/stats') renderStats();
  });
}
