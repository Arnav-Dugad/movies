// ===== SERIES FINALE =====
// Finish a whole series and CineVerse draws the run as one card: every season,
// the dates, total time, your overall pace, your fastest season, a bar for each
// season's pace, and the best-rated episode you watched.
//
// Built from the season recaps (js/season-recap.js), so it is honest the same
// way: pace only from episodes you watched as viewing (a season marked in one
// press has no pace and its bar is drawn hollow), "fastest season" only among
// seasons that have a pace, and ratings are TMDB's.
import { tmdb } from './api.js';
import { pickLogo } from './config.js';
import { state } from './state.js';
import { esc } from './ui.js';
import { icon } from './icons.js';
import { registerActions } from './events.js';
import { viewingLog, showEntry, showProgress, paceLabel } from './episodes.js';
import { pacingProfile } from './pacing.js';
import { seasonRecap, recapDates, formatDuration, drawStar } from './season-recap.js';
import { openShareStudio, bitmap, cover, contain, roundedRect, fittedTitle } from './media.js';

const DAY = 86400000;
const BINGE = 3;
const pad = n => String(n).padStart(2, '0');
const dayKey = at => { const d = new Date(at); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const localMidnight = at => { const d = new Date(at); d.setHours(0, 0, 0, 0); return d.getTime(); };

/**
 * Pure: the whole run of a show.
 * @param {object} entry  the show's progress document
 * @param {Object<number, {episodes?: object[]}>} seasonPayloads  TMDB season payloads by number
 */
export function seriesRecap(entry, seasonPayloads = {}) {
  const numbers = Object.entries(entry?.seasons || {})
    .filter(([season, list]) => +season > 0 && (list || []).length)
    .map(([season]) => +season).sort((a, b) => a - b);
  const seasons = numbers.map(season => seasonRecap(entry, season, { episodes: seasonPayloads[season]?.episodes || [] }));
  const rows = viewingLog(entry).filter(row => row.season > 0);
  const viewing = rows.filter(row => row.viewing);
  const stamps = rows.map(row => row.at);
  const perDay = new Map();
  for (const row of viewing) perDay.set(dayKey(row.at), (perDay.get(dayKey(row.at)) || 0) + 1);
  const first = viewing.length ? Math.min(...viewing.map(row => row.at)) : 0;
  const last = viewing.length ? Math.max(...viewing.map(row => row.at)) : 0;
  const spanDays = viewing.length ? Math.round((localMidnight(last) - localMidnight(first)) / DAY) + 1 : 0;
  const paced = seasons.filter(season => !season.marked && season.pace > 0 && season.viewingEpisodes >= 2);
  const fastest = paced.length >= 2
    ? [...paced].sort((a, b) => b.pace - a.pace || a.spanDays - b.spanDays || a.season - b.season)[0]
    : null;
  const tops = seasons.filter(season => season.topEpisode).map(season => ({ ...season.topEpisode, season: season.season }));
  const trusted = tops.filter(top => top.votes >= 3);
  const topEpisode = (trusted.length ? trusted : tops).sort((a, b) => b.rating - a.rating || b.votes - a.votes || a.season - b.season)[0] || null;
  return {
    seasons,
    seasonCount: seasons.length,
    episodes: seasons.reduce((sum, season) => sum + season.episodes, 0),
    viewingEpisodes: viewing.length,
    minutes: seasons.reduce((sum, season) => sum + season.minutes, 0),
    startedAt: stamps.length ? Math.min(...stamps) : 0,
    finishedAt: stamps.length ? Math.max(...stamps) : 0,
    spanDays,
    pace: viewing.length >= 2 ? viewing.length / Math.max(1, spanDays) : 0,
    bingeDays: [...perDay.values()].filter(count => count >= BINGE).length,
    longestSitting: perDay.size ? Math.max(...perDay.values()) : 0,
    fastest: fastest ? { season: fastest.season, pace: fastest.pace, spanDays: fastest.spanDays, episodes: fastest.episodes } : null,
    topEpisode,
    pattern: pacingProfile([...new Set(viewing.map(row => row.at))]),
    marked: !viewing.length,
  };
}

/** The figures the card shows, in order; empty ones are left out. */
export function finaleFigures(recap) {
  const figures = [['Seasons', String(recap.seasonCount)], ['Episodes', String(recap.episodes)]];
  if (!recap.marked) {
    figures.push(['Days', String(recap.spanDays)]);
    if (recap.pace) figures.push(['Overall pace', paceLabel(recap.pace).replace(/ episodes?/, '')]);
    figures.push(['Binge days', String(recap.bingeDays)]);
  }
  if (recap.minutes) figures.push(['Watch time', formatDuration(recap.minutes)]);
  if (recap.marked && recap.topEpisode) figures.push(['Best episode', recap.topEpisode.rating.toFixed(1)]);
  return figures.slice(0, 6);
}

/** "Season 2 · 3.5 episodes a day over 4 days" */
export function fastestLine(fastest) {
  if (!fastest) return '';
  return `Season ${fastest.season} · ${paceLabel(fastest.pace)} over ${fastest.spanDays} day${fastest.spanDays === 1 ? '' : 's'}`;
}

// ---------- the card ----------
// The card is drawn by one function that can render any moment of its
// build-up: the frame first, then the poster and title, the six figures tile by
// tile, the pace strip with each season's bar rising in turn, and the best
// episode last. The shared PNG is that function at its final moment; the share
// studio plays the build-up on a canvas first (skipped with reduced motion).
const W = 1200, H = 1500;
const clamp01 = value => Math.max(0, Math.min(1, value));
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeBack = t => { const c = 1.35; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

/** Pure: when each part of the card starts and how long it takes, in ms. */
export function finaleTimeline(recap) {
  const tiles = finaleFigures(recap).length;
  const bars = Math.min(20, recap.seasons.length);
  const strip = 520 + tiles * 110 + 260;
  const barsStart = strip + 220;
  const top = barsStart + bars * 90 + 380;
  return { poster: [60, 560], title: [220, 560], tiles: { start: 520, step: 110, dur: 480 }, strip: [strip, 440], bars: { start: barsStart, step: 90, dur: 620 }, top: [top, 480], end: top + 480 };
}

async function finaleAssets(show) {
  const [poster, backdrop, logo] = await Promise.all([bitmap(show.poster_path), bitmap(show.backdrop_path), bitmap(pickLogo(show.images?.logos))]);
  // The blurred backdrop, wash and frame never move: drawn once, reused per frame.
  const ground = document.createElement('canvas'); ground.width = W; ground.height = H;
  const g = ground.getContext('2d');
  g.fillStyle = '#07070c'; g.fillRect(0, 0, W, H);
  if (backdrop) { g.save(); g.globalAlpha = .4; g.filter = 'blur(18px)'; cover(g, backdrop, -40, -40, W + 80, H + 80); g.restore(); }
  const wash = g.createLinearGradient(0, 0, W, H);
  wash.addColorStop(0, 'rgba(251,191,36,.22)'); wash.addColorStop(.42, 'rgba(8,8,14,.82)'); wash.addColorStop(1, '#07070c');
  g.fillStyle = wash; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 2; roundedRect(g, 45, 45, W - 90, H - 90, 42); g.stroke();
  g.fillStyle = '#ff3342'; g.font = '800 29px Arial'; g.fillText('CINEVERSE', 88, 118);
  g.fillStyle = '#fbbf24'; g.font = '800 22px Arial'; g.textAlign = 'right'; g.fillText('SERIES FINALE', W - 88, 116); g.textAlign = 'left';
  g.fillStyle = 'rgba(255,255,255,.4)'; g.font = '500 20px Arial'; g.fillText('Tracked on CineVerse', 88, 1415);
  return { poster, backdrop, logo, ground, close: () => [poster, backdrop, logo].forEach(image => image?.close?.()) };
}

// Draw `paint` faded in and lifted into place by progress `t` (0–1).
function arrive(ctx, t, paint, { lift = 28, scale = 1, cx = 0, cy = 0 } = {}) {
  if (t <= 0) return;
  const e = easeOut(t);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.translate(0, (1 - e) * lift);
  if (scale !== 1) { const k = scale + (1 - scale) * e; ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy); }
  paint();
  ctx.restore();
}

/** Draw the card as it stands `time` ms into its build-up (Infinity: finished). */
function drawFinale(ctx, assets, show, recap, time = Infinity) {
  const plan = finaleTimeline(recap);
  const at = ([start, dur]) => clamp01((time - start) / dur);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(assets.ground, 0, 0);

  arrive(ctx, at(plan.poster), () => {
    ctx.save(); roundedRect(ctx, 88, 170, 300, 450, 24); ctx.clip();
    if (assets.poster) cover(ctx, assets.poster, 88, 170, 300, 450); else { ctx.fillStyle = '#181823'; ctx.fillRect(88, 170, 300, 450); }
    ctx.restore(); ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 2; roundedRect(ctx, 88, 170, 300, 450, 24); ctx.stroke();
  }, { lift: 40 });

  arrive(ctx, at(plan.title), () => {
    const title = show.name || 'TV show';
    ctx.save(); roundedRect(ctx, 430, 170, 682, 170, 12); ctx.clip();
    if (assets.logo) contain(ctx, assets.logo, 430, 170, 682, 160);
    else { ctx.fillStyle = '#fff'; fittedTitle(ctx, title, 430, 230, 682, 2); }
    ctx.restore();
    ctx.fillStyle = '#fff'; ctx.font = '800 60px Arial'; ctx.fillText('The complete series', 430, 408, 682);
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '600 29px Arial'; ctx.fillText(recapDates(recap), 430, 462, 682);
    ctx.fillStyle = '#fbbf24'; ctx.font = '700 27px Arial';
    const line = recap.marked ? 'Marked as watched' : recap.pattern ? `Watched ${recap.pattern.phrase}` : `Finished in ${recap.spanDays} day${recap.spanDays === 1 ? '' : 's'}`;
    ctx.fillText(line, 430, 518, 682);
    ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = '600 22px Arial';
    ctx.fillText(`${recap.seasonCount} season${recap.seasonCount === 1 ? '' : 's'} · ${recap.episodes} episode${recap.episodes === 1 ? '' : 's'}`, 430, 568, 682);
  });

  // Figures, tile by tile
  finaleFigures(recap).forEach(([label, value], index) => {
    const x = 88 + (index % 3) * 350, y = 660 + Math.floor(index / 3) * 160;
    const t = clamp01((time - (plan.tiles.start + index * plan.tiles.step)) / plan.tiles.dur);
    arrive(ctx, t, () => {
      ctx.fillStyle = 'rgba(255,255,255,.07)'; roundedRect(ctx, x, y, 324, 138, 24); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '700 19px Arial'; ctx.fillText(label.toUpperCase(), x + 28, y + 48);
      ctx.fillStyle = '#fff'; ctx.font = '800 46px Arial'; ctx.fillText(value, x + 28, y + 106, 270);
    }, { lift: 22, scale: .9, cx: x + 162, cy: y + 69 });
  });

  // Season pace strip, each season's bar rising in turn
  const stripY = 990, stripH = 270;
  const stripT = at(plan.strip);
  arrive(ctx, stripT, () => {
    ctx.fillStyle = 'rgba(255,255,255,.06)'; roundedRect(ctx, 88, stripY, 1024, stripH, 28); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '700 19px Arial';
    ctx.fillText(recap.fastest ? 'FASTEST SEASON' : 'EPISODES A DAY, BY SEASON', 120, stripY + 50);
    if (recap.fastest) {
      ctx.fillStyle = '#fff'; ctx.font = '800 40px Arial'; ctx.fillText(`Season ${recap.fastest.season}`, 120, stripY + 100, 330);
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '600 22px Arial';
      ctx.fillText(paceLabel(recap.fastest.pace), 120, stripY + 138, 330);
      ctx.fillText(`over ${recap.fastest.spanDays} day${recap.fastest.spanDays === 1 ? '' : 's'}`, 120, stripY + 170, 330);
    }
  }, { lift: 18 });
  const shown = recap.seasons.slice(-20);
  const chartX = recap.fastest ? 470 : 120, chartW = 1080 - chartX, baseY = stripY + stripH - 52, maxBar = 150;
  const maxPace = Math.max(...shown.map(season => season.pace), 0.0001);
  const slot = chartW / Math.max(1, shown.length), barW = Math.min(46, slot * .62);
  shown.forEach((season, index) => {
    const t = clamp01((time - (plan.bars.start + index * plan.bars.step)) / plan.bars.dur);
    if (t <= 0) return;
    const cx = chartX + slot * index + slot / 2;
    const full = season.pace ? Math.max(8, (season.pace / maxPace) * maxBar) : 8;
    const height = Math.max(2, full * easeBack(t));
    const isFastest = recap.fastest?.season === season.season;
    ctx.save();
    ctx.globalAlpha = easeOut(Math.min(1, t * 2));
    roundedRect(ctx, cx - barW / 2, baseY - height, barW, height, Math.min(10, barW / 2, height / 2));
    if (season.pace) { ctx.fillStyle = isFastest ? '#fbbf24' : 'rgba(255,255,255,.34)'; ctx.fill(); }
    else { ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.fillStyle = isFastest ? '#fbbf24' : 'rgba(255,255,255,.55)'; ctx.font = `700 ${shown.length > 12 ? 15 : 18}px Arial`; ctx.textAlign = 'center';
    ctx.fillText(`S${season.season}`, cx, baseY + 32);
    ctx.restore();
  });

  // Best-rated episode
  if (recap.topEpisode) {
    arrive(ctx, at(plan.top), () => {
      const y = 1290;
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '700 19px Arial'; ctx.fillText('BEST-RATED EPISODE YOU WATCHED · TMDB', 88, y + 26);
      ctx.fillStyle = '#fff'; ctx.font = '800 34px Arial';
      ctx.fillText(`S${recap.topEpisode.season} E${recap.topEpisode.number}${recap.topEpisode.name ? ` · ${recap.topEpisode.name}` : ''}`, 88, y + 74, 880);
      ctx.fillStyle = '#fbbf24'; drawStar(ctx, 1012, y + 62, 15); ctx.font = '800 34px Arial'; ctx.fillText(recap.topEpisode.rating.toFixed(1), 1036, y + 74);
    }, { lift: 16 });
  }
}

/** Open the share studio with the series finale card. */
export function openSeriesFinale(id) {
  const entry = showEntry(id);
  if (!entry) return;
  const title = `${entry.title || 'TV show'} series finale`;
  return openShareStudio({
    title,
    url: `${location.origin}/tv/${id}`,
    copy: {
      eyebrow: 'Series complete', heading: 'Series Finale',
      lede: 'Every season, your overall pace and your fastest season, drawn from how you watched it.',
      preparing: 'Drawing the whole series…', ready: 'Ready to share · No plot details included.',
      failed: 'Could not draw the finale card. You can still copy the show link.',
      shareText: `I finished ${entry.title || 'a series'} — my series recap on CineVerse`, copied: 'Show link copied', alt: 'Series finale card:',
    },
    build: async () => {
      const live = showEntry(id) || entry;
      const numbers = Object.keys(live.seasons || {}).map(Number).filter(season => season > 0);
      const [show, ...payloads] = await Promise.all([
        tmdb(`/tv/${id}`, { append_to_response: 'images', include_image_language: 'en,null' }),
        ...numbers.map(season => tmdb(`/tv/${id}/season/${season}`).catch(() => null)),
      ]);
      const recap = seriesRecap(live, Object.fromEntries(numbers.map((season, index) => [season, payloads[index] || {}])));
      const assets = await finaleAssets(show);
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      drawFinale(canvas.getContext('2d'), assets, show, recap);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', .94));
      const plan = finaleTimeline(recap);
      return {
        title, blob,
        // Plays the build-up onto the studio's canvas; resolves when it has
        // finished or the studio moved on (`alive` false).
        animate: (target, alive) => new Promise(resolve => {
          const ctx = target.getContext('2d');
          let started = 0;
          const frame = now => {
            if (!started) started = now;
            const time = now - started;
            if (!alive() || time >= plan.end) { drawFinale(ctx, assets, show, recap); assets.close(); resolve(); return; }
            drawFinale(ctx, assets, show, recap, time);
            requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        }),
        dispose: () => assets.close(),
      };
    },
  });
}

/** Whether the show's run was just finished by watching (not by a bulk mark). */
export function justFinishedSeries(id, now = Date.now()) {
  const entry = showEntry(id);
  if (!entry || !showProgress(id).seriesCompleted) return false;
  const last = viewingLog(entry).sort((a, b) => b.at - a.at)[0];
  return !!last?.viewing && now - last.at < 5 * 60000;
}

function promptFinale(id) {
  const zone = document.getElementById('toastZone');
  const entry = showEntry(id);
  if (!zone || !entry) return;
  zone.querySelector(`[data-finale-prompt="${id}"]`)?.remove();
  const card = document.createElement('div');
  card.className = 'toast success recap-prompt finale-prompt';
  card.dataset.finalePrompt = String(id);
  card.setAttribute('role', 'status');
  card.innerHTML = `<i class="finale-prompt-mark">${icon('trophy')}</i><span>${esc(`${entry.title || 'Series'} · every episode watched`)}</span><button type="button" data-action="series-finale" data-tid="${id}">See your finale</button><button type="button" class="recap-prompt-close" aria-label="Dismiss">${icon('close')}</button>`;
  card.querySelector('.recap-prompt-close').addEventListener('click', () => card.remove());
  card.querySelector('[data-action="series-finale"]').addEventListener('click', () => card.remove());
  zone.appendChild(card);
  setTimeout(() => { if (card.isConnected) { card.style.animation = 'toast-out .3s forwards'; setTimeout(() => card.remove(), 300); } }, 11000);
}

export function initSeriesFinale() {
  registerActions({
    'series-finale': el => openSeriesFinale(+el.dataset.tid),
  });
  document.addEventListener('cv:season-complete', event => {
    const { id } = event.detail || {};
    if (state.user && justFinishedSeries(id)) promptFinale(id);
  });
}
