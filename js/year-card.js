// ===== YEAR CARDS (shared drawing) =====
// The year-in-series and year-in-films cards are the same kind of card: a big
// headline number, four figure tiles, a wall of posters, and a bar for each
// month. This module draws those parts at any moment of their build-up, so each
// card's animation and its shared PNG come from one function, and plays the
// build-up in the share studio.
//
// Month bars rise one after another; the busiest month (every month tied for
// busiest) rises in gold and its glow grows with it.
import { bitmap, cover, roundedRect, fittedTitle } from './media.js';

export const W = 1200, H = 1500;
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

export const clamp01 = value => Math.max(0, Math.min(1, value));
export const easeOut = t => 1 - Math.pow(1 - t, 3);
export const easeBack = t => { const c = 1.35; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

/** Pure: when each part of a year card arrives (ms), for `posters` wall posters. */
export function cardTimeline(posters) {
  const shown = Math.min(12, Math.max(0, posters));
  const tiles = { start: 480, step: 110, dur: 460 };
  const wall = { start: tiles.start + 4 * tiles.step + 200, step: 70, dur: 480 };
  const months = { start: wall.start + shown * wall.step + 260, step: 55, dur: 560 };
  const end = months.start + 11 * months.step + months.dur;
  return { headline: [60, 560], tiles, wall, months, end };
}

/** Pure: the months tied for busiest (indexes), or none when the year is empty. */
export function busiestMonths(byMonth) {
  const top = Math.max(0, ...(byMonth || []));
  return top ? (byMonth || []).map((count, index) => (count === top ? index : -1)).filter(index => index >= 0) : [];
}

export function arrive(ctx, t, paint, { lift = 24, scale = 1, cx = 0, cy = 0 } = {}) {
  if (t <= 0) return;
  const e = easeOut(t);
  ctx.save(); ctx.globalAlpha = e; ctx.translate(0, (1 - e) * lift);
  if (scale !== 1) { const k = scale + (1 - scale) * e; ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy); }
  paint(); ctx.restore();
}

/** The frame, glow and labels that never move, drawn once. */
export function groundCanvas({ label, glow = ['rgba(229,9,20,.32)', 'rgba(124,58,237,.12)'] }) {
  const ground = document.createElement('canvas'); ground.width = W; ground.height = H;
  const g = ground.getContext('2d');
  g.fillStyle = '#07070c'; g.fillRect(0, 0, W, H);
  const light = g.createRadialGradient(900, 180, 40, 900, 180, 900);
  light.addColorStop(0, glow[0]); light.addColorStop(.5, glow[1]); light.addColorStop(1, 'rgba(7,7,12,0)');
  g.fillStyle = light; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 2; roundedRect(g, 45, 45, W - 90, H - 90, 42); g.stroke();
  g.fillStyle = '#ff3342'; g.font = '800 29px Arial'; g.fillText('CINEVERSE', 88, 118);
  g.fillStyle = '#fbbf24'; g.font = '800 22px Arial'; g.textAlign = 'right'; g.fillText(label, W - 88, 116); g.textAlign = 'left';
  g.fillStyle = 'rgba(255,255,255,.4)'; g.font = '500 20px Arial'; g.fillText('Tracked on CineVerse', 88, 1415);
  return ground;
}

/** Up to twelve poster bitmaps, plus a closer for them. */
export async function posterBitmaps(items) {
  const posters = await Promise.all(items.slice(0, 12).map(item => bitmap(item.poster)));
  return { posters, close: () => posters.forEach(image => image?.close?.()) };
}

export function drawHeadline(ctx, time, plan, { count, noun, line }) {
  arrive(ctx, clamp01((time - plan.headline[0]) / plan.headline[1]), () => {
    ctx.fillStyle = '#fff'; ctx.font = '900 190px Arial'; ctx.fillText(String(count), 88, 360);
    const numberWidth = ctx.measureText(String(count)).width;
    ctx.font = '800 54px Arial'; ctx.fillText(noun, 88 + numberWidth + 28, 290, 1024 - numberWidth - 28);
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '600 32px Arial'; ctx.fillText(line, 88 + numberWidth + 28, 346, 1024 - numberWidth - 28);
  }, { lift: 36 });
}

/** Up to four [label, value, note] tiles, two to a row. */
export function drawTiles(ctx, tiles, time, plan) {
  tiles.slice(0, 4).forEach(([label, value, note], index) => {
    const x = 88 + (index % 2) * 520, y = 420 + Math.floor(index / 2) * 170;
    arrive(ctx, clamp01((time - (plan.tiles.start + index * plan.tiles.step)) / plan.tiles.dur), () => {
      ctx.fillStyle = 'rgba(255,255,255,.07)'; roundedRect(ctx, x, y, 504, 150, 24); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '700 19px Arial'; ctx.fillText(label.toUpperCase(), x + 28, y + 46, 448);
      ctx.fillStyle = '#fff'; ctx.font = '800 48px Arial'; ctx.fillText(value, x + 28, y + 104, 448);
      ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = '600 20px Arial'; ctx.fillText(note || '', x + 28, y + 134, 448);
    }, { lift: 20, scale: .92, cx: x + 252, cy: y + 75 });
  });
}

