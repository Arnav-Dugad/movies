// ===== SERIES FINISHED THIS YEAR =====
// A year-end card built from the Completed series shelf: how many series you
// finished in a year, the episodes and time across those runs, your fastest
// finish and your biggest run, a wall of their posters, and a bar for each month
// showing when you finished them. Like the finale card, it assembles itself in
// the share studio and shares its final frame (drawing: js/year-card.js).
//
// A series belongs to the year its last episode was marked (its finish date on
// the shelf). Episodes and time are for each whole run, which may have started
// in an earlier year; the card says "across those runs". "Fastest finish" counts
// only runs watched as viewing (see viewingLog), so a show marked in one press
// never wins it.
import { registerActions } from './events.js';
import { seriesRecap } from './series-finale.js';
import { formatDuration } from './season-recap.js';
import { openShareStudio } from './media.js';
import { cardTimeline, groundCanvas, posterBitmaps, drawHeadline, drawTiles, drawWall, drawMonths, studioResult } from './year-card.js';

/**
 * Pure: a year's finished series.
 * @param {{ id, title, poster, finishedAt, entry }[]} finished  shelf rows with their progress entries
 */
export function seriesYear(finished, year) {
  const shows = (finished || [])
    .filter(show => show.finishedAt && new Date(show.finishedAt).getFullYear() === +year)
    .map(show => {
      const recap = seriesRecap(show.entry || {}, {});
      return { id: show.id, title: show.title, poster: show.poster || '', finishedAt: show.finishedAt, episodes: recap.episodes, minutes: recap.minutes, spanDays: recap.spanDays, paced: !recap.marked && recap.viewingEpisodes >= 2 };
    })
    .sort((a, b) => a.finishedAt - b.finishedAt);
  const byMonth = Array.from({ length: 12 }, () => 0);
  for (const show of shows) byMonth[new Date(show.finishedAt).getMonth()]++;
  const fastest = shows.filter(show => show.paced && show.spanDays > 0)
    .sort((a, b) => a.spanDays - b.spanDays || b.episodes - a.episodes || a.title.localeCompare(b.title))[0] || null;
  const biggest = [...shows].sort((a, b) => b.episodes - a.episodes || a.title.localeCompare(b.title))[0] || null;
  return {
    year: +year, shows, count: shows.length, byMonth,
    episodes: shows.reduce((sum, show) => sum + show.episodes, 0),
    minutes: shows.reduce((sum, show) => sum + show.minutes, 0),
    fastest, biggest,
  };
}

/** Pure: the years that have at least one finished series, newest first. */
export const finishYears = finished => [...new Set((finished || []).filter(show => show.finishedAt).map(show => new Date(show.finishedAt).getFullYear()))].sort((a, b) => b - a);

/** Pure: when each part of the card arrives (ms). */
export const yearTimeline = summary => cardTimeline(summary.count);

function tilesFor(summary) {
  const tiles = [['Episodes', String(summary.episodes), 'across those runs']];
  if (summary.minutes) tiles.push(['Watch time', formatDuration(summary.minutes), 'across those runs']);
  if (summary.fastest) tiles.push(['Fastest finish', `${summary.fastest.spanDays} day${summary.fastest.spanDays === 1 ? '' : 's'}`, summary.fastest.title]);
  if (summary.biggest) tiles.push(['Biggest run', `${summary.biggest.episodes} eps`, summary.biggest.title]);
  return tiles.slice(0, 4);
}

/** Open the share studio with a year's card. `finished` are shelf rows. */
export function openSeriesYear(finished, year) {
  const summary = seriesYear(finished, year);
  if (!summary.count) return;
  const title = `${year} in series`;
  return openShareStudio({
    title,
    url: `${location.origin}/profile`,
    copy: {
      eyebrow: 'Your year in television', heading: `${year} in Series`,
      lede: 'Every series you finished this year, with your fastest finish and your biggest run.',
      preparing: 'Gathering your year…', ready: 'Ready to share · No plot details included.',
      failed: 'Could not draw your year. Try again in a moment.',
      shareText: `I finished ${summary.count} series in ${year} — my year on CineVerse`, copied: 'Link copied', alt: 'Year in series card:',
    },
    build: async () => {
      // The wall shows the year's most recent finishes, in order.
      const wall = summary.shows.slice(-12);
      const { posters, close } = await posterBitmaps(wall);
      const ground = groundCanvas({ label: `${summary.year} IN SERIES` });
      const plan = yearTimeline(summary);
      const tiles = tilesFor(summary);
      const draw = (ctx, time) => {
        ctx.clearRect(0, 0, ground.width, ground.height);
        ctx.drawImage(ground, 0, 0);
        drawHeadline(ctx, time, plan, { count: summary.count, noun: 'series', line: `finished in ${summary.year}` });
        drawTiles(ctx, tiles, time, plan);
        const twoRows = drawWall(ctx, wall, posters, time, plan);
        drawMonths(ctx, summary.byMonth, time, plan, { tall: !twoRows });
      };
      return studioResult({ title, draw, end: plan.end, close });
    },
  });
}

export function initSeriesYear(finishedRows) {
  registerActions({
    'series-year': el => openSeriesYear(finishedRows(), +el.dataset.year),
  });
}
