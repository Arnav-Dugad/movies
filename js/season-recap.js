// ===== SEASON RECAP =====
// Finish a season and CineVerse draws it as a shareable card: when you started
// and finished, how many days it took, your pace, binge days, your longest
// sitting, time watched, when you tend to watch, and the season's top-rated
// episode.
//
// Honest by construction:
//   - Pace, binge days and the longest sitting come from viewing only (see
//     viewingLog): a season marked in one press has no pace, and its card says
//     "Marked as watched" instead of inventing one.
//   - "Top-rated episode" is TMDB's community rating (CineVerse has no episode
//     ratings of its own), and the card says so.
//   - Watch time sums TMDB's per-episode runtimes, falling back to the show's
//     typical runtime; with neither it is left out.
import { tmdb } from './api.js';
import { IMG, pickLogo } from './config.js';
import { state } from './state.js';
import { toast, esc } from './ui.js';
import { registerActions } from './events.js';
import { viewingLog, showEntry, isSeasonComplete, paceLabel, showProgress } from './episodes.js';
import { icon } from './icons.js';
import { pacingProfile } from './pacing.js';
import { openShareStudio, bitmap, cover, contain, roundedRect, fittedTitle } from './media.js';

const DAY = 86400000;
const BINGE = 3;
const pad = n => String(n).padStart(2, '0');
const dayKey = at => { const d = new Date(at); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const localMidnight = at => { const d = new Date(at); d.setHours(0, 0, 0, 0); return d.getTime(); };

export const formatDuration = minutes => {
  const total = Math.round(+minutes || 0);
  if (!total) return '';
  const hours = Math.floor(total / 60), rest = total % 60;
  return hours ? `${hours}h${rest ? ` ${rest}m` : ''}` : `${rest}m`;
};

/**
 * Pure: a recap for one season.
 * @param {object} entry  the show's progress document
 * @param {number} season
 * @param {{ episodes?: object[] }} tmdbSeason  TMDB /tv/{id}/season/{n} payload
 */
export function seasonRecap(entry, season, { episodes = [] } = {}) {
  const number = +season;
  const watched = [...new Set((entry?.seasons?.[String(number)] || []).map(Number))].sort((a, b) => a - b);
  const rows = viewingLog(entry).filter(row => row.season === number);
  const viewing = rows.filter(row => row.viewing);
  const stamps = rows.map(row => row.at);
  const startedAt = stamps.length ? Math.min(...stamps) : 0;
  const finishedAt = stamps.length ? Math.max(...stamps) : 0;
  const perDay = new Map();
  for (const row of viewing) perDay.set(dayKey(row.at), (perDay.get(dayKey(row.at)) || 0) + 1);
  const viewingStart = viewing.length ? Math.min(...viewing.map(row => row.at)) : 0;
  const viewingEnd = viewing.length ? Math.max(...viewing.map(row => row.at)) : 0;
  const spanDays = viewing.length ? Math.round((localMidnight(viewingEnd) - localMidnight(viewingStart)) / DAY) + 1 : 0;
  // Pace needs at least two episodes watched as viewing, like the forecast.
  const pace = viewing.length >= 2 ? viewing.length / Math.max(1, spanDays) : 0;

  const byNumber = new Map((episodes || []).map(episode => [+episode.episode_number, episode]));
  const runtime = watched.reduce((sum, number) => sum + (+byNumber.get(number)?.runtime || +entry?.episodeRuntime || 0), 0);
  const rated = (episodes || []).filter(episode => +episode.vote_average > 0 && watched.includes(+episode.episode_number));
  const trusted = rated.filter(episode => +episode.vote_count >= 3);
  const top = (trusted.length ? trusted : rated).sort((a, b) => b.vote_average - a.vote_average || b.vote_count - a.vote_count)[0] || null;

  return {
    season: number,
    episodes: watched.length,
    viewingEpisodes: viewing.length,
    startedAt, finishedAt,
    spanDays,
    pace,
    bingeDays: [...perDay.values()].filter(count => count >= BINGE).length,
    longestSitting: perDay.size ? Math.max(...perDay.values()) : 0,
    minutes: runtime,
    pattern: pacingProfile([...new Set(viewing.map(row => row.at))]),
    topEpisode: top ? { number: +top.episode_number, name: top.name || '', rating: Math.round(+top.vote_average * 10) / 10, votes: +top.vote_count || 0, still: top.still_path || '' } : null,
    marked: !viewing.length,
  };
}

const shortDate = at => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const longDate = at => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** "Aug 3 – Sep 12, 2026", or one date when started and finished the same day. */
export function recapDates(recap) {
  if (!recap.startedAt) return '';
  if (dayKey(recap.startedAt) === dayKey(recap.finishedAt)) return longDate(recap.finishedAt);
  const sameYear = new Date(recap.startedAt).getFullYear() === new Date(recap.finishedAt).getFullYear();
  return `${sameYear ? shortDate(recap.startedAt) : longDate(recap.startedAt)} – ${longDate(recap.finishedAt)}`;
}

/** The figures the card shows, in order; empty ones are left out. */
export function recapFigures(recap) {
  const figures = [['Episodes', String(recap.episodes)]];
  if (!recap.marked) {
    figures.push(['Days', `${recap.spanDays}`]);
    if (recap.pace) figures.push(['Pace', paceLabel(recap.pace).replace(/ episodes?/, '')]);
    figures.push(['Binge days', String(recap.bingeDays)]);
    figures.push(['Longest sitting', `${recap.longestSitting} ep${recap.longestSitting === 1 ? '' : 's'}`]);
  }
  if (recap.minutes) figures.push(['Watch time', formatDuration(recap.minutes)]);
  return figures.slice(0, 6);
}

// A five-point star drawn as a path, not a font glyph, so it matches the site's
// icon set on every platform.
export function drawStar(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 ? r * 0.46 : r;
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
  }
  ctx.closePath();
  ctx.fill();
}

