// ===== CINEMA GLASS =====
// With Settings → Glass effects on "Rich cinema glass" (the default), the site
// sits on a softly lit, blurred stage (the .aurora layer in index.html), and its
// panels are frosted glass over it: their surface colour lets the stage's light
// through, while their own accent tints stay exactly as designed.
//
// The panels are styled in dozens of rules across the stylesheets, each with its
// own gradient, and the light theme is compiled from those same rules
// (js/theme.js). So rather than rewrite them by hand, this module reads them:
// for every rule whose subject is a panel, it copies the background colours and
// turns only the near-opaque NEUTRAL surface colours translucent. Coloured
// accents, highlights and images are untouched. The copies go in one stylesheet
// after all the others, in the same order and inside the same @media wrappers,
// so the cascade resolves exactly as before, just with glass. It follows the
// theme: rebuilt whenever the theme or the glass setting changes, from whichever
// palette is active. "Quiet and focused" removes it entirely.

// Panel families: a rule is glassed when one of these is its subject (the last
// part of the selector), never merely an ancestor of it.
const FAMILY = /\.(stats-panel|stats-hero|stats-achievements|profile-panel|profile-connect-card|profile-taste-pass|settings-panel|settings-premium-hero|detail-accordion|stat-card|release-hero|release-card|notifications-hero|notification-card|discover-premium-hero|discover-studio|discover-surprise|mood-card|fp-hero|bo-page-hero|challenge-card|tv-card|pi-card|friend-code-card|show-progress|countdown|ep-heatmap|person-completion|person-link|loyalty-card|cast-row|club-badge|hm-readout-card|coll-standing|ep-card|ep-list|wl-cover|watched-controls|wl-controls|bo-page-tools|release-toolbar|taste-match-result|franchise-card|fr-card|fp-part|bo-chart-row|bo-league-row|search-section|notification-drop|awards-section|where-to-watch|provider-panel|review-card|collab-list-card)(?![\w-])/;

// Surface alpha by theme: dark glass lets more light through than paper does.
export const GLASS_ALPHA = { dark: 0.5, light: 0.6 };
const COLOR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\(\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*(?:[,/]\s*[\d.]+%?\s*)?\)/gi;

/** Pure: [r, g, b, a] from a hex or rgb()/rgba() string, or null. */
export function parseColor(text) {
  const value = String(text || '').trim().toLowerCase();
  if (value.startsWith('#')) {
    let hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map(c => c + c).join('');
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(hex)) return null;
    const n = [0, 2, 4, 6].map(i => (i < hex.length ? parseInt(hex.slice(i, i + 2), 16) : 255));
    return [n[0], n[1], n[2], +(n[3] / 255).toFixed(3)];
  }
  const match = value.match(/^rgba?\((.*)\)$/);
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channel = part => (part.endsWith('%') ? parseFloat(part) * 2.55 : parseFloat(part));
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  const out = [channel(parts[0]), channel(parts[1]), channel(parts[2]), alpha];
  return out.every(Number.isFinite) ? out : null;
}

const toLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** Pure: OKLCH lightness and chroma of an sRGB colour. */
export function lightnessChroma([r, g, b]) {
  const lr = toLinear(r / 255), lg = toLinear(g / 255), lb = toLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { L, C: Math.hypot(A, B) };
}

/** Pure: is this colour a panel SURFACE (near-opaque, neutral, dark or paper-light)? */
export function isSurface(rgba) {
  if (!rgba || rgba[3] < 0.75) return false;
  const { L, C } = lightnessChroma(rgba);
  return C <= 0.045 && (L <= 0.32 || L >= 0.8);
}

/**
 * Pure: a background value with its surface colours made translucent. Returns
 * null when nothing in it is a surface (the rule needs no glass copy).
 */
export function glassValue(value, alpha) {
  let changed = false;
  const next = String(value).replace(COLOR, token => {
    const rgba = parseColor(token);
    if (!isSurface(rgba)) return token;
    changed = true;
    const a = Math.min(rgba[3], alpha);
    return `rgba(${Math.round(rgba[0])}, ${Math.round(rgba[1])}, ${Math.round(rgba[2])}, ${a})`;
  });
  return changed ? next : null;
}

/** Pure: the comma-separated parts of a selector list (commas inside :is() kept). */
export function selectorParts(text) {
  const parts = []; let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

/** Pure: the subject compound of one selector (after its last combinator). */
export function subjectOf(selector) {
  let depth = 0, cut = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) cut = i + 1;
  }
  return selector.slice(cut).trim();
}

/** Pure: the parts of a selector list whose subject is a panel (no pseudo-elements). */
export function panelSelector(selectorText) {
  const keep = selectorParts(selectorText).filter(part => {
    const subject = subjectOf(part);
    return FAMILY.test(subject) && !/::?(before|after|placeholder|selection|marker|backdrop)/.test(subject);
  });
  return keep.join(', ');
}

