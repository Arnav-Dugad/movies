// ===== YEAR IN FILMS =====
// The film half of the year cards, built from your watched history: how many
// films you watched in a year, how many viewings that was with rewatches, the
// hours, your top-rated film, your leading genre and the film you went back to
// most (or the director you watched most), a wall of the year's films (your
// highest rated first), and a bar for each month of viewings.
//
// Honest by construction:
//   - A viewing belongs to the year it happened: each dated play of a film
//     counts in its own year, so a 2024 favourite rewatched in 2026 counts once
//     in each. A film with no play dates counts on the day it was marked.
//   - Hours are each film's runtime times its viewings that year; films with no
//     runtime add viewings but no time, and the card says "from known runtimes".
//   - Adult titles never appear on a card meant for sharing.
// Drawing: js/year-card.js.
import { state } from './state.js';
import { genreMap } from './config.js';
import { registerActions } from './events.js';
import { firstPlayMs } from './rewatch.js';
import { formatDuration } from './season-recap.js';
import { openShareStudio } from './media.js';
import { cardTimeline, groundCanvas, posterBitmaps, drawHeadline, drawTiles, drawWall, drawMonths, studioResult } from './year-card.js';

/** Pure: every dated viewing of a watched entry, oldest first. */
export function viewingDates(entry) {
  const stored = Array.isArray(entry?.playDates) ? entry.playDates.map(Number).filter(at => at > 0) : [];
  if (stored.length) return [...stored].sort((a, b) => a - b);
  const first = firstPlayMs(entry);
  return first ? [first] : [];
}

/**
 * Pure: a year's films.
 * @param {object} watched  state.watched (keys like "movie_27205")
 * @param {number} year
 * @param {{ ratings?: object, exclude?: (key) => boolean }} options
 */
export function filmsYear(watched, year, { ratings = {}, exclude = () => false } = {}) {
  const films = [];
  const byMonth = Array.from({ length: 12 }, () => 0);
  for (const [key, entry] of Object.entries(watched || {})) {
    if (!key.startsWith('movie_') || !entry || exclude(key)) continue;
    const dates = viewingDates(entry).filter(at => new Date(at).getFullYear() === +year);
    if (!dates.length) continue;
    for (const at of dates) byMonth[new Date(at).getMonth()]++;
    const runtime = +entry.runtime > 0 && +entry.runtime < 1000 ? +entry.runtime : 0;
    films.push({
      key, id: +key.slice(6), title: entry.title || 'Untitled', poster: entry.poster || '',
      plays: dates.length, first: dates[0], minutes: runtime * dates.length, hasRuntime: runtime > 0,
      rating: +ratings[key] || 0, genres: (entry.genres || []).map(Number), director: entry.director || '',
    });
  }
  films.sort((a, b) => a.first - b.first || a.title.localeCompare(b.title));
  const genres = new Map(), directors = new Map();
  for (const film of films) {
    for (const genre of film.genres) if (genreMap[genre]) genres.set(genre, (genres.get(genre) || 0) + 1);
    if (film.director) directors.set(film.director, (directors.get(film.director) || 0) + 1);
  }
  const lead = (map, name) => [...map.entries()].sort((a, b) => b[1] - a[1] || String(name(a[0])).localeCompare(String(name(b[0]))))[0] || null;
  const genre = lead(genres, id => genreMap[id]);
  const director = lead(directors, value => value);
  const rated = films.filter(film => film.rating > 0);
  const topRated = [...rated].sort((a, b) => b.rating - a.rating || b.plays - a.plays || a.first - b.first)[0] || null;
  const rewatched = [...films].filter(film => film.plays > 1).sort((a, b) => b.plays - a.plays || b.rating - a.rating || a.first - b.first)[0] || null;
  // The wall: your highest rated first, then the rest in the order you watched them.
  const wall = [...films].sort((a, b) => b.rating - a.rating || a.first - b.first).slice(0, 12);
  return {
    year: +year, films, count: films.length, byMonth, wall,
    plays: films.reduce((sum, film) => sum + film.plays, 0),
    minutes: films.reduce((sum, film) => sum + film.minutes, 0),
    allRuntimes: films.every(film => film.hasRuntime),
    genre: genre ? { name: genreMap[genre[0]], count: genre[1] } : null,
    director: director && director[1] >= 2 ? { name: director[0], count: director[1] } : null,
    topRated, rewatched,
  };
}

