// ===== RELEASE REMINDERS =====
// A free, local-first release calendar. TMDB supplies upcoming film/show data;
// saved reminders stay in localStorage and can be exported to any calendar.
import { tmdb } from './api.js';
import { IMG, PH } from './config.js';
import { $, esc, debounce, toast } from './ui.js';
import { registerActions } from './events.js';

const STORE_KEY = 'cv_release_reminders_v1';
let allEvents = [], releaseFilter = 'all', releaseRange = 90, releaseQuery = '';
let loadedRange = 0, reqGen = 0;

const iso = d => d.toISOString().slice(0, 10);
const parseDate = value => new Date(`${value}T12:00:00`);
const addDays = (date, days) => { const d = new Date(date); d.setDate(d.getDate() + days); return d; };

function savedReminders() {
  try { const value = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); return Array.isArray(value) ? value : []; }
  catch (_) { return []; }
}

function saveReminders(items) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(items)); } catch (_) {}
}

function eventKey(event) { return event.key || `${event.mediaType}_${event.id}_${event.date}_${event.kind}`; }

function normalizeMovie(movie) {
  return {
    key: `movie_${movie.id}_${movie.release_date}`, id: movie.id, mediaType: 'movie',
    title: movie.title || movie.original_title || 'Untitled', date: movie.release_date,
    poster: movie.poster_path || '', kind: 'Movie release', note: movie.original_language?.toUpperCase() || '',
    rating: movie.vote_average || 0,
  };
}

function normalizePremiere(show) {
  return {
    key: `premiere_${show.id}_${show.first_air_date}`, id: show.id, mediaType: 'tv',
    title: show.name || show.original_name || 'Untitled', date: show.first_air_date,
    poster: show.poster_path || '', kind: 'Series premiere', note: show.original_language?.toUpperCase() || '',
    rating: show.vote_average || 0,
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
    note: ep.name || 'New episode', rating: ep.vote_average || show.vote_average || 0,
  };
}

