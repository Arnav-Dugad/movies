// ===== WATCH DIARY =====
// Daily and monthly: what you watched, how much, and when. Three views of one
// event list, built from data the library already holds — no request:
//
//   - a MONTH CALENDAR where each day is shaded by minutes watched (one hue,
//     darker is more) and carries a small fan of the posters you watched;
//   - a DAY REEL for the selected day: a 24-hour ribbon that places every film
//     and episode at the time you marked it, with the same items as a list
//     beneath (the table view of the ribbon);
//   - TV THIS MONTH: episodes, TV time, shows and binge days for the month in
//     view, with every show you watched ranked by time and the episode span;
//   - a YEAR STRIP of hours per month, split into films and TV, each month
//     headed by its most-watched poster; picking a month opens it in the calendar;
//   - YOUR WEEK: minutes by weekday for the month in view, with your streaks
//     (the Streak tile shimmers once when today has just extended the run);
//   - ON THIS DAY: what you watched on today's date in earlier years.
//
// The month in view compares itself with the month before, marks its biggest
// day, and can be moved through by keyboard (arrow keys move a day or a week,
// Page Up and Page Down a month) or by swiping the calendar on a touch screen.
//
// What counts as viewing. Films come from each play of a watched film (a rewatch
// is its own day). Episodes come from the per-episode log, read through
// viewingLog (js/episodes.js): single ticks and sitting-sized batches such as
// "Up to here" after an evening are viewing; a whole season, a whole show or a
// back-filled history is bookkeeping — listed on its day as "marked", never
// shading a day and never adding minutes. A series marked watched with no
// episode log is treated the same.
// Minutes use the title's reported runtime; a title without one still counts as
// an item and adds no invented time.
import { IMG, PH } from './config.js';
import { icon } from './icons.js';
import { state } from './state.js';
import { $, esc } from './ui.js';
import { registerActions } from './events.js';
import { viewingLog } from './episodes.js';

const DAY = 86400000;
const pad = n => String(n).padStart(2, '0');
export const dayKey = at => { const d = new Date(at); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const monthKey = at => dayKey(at).slice(0, 7);
const splitKey = key => { const i = String(key).lastIndexOf('_'); return [String(key).slice(0, i), +String(key).slice(i + 1)]; };

const msOf = value => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  return +(value.seconds || 0) * 1000;
};

/** Every dated viewing, oldest first. Pure: pass the pieces of state it reads. */
export function diaryEvents({ watched = {}, episodeProgress = {} } = {}) {
  const events = [];
  const logged = new Set();
  for (const [key, entry] of Object.entries(episodeProgress || {})) {
    // The key ("tv_95396") is the fallback for a document written without an id.
    const id = +entry?.tmdbId || +String(key).split('_').at(-1) || 0;
    if (!id) continue;
    const log = viewingLog(entry);
    if (log.length) logged.add(`tv_${id}`);
    for (const row of log) {
      events.push({
        kind: 'episode', key: `tv_${id}`, id, type: 'tv', title: entry.title || 'TV show', poster: entry.poster || '',
        season: row.season, episode: row.episode, at: row.at, bulk: !row.viewing, minutes: row.viewing ? Math.max(0, +entry.episodeRuntime || 0) : 0,
      });
    }
  }
  for (const [key, doc] of Object.entries(watched || {})) {
    if (!doc) continue;
    const [keyType, keyId] = splitKey(key);
    const type = doc.type || keyType, id = +(doc.tmdbId || keyId);
    if (!id) continue;
    if (type === 'movie') {
      const dates = Array.isArray(doc.playDates) && doc.playDates.length ? doc.playDates.map(Number).filter(Boolean) : [msOf(doc.watchedAt)].filter(Boolean);
      dates.forEach((at, index) => events.push({
        kind: 'movie', key, id, type, title: doc.title || 'Film', poster: doc.poster || '', at, bulk: false,
        minutes: Math.max(0, +doc.runtime || 0), rewatch: index > 0,
      }));
    } else if (type === 'tv' && !logged.has(key)) {
      const at = msOf(doc.watchedAt);
      if (at) events.push({ kind: 'series', key, id, type, title: doc.title || 'TV show', poster: doc.poster || '', at, bulk: true, minutes: 0 });
    }
  }
  return events.sort((a, b) => a.at - b.at);
}

/** Per-day totals: viewing only (bulk marks are counted separately). */
export function diaryDays(events) {
  const days = new Map();
  for (const event of events) {
    const key = dayKey(event.at);
    if (!days.has(key)) days.set(key, { key, minutes: 0, filmMinutes: 0, tvMinutes: 0, items: 0, films: 0, episodes: 0, marked: 0, titles: new Map(), events: [] });
    const day = days.get(key);
    day.events.push(event);
    if (event.bulk) { day.marked++; continue; }
    day.items++;
    day.minutes += event.minutes;
    if (event.kind === 'movie') day.filmMinutes += event.minutes; else day.tvMinutes += event.minutes;
    if (event.kind === 'movie') day.films++; else day.episodes++;
    const title = day.titles.get(event.key) || { key: event.key, id: event.id, type: event.type, title: event.title, poster: event.poster, count: 0, minutes: 0 };
    title.count++; title.minutes += event.minutes;
    day.titles.set(event.key, title);
  }
  return days;
}