// ---------- the card ----------
async function buildRecapCard(show, seasonData, recap) {
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1500;
  const ctx = canvas.getContext('2d');
  const logoPath = pickLogo(show.images?.logos);
  const posterPath = seasonData?.poster_path || show.poster_path;
  const [poster, backdrop, logo, still] = await Promise.all([bitmap(posterPath), bitmap(show.backdrop_path), bitmap(logoPath), bitmap(recap.topEpisode?.still)]);

  ctx.fillStyle = '#07070c'; ctx.fillRect(0, 0, 1200, 1500);
  if (backdrop) { ctx.save(); ctx.globalAlpha = .38; ctx.filter = 'blur(16px)'; cover(ctx, backdrop, -40, -40, 1280, 1580); ctx.restore(); }
  const wash = ctx.createLinearGradient(0, 0, 1200, 1500);
  wash.addColorStop(0, 'rgba(229,9,20,.28)'); wash.addColorStop(.45, 'rgba(8,8,14,.8)'); wash.addColorStop(1, '#07070c');
  ctx.fillStyle = wash; ctx.fillRect(0, 0, 1200, 1500);
  ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 2; roundedRect(ctx, 45, 45, 1110, 1410, 42); ctx.stroke();
  ctx.fillStyle = '#ff3342'; ctx.font = '800 29px Arial'; ctx.fillText('CINEVERSE', 88, 118);
  ctx.fillStyle = 'rgba(255,255,255,.62)'; ctx.font = '700 22px Arial'; ctx.textAlign = 'right'; ctx.fillText('SEASON RECAP', 1112, 116); ctx.textAlign = 'left';

  // Poster
  roundedRect(ctx, 88, 170, 360, 540, 26); ctx.save(); ctx.clip();
  if (poster) cover(ctx, poster, 88, 170, 360, 540); else { ctx.fillStyle = '#181823'; ctx.fillRect(88, 170, 360, 540); }
  ctx.restore(); ctx.strokeStyle = 'rgba(255,255,255,.16)'; roundedRect(ctx, 88, 170, 360, 540, 26); ctx.stroke();

  // Title, season, dates, pattern
  const title = show.name || 'TV show';
  ctx.save(); roundedRect(ctx, 490, 170, 622, 200, 12); ctx.clip();
  if (logo) contain(ctx, logo, 490, 170, 622, 190);
  else { ctx.fillStyle = '#fff'; fittedTitle(ctx, title, 490, 240, 622, 2); }
  ctx.restore();
  ctx.fillStyle = '#fff'; ctx.font = '800 76px Arial'; ctx.fillText(`Season ${recap.season}`, 490, 470);
  ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '600 30px Arial'; ctx.fillText(recapDates(recap), 490, 525);
  ctx.fillStyle = '#fbbf24'; ctx.font = '700 28px Arial';
  const line = recap.marked ? 'Marked as watched' : recap.pattern ? `Watched ${recap.pattern.phrase}` : `Finished in ${recap.spanDays} day${recap.spanDays === 1 ? '' : 's'}`;
  ctx.fillText(line, 490, 585);
  ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = '600 22px Arial'; ctx.fillText(`${recap.episodes} episode${recap.episodes === 1 ? '' : 's'} complete`, 490, 640);

  // Figures: up to six tiles, three to a row
  const figures = recapFigures(recap);
  figures.forEach(([label, value], index) => {
    const x = 88 + (index % 3) * 350, y = 760 + Math.floor(index / 3) * 170;
    ctx.fillStyle = 'rgba(255,255,255,.07)'; roundedRect(ctx, x, y, 324, 146, 24); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '700 20px Arial'; ctx.fillText(label.toUpperCase(), x + 28, y + 50);
    ctx.fillStyle = '#fff'; ctx.font = '800 50px Arial'; ctx.fillText(value, x + 28, y + 112, 270);
  });

  // Top-rated episode
  if (recap.topEpisode) {
    const y = 1120;
    ctx.fillStyle = 'rgba(255,255,255,.07)'; roundedRect(ctx, 88, y, 1024, 220, 28); ctx.fill();
    roundedRect(ctx, 116, y + 28, 290, 164, 16); ctx.save(); ctx.clip();
    if (still) cover(ctx, still, 116, y + 28, 290, 164); else { ctx.fillStyle = '#181823'; ctx.fillRect(116, y + 28, 290, 164); }
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '700 20px Arial'; ctx.fillText('TOP-RATED EPISODE · TMDB', 440, y + 70);
    ctx.fillStyle = '#fff'; ctx.font = '800 38px Arial'; ctx.fillText(`E${recap.topEpisode.number}${recap.topEpisode.name ? ` · ${recap.topEpisode.name}` : ''}`, 440, y + 125, 640);
    ctx.fillStyle = '#fbbf24'; drawStar(ctx, 454, y + 166, 14); ctx.font = '800 34px Arial'; ctx.fillText(recap.topEpisode.rating.toFixed(1), 478, y + 178);
  }
  ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.font = '500 20px Arial'; ctx.fillText('Tracked on CineVerse', 88, 1405);

  [poster, backdrop, logo, still].forEach(image => image?.close?.());
  return await new Promise(resolve => canvas.toBlob(resolve, 'image/png', .94));
}

