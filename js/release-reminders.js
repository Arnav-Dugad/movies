// ===== RELEASE REMINDERS =====
// Free, local-first release calendar. TMDB supplies upcoming film/show data;
// preferences and saved reminders stay on this device and export to any calendar.
import { tmdb } from './api.js';
import { IMG, PH } from './config.js';
import { $, esc, debounce, toast } from './ui.js';
import { registerActions } from './events.js';

const STORE_KEY = 'cv_release_reminders_v1';
const PREF_KEY = 'cv_release_preferences_v1';
const ALLOWED_LANGUAGES = new Set(['en', 'hi']);
const DEFAULT_PREFS = Object.freeze({
  english: true, hindi: true, movies: true, premieres: true, episodes: true,
  minRating: 0, sort: 'soonest', countdown: true, posters: true,
});

let allEvents = [], releaseFilter = 'all', releaseRange = 90, releaseQuery = '';
let loadedRange = 0, reqGen = 0, countdownTimer = null;
let prefs = readPreferences();

const iso = d => d.toISOString().slice(0, 10);
const parseDate = value => new Date(`${value}T12:00:00`);
const addDays = (date, days) => { const d = new Date(date); d.setDate(d.getDate() + days); return d; };

function readPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    return { ...DEFAULT_PREFS, ...(stored && typeof stored === 'object' ? stored : {}) };
  } catch (_) { return { ...DEFAULT_PREFS }; }
}

function savePreferences() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (_) {}
}

function savedReminders() {
  try { const value = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); return Array.isArray(value) ? value : []; }
  catch (_) { return []; }
}

function saveReminders(items) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(items)); } catch (_) {}
}

function eventKey(event) { return event.key || `${event.mediaType}_${event.id}_${event.date}_${event.kind}`; }
function eventLanguage(event) {
  const language = String(event.language || '').toLowerCase();
  if (ALLOWED_LANGUAGES.has(language)) return language;
  const legacy = String(event.note || '').toLowerCase();
  return ALLOWED_LANGUAGES.has(legacy) ? legacy : '';
}

function normalizeMovie(movie) {
  return {
    key: `movie_${movie.id}_${movie.release_date}`, id: movie.id, mediaType: 'movie',
    title: movie.title || movie.original_title || 'Untitled', date: movie.release_date,
    poster: movie.poster_path || '', kind: 'Movie release', note: '',
    language: movie.original_language || '', rating: movie.vote_average || 0,
  };
}

function normalizePremiere(show) {
  return {
    key: `premiere_${show.id}_${show.first_air_date}`, id: show.id, mediaType: 'tv',
    title: show.name || show.original_name || 'Untitled', date: show.first_air_date,
    poster: show.poster_path || '', kind: 'Series premiere', note: '',
    language: show.original_language || '', rating: show.vote_average || 0,
  };
}

function normalizeEpisode(show) {
  const ep = show.next_episode_to_air;
  if (!ep?.air_date) return null;
  return {
    key: `episode_${show.id}_${ep.season_number}_${ep.episode_number}_${ep.air_date}`,
    id: show.id, mediaType: 'tv', title: show.name || 'Untitled', date: ep.air_date,
    poster: ep.still_path || show.poster_path || '', posterKind: ep.still_path ? 'still' : 'poster',
    kind: `S${ep.season_number} · E${ep.episode_number}`,
    note: ep.name || 'New episode', language: show.original_language || '',
    rating: ep.vote_average || show.vote_average || 0,
  };
}