async function fetchReleaseEvents(days) {
  const start = new Date(), end = addDays(start, days), from = iso(start), to = iso(end);
  const movieParams = { sort_by: 'primary_release_date.asc', 'primary_release_date.gte': from, 'primary_release_date.lte': to, include_adult: false, region: 'IN' };
  const tvParams = { sort_by: 'first_air_date.asc', 'first_air_date.gte': from, 'first_air_date.lte': to, include_null_first_air_dates: false };
  const [m1, m2, premieres, airing] = await Promise.all([
    tmdb('/discover/movie', { ...movieParams, page: 1 }),
    tmdb('/discover/movie', { ...movieParams, page: 2 }),
    tmdb('/discover/tv', { ...tvParams, page: 1 }),
    tmdb('/tv/on_the_air', { page: 1 }),
  ]);

  const episodeShows = [...new Map((airing.results || []).filter(x => x.id).map(x => [x.id, x])).values()].slice(0, 16);
  const details = await Promise.all(episodeShows.map(show => tmdb(`/tv/${show.id}`).catch(() => null)));
  const inRange = e => e && e.date >= from && e.date <= to;
  const events = [
    ...(m1.results || []), ...(m2.results || []),
  ].filter(m => m.poster_path && m.release_date).map(normalizeMovie);
  events.push(...(premieres.results || []).filter(s => s.poster_path && s.first_air_date).map(normalizePremiere));
  events.push(...details.map(normalizeEpisode).filter(inRange));
  return [...new Map(events.filter(inRange).map(e => [eventKey(e), e])).values()]
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

function releaseCard(event, saved) {
  const payload = esc(JSON.stringify(event));
  const typeLabel = event.mediaType === 'movie' ? 'MOVIE' : event.kind === 'Series premiere' ? 'SERIES' : 'EPISODE';
  return `<article class="release-card${saved ? ' saved' : ''}">
    <a class="release-poster${event.posterKind === 'still' ? ' landscape' : ''}" href="/${event.mediaType}/${event.id}" data-action="open-detail" data-id="${event.id}" data-type="${event.mediaType}"><img src="${posterURL(event)}" alt="${esc(event.title)}" loading="lazy" data-ph="${PH}"><span class="release-type">${typeLabel}</span></a>
    <div class="release-card-body"><div class="release-kind">${esc(event.kind)}</div><a class="release-title" href="/${event.mediaType}/${event.id}" data-action="open-detail" data-id="${event.id}" data-type="${event.mediaType}">${esc(event.title)}</a>${event.note ? `<div class="release-note">${esc(event.note)}</div>` : ''}
      <div class="release-card-actions"><button class="reminder-btn${saved ? ' active' : ''}" data-action="toggle-release-reminder" data-key="${esc(eventKey(event))}" data-event="${payload}">${saved ? '✓ Saved' : '＋ Remind me'}</button><button class="calendar-btn" data-action="download-release-calendar" data-event="${payload}" data-tip="Add to calendar" aria-label="Add ${esc(event.title)} to calendar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/><path d="M12 14v4M10 16h4"/></svg></button></div>
    </div>
  </article>`;
}

function visibleEvents() {
  const saved = savedReminders(), savedKeys = new Set(saved.map(eventKey));
  const merged = [...new Map([...allEvents, ...saved].map(e => [eventKey(e), e])).values()];
  return merged.filter(event => {
    if (!event?.date || event.date < iso(new Date())) return false;
    if (releaseFilter === 'saved' && !savedKeys.has(eventKey(event))) return false;
    if (releaseFilter === 'movie' && event.mediaType !== 'movie') return false;
    if (releaseFilter === 'tv' && event.mediaType !== 'tv') return false;
    if (releaseQuery && !`${event.title} ${event.note} ${event.kind}`.toLowerCase().includes(releaseQuery.toLowerCase())) return false;
    return true;
  }).sort((a, b) => a.date.localeCompare(b.date));
}

function paintReleaseTimeline() {
  const content = $('releaseContent'), summary = $('releaseSummary'); if (!content) return;
  const savedKeys = new Set(savedReminders().map(eventKey));
  const events = visibleEvents();
  if (summary) summary.innerHTML = `<strong>${events.length}</strong> upcoming event${events.length === 1 ? '' : 's'}<span>${savedKeys.size} reminder${savedKeys.size === 1 ? '' : 's'} saved locally</span>`;
  if (!events.length) {
    content.innerHTML = `<div class="release-empty"><div>✦</div><h3>Nothing matches yet</h3><p>Try another filter, a wider date range, or save a release first.</p></div>`;
    return;
  }
  const groups = new Map();
  events.forEach(event => { if (!groups.has(event.date)) groups.set(event.date, []); groups.get(event.date).push(event); });
  content.innerHTML = [...groups.entries()].map(([date, items]) => {
    const heading = dateHeading(date);
    return `<section class="release-day"><div class="release-date"><div class="release-date-box"><span>${heading.month}</span><strong>${heading.day}</strong></div><div><h2>${heading.relative}</h2><p>${heading.full}</p></div></div><div class="release-day-grid">${items.map(e => releaseCard(e, savedKeys.has(eventKey(e)))).join('')}</div></section>`;
  }).join('');
}

export async function renderReleaseReminders(force = false) {
  const content = $('releaseContent'); if (!content) return;
  const range = $('releaseRange'); if (range) range.value = String(releaseRange);
  const search = $('releaseSearch'); if (search && search.value !== releaseQuery) search.value = releaseQuery;
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
  const saved = savedReminders(), key = eventKey(event), index = saved.findIndex(x => eventKey(x) === key);
  if (index >= 0) { saved.splice(index, 1); toast('Reminder removed', 'info'); }
  else { saved.push(event); toast('Release reminder saved', 'success'); }
  saveReminders(saved); paintReleaseTimeline();
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
    'release-filter': (el) => { releaseFilter = el.dataset.filter; paintReleaseTimeline(); document.querySelectorAll('.release-tab').forEach(t => t.classList.toggle('active', t === el)); },
    'release-range': (el) => { releaseRange = +el.value || 90; renderReleaseReminders(true); },
    'toggle-release-reminder': (el) => { try { toggleReminder(JSON.parse(el.dataset.event || '{}')); } catch (_) {} },
    'download-release-calendar': (el) => { try { downloadCalendar(JSON.parse(el.dataset.event || '{}')); } catch (_) {} },
    'retry-releases': () => renderReleaseReminders(true),
  });
  const search = $('releaseSearch');
  if (search) search.addEventListener('input', debounce(function () { releaseQuery = this.value.trim(); paintReleaseTimeline(); }, 180));
}
