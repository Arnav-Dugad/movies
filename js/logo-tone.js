// ===== TITLE-LOGO TONE =====
// Official title logos are mostly cut for dark backgrounds: white lettering
// that disappears on the light theme's paper. Each logo is sampled once (a
// tiny canvas read of its opaque pixels) and tagged data-tone="light" |
// "mixed" | "dark" | "color"; css/light.css turns white logos into ink and
// inverts the lightness of mixed ones while keeping their hues. Sampling needs a
// CORS-clean copy, which TMDB's image CDN serves; any failure leaves the logo
// untagged and exactly as it was. While the theme is dark only rail-heading
// logos are sampled.
const SELECTOR = '.hero-logo, .title-logo, .cvp-logo, .rail-logo';
const cache = new Map();

/**
 * Tone of a set of RGBA pixels: white art is 'light'; white type beside a
 * colourful mark is 'mixed'; near-black is 'dark'; anything else is 'color'.
 */
export function toneOfPixels(data) {
  let count = 0, luminance = 0, whites = 0, blacks = 0, chroma = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 140) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const c = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    count++; luminance += y; chroma += c;
    if (y > 0.82 && c < 0.18) whites++;
    if (y < 0.18) blacks++;
  }
  if (count < 12) return '';
  const mean = luminance / count;
  const whiteShare = whites / count, meanChroma = chroma / count;
  if (whiteShare >= 0.5 || (mean > 0.66 && meanChroma < 0.2)) return 'light';
  // White lettering vanishes on paper even when a colourful mark carries most
  // of the logo (The Dark Knight's white type beside a blue bat). Flattening
  // it to ink would blot the mark, so such logos keep their hues instead.
  if (whiteShare >= 0.12) return meanChroma >= 0.12 ? 'mixed' : 'light';
  if (blacks / count >= 0.5 || mean < 0.22) return 'dark';
  return 'color';
}

function sample(src) {
  if (cache.has(src)) return cache.get(src);
  const job = new Promise(resolve => {
    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.decoding = 'async';
    probe.onload = () => {
      try {
        const scale = Math.min(1, 96 / Math.max(probe.naturalWidth, probe.naturalHeight));
        const w = Math.max(1, Math.round(probe.naturalWidth * scale)), h = Math.max(1, Math.round(probe.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(probe, 0, 0, w, h);
        resolve(toneOfPixels(ctx.getImageData(0, 0, w, h).data));
      } catch (_) { resolve(''); }
    };
    probe.onerror = () => resolve('');
    // The page already holds a no-CORS copy in cache, and reusing it would taint
    // the canvas; a distinct URL makes the CDN answer the CORS request afresh.
    probe.src = `${src}${src.includes('?') ? '&' : '?'}cv-tone=1`;
  });
  cache.set(src, job);
  return job;
}

const lightTheme = () => document.documentElement.dataset.theme === 'light';

async function tag(img) {
  // Rail headings are sampled in both themes: a dark logo would vanish from a
  // dark rail heading just as a white one does on paper.
  if (!lightTheme() && !img.classList.contains('rail-logo')) return;
  const src = img.currentSrc || img.src;
  if (!src || img.dataset.toneSrc === src) return cache.get(src);
  img.dataset.toneSrc = src;
  const tone = await sample(src);
  if ((img.currentSrc || img.src) !== src) return;
  if (tone) img.dataset.tone = tone; else delete img.dataset.tone;
}

/** Tag every logo on the page; resolves when all have been sampled. */
export const tagAllLogos = () => Promise.all([...document.querySelectorAll(SELECTOR)].map(tag));

export function initLogoTone() {
  // Logos arrive in rendered markup, and the hero's are decoded off-page before
  // insertion, so no load event reaches the document. Watch for logos being
  // added (or re-pointed) instead; the probe fetches its own copy either way.
  document.querySelectorAll(SELECTOR).forEach(tag);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') { if (record.target.matches(SELECTOR)) tag(record.target); continue; }
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches(SELECTOR)) tag(node);
        else if (node.firstElementChild) node.querySelectorAll(SELECTOR).forEach(tag);
      }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
}
