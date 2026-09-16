// ===== SERIES FINISHED THIS YEAR =====
// A year-end card built from the Completed series shelf: how many series you
// finished in a year, the episodes and time across those runs, your fastest
// finish and your biggest run, a wall of their posters, and a bar for each month
// showing when you finished them. Like the finale card, it assembles itself in
// the share studio and shares its final frame.
//
// A series belongs to the year its last episode was marked (its finish date on
// the shelf). Episodes and time are for each whole run, which may have started
// in an earlier year; the card says "across those runs". "Fastest finish" counts
// only runs watched as viewing (see viewingLog), so a show marked in one press
// never wins it.
import { registerActions } from './events.js';
import { seriesRecap } from './series-finale.js';
import { formatDuration } from './season-recap.js';
import { openShareStudio, bitmap, cover, roundedRect, fittedTitle } from './media.js';

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const W = 1200, H = 1500;

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
export function yearTimeline(summary) {
  const posters = Math.min(12, summary.count);
  const tiles = { start: 480, step: 110, dur: 460 };
  const wall = { start: tiles.start + 4 * tiles.step + 200, step: 70, dur: 480 };
  const months = { start: wall.start + posters * wall.step + 260, step: 55, dur: 560 };
  const end = months.start + 11 * months.step + months.dur;
  return { headline: [60, 560], tiles, wall, months, end };
}

const clamp01 = value => Math.max(0, Math.min(1, value));
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeBack = t => { const c = 1.35; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
function arrive(ctx, t, paint, { lift = 24, scale = 1, cx = 0, cy = 0 } = {}) {
  if (t <= 0) return;
  const e = easeOut(t);
  ctx.save(); ctx.globalAlpha = e; ctx.translate(0, (1 - e) * lift);
  if (scale !== 1) { const k = scale + (1 - scale) * e; ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy); }
  paint(); ctx.restore();
}

function tilesFor(summary) {
  const tiles = [['Episodes', String(summary.episodes), 'across those runs']];
  if (summary.minutes) tiles.push(['Watch time', formatDuration(summary.minutes), 'across those runs']);
  if (summary.fastest) tiles.push(['Fastest finish', `${summary.fastest.spanDays} day${summary.fastest.spanDays === 1 ? '' : 's'}`, summary.fastest.title]);
  if (summary.biggest) tiles.push(['Biggest run', `${summary.biggest.episodes} eps`, summary.biggest.title]);
  return tiles.slice(0, 4);
}