/** Per-month totals for the last `months` months, oldest first, no gaps. */
export function diaryMonths(days, { months = 12, now = Date.now() } = {}) {
  const base = new Date(now);
  const out = [];
  for (let back = months - 1; back >= 0; back--) {
    const date = new Date(base.getFullYear(), base.getMonth() - back, 1);
    const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    const month = { key, label: date.toLocaleDateString(undefined, { month: 'short' }), year: date.getFullYear(), minutes: 0, filmMinutes: 0, tvMinutes: 0, items: 0, titles: new Map() };
    out.push(month);
  }
  const byKey = new Map(out.map(month => [month.key, month]));
  for (const day of days.values()) {
    const month = byKey.get(day.key.slice(0, 7));
    if (!month) continue;
    month.minutes += day.minutes;
    month.filmMinutes += day.filmMinutes || 0;
    month.tvMinutes += day.tvMinutes || 0;
    month.items += day.items;
    for (const title of day.titles.values()) {
      const held = month.titles.get(title.key) || { ...title, count: 0, minutes: 0 };
      held.count += title.count; held.minutes += title.minutes;
      month.titles.set(title.key, held);
    }
  }
  return out;
}

// A day with this many episodes watched is a binge day.
export const BINGE_EPISODES = 3;

const epOrder = point => point.season * 100000 + point.episode;

/** "S2 E5", "S2 E1–E5", or "S1 E8 – S2 E2" for the span of episodes watched. */
export function episodeSpan(first, last) {
  if (!first || !last) return '';
  if (first.season === last.season && first.episode === last.episode) return `S${first.season} E${first.episode}`;
  if (first.season === last.season) return `S${first.season} E${first.episode}–E${last.episode}`;
  return `S${first.season} E${first.episode} – S${last.season} E${last.episode}`;
}

/** TV figures for one month (`YYYY-MM`): totals, binge days, and every show ranked by episodes watched. */
export function diaryMonthTV(days, monthValue) {
  const shows = new Map();
  let episodes = 0, minutes = 0, marked = 0, activeDays = 0, bingeDays = 0;
  for (const day of days.values()) {
    if (!day.key.startsWith(monthValue)) continue;
    let dayEpisodes = 0;
    for (const event of day.events) {
      if (event.kind !== 'episode' && event.kind !== 'series') continue;
      if (event.bulk) { marked++; continue; }
      episodes++; dayEpisodes++;
      minutes += event.minutes;
      const show = shows.get(event.key) || { key: event.key, id: event.id, title: event.title, poster: event.poster, episodes: 0, minutes: 0, days: new Set(), first: null, last: null };
      show.episodes++;
      show.minutes += event.minutes;
      show.days.add(day.key);
      const point = { season: event.season, episode: event.episode };
      if (!show.first || epOrder(point) < epOrder(show.first)) show.first = point;
      if (!show.last || epOrder(point) > epOrder(show.last)) show.last = point;
      shows.set(event.key, show);
    }
    if (dayEpisodes) activeDays++;
    if (dayEpisodes >= BINGE_EPISODES) bingeDays++;
  }
  const list = [...shows.values()]
    .map(show => ({ ...show, days: show.days.size, span: episodeSpan(show.first, show.last) }))
    .sort((a, b) => b.episodes - a.episodes || b.minutes - a.minutes || a.title.localeCompare(b.title));
  return { episodes, minutes, marked, activeDays, bingeDays, shows: list };
}

/** Shade step 0-4 for a day's minutes against the busiest day in view. */
export function shadeStep(minutes, max) {
  if (!minutes || !max) return 0;
  const ratio = minutes / max;
  return ratio > .75 ? 4 : ratio > .5 ? 3 : ratio > .25 ? 2 : 1;
}

export const formatMinutes = minutes => {
  const total = Math.round(+minutes || 0);
  if (!total) return '0m';
  const hours = Math.floor(total / 60), rest = total % 60;
  return hours ? `${hours}h${rest ? ` ${rest}m` : ''}` : `${rest}m`;
};

const noonOf = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const shiftDay = (key, by) => { const date = noonOf(key); date.setDate(date.getDate() + by); return dayKey(date.getTime()); };

/** Pure: the longest run of consecutive day keys (sorted or not). */
export function longestRun(keys) {
  const sorted = [...new Set(keys)].sort();
  let longest = 0, run = 0, previous = '';
  for (const key of sorted) {
    run = previous && shiftDay(previous, 1) === key ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = key;
  }
  return longest;
}