async function fetchReleaseEvents(days) {
  const start = new Date(), end = addDays(start, days), from = iso(start), to = iso(end);
  const movieParams = { sort_by: 'primary_release_date.asc', 'primary_release_date.gte': from, 'primary_release_date.lte': to, include_adult: false, region: 'IN' };
  const tvParams = { sort_by: 'first_air_date.asc', 'first_air_date.gte': from, 'first_air_date.lte': to, include_null_first_air_dates: false };
  const [moviesEn1, moviesEn2, moviesHi, tvEn, tvHi, airing] = await Promise.all([
    tmdb('/discover/movie', { ...movieParams, with_original_language: 'en', page: 1 }),
    tmdb('/discover/movie', { ...movieParams, with_original_language: 'en', page: 2 }),
    tmdb('/discover/movie', { ...movieParams, with_original_language: 'hi', page: 1 }),
    tmdb('/discover/tv', { ...tvParams, with_original_language: 'en', page: 1 }),
    tmdb('/discover/tv', { ...tvParams, with_original_language: 'hi', page: 1 }),
    tmdb('/tv/on_the_air', { page: 1 }),
  ]);

  const episodeShows = [...new Map((airing.results || [])
    .filter(show => show.id && ALLOWED_LANGUAGES.has(show.original_language))
    .map(show => [show.id, show])).values()].slice(0, 16);
  const details = await Promise.all(episodeShows.map(show => tmdb(`/tv/${show.id}`).catch(() => null)));
  const inRange = event => event && event.date >= from && event.date <= to;
  const movieRows = [...(moviesEn1.results || []), ...(moviesEn2.results || []), ...(moviesHi.results || [])];
  const premiereRows = [...(tvEn.results || []), ...(tvHi.results || [])];
  const events = movieRows.filter(movie => movie.release_date).map(normalizeMovie);
  events.push(...premiereRows.filter(show => show.first_air_date).map(normalizePremiere));
  events.push(...details.map(normalizeEpisode).filter(Boolean));
  return [...new Map(events
    .filter(inRange)
    .filter(event => ALLOWED_LANGUAGES.has(eventLanguage(event)))
    .map(event => [eventKey(event), event])).values()]
    .sort((a, b) => a.date.localeCompare(b.date) || (b.rating || 0) - (a.rating || 0));
}

function dateHeading(value) {
  const date = parseDate(value), today = new Date();
  const dayDiff = Math.round((date.setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86400000);
  const relative = dayDiff === 0 ? 'Today' : dayDiff === 1 ? 'Tomorrow' : date.toLocaleDateString(undefined, { weekday: 'long' });
  return { relative, month: date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(), day: date.getDate(), full: date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) };
}

function posterURL(event) {
  if (!event.poster) return PH;
  return `${IMG}${event.posterKind === 'still' ? 'w300' : 'w342'}${event.poster}`;
}

function languageLabel(event) { return eventLanguage(event) === 'hi' ? 'Hindi' : 'English'; }
function isEpisode(event) { return event.mediaType === 'tv' && event.kind !== 'Series premiere'; }

function releaseCard(event, saved) {
  const payload = esc(JSON.stringify(event));
  const typeLabel = event.mediaType === 'movie' ? 'MOVIE' : event.kind === 'Series premiere' ? 'SERIES' : 'EPISODE';
  const countdown = saved && prefs.countdown
    ? `<div class="release-countdown" data-release-countdown="${esc(event.date)}"><span>Countdown</span><strong>--d --h</strong></div>` : '';
  return `<article class="release-card${saved ? ' saved' : ''}">
    <a class="release-poster${event.posterKind === 'still' ? ' landscape' : ''}" href="/${event.mediaType}/${event.id}" data-action="open-detail" data-id="${event.id}" data-type="${event.mediaType}"><img src="${posterURL(event)}" alt="${esc(event.title)}" loading="lazy" data-ph="${PH}"><span class="release-type">${typeLabel}</span></a>
    <div class="release-card-body"><div class="release-meta-line"><span class="release-kind">${esc(event.kind)}</span><span class="release-language">${languageLabel(event)}</span></div><a class="release-title" href="/${event.mediaType}/${event.id}" data-action="open-detail" data-id="${event.id}" data-type="${event.mediaType}">${esc(event.title)}</a>${event.note ? `<div class="release-note">${esc(event.note)}</div>` : ''}${countdown}
      <div class="release-card-actions"><button class="reminder-btn${saved ? ' active' : ''}" data-action="toggle-release-reminder" data-key="${esc(eventKey(event))}" data-event="${payload}">${saved ? '✓ Saved' : '＋ Remind me'}</button><button class="calendar-btn" data-action="download-release-calendar" data-event="${payload}" data-tip="Add to calendar" aria-label="Add ${esc(event.title)} to calendar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/><path d="M12 14v4M10 16h4"/></svg></button></div>
    </div>
  </article>`;
}

function enabledLanguage(event) {
  const language = eventLanguage(event);
  return (language === 'en' && prefs.english) || (language === 'hi' && prefs.hindi);
}

function enabledType(event) {
  if (event.mediaType === 'movie') return prefs.movies;
  return isEpisode(event) ? prefs.episodes : prefs.premieres;
}