// ---------- compiling the live stylesheets ----------
// Why every background declaration is copied, not only the panels': the copies
// sit after all the original sheets. Were only panel rules copied, a panel's
// copy would outrank any other rule of equal specificity that also paints that
// element (".profile-clubs" beside ".profile-panel", a hover state), because it
// comes later. Copying every background declaration, unchanged except for panel
// surfaces, in the original order, makes the copies decide among themselves
// exactly as the originals did.
// Only the global surface tokens are resolved (from :root, where they are set,
// in either theme). A variable a panel might set locally is left as it is: its
// root value could be the wrong colour for that panel.
const GLOBAL_SURFACE = /^--(bg\d?|surface\d?)$/;
function resolver(root) {
  const memo = new Map();
  return value => value.replace(/var\(\s*(--[\w-]+)\s*(?:,[^()]*)?\)/g, (whole, name) => {
    if (!GLOBAL_SURFACE.test(name)) return whole;
    if (!memo.has(name)) memo.set(name, getComputedStyle(root).getPropertyValue(name).trim());
    const resolved = memo.get(name);
    return parseColor(resolved) ? resolved : whole;
  });
}

const PROPS = ['background-color', 'background-image'];

/**
 * Pure: a longhand value as the CSSOM reports it, made writable again. A
 * `background` shorthand whose last layer is only a colour reports that layer's
 * image as "initial" ("radial-gradient(…), initial"), which is not valid when
 * written back as a background-image list; the layer's image is none.
 */
export function writableValue(prop, value) {
  if (prop !== 'background-image') return value;
  const layers = selectorParts(value);
  return layers.length > 1 ? layers.map(layer => (layer === 'initial' ? 'none' : layer)).join(', ') : value;
}

function block(style, transform) {
  let body = '';
  for (const prop of PROPS) {
    const raw = writableValue(prop, style.getPropertyValue(prop));
    if (!raw) continue;
    const value = transform ? transform(raw) : raw;
    body += `${prop}:${value}${style.getPropertyPriority(prop) ? ' !important' : ''};`;
  }
  return body;
}

/** Copies of a rule list's background declarations; panel surfaces made glass. */
export function compileRules(rules, alpha, resolve = value => value) {
  let css = '';
  const glassed = raw => glassValue(resolve(raw), alpha) || raw;
  for (const rule of rules) {
    if (rule.selectorText !== undefined && rule.style) {
      const panels = panelSelector(rule.selectorText);
      const others = panels ? selectorParts(rule.selectorText).filter(part => !selectorParts(panels).includes(part)).join(', ') : rule.selectorText;
      if (others) { const body = block(rule.style); if (body) css += `${others}{${body}}\n`; }
      if (panels) { const body = block(rule.style, glassed); if (body) css += `${panels}{${body}}\n`; }
    } else if (rule.cssRules && rule.cssRules.length) {
      const inner = compileRules(rule.cssRules, alpha, resolve);
      if (!inner) continue;
      const kind = rule.constructor?.name;
      const condition = rule.conditionText || rule.media?.mediaText || '';
      if (kind === 'CSSMediaRule') css += `@media ${condition}{\n${inner}}\n`;
      else if (kind === 'CSSSupportsRule') css += `@supports ${condition}{\n${inner}}\n`;
      else if (kind === 'CSSContainerRule') css += `@container ${condition}{\n${inner}}\n`;
      // Anything else (keyframes, font faces) sets no page backgrounds.
    }
  }
  return css;
}

const STYLE_ID = 'cvGlass';
export function compileGlass(doc = document) {
  const root = doc.documentElement;
  let style = doc.getElementById(STYLE_ID);
  if (root.dataset.glass === 'quiet') { if (style) style.textContent = ''; return ''; }
  const theme = root.dataset.theme === 'light' ? 'light' : 'dark';
  const view = doc.defaultView;
  const sheets = [...doc.styleSheets].filter(sheet => {
    const node = sheet.ownerNode;
    if (!node || node.id === STYLE_ID || sheet.disabled) return false;
    // A sheet that does not apply right now (the compiled light palette while
    // dark) must not be copied.
    const media = sheet.media?.mediaText;
    if (media && view?.matchMedia && !view.matchMedia(media).matches) return false;
    try { return !!sheet.cssRules; } catch (_) { return false; }
  });
  const resolve = resolver(root);
  const css = sheets.map(sheet => compileRules(sheet.cssRules, GLASS_ALPHA[theme], resolve)).join('');
  if (!style) { style = doc.createElement('style'); style.id = STYLE_ID; doc.head.appendChild(style); }
  style.textContent = css;
  return css;
}

export function initGlass() {
  if (typeof document === 'undefined' || !document.documentElement) return;
  compileGlass();
  // The theme switch and the glass setting both change what the copies must be.
  let theme = document.documentElement.dataset.theme, glass = document.documentElement.dataset.glass;
  new MutationObserver(() => {
    const root = document.documentElement;
    if (root.dataset.theme === theme && root.dataset.glass === glass) return;
    theme = root.dataset.theme; glass = root.dataset.glass;
    compileGlass();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-glass'] });
}
