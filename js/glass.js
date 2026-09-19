// ===== CINEMA GLASS =====
// With Settings → Glass effects on "Rich cinema glass" (the default), the site
// sits on a softly lit, blurred stage (the .aurora layer in index.html) and its
// surfaces are glass over it:
//   - panels let the stage's light through, carry a lit top edge, pick up a
//     faint sheen that travels across them as they scroll past, and (with a
//     mouse) catch a soft light where the pointer is;
//   - menus and dialogs are frosted: translucent, with the page behind blurred.
// Accent tints, highlights and images stay exactly as designed.
//
// How: the panels are styled by hundreds of rules across the stylesheets, and
// the light theme is compiled from those same rules at runtime (js/theme.js).
// Rather than rewrite them by hand, this module edits the matching rules IN
// PLACE through the CSSOM: only rules whose subject is a panel or a dialog, and
// in them only near-opaque NEUTRAL surface colours. Editing in place adds no
// rules, so the cascade (specificity, order, media queries) resolves exactly as
// written, and a theme switch costs no more style work than it did before
// glass. Every edit is recorded and can be undone: for "Quiet and focused", and
// around the light-theme compile, which must read the stylesheets as written.
//
// Theme tokens (var(--bg2)) are resolved per sheet: rules that apply in dark
// against the dark tokens, the compiled light palette and light-only rules
// against the light ones. Variables that are not theme tokens are left alone.

// Panels: a rule is glassed when one of these is its subject (the last compound
// of the selector), never merely an ancestor of it.
export const PANEL_CLASSES = ['stats-panel', 'stats-hero', 'stats-achievements', 'profile-panel', 'profile-connect-card', 'profile-taste-pass', 'settings-panel', 'settings-premium-hero', 'detail-accordion', 'stat-card', 'release-hero', 'release-card', 'notifications-hero', 'notification-card', 'discover-premium-hero', 'discover-studio', 'discover-surprise', 'mood-card', 'fp-hero', 'bo-page-hero', 'challenge-card', 'tv-card', 'pi-card', 'friend-code-card', 'show-progress', 'ep-heatmap', 'person-completion', 'person-link', 'loyalty-card', 'cast-row', 'club-badge', 'hm-readout-card', 'ep-card', 'wl-cover', 'watched-controls', 'wl-controls', 'bo-page-tools', 'release-toolbar', 'taste-match-result', 'fr-card', 'bo-chart-row', 'awards-section', 'year-hero', 'year-total', 'year-month', 'year-side', 'year-moments', 'year-genres'];
// Dialogs and menus: frosted, and a little more opaque so text over busy pages
// stays easy to read.
export const OVERLAY_CLASSES = ['profile-dd', 'rate-modal', 'auth-modal', 'pin-modal', 'import-modal', 'spoiler-share-modal', 'scan-modal', 'notification-drop'];

const classPattern = names => new RegExp(`\\.(${names.join('|')})(?![\\w-])`);
const PANEL = classPattern(PANEL_CLASSES);
const OVERLAY = classPattern(OVERLAY_CLASSES);

/** Surface alpha by kind and theme: dark glass lets more light through than paper. */
export const GLASS_ALPHA = { panel: { dark: 0.4, light: 0.52 }, overlay: { dark: 0.74, light: 0.8 } };
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

/** Pure: is this colour a SURFACE (near-opaque, neutral, dark or paper-light)? */
export function isSurface(rgba) {
  if (!rgba || rgba[3] < 0.75) return false;
  const { L, C } = lightnessChroma(rgba);
  return C <= 0.045 && (L <= 0.32 || L >= 0.8);
}

/** Pure: a value with its surface colours made translucent, or null when it has none. */
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

/** Pure: the comma-separated parts of a list (commas inside () or [] kept). */
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

const PSEUDO_ELEMENT = /::?(before|after|placeholder|selection|marker|backdrop|-webkit-scrollbar[\w-]*)/;
/** Pure: which kind of glass a selector's subject is: 'overlay', 'panel' or ''. */
export function glassKind(selector) {
  const subject = subjectOf(selector);
  if (PSEUDO_ELEMENT.test(subject)) return '';
  if (OVERLAY.test(subject)) return 'overlay';
  if (PANEL.test(subject)) return 'panel';
  return '';
}

/** Pure: the panel parts of a selector list, joined. */
export const panelSelector = selectorText => selectorParts(selectorText).filter(part => glassKind(part) === 'panel').join(', ');

// Each background layer list's initial value, for layers the CSSOM reports as "initial".
const LAYER_INITIAL = { 'background-image': 'none', 'background-size': 'auto', 'background-position': '0% 0%', 'background-repeat': 'repeat', 'background-attachment': 'scroll', 'background-origin': 'padding-box', 'background-clip': 'border-box' };

