// The light-theme compiler (js/theme.js): colour maths, value rewriting, and
// the rules that keep the cascade and legibility intact.
import { check, summary } from './harness.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// js/theme.js is a classic script that installs window.CVTheme. Run it in a
// sandbox with no document, so it defines the API without applying anything.
const sandbox = { window: {}, matchMedia: () => ({ matches: false }) };
sandbox.window.matchMedia = sandbox.matchMedia;
vm.runInNewContext(readFileSync(new URL('../../js/theme.js', import.meta.url), 'utf8'), sandbox);
const T = sandbox.window.CVTheme;
check('theme.js installs its API without a document', T && typeof T.compileRules === 'function');

const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const flip = (h, mode = 'paint') => T.transformRGBA(...hex(h), 1, mode);

// ---------- colour maths ----------
const round = T.oklchToRgb(...Object.values(T.rgbToOklch(229, 9, 20)));
check('OKLCH round-trips sRGB', round.every((v, i) => Math.abs(v * 255 - [229, 9, 20][i]) < 1), JSON.stringify(round.map(v => v * 255)));
check('the lightness curve is monotonic', Array.from({ length: 21 }, (_, i) => T.flipL(i / 20)).every((v, i, a) => !i || v <= a[i - 1]));

// ---------- neutrals flip, accents hold ----------
const paper = flip('#06060b');
check('the darkest surface becomes warm stone, not white', T.rgbToOklch(...paper).L > 0.88 && T.rgbToOklch(...paper).L < 0.94 && paper[0] > paper[2], JSON.stringify(paper));
check('primary ink becomes charcoal', T.rgbToOklch(...flip('#f0f0f5')).L < 0.3);
check('secondary ink (--text3) still clears 4.5:1 on the new paper', contrast(flip('#767f8d', 'ink'), paper) >= 4.5, contrast(flip('#767f8d', 'ink'), paper).toFixed(2));
check('--text2 clears AA with room to spare and stays above --text3', contrast(flip('#9ca3af', 'ink'), paper) >= 6 && contrast(flip('#9ca3af', 'ink'), paper) > contrast(flip('#767f8d', 'ink'), paper), contrast(flip('#9ca3af', 'ink'), paper).toFixed(2));
check('alpha survives a flip', T.transformRGBA(255, 255, 255, 0.06, 'paint')[3] === 0.06);
const red = T.rgbToOklch(...flip('#e50914')), redBefore = T.rgbToOklch(229, 9, 20);
check('cinema red keeps its hue and weight', Math.abs(red.h - redBefore.h) < 0.05 && Math.abs(red.L - redBefore.L) < 0.02);
const cyanInk = flip('#22d3ee', 'ink');
check('bright accent type is deepened until readable', contrast(cyanInk, paper) >= 3, contrast(cyanInk, paper).toFixed(2));
check('the same accent as a fill is deepened less than as type', T.rgbToOklch(...flip('#22d3ee', 'paint')).L > T.rgbToOklch(...cyanInk).L);
const shadow = T.transformRGBA(0, 0, 0, 0.6, 'shadow');
check('shadows stay dark and soften', shadow[0] === 0 && shadow[3] < 0.3, JSON.stringify(shadow));
check('keep mode is the identity', JSON.stringify(T.transformRGBA(1, 2, 3, 0.5, 'keep')) === '[1,2,3,0.5]');

