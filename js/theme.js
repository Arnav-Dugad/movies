// ===== LIGHT THEME ENGINE =====
// CineVerse is designed dark: ~550 KB of CSS with hundreds of hand-picked colours
// beyond the tokens in variables.css. Rather than fork every stylesheet, the
// light theme is COMPILED from them at runtime, once, before first paint:
//
//   1. Walk every same-origin stylesheet in document order.
//   2. For each rule, copy only its colour-bearing declarations (color,
//      backgrounds, borders, shadows, SVG paints, custom properties…) into a new
//      rule with the SAME selector inside the SAME @media/@supports wrappers.
//   3. Rewrite each colour in OKLCH: neutrals flip lightness along a tuned curve
//      (near-black surfaces become paper, near-white ink becomes charcoal) while
//      keeping hue; saturated accents keep their colour and are only darkened
//      where they were too bright to read on paper; dark shadows stay dark but
//      soften. Ink sitting on a saturated fill (white on the red button) is kept.
//
// Why the cascade still resolves correctly: every colour declaration is copied —
// changed or not — with identical specificity, in identical order, after all the
// originals. So among colour properties the copies alone decide the winner, in
// exactly the way the originals did. Switching back to dark just disables the
// compiled sheet. css/light.css then hand-tunes what a formula cannot know
// (tokens, the nav glass, text on artwork), scoped to :root[data-theme="light"].
//
// This file is a classic script, not a module, so it runs synchronously in
// <head> after the stylesheets have loaded and before anything paints — a light
// reader never sees a dark flash. js/theme-toggle.js adds the toggle and motion.
(function (root) {
  'use strict';

  const PREFS_KEY = 'cv_experience_v2';
  const STYLE_ID = 'cvLightTheme';
  const META = { dark: '#06060b', light: '#f6f5f1' };

  // ---------- colour maths (OKLab / OKLCH, Björn Ottosson) ----------
  const toLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const toGamma = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

  function rgbToOklch(r, g, b) {
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
    const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
    const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
    const s = Math.pow(L - 0.0894841775 * A - 1.2914855480 * B, 3);
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ].map(toGamma);
  }

  // Out-of-gamut results lose chroma (never lightness) until they fit.
  function inGamut(L, C, h) {
    let rgb = oklchToRgb(L, C, h);
    if (rgb.every(v => v >= -0.001 && v <= 1.001)) return rgb;
    let lo = 0, hi = C;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (oklchToRgb(L, mid, h).every(v => v >= -0.001 && v <= 1.001)) lo = mid; else hi = mid;
    }
    return oklchToRgb(L, lo, h);
  }

  // Lightness curve for neutrals: [dark-theme L, light-theme L]. Surfaces
  // (L .08–.3) land on warm paper .98–.88; secondary ink (.6–.75) lands where it
  // still clears 4.5:1 on paper; primary ink (.95) becomes charcoal.
  const CURVE = [[0, 1], [0.1, 0.978], [0.14, 0.962], [0.2, 0.935], [0.3, 0.875], [0.45, 0.74], [0.6, 0.52], [0.73, 0.45], [0.85, 0.33], [0.95, 0.235], [1, 0.19]];
  function flipL(L) {
    if (L <= 0) return CURVE[0][1];
    for (let i = 1; i < CURVE.length; i++) {
      const [x1, y1] = CURVE[i], [x0, y0] = CURVE[i - 1];
      if (L <= x1) return y0 + (y1 - y0) * ((L - x0) / (x1 - x0));
    }
    return CURVE[CURVE.length - 1][1];
  }

  const NEUTRAL_C = 0.035;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /**
   * One colour, rewritten for paper. `mode`:
   *   'paint'  — fills, borders, backgrounds (the default)
   *   'ink'    — text and icon strokes: saturated colours deepen further, since
   *              a hue that is fine as a fill can be too pale to read as type
   *   'shadow' — box shadows: dark stays dark and softens; light glows stay
   *   'text-shadow' — text shadows: dark halos lighten to match flipped ink
   *   'keep'   — returned unchanged (ink on a saturated fill)
   */
  function transformRGBA(r, g, b, a, mode) {
    if (mode === 'keep') return [r, g, b, a];
    const { L, C, h } = rgbToOklch(r, g, b);
    const neutral = C < NEUTRAL_C;
    if (mode === 'shadow') {
      if (L < 0.35) return [r, g, b, +(a * 0.42).toFixed(3)];
      return [r, g, b, a];
    }
    if (mode === 'text-shadow' && neutral) {
      if (L < 0.35) { const out = inGamut(0.99, 0, h).map(v => clamp(Math.round(v * 255), 0, 255)); return [...out, +(a * 0.55).toFixed(3)]; }
      return [r, g, b, +(a * 0.3).toFixed(3)];
    }
    let nextL = L, nextC = C;
    if (neutral) {
      nextL = flipL(L);
      // Neutral surfaces pick up the faintest warmth instead of the dark theme's
      // blue cast: paper, not a cold screen.
      if (nextL > 0.8) return [...inGamut(nextL, 0.0045, 1.35).map(v => clamp(Math.round(v * 255), 0, 255)), a];
      nextC = C * 0.8;
    } else if (L < 0.42) {
      // Dark tinted surfaces (the After Dark plum, deep reds) become pale tints.
      nextL = Math.min(0.955, flipL(L));
      nextC = Math.min(C, 0.05) * 0.9;
    } else if (mode === 'ink' && L > 0.6) {
      // Bright accent type (cyan figures, gold stars, lilac labels) sinks to
      // a depth that still reads as its hue but clears contrast on paper.
      nextL = 0.6 - (L - 0.6) * 0.4;
    } else if (L > 0.74) {
      // Bright accent fills that glowed on black are deepened to sit on paper.
      nextL = 0.74 - (L - 0.74) * 0.55;
    }
    const rgb = inGamut(nextL, nextC, h).map(v => clamp(Math.round(v * 255), 0, 255));
    return [...rgb, a];
  }

  // ---------- value parsing ----------
  const NAMED = { white: [255, 255, 255], black: [0, 0, 0] };

  function parseHex(hex) {
    let s = hex.slice(1);
    if (s.length === 3 || s.length === 4) s = s.split('').map(c => c + c).join('');
    const n = parseInt(s, 16);
    if (s.length === 6) return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    if (s.length === 8) return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), +(parseInt(s.slice(6, 8), 16) / 255).toFixed(3)];
    return null;
  }

  function parseFn(name, body) {
    const parts = body.replace(/\s*\/\s*/, ' / ').split(/[\s,]+/).filter(p => p && p !== '/');
    if (parts.length < 3) return null;
    const num = (p, scale) => (p.endsWith('%') ? parseFloat(p) / 100 * scale : parseFloat(p));
    let alpha = parts[3] != null ? num(parts[3], 1) : 1;
    if (!Number.isFinite(alpha)) return null;
    if (name.startsWith('rgb')) {
      const [r, g, b] = parts.slice(0, 3).map(p => num(p, 255));
      return [r, g, b].every(Number.isFinite) ? [r, g, b, alpha] : null;
    }
    const hue = parseFloat(parts[0]), sat = parseFloat(parts[1]) / 100, lig = parseFloat(parts[2]) / 100;
    if (![hue, sat, lig].every(Number.isFinite)) return null;
    const k = n => (n + hue / 30) % 12;
    const f = n => lig - sat * Math.min(lig, 1 - lig) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0) * 255, f(8) * 255, f(4) * 255, alpha];
  }

  const fmt = ([r, g, b, a]) => (a >= 1 ? `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})` : `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${+(+a).toFixed(3)})`);
  const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(([^()]*)\)|\b(white|black)\b/g;
  const COLOR_HINT = /#|%23|rgb|hsl|white|black/i;   // cheap pre-check: most values hold no colour

  function parseColor(token) {
    if (token[0] === '#') { const len = token.length - 1; return len === 3 || len === 4 || len === 6 || len === 8 ? parseHex(token) : null; }
    const fn = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(token);
    if (fn) return parseFn(fn[1], fn[2]);
    return NAMED[token] ? [...NAMED[token], 1] : null;
  }

  // Replace colours in a value, leaving url(...) contents alone except the
  // url-encoded hex inside inline SVG icons. The stylesheets repeat the same
  // few hundred values thousands of times, so results are memoised.
  const valueMemo = new Map();
  function transformValue(value, mode) {
    const key = mode + '|' + value;
    let out = valueMemo.get(key);
    if (out === undefined) { out = transformValueUncached(value, mode); valueMemo.set(key, out); }
    return out;
  }
  function transformValueUncached(value, mode) {
    if (!COLOR_HINT.test(value)) return value;
    let out = '', i = 0;
    while (i < value.length) {
      const at = value.indexOf('url(', i);
      const end = at < 0 ? value.length : at;
      out += value.slice(i, end).replace(COLOR_RE, token => {
        const rgba = parseColor(token);
        return rgba ? fmt(transformRGBA(rgba[0], rgba[1], rgba[2], rgba[3], mode)) : token;
      });
      if (at < 0) break;
      const close = matchParen(value, at + 3);
      const inner = value.slice(at, close + 1);
      out += inner.indexOf('svg') >= 0
        ? inner.replace(/%23([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g, (m, hex) => {
            const rgba = parseHex('#' + hex);
            const [r, g, b] = transformRGBA(rgba[0], rgba[1], rgba[2], 1, mode);
            return '%23' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
          })
        : inner;
      i = close + 1;
    }
    return out;
  }

  function matchParen(text, open) {
    let depth = 0, quote = '';
    for (let i = open; i < text.length; i++) {
      const c = text[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === '(') depth++;
      else if (c === ')' && --depth === 0) return i;
    }
    return text.length - 1;
  }

  // Split a declaration block's cssText at top-level semicolons.
  function declarations(cssText) {
    const out = [];
    let depth = 0, quote = '', start = 0;
    for (let i = 0; i <= cssText.length; i++) {
      const c = cssText[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
      else if ((c === ';' && depth === 0) || i === cssText.length) {
        const piece = cssText.slice(start, i).trim();
        start = i + 1;
        const colon = piece.indexOf(':');
        if (colon <= 0) continue;
        let value = piece.slice(colon + 1).trim(), important = false;
        if (/!\s*important$/i.test(value)) { important = true; value = value.replace(/\s*!\s*important$/i, ''); }
        out.push({ prop: piece.slice(0, colon).trim(), value, important });
      }
    }
    return out;
  }

  const COLOR_PROP = /^(--.+|color|background(-color|-image)?|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|box-shadow|text-shadow|fill|stroke|stop-color|flood-color|caret-color|accent-color|column-rule(-color)?|text-decoration(-color)?|text-emphasis(-color)?|-webkit-text-fill-color|-webkit-text-stroke(-color)?|scrollbar-color|filter|-webkit-tap-highlight-color)$/;
  const INK_PROP = /^(color|-webkit-text-fill-color|fill|stroke|caret-color|text-decoration-color|-webkit-text-stroke(-color)?)$/;
  // Rules copied untouched: the switch's own bloom and knob, whose colours are
  // the same in both themes by design.
  const KEEP_SELECTOR = /(^|,\s*):root(\.theme-bloom)?::after$|\.theme-wipe\b|\.theme-switch-track\b/;
  // Dark islands: artwork cards whose copy sits directly on a photograph. They
  // keep the cinema palette in both themes (css/light.css re-declares the dark
  // tokens on them), because a paper wash over a film still reads as fog.
  const ISLAND = /\.(discover-spotlight-(card|shade|copy)|coll-banner|wl-cover)\b/;
  const splitSelectors = text => {
    const parts = []; let depth = 0, start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '(') depth++; else if (c === ')') depth--; else if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
    }
    parts.push(text.slice(start));
    return parts;
  };
  const keepRule = selector => KEEP_SELECTOR.test(selector) || splitSelectors(selector).every(part => ISLAND.test(part));
  const BG_PROP = /^background(-color|-image)?$/;

  // Is this background a saturated, mostly opaque fill that ink must stay legible on?
  function saturatedFill(value, tokens, seen = 0) {
    let found = false;
    value.replace(COLOR_RE, token => {
      const rgba = parseColor(token);
      if (rgba && rgba[3] >= 0.55 && rgbToOklch(rgba[0], rgba[1], rgba[2]).C >= 0.09) found = true;
      return token;
    });
    if (found || seen > 3) return found;
    return (value.match(/var\(\s*(--[\w-]+)/g) || []).some(ref => {
      const name = ref.replace(/var\(\s*/, '');
      return tokens[name] ? saturatedFill(tokens[name], tokens, seen + 1) : false;
    });
  }

  function modeFor(prop) {
    if (prop === 'box-shadow' || prop === 'filter' || (prop.startsWith('--') && /shadow/i.test(prop))) return 'shadow';
    if (prop === 'text-shadow') return 'text-shadow';
    return INK_PROP.test(prop) ? 'ink' : 'paint';
  }

  // An opaque near-white fill that carries no ink, or literal dark ink, is a
  // plate: a studio logo card, a QR code, a switch knob, a white pill button.
  // It is already a light object, so it stays exactly as drawn — a QR code must.
  const lightness = value => {
    const rgba = parseColor(value.trim());
    return rgba && rgba[3] >= 1 ? rgbToOklch(rgba[0], rgba[1], rgba[2]) : null;
  };
  function isPlate(decls) {
    const fill = decls.some(d => BG_PROP.test(d.prop) && (c => c && c.L > 0.95 && c.C < 0.02)(lightness(d.value)));
    if (!fill) return false;
    const ink = decls.find(d => d.prop === 'color');
    if (!ink) return true;
    const c = lightness(ink.value);
    return !!c && c.L < 0.35;
  }

  function compileBlock(style, tokens, keepAll = false) {
    const decls = declarations(style.cssText);
    const inkOnFill = decls.some(d => BG_PROP.test(d.prop) && saturatedFill(d.value, tokens));
    const plate = isPlate(decls);
    let out = '';
    for (const { prop, value, important } of decls) {
      if (!COLOR_PROP.test(prop)) continue;
      let mode = keepAll ? 'keep' : modeFor(prop);
      if (inkOnFill && INK_PROP.test(prop)) mode = 'keep';
      if (plate && (BG_PROP.test(prop) || prop === 'color')) mode = 'keep';
      // filter only carries colour inside drop-shadow(); everything else is copied as-is.
      const next = mode === 'keep' ? value : prop === 'filter' ? value.replace(/drop-shadow\(([^()]*(\([^()]*\))?[^()]*)\)/g, m => transformValue(m, 'shadow')) : transformValue(value, mode);
      out += `${prop}:${next}${important ? ' !important' : ''};`;
    }
    return out;
  }

  function compileRules(rules, tokens) {
    let css = '';
    for (const rule of rules) {
      if (rule.type === 1) {                       // style rule
        const body = compileBlock(rule.style, tokens, keepRule(rule.selectorText));
        const nested = rule.cssRules && rule.cssRules.length ? compileRules(rule.cssRules, tokens) : '';
        if (body || nested) css += `${rule.selectorText}{${body}${nested}}\n`;
      } else if (rule.type === 4 || rule.type === 12) { // @media, @supports
        const inner = compileRules(rule.cssRules, tokens);
        if (inner) css += `@${rule.type === 4 ? 'media' : 'supports'} ${rule.conditionText || (rule.media && rule.media.mediaText)}{\n${inner}}\n`;
      } else if (rule.type === 7) {                // @keyframes: copied whole when it animates colour
        let frames = '', coloured = false;
        for (const frame of rule.cssRules) {
          const body = frame.style.cssText;
          if (!COLOR_RE.test(body)) { COLOR_RE.lastIndex = 0; frames += `${frame.keyText}{${body}}`; continue; }
          COLOR_RE.lastIndex = 0;
          coloured = true;
          frames += `${frame.keyText}{${declarations(body).map(({ prop, value, important }) => `${prop}:${COLOR_PROP.test(prop) ? transformValue(value, modeFor(prop)) : value}${important ? ' !important' : ''};`).join('')}}`;
        }
        if (coloured) css += `@keyframes ${rule.name}{${frames}}\n`;
      }
    }
    return css;
  }

  // The dark theme's own token values, so `background: var(--red)` can be
  // recognised as a saturated fill.
  function collectTokens(sheets) {
    const tokens = {};
    const visit = rules => {
      for (const rule of rules) {
        if (rule.type === 1 && /^(:root|html)$/.test(rule.selectorText)) {
          for (const d of declarations(rule.style.cssText)) if (d.prop.startsWith('--')) tokens[d.prop] = d.value;
        }
      }
    };
    sheets.forEach(sheet => visit(sheet.cssRules));
    return tokens;
  }

  function sourceSheets(doc) {
    return [...doc.styleSheets].filter(sheet => {
      const node = sheet.ownerNode;
      if (!node || node.id === STYLE_ID || node.dataset?.theme === 'light') return false;
      try { return !!sheet.cssRules; } catch (_) { return false; }  // cross-origin (fonts)
    });
  }

  function compile(doc) {
    const sheets = sourceSheets(doc);
    const tokens = collectTokens(sheets);
    return sheets.map(sheet => compileRules(sheet.cssRules, tokens)).join('');
  }

  // ---------- applying ----------
  function stored() {
    try { return JSON.parse(root.localStorage.getItem(PREFS_KEY) || '{}').theme; } catch (_) { return undefined; }
  }

  const systemLight = () => { try { return root.matchMedia('(prefers-color-scheme: light)').matches; } catch (_) { return false; } };
  const resolve = choice => (choice === 'light' || (choice === 'system' && systemLight()) ? 'light' : 'dark');

  function apply(choice) {
    const doc = root.document;
    const theme = resolve(choice);
    const html = doc.documentElement;
    let style = doc.getElementById(STYLE_ID);
    if (theme === 'light' && !style) {
      const started = root.performance ? root.performance.now() : 0;
      style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = compile(doc);
      valueMemo.clear();   // the compile runs once per page; free its scratch space
      // Before css/light.css, so the hand-tuned layer always has the last word.
      const anchor = doc.querySelector('link[data-theme="light"]');
      if (anchor) anchor.parentNode.insertBefore(style, anchor); else doc.head.appendChild(style);
      api.compileMs = root.performance ? Math.round(root.performance.now() - started) : 0;
    }
    if (style) style.media = theme === 'light' ? 'all' : 'not all';
    html.dataset.theme = theme;
    html.style.colorScheme = theme;
    const meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', META[theme]);
    return theme;
  }

  const api = { rgbToOklch, oklchToRgb, flipL, transformRGBA, transformValue, declarations, compileBlock, compileRules, parseColor, resolve, apply, stored, compileMs: 0, META };
  root.CVTheme = api;

  if (root.document && root.document.documentElement) {
    const choice = stored() || 'dark';
    apply(choice);
    if (root.matchMedia) {
      try {
        root.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
          if (stored() === 'system') apply('system');
        });
      } catch (_) {}
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