/** Pure: the years with at least one viewing of a film, newest first. */
export function filmYears(watched, { exclude = () => false } = {}) {
  const years = new Set();
  for (const [key, entry] of Object.entries(watched || {})) {
    if (!key.startsWith('movie_') || !entry || exclude(key)) continue;
    for (const at of viewingDates(entry)) years.add(new Date(at).getFullYear());
  }
  return [...years].sort((a, b) => b - a);
}

/** Pure: the card's four figure tiles. */
export function filmTiles(summary) {
  const tiles = [];
  if (summary.minutes) tiles.push(['Watch time', formatDuration(summary.minutes), summary.allRuntimes ? `across ${summary.plays} viewing${summary.plays === 1 ? '' : 's'}` : 'from known runtimes']);
  else tiles.push(['Viewings', String(summary.plays), 'rewatches included']);
  if (summary.topRated) tiles.push(['Top rated', `${summary.topRated.rating}/10`, summary.topRated.title]);
  if (summary.genre) tiles.push(['Favourite genre', summary.genre.name, `${summary.genre.count} film${summary.genre.count === 1 ? '' : 's'}`]);
  if (summary.rewatched) tiles.push(['Most rewatched', `${summary.rewatched.plays}×`, summary.rewatched.title]);
  else if (summary.director) tiles.push(['Most watched director', summary.director.name, `${summary.director.count} films`]);
  if (tiles.length < 4 && summary.minutes && summary.plays > summary.count) tiles.push(['Viewings', String(summary.plays), 'rewatches included']);
  return tiles.slice(0, 4);
}

/** Pure: when each part of the card arrives (ms). */
export const filmTimeline = summary => cardTimeline(summary.wall.length);

const filmLine = summary => (summary.plays > summary.count ? `${summary.plays} viewings with rewatches` : `watched in ${summary.year}`);

/** The card's drawing for a year summary: `draw(ctx, time)`, its timeline and a closer. */
export async function filmsCardArt(summary) {
  const { posters, close } = await posterBitmaps(summary.wall);
  const ground = groundCanvas({ label: `${summary.year} IN FILMS`, glow: ['rgba(14,165,233,.28)', 'rgba(229,9,20,.12)'] });
  const plan = filmTimeline(summary);
  const tiles = filmTiles(summary);
  const line = filmLine(summary);
  const draw = (ctx, time) => {
    ctx.clearRect(0, 0, ground.width, ground.height);
    ctx.drawImage(ground, 0, 0);
    drawHeadline(ctx, time, plan, { count: summary.count, noun: summary.count === 1 ? 'film' : 'films', line });
    drawTiles(ctx, tiles, time, plan);
    const twoRows = drawWall(ctx, summary.wall, posters, time, plan);
    drawMonths(ctx, summary.byMonth, time, plan, { tall: !twoRows });
  };
  return { draw, plan, close };
}

/** Open the share studio with a year's film card. */
export function openFilmsYear(year, { exclude = () => false } = {}) {
  const summary = filmsYear(state.watched, year, { ratings: state.ratings, exclude });
  if (!summary.count) return;
  const title = `${year} in films`;
  return openShareStudio({
    title,
    url: `${location.origin}/profile`,
    copy: {
      eyebrow: 'Your year at the movies', heading: `${year} in Films`,
      lede: 'Every film you watched this year, your favourites first, month by month.',
      preparing: 'Gathering your year…', ready: 'Ready to share · No plot details included.',
      failed: 'Could not draw your year. Try again in a moment.',
      shareText: `I watched ${summary.count} films in ${year} — my year on CineVerse`, copied: 'Link copied', alt: 'Year in films card:',
    },
    build: async () => {
      const { draw, plan, close } = await filmsCardArt(summary);
      return studioResult({ title, draw, end: plan.end, close });
    },
  });
}

export function initFilmsYear({ exclude } = {}) {
  registerActions({
    'films-year': el => openFilmsYear(+el.dataset.year, { exclude }),
  });
}
