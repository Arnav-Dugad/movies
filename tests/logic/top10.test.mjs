// The weekly chart. Movement is the only claim on this page that cannot be
// re-derived from the current data — once this week's ranking is recorded, last
// week's is gone — so the rules around WHEN it is allowed to say anything are
// what these tests pin.
import { check, summary } from './harness.mjs';

// Resolved from this file so the suite runs from any checkout, on any OS.
const SRC = new URL('../../js/', import.meta.url).href;
const t10 = await import(SRC + 'top10.js');

const KEY = chart => `cv_top10_history_v1_${chart}`;
const wipe = () => { localStorage.removeItem(KEY('movie')); localStorage.removeItem(KEY('tv')); t10.resetMovementMemo(); };
const plant = (chart, week, ids) => localStorage.setItem(KEY(chart), JSON.stringify({ week, ids, at: Date.now() - 8 * 86400000 }));
const stored = chart => JSON.parse(localStorage.getItem(KEY(chart)) || 'null');
const kinds = moves => [...moves.entries()].map(([id, m]) => `${id}:${m.kind}${m.by || ''}`).join(' ');

// ================= week keys =================
// A "week" has to be the same fact for everyone looking at it, and it has to
// change exactly once per week — otherwise movement is reported at the wrong time.
const d = str => new Date(`${str}T12:00:00Z`);
check('a week key looks like a week key', /^\d{4}-W\d{2}$/.test(t10.weekKey(d('2026-08-22'))), t10.weekKey(d('2026-08-22')));
check('every day inside one week shares a key', (() => {
  const keys = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'].map(x => t10.weekKey(d(x)));
  return new Set(keys).size === 1;
})(), ['2026-08-17', '2026-08-23'].map(x => t10.weekKey(d(x))).join(' vs '));
check('the next day starts a new week', t10.weekKey(d('2026-08-24')) !== t10.weekKey(d('2026-08-23')));
check('the key advances across a year boundary',
  t10.weekKey(d('2027-01-05')) !== t10.weekKey(d('2026-12-22')));
check('a week is never numbered 00 or above 53', (() => {
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.UTC(2024, 0, 1 + i, 12));
    const n = +t10.weekKey(day).split('W')[1];
    if (n < 1 || n > 53) return false;
  }
  return true;
})());

// ================= a first visit says nothing =================
wipe();
let moves = t10.movementFor([1, 2, 3, 4, 5], 'movie');
check('a first visit reports no movement', moves.size === 0, kinds(moves));
check('but it does record the chart', stored('movie')?.ids.join(',') === '1,2,3,4,5');
check('stamped with this week', stored('movie')?.week === t10.weekKey());

// ================= the same week is not a comparison =================
wipe();
t10.movementFor([1, 2, 3], 'movie');
t10.resetMovementMemo();                          // a fresh page load, same week
moves = t10.movementFor([3, 2, 1], 'movie');
check('a revisit in the SAME week reports nothing', moves.size === 0, kinds(moves),
  'the stored chart is this week\'s own, so comparing against it would be comparing the chart with itself');

// ================= a later week is =================
wipe();
plant('movie', '2019-W02', [30, 20, 10, 40, 50]);
moves = t10.movementFor([10, 20, 30, 60, 50], 'movie');
check('a title that climbed reports how far', moves.get(10)?.kind === 'up' && moves.get(10)?.by === 2, kinds(moves));
check('a title that held reports a hold', moves.get(20)?.kind === 'hold');
check('a title that fell reports how far', moves.get(30)?.kind === 'down' && moves.get(30)?.by === 2);
check('a title absent last week is NEW', moves.get(60)?.kind === 'new');
check('a title that stayed put further down also holds', moves.get(50)?.kind === 'hold');
check('every entry gets a verdict', moves.size === 5, moves.size);
check('and the new chart replaces the old one', stored('movie').ids.join(',') === '10,20,30,60,50');

// ================= the answer survives a re-render =================
// Recording this week destroys last week, so a second pass would compare the
// chart against the copy it had just written and silently drop every chip.
wipe();
plant('movie', '2019-W02', [30, 20, 10]);
const first = t10.movementFor([10, 20, 30], 'movie');
const second = t10.movementFor([10, 20, 30], 'movie');
check('a re-render returns the same verdicts', kinds(first) === kinds(second) && second.size === 3, kinds(second));
check('and it is literally the same result, not a recomputation', first === second);
check('a different chart is decided separately', (() => {
  plant('tv', '2019-W02', [7, 8, 9]);
  const tv = t10.movementFor([9, 8, 7], 'tv');
  return tv.get(9)?.kind === 'up' && tv.get(9)?.by === 2;
})());

// ================= the two charts never collide =================
// One shared key would make each chart report movement against the other's
// ranking — confidently, and completely wrongly.
wipe();
t10.movementFor([1, 2, 3], 'movie');
t10.movementFor([90, 91, 92], 'tv');
check('films and television keep separate histories',
  stored('movie').ids.join(',') === '1,2,3' && stored('tv').ids.join(',') === '90,91,92',
  `${stored('movie')?.ids} | ${stored('tv')?.ids}`);
check('and neither reports movement from the other', (() => {
  t10.resetMovementMemo();
  plant('movie', '2019-W02', [3, 2, 1]);
  const tv = t10.movementFor([90, 91, 92], 'tv');    // tv's own record is this week
  return tv.size === 0;
})());

// ================= degenerate storage =================
wipe();
localStorage.setItem(KEY('movie'), 'not json at all');
check('unreadable history is ignored rather than throwing', t10.movementFor([1, 2], 'movie').size === 0);
check('and is replaced with something valid', stored('movie')?.ids.join(',') === '1,2');

wipe();
localStorage.setItem(KEY('movie'), JSON.stringify({ week: 5, ids: 'nope' }));
check('a malformed history is ignored', t10.movementFor([1], 'movie').size === 0);

wipe();
check('an empty chart is handled', t10.movementFor([], 'movie').size === 0);

summary();