/** Open the share studio with a season's recap card. */
export function openSeasonRecap(id, season) {
  const entry = showEntry(id);
  if (!entry) return;
  const title = `${entry.title || 'TV show'} Season ${season} recap`;
  return openShareStudio({
    title,
    url: `${location.origin}/tv/${id}`,
    copy: {
      eyebrow: 'Season complete', heading: 'Season Recap',
      lede: 'Your pace, binge days and the season’s top-rated episode, drawn from how you watched it.',
      preparing: 'Drawing your season…', ready: 'Ready to share · No plot details included.',
      failed: 'Could not draw the recap. You can still copy the show link.',
      shareText: `My ${entry.title || 'TV'} season ${season} recap on CineVerse`, copied: 'Show link copied', alt: 'Recap card:',
    },
    build: async () => {
      const [show, seasonData] = await Promise.all([
        tmdb(`/tv/${id}`, { append_to_response: 'images', include_image_language: 'en,null' }),
        tmdb(`/tv/${id}/season/${season}`).catch(() => null),
      ]);
      const recap = seasonRecap(showEntry(id) || entry, season, { episodes: seasonData?.episodes || [] });
      return { title, blob: await buildRecapCard(show, seasonData, recap) };
    },
  });
}

// ---------- the moment a season is finished ----------
function promptRecap(id, season) {
  const zone = document.getElementById('toastZone');
  const entry = showEntry(id);
  if (!zone || !entry) return;
  zone.querySelector(`[data-recap-prompt="${id}_${season}"]`)?.remove();
  const card = document.createElement('div');
  card.className = 'toast success recap-prompt';
  card.dataset.recapPrompt = `${id}_${season}`;
  card.setAttribute('role', 'status');
  card.innerHTML = `<span>${esc(`${entry.title || 'Season'} · Season ${season} complete`)}</span><button type="button" data-action="season-recap" data-tid="${id}" data-sn="${season}">See your recap</button><button type="button" class="recap-prompt-close" aria-label="Dismiss">${icon('close')}</button>`;
  card.querySelector('.recap-prompt-close').addEventListener('click', () => card.remove());
  card.querySelector('[data-action="season-recap"]').addEventListener('click', () => card.remove());
  zone.appendChild(card);
  setTimeout(() => { if (card.isConnected) { card.style.animation = 'toast-out .3s forwards'; setTimeout(() => card.remove(), 300); } }, 9000);
}

export function initSeasonRecap() {
  registerActions({
    'season-recap': el => openSeasonRecap(+el.dataset.tid, +el.dataset.sn),
  });
  // Offered only for a finish that was watched: the last episode of the season
  // was ticked as viewing, not swept in by a whole-season or whole-show mark.
  document.addEventListener('cv:season-complete', event => {
    const { id, seasons = [] } = event.detail || {};
    const entry = showEntry(id);
    if (!state.user || !entry) return;
    // Finishing the last season finishes the series: the finale card
    // (js/series-finale.js) is offered instead of a second prompt.
    if (showProgress(id).seriesCompleted) return;
    const season = [...seasons].sort((a, b) => b - a).find(number => {
      if (!isSeasonComplete(id, number)) return false;
      const rows = viewingLog(entry).filter(row => row.season === +number);
      const last = rows.sort((a, b) => b.at - a.at)[0];
      return !!last?.viewing && Date.now() - last.at < 5 * 60000;
    });
    if (season) promptRecap(id, season);
  });
}