/**
 * Pure: a longhand value as the CSSOM reports it, made writable again. A
 * `background` shorthand whose last layer is only a colour reports that layer's
 * entries as "initial" ("radial-gradient(…), initial"), which is not valid when
 * written back as a list, so the edit (or its undo) would be silently dropped;
 * each such entry is written as the property's initial value instead.
 */
export function writableValue(prop, value) {
  if (!LAYER_INITIAL[prop]) return value;
  const layers = selectorParts(String(value));
  return layers.length > 1 ? layers.map(layer => (layer === 'initial' ? LAYER_INITIAL[prop] : layer)).join(', ') : value;
}

/** Pure: var(--x) references replaced from `tokens` (chains followed, others kept). */
export function resolveTokens(value, tokens) {
  let out = String(value);
  for (let pass = 0; pass < 4 && out.includes('var('); pass++) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (whole, name) => (tokens[name] !== undefined && tokens[name] !== '' ? tokens[name] : whole));
  }
  return out;
}

// The sheen: a faint diagonal band whose position follows the panel's place in
// the viewport (--glass-sheen, set on scroll) and whose strength comes from the
// page (--glass-sheen-a, 0 unless glass is on). It is the TOP layer of the
// panel's background: over its own gradients, under its content.
export const SHEEN_LAYER = 'linear-gradient(112deg, transparent calc(var(--glass-sheen, -60%) - 18%), rgba(255, 255, 255, var(--glass-sheen-a, 0)) var(--glass-sheen, -60%), transparent calc(var(--glass-sheen, -60%) + 18%))';
// The pointer light: a wide soft circle at --spot-x/--spot-y (set while a mouse
// is over the panel), as strong as --glass-spot-a (0 unless glass is on).
export const SPOT_LAYER = 'radial-gradient(circle 360px at var(--spot-x, -999px) var(--spot-y, -999px), rgba(255, 255, 255, var(--glass-spot-a, 0)), transparent 72%)';
/** Every layer glass adds on top of a panel's own background, top first. */
export const GLASS_LAYERS = [SPOT_LAYER, SHEEN_LAYER];
export const EDGE = 'inset 0 1px 0 var(--glass-edge, transparent)';
const LAYER_LISTS = { 'background-size': 'auto', 'background-position': '0% 0%', 'background-repeat': 'no-repeat' };
const unset = value => !value || /^initial(\s*,\s*initial)*$/.test(value);

/**
 * Pure: what to write into one rule, or null when it needs nothing.
 * @param {(prop) => { value, priority }} read  the rule's own declarations
 * @returns {{ prop, value, priority }[] | null}
 */
export function glassDeclarations(read, kind, alpha, tokens = {}) {
  const writes = [];
  for (const prop of ['background-color', 'background-image']) {
    const { value, priority } = read(prop);
    if (unset(value)) continue;
    const next = glassValue(resolveTokens(writableValue(prop, value), tokens), alpha);
    if (next) writes.push({ prop, value: next, priority });
  }
  // A panel rule with no surface colour of its own (a tinted gradient) still
  // gets the sheen and the pointer light when it paints an image; a dialog needs
  // a surface to frost.
  if (!writes.length && (kind === 'overlay' || unset(read('background-image').value))) return null;
  if (kind === 'overlay') {
    // One recipe for the whole site: css/apple.css names the same blur in
    // --glass-blur for the frosted things that are not panels.
    writes.push({ prop: 'backdrop-filter', value: 'blur(30px) saturate(185%)', priority: '' });
    writes.push({ prop: '-webkit-backdrop-filter', value: 'blur(30px) saturate(185%)', priority: '' });
    return writes;
  }
  // The sheen goes only where this rule itself paints an image, so it never
  // overrides another rule's image for the same panel.
  const imageRead = read('background-image');
  if (!unset(imageRead.value)) {
    const existing = writes.find(write => write.prop === 'background-image');
    const base = existing ? existing.value : writableValue('background-image', imageRead.value);
    const added = GLASS_LAYERS.join(', ');
    const layered = base === 'none' ? added : `${added}, ${base}`;
    if (existing) existing.value = layered; else writes.push({ prop: 'background-image', value: layered, priority: imageRead.priority });
    // This rule's own layer lists gain a leading entry for each glass layer, so
    // its layers keep their sizes, positions and repeats.
    const layerCount = base === 'none' ? 0 : selectorParts(base).length;
    for (const [prop, first] of Object.entries(LAYER_LISTS)) {
      const { value, priority } = read(prop);
      if (unset(value)) continue;
      const entries = selectorParts(writableValue(prop, value));
      const full = Array.from({ length: Math.max(layerCount, entries.length) }, (_, i) => entries[i % entries.length]);
      writes.push({ prop, value: [...GLASS_LAYERS.map(() => first), ...full].join(', '), priority });
    }
  }
  const shadow = read('box-shadow');
  if (!unset(shadow.value)) writes.push({ prop: 'box-shadow', value: shadow.value === 'none' ? EDGE : `${shadow.value}, ${EDGE}`, priority: shadow.priority });
  return writes;
}

