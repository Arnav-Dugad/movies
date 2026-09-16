// ===== AMBIENT COLOUR =====
// A title page takes a colour from its own poster: the glow behind the header,
// the primary button, and the progress bars. Settings → Appearance → Title
// colour turns it off (on by default).
//
// The colour is sampled once per poster from a tiny CORS copy (w92, a few KB),
// cached on the device, and chosen for character rather than average: pixels
// are grouped by hue, and the group with the most vivid weight wins, so the
// orange of a flame beats a large brown background. A poster with no real
// colour (black and white, near-grey) returns nothing and the page stays in the
// site's red. The sampled colour is then fitted to its jobs in OKLCH, keeping
// its hue: a button fill dark enough for white text (at least 4.5:1), and a
// lighter or darker accent for type depending on the theme.
import { IMG } from './config.js';
import { prefs } from './prefs.js';

const CACHE_KEY = 'cv_poster_colours_v1';
const CACHE_LIMIT = 400;
let memo = null;

function store() {
  if (memo) return memo;
  try { memo = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (_) { memo = {}; }
  return memo;
}
function remember(path, value) {
  const cache = store();
  cache[path] = { v: value, at: Date.now() };
  try {
    const rows = Object.entries(cache).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, CACHE_LIMIT);
    memo = Object.fromEntries(rows);
    localStorage.setItem(CACHE_KEY, JSON.stringify(memo));
  } catch (_) {}
}

// ---------- colour maths (OKLab, Björn Ottosson) ----------
const toLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toGamma = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export function rgbToOklch([r, g, b]) {
  const lr = toLinear(r / 255), lg = toLinear(g / 255), lb = toLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { L, C: Math.hypot(A, B), h: Math.atan2(B, A) };
}

function oklchToRgb(L, C, h) {
  const A = C * Math.cos(h), B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s].map(toGamma);
}

// Largest chroma that fits sRGB at this lightness and hue, never above `C`.
function fit(L, C, h) {
  const ok = c => oklchToRgb(L, c, h).every(v => v >= -0.0005 && v <= 1.0005);
  if (ok(C)) return oklchToRgb(L, C, h);
  let lo = 0, hi = C;
  for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
  return oklchToRgb(L, lo, h);
}
const bytes = rgb => rgb.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255));

const channel = v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/**
 * Pure: the characteristic colour of RGBA pixel data, or null for a colourless
 * image. Pixels are binned by OKLCH hue (24 bins); a bin's weight is the sum of
 * its pixels' chroma, so vivid colour outweighs a large dull area.
 */
export function dominantColour(data) {
  const bins = Array.from({ length: 24 }, () => ({ weight: 0, r: 0, g: 0, b: 0, n: 0 }));
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const { L, C, h } = rgbToOklch(rgb);
    total++;
    if (C < 0.05 || L < 0.22 || L > 0.95) continue;
    const bin = bins[Math.floor(((h + Math.PI) / (2 * Math.PI)) * 24) % 24];
    bin.weight += C; bin.r += rgb[0] * C; bin.g += rgb[1] * C; bin.b += rgb[2] * C; bin.n++;
  }
  if (!total) return null;
  const best = bins.reduce((a, b) => (b.weight > a.weight ? b : a));
  // A few stray coloured pixels in a grey poster are not its colour.
  if (!best.n || best.n / total < 0.04 || best.weight / best.n < 0.07) return null;
  return [Math.round(best.r / best.weight), Math.round(best.g / best.weight), Math.round(best.b / best.weight)];
}

/**
 * Pure: the sampled colour fitted to its jobs, keeping its hue.
 *   solid — button fill and progress bars; white text on it clears 4.5:1
 *   glow  — the raw colour, for soft light behind the header
 *   inkDark / inkLight — accent type on the dark and light themes
 */
export function ambientPalette(rgb) {
  if (!rgb) return null;
  const { C, h } = rgbToOklch(rgb);
  const chroma = Math.min(Math.max(C, 0.09), 0.17);
  let L = 0.54, solid = bytes(fit(L, chroma, h));
  while (contrast(solid, [255, 255, 255]) < 4.6 && L > 0.3) { L -= 0.02; solid = bytes(fit(L, chroma, h)); }
  return {
    glow: rgb,
    solid,
    inkDark: bytes(fit(0.8, Math.min(chroma, 0.13), h)),
    inkLight: bytes(fit(0.46, chroma, h)),
  };
}

function sample(path) {
  return new Promise(resolve => {
    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.decoding = 'async';
    probe.onload = () => {
      try {
        const w = 24, h = 36;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(probe, 0, 0, w, h);
        resolve(dominantColour(ctx.getImageData(0, 0, w, h).data));
      } catch (_) { resolve(null); }
    };
    probe.onerror = () => resolve(null);
    // A distinct URL: the page may already hold a no-CORS copy of this poster,
    // and reusing it would taint the canvas.
    probe.src = `${IMG}w92${path}?cv-colour=1`;
  });
}

/** Resolves to the poster's palette (cached), or null. */
export async function posterPalette(path) {
  if (!path) return null;
  const cached = store()[path];
  if (cached) return ambientPalette(cached.v || null);
  const rgb = await sample(path);
  remember(path, rgb || 0);
  return ambientPalette(rgb);
}

const css = rgb => rgb.join(', ');

/** The poster's sampled colour as "r, g, b" when this device already knows it, else ''. Synchronous. */
export function cachedTone(path) {
  const cached = path ? store()[path] : null;
  return cached && Array.isArray(cached.v) ? css(cached.v) : '';
}

/** Tint `host` from the poster; a no-op (and cleared) when the preference is off. */
export async function applyAmbient(host, path) {
  if (!host) return;
  clearAmbient(host);
  // A newer title opened while this poster was sampling wins.
  const token = (host._ambientToken = (host._ambientToken || 0) + 1);
  if (!prefs.ambientColour || !path) return;
  const palette = await posterPalette(path);
  if (!palette || !host.isConnected || token !== host._ambientToken) return;
  host.dataset.ambientFor = path;
  host.style.setProperty('--amb-glow', css(palette.glow));
  host.style.setProperty('--amb-solid', css(palette.solid));
  host.style.setProperty('--amb-ink-dark', css(palette.inkDark));
  host.style.setProperty('--amb-ink-light', css(palette.inkLight));
  // Set on the next frame so the tint fades in rather than snapping.
  requestAnimationFrame(() => { if (token === host._ambientToken) host.dataset.ambient = 'on'; });
}

export function clearAmbient(host) {
  if (!host) return;
  host._ambientToken = (host._ambientToken || 0) + 1;
  delete host.dataset.ambient;
  delete host.dataset.ambientFor;
  ['--amb-glow', '--amb-solid', '--amb-ink-dark', '--amb-ink-light'].forEach(name => host.style.removeProperty(name));
}