/** The poster wall: up to twelve, six to a row, each row centred. Returns its height class. */
export function drawWall(ctx, items, images, time, plan) {
  const wall = items.slice(0, 12);
  // Two rows use 140×210 (ending at 1216, above the month bars); one row has
  // room for 160×240.
  const cols = 6, gap = 16, twoRows = wall.length > cols;
  const pw = twoRows ? 140 : 160, ph = twoRows ? 210 : 240;
  const rowLeft = row => { const inRow = Math.min(cols, wall.length - row * cols); return 88 + (1024 - (inRow * pw + (inRow - 1) * gap)) / 2; };
  wall.forEach((item, index) => {
    const row = Math.floor(index / cols);
    const x = rowLeft(row) + (index % cols) * (pw + gap), y = 780 + row * (ph + gap);
    arrive(ctx, clamp01((time - (plan.wall.start + index * plan.wall.step)) / plan.wall.dur), () => {
      ctx.save(); roundedRect(ctx, x, y, pw, ph, 14); ctx.clip();
      const image = images[index];
      if (image) cover(ctx, image, x, y, pw, ph);
      else { ctx.fillStyle = '#181823'; ctx.fillRect(x, y, pw, ph); ctx.fillStyle = '#fff'; fittedTitle(ctx, item.title || '', x + 10, y + 60, pw - 20, 3); }
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 2; roundedRect(ctx, x, y, pw, ph, 14); ctx.stroke();
    }, { lift: 18, scale: .86, cx: x + pw / 2, cy: y + ph / 2 });
  });
  return twoRows;
}

/**
 * A bar per month, rising in turn. The busiest month rises in gold with a soft
 * glow that grows as the bar does.
 */
export function drawMonths(ctx, byMonth, time, plan, { tall = true } = {}) {
  const baseY = 1375, maxBar = tall ? 150 : 76, top = Math.max(1, ...byMonth);
  const busiest = new Set(busiestMonths(byMonth));
  const slot = 1024 / 12, barW = 44;
  byMonth.forEach((count, index) => {
    const t = clamp01((time - (plan.months.start + index * plan.months.step)) / plan.months.dur);
    if (t <= 0) return;
    const cx = 88 + slot * index + slot / 2;
    const full = count ? Math.max(10, (count / top) * maxBar) : 4;
    const grow = count ? easeBack(t) : easeOut(t);
    const height = Math.max(2, full * grow);
    const x = cx - barW / 2, y = baseY - 28 - height;
    const peak = busiest.has(index);
    ctx.save();
    ctx.globalAlpha = easeOut(Math.min(1, t * 2));
    if (peak) {
      // The halo behind the bar: a soft gold light centred on its top, widening
      // as the bar grows.
      const e = easeOut(t);
      const halo = ctx.createRadialGradient(cx, y + 6, 2, cx, y + 6, 26 + 58 * e);
      halo.addColorStop(0, `rgba(251,191,36,${(.42 * e).toFixed(3)})`);
      halo.addColorStop(1, 'rgba(251,191,36,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(cx - 90, y - 90, 180, height + 150);
      ctx.shadowColor = 'rgba(251,191,36,.85)';
      ctx.shadowBlur = 30 * e;
    }
    roundedRect(ctx, x, y, barW, height, Math.min(10, height / 2));
    ctx.fillStyle = count ? (peak ? '#fbbf24' : 'rgba(255,255,255,.4)') : 'rgba(255,255,255,.12)';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = peak ? '#fbbf24' : 'rgba(255,255,255,.55)'; ctx.font = '700 18px Arial'; ctx.textAlign = 'center'; ctx.fillText(MONTHS[index], cx, baseY);
    if (count) { ctx.fillStyle = peak ? '#fde68a' : '#fff'; ctx.font = '800 18px Arial'; ctx.fillText(String(count), cx, y - 8); }
    ctx.restore();
  });
}

/**
 * A share-studio build result for a card drawn by `draw(ctx, time)`: the final
 * frame as a PNG, and a player for the build-up.
 */
export async function studioResult({ title, draw, end, close }) {
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  draw(canvas.getContext('2d'), Infinity);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', .94));
  return {
    title, blob,
    animate: (target, alive) => new Promise(resolve => {
      const ctx = target.getContext('2d');
      let started = 0;
      const frame = now => {
        if (!started) started = now;
        const time = now - started;
        if (!alive() || time >= end) { draw(ctx, Infinity); close(); resolve(); return; }
        draw(ctx, time);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }),
    dispose: close,
  };
}