// ---------- editing the live stylesheets ----------
const edits = [];            // undo log, oldest first
let sheetsDone = new WeakSet();
let active = false;

const isLightSheet = sheet => sheet.ownerNode?.id === 'cvLightTheme' || sheet.ownerNode?.dataset?.theme === 'light';

function readTokens(doc) {
  const dark = {}, light = {};
  const take = (rule, into) => { for (let i = 0; i < rule.style.length; i++) { const name = rule.style[i]; if (name.startsWith('--')) into[name] = rule.style.getPropertyValue(name).trim(); } };
  for (const sheet of doc.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch (_) { continue; }
    const lightSheet = isLightSheet(sheet);
    for (const rule of rules) {
      if (rule.selectorText === undefined || !rule.style) continue;
      if (/^(:root|html)$/.test(rule.selectorText)) take(rule, lightSheet ? light : dark);
      else if (/^:root\[data-theme="light"\]$/.test(rule.selectorText)) take(rule, light);
    }
  }
  return { dark, light: { ...dark, ...light } };
}

function writeAll(style, writes) {
  for (const { prop, value, priority } of writes) {
    edits.push({ kind: 'prop', style, prop, value: writableValue(prop, style.getPropertyValue(prop)), priority: style.getPropertyPriority(prop) });
    style.setProperty(prop, value, priority || '');
  }
}

function glassRules(rules, sheetLight, tokens) {
  for (const rule of [...rules]) {
    if (rule.selectorText !== undefined && rule.style) {
      if (rule.parentRule && rule.parentRule.selectorText !== undefined) continue;   // nested rules left alone
      const parts = selectorParts(rule.selectorText);
      const kinds = parts.map(glassKind);
      if (!kinds.some(Boolean)) continue;
      const light = sheetLight || /data-theme="light"/.test(rule.selectorText);
      const read = prop => ({ value: rule.style.getPropertyValue(prop), priority: rule.style.getPropertyPriority(prop) });
      const groups = ['panel', 'overlay']
        .map(kind => ({ kind, selector: parts.filter((_, i) => kinds[i] === kind).join(', ') }))
        .filter(group => group.selector)
        .map(group => ({ ...group, writes: glassDeclarations(read, group.kind, GLASS_ALPHA[group.kind][light ? 'light' : 'dark'], light ? tokens.light : tokens.dark) }));
      const planned = groups.filter(group => group.writes);
      if (!planned.length) continue;
      if (groups.length === 1 && kinds.every(Boolean)) { writeAll(rule.style, planned[0].writes); continue; }
      // A list mixing panels, dialogs and other elements is split: each glassed
      // group becomes its own rule right after the original, which keeps the rest.
      const parent = rule.parentRule || rule.parentStyleSheet;
      const inserted = [];
      let at = [...parent.cssRules].indexOf(rule);
      for (const group of planned) {
        const index = parent.insertRule(`${group.selector}{}`, ++at);
        const copy = parent.cssRules[index];
        for (let i = 0; i < rule.style.length; i++) { const prop = rule.style[i]; copy.style.setProperty(prop, writableValue(prop, rule.style.getPropertyValue(prop)), rule.style.getPropertyPriority(prop)); }
        for (const { prop, value, priority } of group.writes) copy.style.setProperty(prop, value, priority || '');
        inserted.push(copy);
      }
      const keep = [...parts.filter((_, i) => !kinds[i]), ...groups.filter(group => !group.writes).map(group => group.selector)];
      edits.push({ kind: 'split', rule, parent, selector: rule.selectorText, inserted });
      rule.selectorText = keep.length ? keep.join(', ') : ':not(*)';
    } else if (rule.cssRules && ['CSSMediaRule', 'CSSSupportsRule', 'CSSContainerRule'].includes(rule.constructor?.name)) {
      glassRules(rule.cssRules, sheetLight, tokens);
    }
  }
}

/** Glass every stylesheet not yet glassed. */
export function applyGlass(doc = document) {
  if (doc.documentElement.dataset.glass === 'quiet') return;
  active = true;
  const tokens = readTokens(doc);
  for (const sheet of doc.styleSheets) {
    if (sheetsDone.has(sheet)) continue;
    let rules; try { rules = sheet.cssRules; } catch (_) { continue; }
    sheetsDone.add(sheet);
    glassRules(rules, isLightSheet(sheet), tokens);
  }
}