/**
 * Pure: streaks of days with viewing (bulk marks do not count).
 * current: the run ending today, or ending yesterday while today is still empty.
 */
export function diaryStreaks(days, now = Date.now(), monthValue = '') {
  const active = [...days.values()].filter(day => day.items).map(day => day.key);
  const set = new Set(active);
  const today = dayKey(now);
  let cursor = set.has(today) ? today : shiftDay(today, -1);
  let current = 0;
  while (set.has(cursor)) { current++; cursor = shiftDay(cursor, -1); }
  return { current, longest: longestRun(active), month: monthValue ? longestRun(active.filter(key => key.startsWith(monthValue))) : 0 };
}

/**
 * Pure: what you watched on today's month and day in earlier years, newest year
 * first. Viewing only: bulk marks are bookkeeping, not a memory of that day.
 * Each title appears once per year, with how many episodes or viewings it had.
 */
export function onThisDay(events, now = Date.now()) {
  const today = new Date(now);
  const byYear = new Map();
  for (const event of events || []) {
    if (event.bulk) continue;
    const at = new Date(event.at);
    if (at.getMonth() !== today.getMonth() || at.getDate() !== today.getDate() || at.getFullYear() >= today.getFullYear()) continue;
    const year = at.getFullYear();
    if (!byYear.has(year)) byYear.set(year, new Map());
    const group = byYear.get(year);
    const held = group.get(event.key) || { key: event.key, id: event.id, type: event.type, title: event.title, poster: event.poster, episodes: 0, viewings: 0, last: null, at: event.at };
    if (event.kind === 'episode') { held.episodes++; held.last = { season: event.season, episode: event.episode }; } else held.viewings++;
    held.at = Math.min(held.at, event.at);
    group.set(event.key, held);
  }
  return [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([year, group]) => ({
    year, yearsAgo: today.getFullYear() - year,
    items: [...group.values()].sort((a, b) => a.at - b.at),
  }));
}

/** Pure: minutes and items by weekday (Monday first) for one month. */
export function diaryWeekdays(days, monthValue) {
  const out = Array.from({ length: 7 }, (_, index) => ({ index, minutes: 0, items: 0, days: 0 }));
  for (const day of days.values()) {
    if (!day.key.startsWith(monthValue) || !day.items) continue;
    const slot = out[(noonOf(day.key).getDay() + 6) % 7];
    slot.minutes += day.minutes; slot.items += day.items; slot.days++;
  }
  return out;
}

/** Pure: a month's totals (`YYYY-MM`). */
export function monthTotals(days, monthValue) {
  const totals = { minutes: 0, tv: 0, film: 0, items: 0, active: 0, busiest: null };
  for (const day of days.values()) {
    if (!day.key.startsWith(monthValue)) continue;
    totals.minutes += day.minutes; totals.tv += day.tvMinutes || 0; totals.film += day.filmMinutes || 0;
    totals.items += day.items; totals.active += day.items ? 1 : 0;
    if (day.minutes > (totals.busiest?.minutes || 0)) totals.busiest = day;
  }
  return totals;
}

const topTitles = titles => [...titles.values()].sort((a, b) => b.minutes - a.minutes || b.count - a.count);

// ---------- view state ----------
const view = { month: '', day: '', slide: '', tvOpen: '' };
// The streak step waiting to shimmer; remembered once the tile has been seen,
// so the same step never shimmers again.
const shimmer = { mark: '', key: '' };
function rememberShimmer() {
  try { if (shimmer.mark) localStorage.setItem(shimmer.key, shimmer.mark); } catch (_) {}
}

function model() {
  const events = diaryEvents({ watched: state.watched, episodeProgress: state.episodeProgress });
  return { events, days: diaryDays(events) };
}

export function diarySummary() {
  const { days } = model();
  const current = monthKey(Date.now());
  let minutes = 0, items = 0;
  for (const day of days.values()) if (day.key.startsWith(current)) { minutes += day.minutes; items += day.items; }
  return items ? `${items} watched this month · ${formatMinutes(minutes)}` : 'Your daily viewing, drawn as a calendar';
}

// ---------- markup ----------
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0].map(index => new Date(2024, 0, 7 + index).toLocaleDateString(undefined, { weekday: 'short' }));