function visibleEvents() {
  const saved = savedReminders(), savedKeys = new Set(saved.map(eventKey));
  // Current API data wins over an older saved payload so legacy reminders receive
  // language/rating metadata without touching the user's saved choice.
  const merged = [...new Map([...saved, ...allEvents].map(event => [eventKey(event), event])).values()];
  const events = merged.filter(event => {
    if (!event?.date || event.date < iso(new Date())) return false;
    if (!ALLOWED_LANGUAGES.has(eventLanguage(event)) || !enabledLanguage(event) || !enabledType(event)) return false;
    if (prefs.posters && !event.poster) return false;
    if (+prefs.minRating && +(event.rating || 0) < +prefs.minRating) return false;
    if (releaseFilter === 'saved' && !savedKeys.has(eventKey(event))) return false;
    if (releaseFilter === 'movie' && event.mediaType !== 'movie') return false;
    if (releaseFilter === 'tv' && event.mediaType !== 'tv') return false;
    if (releaseQuery && !`${event.title} ${event.note} ${event.kind} ${languageLabel(event)}`.toLowerCase().includes(releaseQuery.toLowerCase())) return false;
    return true;
  });
  return events.sort(prefs.sort === 'rating'
    ? (a, b) => (b.rating || 0) - (a.rating || 0) || a.date.localeCompare(b.date)
    : (a, b) => a.date.localeCompare(b.date) || (b.rating || 0) - (a.rating || 0));
}

function updateReleaseCountdowns() {
  document.querySelectorAll('[data-release-countdown]').forEach(node => {
    const target = new Date(`${node.dataset.releaseCountdown}T00:00:00`).getTime();
    const difference = target - Date.now();
    const value = node.querySelector('strong');
    if (!value) return;
    if (difference <= 0) { value.textContent = 'Released today'; return; }
    const days = Math.floor(difference / 86400000);
    const hours = Math.floor((difference % 86400000) / 3600000);
    value.textContent = `${days}d ${String(hours).padStart(2, '0')}h`;
  });
}

function startReleaseCountdowns() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
  if (!document.querySelector('[data-release-countdown]')) return;
  updateReleaseCountdowns();
  countdownTimer = setInterval(updateReleaseCountdowns, 60000);
}

function paintReleaseTimeline() {
  const content = $('releaseContent'), summary = $('releaseSummary'); if (!content) return;
  const savedKeys = new Set(savedReminders().map(eventKey));
  const events = visibleEvents();
  if (summary) summary.innerHTML = `<strong>${events.length}</strong> upcoming event${events.length === 1 ? '' : 's'}<span>English + Hindi · ${savedKeys.size} reminder${savedKeys.size === 1 ? '' : 's'} saved locally</span>`;
  if (!events.length) {
    content.innerHTML = `<div class="release-empty"><div>✦</div><h3>Nothing matches yet</h3><p>Try another filter, a wider date range, or adjust your preferences.</p><button class="btn-glass" data-action="toggle-release-preferences">Open preferences</button></div>`;
    startReleaseCountdowns();
    return;
  }
  const groups = new Map();
  events.forEach(event => { if (!groups.has(event.date)) groups.set(event.date, []); groups.get(event.date).push(event); });
  content.innerHTML = [...groups.entries()].map(([date, items]) => {
    const heading = dateHeading(date);
    return `<section class="release-day"><div class="release-date"><div class="release-date-box"><span>${heading.month}</span><strong>${heading.day}</strong></div><div><h2>${heading.relative}</h2><p>${heading.full}</p></div></div><div class="release-day-grid">${items.map(event => releaseCard(event, savedKeys.has(eventKey(event)))).join('')}</div></section>`;
  }).join('');
  startReleaseCountdowns();
}

function syncPreferenceControls() {
  document.querySelectorAll('[data-pref]').forEach(control => {
    const key = control.dataset.pref;
    if (!(key in prefs)) return;
    if (control.type === 'checkbox') control.checked = !!prefs[key];
    else control.value = String(prefs[key]);
  });
}

