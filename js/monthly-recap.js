// ===== MONTHLY RECAP =====
// On the 1st of every month the notification centre gains one card: last
// month's films and the series you finished, with the time and a poster fan.
// It stays in the inbox for the rest of the month and is replaced by the next
// one. Everything is derived on the device from your watched history and the
// Completed series shelf, so there is nothing to fetch and nothing to store.
//
// The same rules as the year cards (js/films-year.js, js/series-year.js): each
// dated viewing of a film counts in its own month, a series belongs to the
// month its last episode was marked, and adult titles never appear.
import { filmsYear, viewingDates } from './films-year.js';
import { formatDuration } from './season-recap.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = value => String(value).padStart(2, '0');
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Pure: the month a recap shown at `now` is about (the previous calendar month, local time). */
export function recapMonth(now = Date.now()) {
  const date = new Date(now);
  const year = date.getMonth() === 0 ? date.getFullYear() - 1 : date.getFullYear();
  const month = date.getMonth() === 0 ? 11 : date.getMonth() - 1;
  return { year, month, name: MONTHS[month] };
}

/**
 * Pure: last month's films and finished series.
 * @param {{ watched, ratings, finished, exclude, now }} sources
 *   finished: Completed shelf rows ({ id, title, poster, finishedAt, entry })
 *   exclude: (key like "movie_1" / "tv_1") => boolean
 */
export function monthRecap({ watched = {}, ratings = {}, finished = [], exclude = () => false, now = Date.now() } = {}) {
  const { year, month, name } = recapMonth(now);
  const inMonth = at => { const date = new Date(at); return date.getFullYear() === year && date.getMonth() === month; };
  // A film's viewings from other months are trimmed away; its plays and minutes are this month's.
  const yearFilms = filmsYear(watched, year, { ratings, exclude }).films;
  const films = [];
  for (const film of yearFilms) {
    const perPlay = film.plays ? film.minutes / film.plays : 0;
    const dates = viewingDates(watched[film.key]).filter(inMonth);
    if (!dates.length) continue;
    films.push({ ...film, plays: dates.length, first: Math.min(...dates), minutes: Math.round(perPlay * dates.length) });
  }
  films.sort((a, b) => b.rating - a.rating || a.first - b.first || a.title.localeCompare(b.title));
  const series = (finished || [])
    .filter(show => show.finishedAt && inMonth(show.finishedAt) && !exclude(`tv_${show.id}`))
    .sort((a, b) => a.finishedAt - b.finishedAt);
  const minutes = films.reduce((sum, film) => sum + film.minutes, 0);
  return {
    year, month, name, films, series, minutes,
    plays: films.reduce((sum, film) => sum + film.plays, 0),
    count: films.length + series.length,
  };
}

/** Pure: the notification event for a recap, or null when last month was empty. */
export function recapEvent(recap, now = Date.now()) {
  if (!recap?.count) return null;
  const date = new Date(now);
  const arrived = new Date(date.getFullYear(), date.getMonth(), 1);
  const parts = [];
  if (recap.films.length) parts.push(plural(recap.films.length, 'film'));
  if (recap.series.length) parts.push(`${recap.series.length} finished series`);
  const details = [];
  if (recap.minutes) details.push(`${formatDuration(recap.minutes)} of films`);
  if (recap.plays > recap.films.length) details.push(`${plural(recap.plays, 'viewing')} with rewatches`);
  const top = recap.films.find(film => film.rating > 0);
  if (top) details.push(`Top rated: ${top.title} (${top.rating}/10)`);
  if (recap.series.length) details.push(`Finished ${recap.series.slice(0, 2).map(show => show.title).join(' and ')}${recap.series.length > 2 ? ` +${recap.series.length - 2}` : ''}`);
  const posters = [...recap.films, ...recap.series].map(item => item.poster).filter(Boolean).slice(0, 4);
  return {
    key: `recap_${recap.year}_${pad(recap.month + 1)}`, category: 'recap', id: recap.year, mediaType: 'year',
    title: `Your ${recap.name} recap`, headline: parts.join(' and '),
    detail: details.join(' · ') || `What you watched in ${recap.name}`,
    date: `${arrived.getFullYear()}-${pad(arrived.getMonth() + 1)}-01`, airstamp: arrived.toISOString(),
    poster: posters[0] || '', posters, source: 'Monthly recap',
    path: `/year/${recap.year}?month=${recap.month + 1}`,
    // Only the 1st itself may raise a desktop alert; later in the month it just waits in the inbox.
    alertable: date.getDate() === 1,
    recap: { films: recap.films.length, series: recap.series.length, minutes: recap.minutes, month: recap.name },
  };
}