function calendarHTML(days, monthValue, selected) {
  const [year, month] = monthValue.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const count = new Date(year, month, 0).getDate();
  const lead = (first.getDay() + 6) % 7;             // Monday first
  const today = dayKey(Date.now());
  const inMonth = [...days.values()].filter(day => day.key.startsWith(monthValue));
  const max = Math.max(0, ...inMonth.map(day => day.minutes));
  const best = max ? inMonth.find(day => day.minutes === max)?.key : '';
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="diary-cell pad" aria-hidden="true"></span>');
  for (let date = 1; date <= count; date++) {
    const key = `${monthValue}-${pad(date)}`;
    const day = days.get(key);
    const future = key > today;
    const step = day ? shadeStep(day.minutes, max) : 0;
    const titles = day ? topTitles(day.titles) : [];
    const fan = titles.slice(0, 3).map((title, index) => `<img style="--fan:${index}" src="${title.poster ? `${IMG}w92${title.poster}` : PH}" alt="" loading="lazy">`).join('');
    const extra = titles.length > 3 ? `<em>+${titles.length - 3}</em>` : '';
    const dateLabel = new Date(year, month - 1, date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    const summary = day && (day.items || day.marked)
      ? `${day.items ? `${day.items} watched, ${formatMinutes(day.minutes)}` : ''}${day.items && day.marked ? '; ' : ''}${day.marked ? `${day.marked} marked in bulk` : ''}${titles.length ? ` — ${titles.slice(0, 3).map(title => title.title).join(', ')}` : ''}`
      : 'nothing watched';
    cells.push(`<button class="diary-cell s${step}${key === today ? ' today' : ''}${key === selected ? ' selected' : ''}${future ? ' future' : ''}${key === best ? ' best' : ''}${day?.marked && !day.items ? ' marked-only' : ''}" data-action="diary-day" data-day="${key}" aria-pressed="${key === selected}" tabindex="${key === selected ? 0 : -1}" aria-label="${esc(`${dateLabel}: ${summary}${key === best ? ', your biggest day this month' : ''}`)}"${future ? ' disabled' : ''} data-tip="${esc(day?.items ? `${formatMinutes(day.minutes)} · ${titles.slice(0, 2).map(title => title.title).join(', ')}` : dateLabel)}" style="--d:${date}">
      <b>${date}${key === best ? `<i class="diary-best" aria-hidden="true">${icon('starSolid')}</i>` : ''}</b>${fan ? `<span class="diary-fan">${fan}${extra}</span>` : ''}${day?.items ? `<small>${formatMinutes(day.minutes)}</small>` : ''}
    </button>`);
  }
  return `<div class="diary-weekdays" aria-hidden="true">${WEEKDAYS.map(name => `<span>${esc(name)}</span>`).join('')}</div>
    <div class="diary-grid${view.slide ? ` slide-${view.slide}` : ''}" role="group" aria-label="${esc(`${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}. Arrow keys move between days, Page Up and Page Down between months.`)}">${cells.join('')}</div>
    <div class="diary-legend" aria-hidden="true"><span>Less</span>${[0, 1, 2, 3, 4].map(step => `<i class="s${step}"></i>`).join('')}<span>More</span><small>shaded by minutes watched</small></div>
    <div class="diary-keys" aria-hidden="true">
      <span><i class="diary-key-star">${icon('starSolid')}</i>Biggest day</span>
      <span><i class="diary-key-dot"></i>Marked in bulk only</span>
      <span><i class="diary-key-today"></i>Today</span>
    </div>`;
}

const timeOf = at => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function reelHTML(day, key) {
  const date = new Date(`${key}T12:00:00`);
  const heading = date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (!day || !day.events.length) {
    return `<div class="diary-reel empty"><span class="diary-kicker">Day reel</span><h3>${esc(heading)}</h3><p>Nothing watched this day. Pick a shaded day on the calendar.</p></div>`;
  }
  const viewing = day.events.filter(event => !event.bulk);
  const marked = day.events.filter(event => event.bulk);
  // Markers sit at their time of day; ones that would collide are dropped into
  // the next lane instead of overlapping.
  const lanes = [];
  const markers = viewing.map(event => {
    const d = new Date(event.at);
    const position = ((d.getHours() * 60 + d.getMinutes()) / 1440) * 100;
    let lane = lanes.findIndex(last => position - last > 7);
    if (lane < 0) { lane = lanes.length; lanes.push(position); } else lanes[lane] = position;
    const label = event.kind === 'episode' ? `S${event.season} E${event.episode}` : event.rewatch ? 'Rewatch' : 'Film';
    return `<a class="diary-marker" style="--at:${position.toFixed(2)}%;--lane:${lane}" href="/${event.type}/${event.id}" data-action="open-detail" data-id="${event.id}" data-type="${event.type}" data-tip="${esc(`${timeOf(event.at)} · ${event.title} · ${label}`)}" aria-label="${esc(`${timeOf(event.at)}, ${event.title}, ${label}`)}"><img src="${event.poster ? `${IMG}w92${event.poster}` : PH}" alt="" loading="lazy"></a>`;
  }).join('');
  const laneCount = Math.max(1, lanes.length);
  const hours = [0, 6, 12, 18, 24].map(hour => `<span style="--at:${hour / 24 * 100}%">${hour === 24 ? '' : new Date(2024, 0, 1, hour).toLocaleTimeString(undefined, { hour: 'numeric' })}</span>`).join('');
  const rows = day.events.map(event => `<li class="${event.bulk ? 'bulk' : ''}">
      <time>${esc(timeOf(event.at))}</time>
      <img src="${event.poster ? `${IMG}w92${event.poster}` : PH}" alt="" loading="lazy">
      <a href="/${event.type}/${event.id}" data-action="open-detail" data-id="${event.id}" data-type="${event.type}">${esc(event.title)}</a>
      <span>${event.kind === 'episode' ? `S${event.season} E${event.episode}` : event.kind === 'series' ? 'Series marked watched' : event.rewatch ? 'Film · rewatch' : 'Film'}${event.bulk && event.kind === 'episode' ? ' · marked in bulk' : ''}</span>
      <b>${event.minutes ? formatMinutes(event.minutes) : '—'}</b>
    </li>`).join('');
  const parts = [day.films ? `${day.films} film${day.films === 1 ? '' : 's'}` : '', day.episodes ? `${day.episodes} episode${day.episodes === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
  return `<div class="diary-reel">
    <span class="diary-kicker">Day reel</span>
    <h3>${esc(heading)}</h3>
    <p class="diary-reel-sum">${viewing.length ? `<b>${formatMinutes(day.minutes)}</b> · ${esc(parts)}` : 'No viewing'}${marked.length ? ` · ${marked.length} marked in bulk` : ''}</p>
    ${viewing.length ? `<div class="diary-ribbon" style="--lanes:${laneCount}" role="img" aria-label="${esc(`When you watched on ${heading}`)}"><div class="diary-ribbon-track"><i class="night a"></i><i class="night b"></i>${markers}</div><div class="diary-ribbon-hours">${hours}</div></div>` : ''}
    <ol class="diary-list">${rows}</ol>
  </div>`;
}

function yearHTML(days, monthValue) {
  const months = diaryMonths(days, { months: 12 });
  const max = Math.max(1, ...months.map(month => month.minutes));
  return `<div class="diary-year" role="group" aria-label="Hours watched per month, last 12 months">${months.map(month => {
    const lead = topTitles(month.titles)[0];
    const height = month.minutes ? Math.max(6, Math.round(month.minutes / max * 100)) : 0;
    const name = new Date(`${month.key}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const split = month.minutes ? ` (${formatMinutes(month.tvMinutes)} TV, ${formatMinutes(month.filmMinutes)} films)` : '';
    // Stacked: TV at the base, films above, a 2px gap between them. A title with
    // no reported runtime adds no height, so a split can only show known time.
    const segments = month.minutes
      ? `${month.filmMinutes ? `<i class="film" style="flex:${month.filmMinutes}"></i>` : ''}${month.tvMinutes ? `<i class="tv" style="flex:${month.tvMinutes}"></i>` : ''}`
      : '';
    return `<button class="diary-month${month.key === monthValue ? ' active' : ''}" data-action="diary-month-pick" data-month="${month.key}" aria-pressed="${month.key === monthValue}" aria-label="${esc(`${name}: ${formatMinutes(month.minutes)}${split} across ${month.items} watched${lead ? `, most of all ${lead.title}` : ''}`)}" data-tip="${esc(`${name} · ${month.minutes ? `${formatMinutes(month.minutes)}${split}` : 'nothing watched'}${lead ? ` · ${lead.title}` : ''}`)}">
      <span class="diary-month-bar"><span class="diary-month-fill" style="--h:${height}%">${segments}${lead?.poster ? `<img src="${IMG}w92${lead.poster}" alt="" loading="lazy">` : ''}</span></span>
      <b>${month.minutes ? formatMinutes(month.minutes) : ''}</b>
      <span>${esc(month.label)}</span>
    </button>`;
  }).join('')}</div>
    <div class="diary-year-legend" aria-hidden="true"><span><i class="film"></i>Films</span><span><i class="tv"></i>TV</span></div>`;
}

const WEEKDAY_LONG = [1, 2, 3, 4, 5, 6, 0].map(index => new Date(2024, 0, 7 + index).toLocaleDateString(undefined, { weekday: 'long' }));

function weekHTML(days, monthValue, monthName) {
  const week = diaryWeekdays(days, monthValue);
  const streaks = diaryStreaks(days, Date.now(), monthValue);
  // The Streak tile shimmers once when today's viewing has just made the run
  // longer: remembered per device as "today:length", so it plays once a step.
  const today = dayKey(Date.now());
  // It stays pending across redraws until the tile has actually been on screen.
  let grew = false;
  if (streaks.current && days.get(today)?.items) {
    const mark = `${today}:${streaks.current}`, key = `cv_streak_seen_v1_${state.user?.uid || 'guest'}`;
    try { if (localStorage.getItem(key) !== mark) { grew = true; shimmer.mark = mark; shimmer.key = key; } } catch (_) {}
  }
  const byMinutes = week.some(slot => slot.minutes);
  const value = slot => (byMinutes ? slot.minutes : slot.items);
  const top = Math.max(0, ...week.map(value));
  const peak = top ? week.find(slot => value(slot) === top) : null;
  const bars = week.map(slot => {
    const share = top ? Math.max(value(slot) ? 6 : 0, Math.round(value(slot) / top * 100)) : 0;
    const label = `${WEEKDAY_LONG[slot.index]}s: ${byMinutes ? formatMinutes(slot.minutes) : `${slot.items} watched`}`;
    return `<li class="${peak === slot ? 'peak' : ''}" aria-label="${esc(label)}" style="--i:${slot.index}"><span class="diary-week-bar"><i style="--h:${share}%"></i></span><small>${esc(WEEKDAYS[slot.index].slice(0, 2))}</small></li>`;
  }).join('');
  return `<div class="diary-week">
    <div class="diary-week-head"><span class="diary-kicker">Your week</span><p>${peak ? `Most on <b>${esc(WEEKDAY_LONG[peak.index])}s</b> in ${esc(monthName.split(' ')[0])}` : `Nothing watched in ${esc(monthName)} yet`}</p></div>
    <ol class="diary-week-bars" aria-label="${esc(`Viewing by weekday in ${monthName}`)}">${bars}</ol>
    <div class="diary-streaks">
      <div class="${streaks.current ? 'live' : ''}${grew ? ' grew' : ''}"><span>Streak</span><strong>${streaks.current}<small> day${streaks.current === 1 ? '' : 's'}</small></strong></div>
      <div><span>Month best</span><strong>${streaks.month}<small> day${streaks.month === 1 ? '' : 's'}</small></strong></div>
      <div><span>Best ever</span><strong>${streaks.longest}<small> day${streaks.longest === 1 ? '' : 's'}</small></strong></div>
    </div>
  </div>`;
}

function tvHTML(days, monthValue, monthName) {
  const tv = diaryMonthTV(days, monthValue);
  const note = tv.marked ? `<small>${tv.marked} more marked in bulk, not counted</small>` : '';
  if (!tv.episodes) {
    return `<div class="diary-tv"><div class="diary-tv-head"><span class="diary-kicker">TV this month</span>${note}</div><p class="diary-tv-empty">No episodes watched in ${esc(monthName)}.</p></div>`;
  }
  // Bars measure episodes, the one unit every show has; time is the figure beside
  // them, and a show with no reported runtime shows a dash rather than a guess.
  const top = Math.max(1, ...tv.shows.map(show => show.episodes));
  // More than six shows fold behind "Show all", remembered for the month in view.
  const fold = tv.shows.length > 6;
  const open = fold && view.tvOpen === monthValue;
  const rows = tv.shows.map((show, index) => {
    const share = Math.max(4, Math.round(show.episodes / top * 100));
    const detail = `${show.span} · ${show.episodes} episode${show.episodes === 1 ? '' : 's'} · ${show.days} day${show.days === 1 ? '' : 's'}`;
    return `<li${index >= 6 ? ' class="extra"' : ''}>
      <img src="${show.poster ? `${IMG}w92${show.poster}` : PH}" alt="" loading="lazy">
      <div>
        <a href="/tv/${show.id}" data-action="open-detail" data-id="${show.id}" data-type="tv">${esc(show.title)}</a>
        <span>${esc(detail)}</span>
        <i class="diary-tv-bar" aria-hidden="true"><b style="--w:${share}%"></b></i>
      </div>
      <strong>${show.minutes ? formatMinutes(show.minutes) : '—'}</strong>
    </li>`;
  }).join('');
  return `<div class="diary-tv">
    <div class="diary-tv-head"><span class="diary-kicker">TV this month</span>${note}</div>
    <div class="diary-tv-tiles">
      <div><span>Episodes</span><strong>${tv.episodes}</strong></div>
      <div><span>TV time</span><strong>${formatMinutes(tv.minutes)}</strong></div>
      <div><span>Shows</span><strong>${tv.shows.length}</strong></div>
      <div><span>Days with TV</span><strong>${tv.activeDays}</strong></div>
      <div><span>Binge days</span><strong>${tv.bingeDays}</strong><small>${BINGE_EPISODES}+ episodes</small></div>
    </div>
    <ol class="diary-tv-shows${fold && !open ? ' collapsed' : ''}" id="diaryTvShows" aria-label="${esc(`Shows watched in ${monthName}, most episodes first`)}">${rows}</ol>
    ${fold ? `<button type="button" class="diary-tv-more" data-action="diary-tv-more" aria-expanded="${open}" aria-controls="diaryTvShows" data-more="${esc(`Show all ${tv.shows.length} shows`)}"><span>${open ? 'Show fewer' : esc(`Show all ${tv.shows.length} shows`)}</span>${icon('chevronDown')}</button>` : ''}
  </div>`;
}

function onThisDayHTML(events) {
  const memories = onThisDay(events);
  if (!memories.length) return '';
  const heading = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  const years = memories.map((memory, index) => `<li class="diary-otd-year" style="--i:${index}">
      <div class="diary-otd-when"><b>${memory.yearsAgo === 1 ? '1 year ago' : `${memory.yearsAgo} years ago`}</b><small>${memory.year}</small></div>
      <ul>${memory.items.slice(0, 6).map(item => {
        const note = item.episodes === 1 && item.last ? `S${item.last.season} E${item.last.episode}` : item.episodes ? `${item.episodes} episodes` : item.viewings > 1 ? `${item.viewings} viewings` : 'Film';
        return `<li><a href="/${item.type}/${item.id}" data-action="open-detail" data-id="${item.id}" data-type="${item.type}" aria-label="${esc(`${item.title}, ${note}, ${memory.year}`)}"><img src="${item.poster ? `${IMG}w185${item.poster}` : PH}" alt="" loading="lazy"><span><b>${esc(item.title)}</b><small>${esc(note)}</small></span></a></li>`;
      }).join('')}${memory.items.length > 6 ? `<li class="diary-otd-more">+${memory.items.length - 6}</li>` : ''}</ul>
    </li>`).join('');
  return `<section class="diary-otd" aria-label="${esc(`On this day, ${heading}, in earlier years`)}">
    <div class="diary-otd-head"><span class="diary-kicker">On this day</span><h4>${esc(heading)}</h4></div>
    <ol class="diary-otd-years">${years}</ol>
  </section>`;
}

function bodyHTML() {
  const { days, events } = model();
  const current = monthKey(Date.now());
  if (!view.month) view.month = current;
  // Default day: the latest day with anything on it in the shown month.
  if (!view.day || !view.day.startsWith(view.month)) {
    const keys = [...days.keys()].filter(key => key.startsWith(view.month)).sort();
    view.day = keys.length ? keys[keys.length - 1] : (view.month === current ? dayKey(Date.now()) : `${view.month}-01`);
  }
  const [year, month] = view.month.split('-').map(Number);
  const monthName = new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const totals = monthTotals(days, view.month);
  const previousKey = shiftMonth(view.month, -1);
  const previous = monthTotals(days, previousKey);
  const previousName = new Date(`${previousKey}-15T12:00:00`).toLocaleDateString(undefined, { month: 'short' });
  const busiest = totals.busiest;
  const diff = totals.minutes - previous.minutes;
  const change = previous.minutes || totals.minutes
    ? `<em class="diary-change ${diff > 0 ? 'up' : diff < 0 ? 'down' : 'same'}">${diff ? `${diff > 0 ? '+' : '−'}${formatMinutes(Math.abs(diff))}` : 'Same'} vs ${esc(previousName)}</em>`
    : '';
  return `<div class="diary-top">
      <div class="diary-switch">
        <button data-action="diary-month" data-dir="-1" aria-label="Previous month">${icon('chevronRight', { cls: 'flip' })}</button>
        <h3 aria-live="polite">${esc(monthName)}</h3>
        <button data-action="diary-month" data-dir="1" aria-label="Next month"${view.month >= current ? ' disabled' : ''}>${icon('chevronRight')}</button>
        ${view.month !== current ? '<button class="diary-today" data-action="diary-today">This month</button>' : ''}
      </div>
      <div class="diary-tiles">
        <div><span>Watched</span><strong>${formatMinutes(totals.minutes)}</strong>${totals.minutes ? `<small>${formatMinutes(totals.tv)} TV · ${formatMinutes(totals.film)} films</small>` : ''}${change}</div>
        <div><span>Titles &amp; episodes</span><strong>${totals.items}</strong></div>
        <div><span>Days with viewing</span><strong>${totals.active}</strong></div>
        ${busiest?.minutes
          ? `<button class="diary-tile-link" data-action="diary-day" data-day="${busiest.key}" aria-label="${esc(`Biggest day: ${new Date(`${busiest.key}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}, ${formatMinutes(busiest.minutes)}. Open it.`)}"><span>Biggest day</span><strong>${esc(new Date(`${busiest.key}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}</strong><small>${formatMinutes(busiest.minutes)}</small></button>`
          : '<div><span>Biggest day</span><strong>—</strong></div>'}
      </div>
    </div>
    ${onThisDayHTML(events)}
    <div class="diary-layout">
      <div class="diary-calendar">${calendarHTML(days, view.month, view.day)}</div>
      <div class="diary-side">
        ${reelHTML(days.get(view.day), view.day)}
        ${weekHTML(days, view.month, monthName)}
      </div>
    </div>
    ${tvHTML(days, view.month, monthName)}
    <div class="diary-year-wrap"><span class="diary-kicker">Last 12 months</span>${yearHTML(days, view.month)}</div>`;
}

// The 12-month strip scrolls sideways on a phone: keep the month in view on screen.
// A Streak tile that grew today shimmers once it is actually on screen.
let shimmerWatch = null;
function settle() {
  requestAnimationFrame(() => {
    document.querySelectorAll('.diary-streaks .grew:not(.shine)').forEach(tile => {
      if (!('IntersectionObserver' in window)) { tile.classList.add('shine'); rememberShimmer(); return; }
      shimmerWatch ||= new IntersectionObserver(entries => entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        shimmerWatch.unobserve(entry.target);
        if (!entry.target.isConnected) return;
        entry.target.classList.add('shine');
        rememberShimmer();
      }), { threshold: 0.6 });
      shimmerWatch.observe(tile);
    });
    document.querySelectorAll('.diary-year').forEach(strip => {
      const active = strip.querySelector('.diary-month.active');
      if (!active || strip.scrollWidth <= strip.clientWidth + 1) return;
      strip.scrollLeft = Math.max(0, active.offsetLeft - strip.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2);
    });
  });
}

export function diaryPanel() {
  settle();
  return `<section class="stats-panel watch-diary">
    <div class="stats-section-head"><div><span>Daily &amp; monthly</span><h2>Watch Diary</h2><p>Every film and episode on the day you watched it, with a month of TV at a glance. Days are shaded by minutes watched; whole seasons marked at once are listed, never counted as viewing.</p></div></div>
    <div id="diaryRoot" class="animate">${bodyHTML()}</div>
  </section>`;
}

// Bars grow and the calendar slides only when the month changes, not on every day picked.
function repaint(focusDay = false, animate = false) {
  const root = $('diaryRoot');
  if (!root) return;
  root.classList.toggle('animate', animate);
  root.innerHTML = bodyHTML();
  view.slide = '';
  settle();
  if (focusDay) root.querySelector(`.diary-cell[data-day="${view.day}"]`)?.focus({ preventScroll: true });
}

function goMonth(next, { day = '', focusDay = false } = {}) {
  const current = monthKey(Date.now());
  if (!next || next > current) return false;
  const from = view.month || current;
  if (next !== from) view.slide = next > from ? 'next' : 'prev';
  const changed = next !== from;
  view.month = next; view.day = day;
  repaint(focusDay, changed);
  return true;
}

const shiftMonth = (value, by) => {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(year, month - 1 + by, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
};

export function initDiary() {
  registerActions({
    'diary-day': el => {
      const key = el.dataset.day;
      if (!key) return;
      if (!key.startsWith(view.month)) { goMonth(key.slice(0, 7), { day: key, focusDay: true }); return; }
      view.day = key; repaint(true);
    },
    'diary-month': el => goMonth(shiftMonth(view.month || monthKey(Date.now()), +el.dataset.dir || 0)),
    'diary-month-pick': el => goMonth(el.dataset.month),
    'diary-today': () => goMonth(monthKey(Date.now()), { day: dayKey(Date.now()) }),
    'diary-tv-more': el => {
      const list = $('diaryTvShows');
      if (!list) return;
      const open = list.classList.contains('collapsed');
      list.classList.toggle('collapsed', !open);
      view.tvOpen = open ? view.month : '';
      el.setAttribute('aria-expanded', String(open));
      el.querySelector('span').textContent = open ? 'Show fewer' : el.dataset.more;
      if (!open) list.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
  });

  // Keyboard: the calendar is one tab stop; arrows move a day or a week,
  // Page Up / Page Down a month. Future days are skipped over.
  document.addEventListener('keydown', event => {
    const cell = event.target.closest?.('.diary-cell[data-day]');
    if (!cell) return;
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let key = '';
    if (steps[event.key]) key = shiftDay(cell.dataset.day, steps[event.key]);
    else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const month = shiftMonth(cell.dataset.day.slice(0, 7), event.key === 'PageUp' ? -1 : 1);
      const [y, m] = month.split('-').map(Number);
      const last = new Date(y, m, 0).getDate();
      key = `${month}-${pad(Math.min(+cell.dataset.day.slice(8), last))}`;
    } else return;
    event.preventDefault();
    const today = dayKey(Date.now());
    if (key > today) key = today;
    if (key === cell.dataset.day) return;
    if (key.startsWith(view.month)) { view.day = key; repaint(true); } else goMonth(key.slice(0, 7), { day: key, focusDay: true });
  });

  // Touch: swipe the calendar sideways to change month.
  let swipe = null;
  document.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' || !event.target.closest?.('.diary-calendar')) { swipe = null; return; }
    swipe = { x: event.clientX, y: event.clientY, at: performance.now() };
  }, { passive: true });
  document.addEventListener('pointerup', event => {
    if (!swipe || event.pointerType !== 'touch') return;
    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y, quick = performance.now() - swipe.at < 700;
    swipe = null;
    if (!quick || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    goMonth(shiftMonth(view.month || monthKey(Date.now()), dx < 0 ? 1 : -1));
  }, { passive: true });
  document.addEventListener('pointercancel', () => { swipe = null; }, { passive: true });
  document.addEventListener('cv:auth', () => { view.month = ''; view.day = ''; });
}