/** Undo every edit, leaving the stylesheets exactly as written. */
export function removeGlass() {
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit = edits[i];
    try {
      if (edit.kind === 'prop') {
        if (edit.value) edit.style.setProperty(edit.prop, edit.value, edit.priority || '');
        else edit.style.removeProperty(edit.prop);
      } else {
        for (const copy of edit.inserted) { const index = [...edit.parent.cssRules].indexOf(copy); if (index >= 0) edit.parent.deleteRule(index); }
        edit.rule.selectorText = edit.selector;
      }
    } catch (_) {}
  }
  edits.length = 0;
  sheetsDone = new WeakSet();
  active = false;
}

export const glassEditCount = () => edits.length;

// ---------- the sheen follows the scroll ----------
const PANEL_SELECTOR = PANEL_CLASSES.map(name => `.${name}`).join(',');

/** Pure: the sheen's position (%) for a panel centred at `centerY` in a viewport `height` tall. */
export function sheenAt(centerY, height) {
  const progress = 1 - Math.max(-0.25, Math.min(1.25, centerY / Math.max(1, height)));
  return Math.round(-40 + progress * 180);
}

const visible = new Set();
const watched = new WeakSet();
let observer = null;
let frame = 0;
function paintSheens() {
  frame = 0;
  const height = window.innerHeight;
  for (const el of visible) {
    if (!el.isConnected) { visible.delete(el); continue; }
    const rect = el.getBoundingClientRect();
    const at = `${sheenAt(rect.top + rect.height / 2, height)}%`;
    if (el.style.getPropertyValue('--glass-sheen') !== at) el.style.setProperty('--glass-sheen', at);
  }
}
const schedule = () => { if (!frame) frame = requestAnimationFrame(paintSheens); };
function watchPanels() {
  if (!observer) return;
  document.querySelectorAll(PANEL_SELECTOR).forEach(el => { if (!watched.has(el)) { watched.add(el); observer.observe(el); } });
}

// ---------- the pointer light ----------
let spotPanel = null, spotFrame = 0, spotEvent = null;
function clearSpot() {
  if (!spotPanel) return;
  spotPanel.style.removeProperty('--spot-x');
  spotPanel.style.removeProperty('--spot-y');
  spotPanel = null;
}
function paintSpot() {
  spotFrame = 0;
  const event = spotEvent;
  if (!event) return;
  const panel = event.target?.closest?.(PANEL_SELECTOR) || null;
  if (panel !== spotPanel) clearSpot();
  if (!panel || !sheenAllowed()) return;
  const rect = panel.getBoundingClientRect();
  panel.style.setProperty('--spot-x', `${Math.round(event.clientX - rect.left)}px`);
  panel.style.setProperty('--spot-y', `${Math.round(event.clientY - rect.top)}px`);
  spotPanel = panel;
}

function sheenAllowed() {
  const root = document.documentElement;
  if (root.dataset.glass === 'quiet' || root.dataset.motion === 'reduced') return false;
  if (root.dataset.motion !== 'full' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  return true;
}

export function initGlass() {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const root = document.documentElement;
  // The light theme compiles from the stylesheets as written: glass steps aside
  // for the compile and then glasses the new light sheet too.
  window.CVGlassHooks = {
    beforeCompile: () => { if (active) removeGlass(); },
    afterCompile: () => { if (root.dataset.glass !== 'quiet') applyGlass(); },
  };
  if (root.dataset.glass !== 'quiet') applyGlass();
  let glass = root.dataset.glass;
  new MutationObserver(() => {
    if (root.dataset.glass === glass) return;
    glass = root.dataset.glass;
    if (glass === 'quiet') removeGlass(); else applyGlass();
  }).observe(root, { attributes: true, attributeFilter: ['data-glass'] });

  if (typeof IntersectionObserver === 'function' && document.body) {
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) { if (entry.isIntersecting) visible.add(entry.target); else visible.delete(entry.target); }
      if (sheenAllowed()) schedule();
    });
    watchPanels();
    let pending = 0;
    new MutationObserver(() => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; watchPanels(); }); }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('scroll', () => { if (sheenAllowed()) schedule(); }, { passive: true, capture: true });
    window.addEventListener('resize', () => { if (sheenAllowed()) schedule(); }, { passive: true });
  }

  // The pointer light is for a mouse or trackpad: touch has no hover to follow.
  if (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) {
    document.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse') return;
      spotEvent = event;
      if (!spotFrame) spotFrame = requestAnimationFrame(paintSpot);
    }, { passive: true });
    document.addEventListener('pointerleave', () => { spotEvent = null; clearSpot(); }, { passive: true });
    window.addEventListener('blur', () => { spotEvent = null; clearSpot(); });
  }
}