export async function renderReleaseReminders(force = false) {
  const content = $('releaseContent'); if (!content) return;
  const range = $('releaseRange'); if (range) range.value = String(releaseRange);
  const search = $('releaseSearch'); if (search && search.value !== releaseQuery) search.value = releaseQuery;
  syncPreferenceControls();
  document.querySelectorAll('.release-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.filter === releaseFilter));
  if (!force && allEvents.length && loadedRange === releaseRange) return paintReleaseTimeline();
  const gen = ++reqGen;
  content.innerHTML = `<div class="release-loading">${Array(6).fill('<div class="release-skeleton skel"></div>').join('')}</div>`;
  try {
    const result = await fetchReleaseEvents(releaseRange);
    if (gen !== reqGen) return;
    allEvents = result; loadedRange = releaseRange; paintReleaseTimeline();
  } catch (error) {
    console.error('release reminders', error);
    content.innerHTML = `<div class="release-empty"><div>!</div><h3>Couldn’t load the calendar</h3><p>Please try again in a moment.</p><button class="btn-primary" data-action="retry-releases">Try again</button></div>`;
  }
}

function toggleReminder(event) {
  const language = eventLanguage(event);
  if (!ALLOWED_LANGUAGES.has(language)) { toast('Only English and Hindi releases can be saved', 'info'); return; }
  event.language = language;
  const saved = savedReminders(), key = eventKey(event), index = saved.findIndex(item => eventKey(item) === key);
  if (index >= 0) { saved.splice(index, 1); toast('Reminder removed', 'info'); }
  else { saved.push(event); toast('Release reminder saved', 'success'); }
  saveReminders(saved); paintReleaseTimeline();
}

function setPreference(control) {
  const key = control.dataset.pref;
  if (!(key in DEFAULT_PREFS)) return;
  const next = control.type === 'checkbox' ? control.checked : control.value;
  if (control.type === 'checkbox' && next === false) {
    const languageKeys = ['english', 'hindi'];
    const typeKeys = ['movies', 'premieres', 'episodes'];
    const group = languageKeys.includes(key) ? languageKeys : typeKeys.includes(key) ? typeKeys : [];
    if (group.length && !group.some(name => name !== key && prefs[name])) {
      control.checked = true;
      toast(group === languageKeys ? 'Keep at least one language selected' : 'Keep at least one release type selected', 'info');
      return;
    }
  }
  prefs[key] = key === 'minRating' ? (+next || 0) : next;
  savePreferences();
  paintReleaseTimeline();
}

function togglePreferences(force) {
  const panel = $('releasePreferences'), button = $('releasePrefBtn'); if (!panel) return;
  const open = typeof force === 'boolean' ? force : panel.hidden;
  panel.hidden = !open;
  if (button) { button.classList.toggle('active', open); button.setAttribute('aria-expanded', String(open)); }
  if (open) { syncPreferenceControls(); panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

function icsEscape(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n'); }
function downloadCalendar(event) {
  const start = event.date.replace(/-/g, ''), end = iso(addDays(parseDate(event.date), 1)).replace(/-/g, '');
  const body = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//CineVerse//Release Reminders//EN','BEGIN:VEVENT',`UID:${icsEscape(eventKey(event))}@cineverse`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,`DTSTART;VALUE=DATE:${start}`,`DTEND;VALUE=DATE:${end}`,`SUMMARY:${icsEscape(`${event.title} — ${event.kind}`)}`,`DESCRIPTION:${icsEscape(event.note || 'CineVerse release reminder')}`,`URL:${location.origin}/${event.mediaType}/${event.id}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `${event.title || 'release'}.ics`.replace(/[^\w.-]+/g, '-'); link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function initReleaseReminders() {
  registerActions({
    'release-filter': el => { releaseFilter = el.dataset.filter; paintReleaseTimeline(); document.querySelectorAll('.release-tab').forEach(tab => tab.classList.toggle('active', tab === el)); },
    'release-range': el => { releaseRange = +el.value || 90; renderReleaseReminders(true); },
    'toggle-release-reminder': el => { try { toggleReminder(JSON.parse(el.dataset.event || '{}')); } catch (_) {} },
    'download-release-calendar': el => { try { downloadCalendar(JSON.parse(el.dataset.event || '{}')); } catch (_) {} },
    'toggle-release-preferences': () => togglePreferences(),
    'release-preference': el => setPreference(el),
    'reset-release-preferences': () => { prefs = { ...DEFAULT_PREFS }; savePreferences(); syncPreferenceControls(); paintReleaseTimeline(); toast('Reminder preferences reset', 'success'); },
    'retry-releases': () => renderReleaseReminders(true),
  });
  const search = $('releaseSearch');
  if (search) search.addEventListener('input', debounce(function () { releaseQuery = this.value.trim(); paintReleaseTimeline(); }, 180));
}