// ---------- values ----------
check('colour functions and hex are rewritten', !/#06060b|rgba\(255, 255, 255, 0\.1\)/.test(T.transformValue('linear-gradient(#06060b, rgba(255, 255, 255, 0.1))', 'paint')));
check('non-colour tokens are left alone', T.transformValue('1px solid transparent', 'paint') === '1px solid transparent');
check('url() contents are untouched', T.transformValue('url("x.png#fff")', 'paint') === 'url("x.png#fff")');
check('url-encoded fills in inline SVG icons are rewritten', !T.transformValue(`url("data:image/svg+xml,%3Csvg fill='%23ffffff'%3E")`, 'ink').includes('%23ffffff'));
const decls = T.declarations(`background: url("data:image/svg+xml;base64,AA;BB") no-repeat; color: red !important; --x: a`);
check('declarations split only at top-level semicolons', decls.length === 3 && decls[0].value.includes('AA;BB'), JSON.stringify(decls));
check('!important is carried separately', decls[1].important && decls[1].value === 'red');

// ---------- blocks ----------
const block = cssText => T.compileBlock({ cssText }, { '--red': '#e50914', '--bg': '#06060b' });
const copied = block('padding: 4px; color: var(--red); border-top: 1px solid rgb(255, 255, 255);');
check('every colour declaration is copied, changed or not', copied.includes('color:var(--red);') && copied.includes('border-top:'), copied);
check('non-colour declarations are not copied', !copied.includes('padding'));
check('white ink on a saturated fill is kept', block('background: rgb(229, 9, 20); color: rgb(255, 255, 255);').includes('color:rgb(255, 255, 255)'));
check('white ink on a token fill is kept', block('background: linear-gradient(var(--red), var(--red)); color: rgb(255, 255, 255);').includes('color:rgb(255, 255, 255)'));
check('a white plate stays white (QR codes, logo cards)', block('background: rgb(255, 255, 255); border-radius: 8px;').includes('background:rgb(255, 255, 255)'));
const chip = block('background: rgb(245, 245, 247); color: rgb(9, 10, 13);');
check('a light chip with dark ink stays as drawn', chip.includes('background:rgb(245, 245, 247)') && chip.includes('color:rgb(9, 10, 13)'), chip);
check('a white hover with token ink still flips', !block('background: rgb(255, 255, 255); color: var(--bg);').includes('background:rgb(255, 255, 255)'));
check('!important survives compilation', block('color: rgb(255, 255, 255) !important;').includes('!important'));

// ---------- rule lists ----------
const style = (selectorText, cssText) => ({ type: 1, selectorText, style: { cssText } });
const css = T.compileRules([
  style('.a', 'color: rgb(255, 255, 255); margin: 0;'),
  style('.a', 'color: var(--red);'),
  { type: 4, conditionText: '(max-width: 700px)', cssRules: [style('.b', 'background: rgb(6, 6, 11);')] },
  { type: 7, name: 'pulse', cssRules: [{ keyText: '0%', style: { cssText: 'opacity: 1;' } }, { keyText: '100%', style: { cssText: 'background: rgb(0, 0, 0); opacity: 0;' } }] },
  { type: 7, name: 'spin', cssRules: [{ keyText: 'to', style: { cssText: 'transform: rotate(1turn);' } }] },
  style('.coll-banner h3', 'color: rgb(255, 255, 255);'),
  style('.coll-banner h3, .other', 'color: rgb(255, 255, 255);'),
  style('.nothing', 'display: grid;'),
  style('.up-next-count', 'color: rgb(255, 255, 255);'),
  style('.up-next-card .continue-next i', 'color: rgb(255, 255, 255);'),
], {});
const rules = css.trim().split('\n');
check('source order is preserved among copies', css.indexOf('.a{color:rgb') < css.indexOf('.a{color:var(--red)'));
check('@media wrappers are reproduced', css.includes('@media (max-width: 700px){'));
check('colour keyframes are copied whole', /@keyframes pulse\{0%\{opacity: 1;\}100%\{background:rgb\(\d+, \d+, \d+\);opacity:0;\}\}/.test(css.replace(/\n/g, '')), css);
check('keyframes without colour are skipped', !css.includes('spin'));
check('dark-island rules are copied untouched', css.includes('.coll-banner h3{color:rgb(255, 255, 255);}'));
check('a selector list only partly on an island is still themed', !css.includes('.coll-banner h3, .other{color:rgb(255, 255, 255);}'));
check('the Up Next countdown on artwork is an island', css.includes('.up-next-count{color:rgb(255, 255, 255);}'));
check('Up Next text below the artwork is themed', !css.includes('.up-next-card .continue-next i{color:rgb(255, 255, 255);}'));
check('rules without colour produce nothing', !css.includes('.nothing'));
check('no empty rules are emitted', rules.every(line => !/\{\}$/.test(line)), css);

// ---------- choice resolution ----------
check('dark and light resolve to themselves', T.resolve('dark') === 'dark' && T.resolve('light') === 'light');
check('system follows the device (dark here)', T.resolve('system') === 'dark');
check('unknown choices fall back to dark', T.resolve('sepia') === 'dark' && T.resolve(undefined) === 'dark');

summary();
