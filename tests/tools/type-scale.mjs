// Generates css/type-scale.css: a minimum type scale for the Stats and Settings
// pages.
//
// Measured in the browser, both pages rendered most of their supporting text at
// 6.7-10px (the TV Tracker's month labels at 6.7px, Settings' descriptions at
// 8.8px). Patching well over a hundred selectors by hand would miss some and
// would drift the moment a panel is added, so this reads the real stylesheets.
//
// Every rule that sets a font-size, and whose selector only uses classes the
// page's own modules render, is re-emitted scoped under that page's root
// (#statsContent, #settingsContent): sizes below 13.5px are lifted, everything
// else is copied unchanged. Copying the unchanged ones matters — scoping adds an
// id to every emitted rule, so a later, larger override left unscoped would lose
// to an earlier scoped one. Rules are emitted in their original source order.
//
// The lift is monotonic — [6.5px, 13.5px] onto [11px, 14px] — so each page keeps
// its hierarchy: what was smaller is still smaller, just readable.
//
//   node tests/tools/type-scale.mjs      (from the repository root)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUTPUT = 'css/type-scale.css';

const PAGES = [
  { root: '#statsContent', modules: ['js/stats.js', 'js/badges.js', 'js/diary.js'] },
  { root: '#settingsContent', modules: ['js/settings.js'] },
];

const FROM = [6.5, 13.5], TO = [11, 14];
export const scalePx = px => TO[0] + (px - FROM[0]) * (TO[1] - TO[0]) / (FROM[1] - FROM[0]);

const read = file => { try { return readFileSync(join(ROOT, file), 'utf8'); } catch (_) { return ''; } };

// Every class name a module can put in the DOM: tokens inside class attributes
// (template placeholders removed) and classList arguments.
function classesOf(modules) {
  const out = new Set();
  const addTokens = value => value.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)
    .forEach(token => { if (/^[a-z][\w-]*$/i.test(token)) out.add(token); });
  for (const file of modules) {
    const source = read(file);
    for (const match of source.matchAll(/class(?:Name)?\s*=\s*"([^"]*)"/g)) addTokens(match[1]);
    for (const match of source.matchAll(/class(?:Name)?\s*=\s*'([^']*)'/g)) addTokens(match[1]);
    for (const match of source.matchAll(/classList\.(?:add|toggle|remove)\(\s*['"]([\w-]+)['"]/g)) out.add(match[1]);
  }
  return out;
}

// Stylesheets in the order index.html loads them.
const stylesheets = [...read('index.html').matchAll(/<link rel="stylesheet" href="\/(css\/[\w.-]+\.css)">/g)]
  .map(match => match[1]).filter(file => file !== OUTPUT);

// A small CSS reader: comments removed, top-level rules plus one level of
// @media / @supports. Nested at-rules, @keyframes and @font-face are skipped.
function parseRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const walk = (body, media) => {
    let i = 0;
    while (i < body.length) {
      const open = body.indexOf('{', i);
      if (open < 0) break;
      const prelude = body.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < body.length && depth) {
        if (body[j] === '{') depth++;
        else if (body[j] === '}') depth--;
        j++;
      }
      const inner = body.slice(open + 1, j - 1);
      if (/^@(media|supports)/.test(prelude)) { if (!media) walk(inner, prelude); }
      else if (!prelude.startsWith('@')) rules.push({ selector: prelude, body: inner, media });
      i = j;
    }
  };
  walk(text, '');
  return rules;
}

function liftValue(raw) {
  const value = String(raw).trim();
  const match = value.match(/^([\d.]+)(rem|px)(\s*!important)?$/);
  if (!match) return value;
  const px = match[2] === 'rem' ? +match[1] * 16 : +match[1];
  if (px >= FROM[1]) return value;
  return `${+(Math.max(px, scalePx(px)) / 16).toFixed(3)}rem${match[3] ? ' !important' : ''}`;
}

// "html[data-x] .a .b" -> "html[data-x] #root .a .b"; ".a .b" -> "#root .a .b".
function scope(selector, root) {
  const lead = selector.match(/^((?:html|:root|body)[^\s>+~]*)\s*(.*)$/);
  if (lead) return lead[2] ? `${lead[1]} ${root} ${lead[2]}` : null;
  return `${root} ${selector}`;
}

function splitSelectors(selector) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < selector.length; i++) {
    if (selector[i] === '(') depth++;
    else if (selector[i] === ')') depth--;
    else if (selector[i] === ',' && !depth) { parts.push(selector.slice(start, i)); start = i + 1; }
  }
  parts.push(selector.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
}

const entries = [];   // { media, text }, in source order
let emitted = 0, lifted = 0;
for (const page of PAGES) {
  const classes = classesOf(page.modules);
  for (const file of stylesheets) {
    for (const rule of parseRules(read(file))) {
      const size = rule.body.match(/(?:^|;)\s*font-size\s*:\s*([^;]+)/);
      if (!size) continue;
      const selectors = splitSelectors(rule.selector).filter(selector => {
        if (selector.includes('#')) return false;
        const used = [...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(match => match[1]);
        return used.length > 0 && used.every(name => classes.has(name));
      }).map(selector => scope(selector, page.root)).filter(Boolean);
      if (!selectors.length) continue;
      const value = liftValue(size[1]);
      if (value !== String(size[1]).trim()) lifted++;
      entries.push({ media: rule.media, text: `${selectors.join(',\n')} { font-size: ${value}; }` });
      emitted++;
    }
  }
}

let css = `/* ===== STATS & SETTINGS TYPE SCALE =====
   GENERATED by tests/tools/type-scale.mjs — edit that script, not this file.
   Lifts every font-size below 13.5px on the Stats and Settings pages onto an
   11-14px scale that keeps the original hierarchy, scoped to each page's root.
   Unchanged sizes are copied too, so the original cascade order still holds. */
`;
// Consecutive rules under the same media query share one block; order is kept.
for (let i = 0; i < entries.length;) {
  const media = entries[i].media;
  const run = [];
  while (i < entries.length && entries[i].media === media) run.push(entries[i++].text);
  css += media
    ? `\n${media} {\n${run.map(rule => `  ${rule.replace(/\n/g, '\n  ')}`).join('\n')}\n}\n`
    : `\n${run.join('\n')}\n`;
}
writeFileSync(join(ROOT, OUTPUT), css);
console.log(`${OUTPUT}: ${emitted} rules (${lifted} lifted) from ${stylesheets.length} stylesheets`);