async function yearAssets(summary) {
  const posters = await Promise.all(summary.shows.slice(-12).map(show => bitmap(show.poster)));
  const ground = document.createElement('canvas'); ground.width = W; ground.height = H;
  const g = ground.getContext('2d');
  g.fillStyle = '#07070c'; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(900, 180, 40, 900, 180, 900);
  glow.addColorStop(0, 'rgba(229,9,20,.32)'); glow.addColorStop(.5, 'rgba(124,58,237,.12)'); glow.addColorStop(1, 'rgba(7,7,12,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 2; roundedRect(g, 45, 45, W - 90, H - 90, 42); g.stroke();
  g.fillStyle = '#ff3342'; g.font = '800 29px Arial'; g.fillText('CINEVERSE', 88, 118);
  g.fillStyle = '#fbbf24'; g.font = '800 22px Arial'; g.textAlign = 'right'; g.fillText(`${summary.year} IN SERIES`, W - 88, 116); g.textAlign = 'left';
  g.fillStyle = 'rgba(255,255,255,.4)'; g.font = '500 20px Arial'; g.fillText('Tracked on CineVerse', 88, 1415);
  return { posters, ground, close: () => posters.forEach(image => image?.close?.()) };
}

function drawYear(ctx, assets, summary, time = Infinity) {
  const plan = yearTimeline(summary);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(assets.ground, 0, 0);
  arrive(ctx, clamp01((time - plan.headline[0]) / plan.headline[1]), () => {
    ctx.fillStyle = '#fff'; ctx.font = '900 190px Arial'; ctx.fillText(String(summary.count), 88, 360);
    const numberWidth = ctx.measureText(String(summary.count)).width;
    ctx.font = '800 54px Arial'; ctx.fillText('series', 88 + numberWidth + 28, 290);
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '600 32px Arial'; ctx.fillText(`finished in ${summary.year}`, 88 + numberWidth + 28, 346);
  }, { lift: 36 });

  tilesFor(summary).forEach(([label, value, note], index) => {
    const x = 88 + (index % 2) * 520, y = 420 + Math.floor(index / 2) * 170;
    arrive(ctx, clamp01((time - (plan.tiles.start + index * plan.tiles.step)) / plan.tiles.dur), () => {
      ctx.fillStyle = 'rgba(255,255,255,.07)'; roundedRect(ctx, x, y, 504, 150, 24); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '700 19px Arial'; ctx.fillText(label.toUpperCase(), x + 28, y + 46);
      ctx.fillStyle = '#fff'; ctx.font = '800 48px Arial'; ctx.fillText(value, x + 28, y + 104, 448);
      ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = '600 20px Arial'; ctx.fillText(note, x + 28, y + 134, 448);
    }, { lift: 20, scale: .92, cx: x + 252, cy: y + 75 });
  });

  // Poster wall: the year's finishes in order, up to twelve.
  const wall = summary.shows.slice(-12);
  // Six to a row, each row centred. Two rows use 140×210 (ending at 1216, above
  // the month bars); a single row has room for 160×240.
  const cols = 6, gap = 16, twoRows = wall.length > cols;
  const pw = twoRows ? 140 : 160, ph = twoRows ? 210 : 240;
  const rowLeft = row => { const inRow = Math.min(cols, wall.length - row * cols); return 88 + (1024 - (inRow * pw + (inRow - 1) * gap)) / 2; };
  wall.forEach((show, index) => {
    const row = Math.floor(index / cols);
    const x = rowLeft(row) + (index % cols) * (pw + gap), y = 780 + row * (ph + gap);
    arrive(ctx, clamp01((time - (plan.wall.start + index * plan.wall.step)) / plan.wall.dur), () => {
      ctx.save(); roundedRect(ctx, x, y, pw, ph, 14); ctx.clip();
      const image = assets.posters[index];
      if (image) cover(ctx, image, x, y, pw, ph);
      else { ctx.fillStyle = '#181823'; ctx.fillRect(x, y, pw, ph); ctx.fillStyle = '#fff'; fittedTitle(ctx, show.title, x + 10, y + 60, pw - 20, 3); }
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 2; roundedRect(ctx, x, y, pw, ph, 14); ctx.stroke();
    }, { lift: 18, scale: .86, cx: x + pw / 2, cy: y + ph / 2 });
  });

  // Finishes by month
  // Tallest bar: its count label must clear the poster wall's last row.
  const baseY = 1375, maxBar = wall.length > 6 ? 76 : 150, top = Math.max(1, ...summary.byMonth);
  const slot = 1024 / 12, barW = 44;
  summary.byMonth.forEach((count, index) => {
    const t = clamp01((time - (plan.months.start + index * plan.months.step)) / plan.months.dur);
    if (t <= 0) return;
    const cx = 88 + slot * index + slot / 2;
    const full = count ? Math.max(10, (count / top) * maxBar) : 4;
    const height = Math.max(2, full * (count ? easeBack(t) : easeOut(t)));
    ctx.save(); ctx.globalAlpha = easeOut(Math.min(1, t * 2));
    roundedRect(ctx, cx - barW / 2, baseY - 28 - height, barW, height, Math.min(10, height / 2));
    ctx.fillStyle = count ? (count === top ? '#fbbf24' : 'rgba(255,255,255,.4)') : 'rgba(255,255,255,.12)'; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '700 18px Arial'; ctx.textAlign = 'center'; ctx.fillText(MONTHS[index], cx, baseY);
    if (count) { ctx.fillStyle = '#fff'; ctx.font = '800 18px Arial'; ctx.fillText(String(count), cx, baseY - 36 - height); }
    ctx.restore();
  });
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
      const assets = await yearAssets(summary);
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      drawYear(canvas.getContext('2d'), assets, summary);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', .94));
      const plan = yearTimeline(summary);
      return {
        title, blob,
        animate: (target, alive) => new Promise(resolve => {
          const ctx = target.getContext('2d');
          let started = 0;
          const frame = now => {
            if (!started) started = now;
            const time = now - started;
            if (!alive() || time >= plan.end) { drawYear(ctx, assets, summary); assets.close(); resolve(); return; }
            drawYear(ctx, assets, summary, time);
            requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        }),
        dispose: () => assets.close(),
      };
    },
  });
}

export function initSeriesYear(finishedRows) {
  registerActions({
    'series-year': el => openSeriesYear(finishedRows(), +el.dataset.year),
  });
}
