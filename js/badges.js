// ===== BADGES + VIEWING CHALLENGES =====
// Badges are DERIVED state: a pure function of state.watched / ratings / watchlist,
// which already live in Firestore. So nothing here is a source of truth — the
// localStorage ledger below only answers "have we already celebrated this?".
// Losing it costs one duplicate confetti, never data, which is why it doesn't
// need (and deliberately avoids) a new Firestore subcollection.
import { state } from './state.js';
import { genreMap } from './config.js';
import { esc, toast } from './ui.js';
import { confettiBurst } from './effects.js';

// ===== CONTEXT =====
function maxEntry(m) {
  let best = null;
  for (const [key, v] of m) if (!best || v.n > best.n) best = { key, ...v };
  return best;
}

// One pass over state.watched builds everything every badge needs, so predicates
// stay O(1) and the whole registry costs one traversal.
export function buildCtx() {
  const c = {
    watchedTotal: 0, movies: 0, shows: 0,
    wlTotal: state.watchlist.length,
    ratedTotal: 0, avgRating: 0, perfect: 0,
    minutes: 0, metaKnown: 0,
    genre: new Map(), decade: new Map(), director: new Map(), actor: new Map(),
  };

  const bump = (m, k, extra) => {
    if (k == null || k === '') return;
    const e = m.get(k) || { n: 0, ...extra };
    e.n++; m.set(k, e);
  };

  for (const d of Object.values(state.watched)) {
    c.watchedTotal++;
    if (d.type === 'tv') c.shows++; else c.movies++;
    (d.genres || []).forEach(g => bump(c.genre, g, { name: genreMap[g] || String(g) }));
    const y = parseInt(d.year);
    if (y) bump(c.decade, Math.floor(y / 10) * 10);
    if (typeof d.runtime === 'number' && d.runtime > 0) { c.minutes += d.runtime; c.metaKnown++; }
    // TV metadata stores the series creator in the legacy `director` field.
    // Director-specific badges must therefore use movies only.
    if (d.type === 'movie' && d.director) bump(c.director, d.director, { id: d.directorId || 0 });
    (d.cast || []).forEach(p => { if (p && p.id) bump(c.actor, p.id, { name: p.name || '' }); });
  }

  let sum = 0;
  for (const v of Object.values(state.ratings)) {
    c.ratedTotal++; sum += v;
    if (v === 10) c.perfect++;
  }
  c.avgRating = c.ratedTotal ? sum / c.ratedTotal : 0;
  c.hours = Math.floor(c.minutes / 60);
  // < 1 while the backfill is still in flight — drives the "calculating" hint so
  // hours/director badges don't look broken before their data exists.
  c.metaCoverage = c.watchedTotal ? c.metaKnown / c.watchedTotal : 1;
  c.topDirector = maxEntry(c.director);
  c.topActor = maxEntry(c.actor);
  c.distinctGenres = c.genre.size;
  c.distinctDecades = c.decade.size;
  return c;
}

// ===== REGISTRY =====
// `earned = value(ctx) >= goal`, so progress is just value/goal — there's no way
// for an "earned" test and a progress bar to disagree. `meta:true` marks badges
// that depend on backfilled data (runtime/director/cast).
const B = (id, name, desc, icon, tier, goal, value, opts = {}) =>
  ({ id, name, desc, icon, tier, goal, value, unit: opts.unit || '', meta: !!opts.meta });

export const BADGES = [
  // Volume — tiers climb steeply so the top ones stay a real long-haul goal.
  B('first_watch', 'First Steps', 'Mark your first title as watched', '🎬', 'bronze', 1, c => c.watchedTotal),
  B('watch_10', 'Getting Started', 'Watch 25 titles', '🍿', 'bronze', 25, c => c.watchedTotal),
  B('watch_50', 'Cinephile', 'Watch 100 titles', '🎞️', 'silver', 100, c => c.watchedTotal),
  B('watch_100', 'Veteran Viewer', 'Watch 300 titles', '💯', 'gold', 300, c => c.watchedTotal),
  B('watch_250', 'Living Archive', 'Watch 750 titles', '🏛️', 'platinum', 750, c => c.watchedTotal),
  // Hours (needs backfilled runtime)
  B('hours_24', 'Weekend Binger', 'Watch 50 hours of content', '⏳', 'bronze', 50, c => c.hours, { unit: 'h', meta: true }),
  B('hours_100', 'Time Traveller', 'Watch 250 hours of content', '🕰️', 'silver', 250, c => c.hours, { unit: 'h', meta: true }),
  B('hours_500', 'Marathoner', 'Watch 1,000 hours of content', '🏃', 'gold', 1000, c => c.hours, { unit: 'h', meta: true }),
  // Ratings
  B('rate_1', 'Critic in Training', 'Rate your first title', '⭐', 'bronze', 1, c => c.ratedTotal),
  B('rate_25', 'Sharp Eye', 'Rate 50 titles', '🧐', 'silver', 50, c => c.ratedTotal),
  B('rate_100', 'Head Critic', 'Rate 250 titles', '🏆', 'gold', 250, c => c.ratedTotal),
  B('rate_750', 'Master Critic', 'Rate 750 titles', '⚖️', 'platinum', 750, c => c.ratedTotal),
  B('perfect_10', 'Masterpiece', 'Give a title a perfect 10', '🔟', 'silver', 1, c => c.perfect),
  // Breadth
  B('genre_5', 'Explorer', 'Watch 8 different genres', '🧭', 'bronze', 8, c => c.distinctGenres),
  B('genre_12', 'Omnivore', 'Watch 15 different genres', '🌐', 'gold', 15, c => c.distinctGenres),
  B('decade_5', 'Time Capsule', 'Watch titles from 7 different decades', '📼', 'silver', 7, c => c.distinctDecades),
  // Loyalty (needs backfilled director/cast)
  B('director_5', 'Director Devotee', 'Watch 8 titles by one director', '🎥', 'silver', 8, c => (c.topDirector ? c.topDirector.n : 0), { meta: true }),
  B('director_20', 'Auteur Loyalist', 'Watch 20 titles by one director', '🎬', 'platinum', 20, c => (c.topDirector ? c.topDirector.n : 0), { meta: true }),
  B('actor_10', 'Fan Club', 'Watch 20 titles with one actor', '🌟', 'gold', 20, c => (c.topActor ? c.topActor.n : 0), { meta: true }),
  // Lists
  B('wl_25', 'Curator', 'Keep 50 titles in your watchlist', '📋', 'bronze', 50, c => c.wlTotal),
];

export const earnedIds = ctx => BADGES.filter(b => b.value(ctx) >= b.goal).map(b => b.id);

// ===== LIFETIME CHALLENGES =====
// Marquee goals, no time window — some easy, some brutal. Each is `{ id, name, sub,
// icon, difficulty, goal, value(ctx), unit }`; difficulty drives the ring accent + a
// pill. Rendered as rings on the Stats page, in-progress first.
const DIFFICULTY = {
  easy:      { label: 'Easy',      accent: 'green',  order: 0 },
  medium:    { label: 'Medium',    accent: 'cyan',   order: 1 },
  hard:      { label: 'Hard',      accent: 'gold',   order: 2 },
  insane:    { label: 'Insane',    accent: 'red',    order: 3 },
  legendary: { label: 'Legendary', accent: 'purple', order: 4 },
};

const CH = (id, name, sub, icon, difficulty, goal, value, unit = '') => ({ id, name, sub, icon, difficulty, goal, value, unit });
export const CHALLENGES = [
  CH('c_start', 'Getting Comfortable', 'Watch 5 titles', '🎬', 'easy', 5, c => c.watchedTotal),
  CH('c_opinions', 'First Opinions', 'Rate 3 titles', '⭐', 'easy', 3, c => c.ratedTotal),
  CH('c_genres', 'Genre Hopper', 'Watch 12 different genres', '🧭', 'medium', 12, c => c.distinctGenres),
  CH('c_hours100', 'Time Traveller', 'Watch 250 hours of content', '🕰️', 'medium', 250, c => c.hours, 'h'),
  CH('c_decades', 'Across the Ages', 'Watch titles from 8 different decades', '📼', 'hard', 8, c => c.distinctDecades),
  CH('c_cinephile', 'The Cinephile', 'Watch 250 titles', '🎞️', 'hard', 250, c => c.watchedTotal),
  CH('c_director', "Auteur's Devotee", 'Watch 15 titles by a single director', '🎥', 'hard', 15, c => (c.topDirector ? c.topDirector.n : 0)),
  CH('c_critic', 'Completionist Critic', 'Rate 500 titles', '🏆', 'insane', 500, c => c.ratedTotal),
  CH('c_perfectionist', 'The Perfectionist', 'Award 25 perfect 10s', '🔟', 'insane', 25, c => c.perfect),
  CH('c_archive', 'Living Archive', 'Watch 1,000 titles', '🏛️', 'insane', 1000, c => c.watchedTotal),
  CH('c_master', 'Master Critic', 'Rate 1,000 titles', '⚖️', 'legendary', 1000, c => c.ratedTotal),
  CH('c_hours1000', 'Endless Hours', 'Watch 2,500 hours of content', '⏳', 'legendary', 2500, c => c.hours, 'h'),
];

// ===== LEDGER (localStorage) =====
const LKEY = uid => `cv_badges_${uid}`;

function readLedger(uid) {
  try {
    const r = JSON.parse(localStorage.getItem(LKEY(uid)) || 'null');
    return r && Array.isArray(r.ids) ? new Set(r.ids) : null;   // null = FIRST RUN
  } catch (_) { return null; }
}

function writeLedger(uid, set) {
  try { localStorage.setItem(LKEY(uid), JSON.stringify({ v: 1, ids: [...set] })); } catch (_) {}
}

const recentUnlocks = new Map();   // id -> ts; drives the .badge-new pulse
export const isRecentUnlock = id => recentUnlocks.has(id) && Date.now() - recentUnlocks.get(id) < 12000;

function celebrateUnlocks(ids) {
  const defs = ids.map(id => BADGES.find(b => b.id === id)).filter(Boolean);
  if (!defs.length) return;
  // Exactly ONE burst regardless of how many landed at once.
  confettiBurst(defs.length > 1 ? 140 : 90);
  toast(defs.length === 1 ? `Badge unlocked: ${defs[0].name}!` : `${defs.length} new badges unlocked!`, 'success');
}

export function syncBadges({ celebrate = false } = {}) {
  if (!state.user) return;
  const uid = state.user.uid;
  const earned = new Set(earnedIds(buildCtx()));
  const ledger = readLedger(uid);

  // FIRST RUN for this uid: seed silently. Without this, every existing user (and
  // every new device) would get a confetti bomb for a backlog they earned long ago.
  if (!ledger) { writeLedger(uid, earned); return; }

  const fresh = [...earned].filter(id => !ledger.has(id));
  if (!fresh.length) return;

  const now = Date.now();
  fresh.forEach(id => recentUnlocks.set(id, now));
  // Union, never subtract: un-watching something shouldn't re-arm a celebration
  // the user has already seen.
  writeLedger(uid, new Set([...ledger, ...earned]));
  if (celebrate) celebrateUnlocks(fresh);
}

// ===== RENDER =====
const pct = (v, goal) => Math.max(0, Math.min(100, Math.round(v / goal * 100)));
const RING_C = 326.73;   // 2 * PI * r, r=52

// Compact number for the ring center so big tallies (e.g. 2,500h) never overflow
// the ~88px inner circle: 1000→"1k", 1847→"1.8k", 12000→"12k".
const abbrev = n => {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (k >= 10 ? Math.round(k) : +k.toFixed(1)) + 'k';
};

function ringHTML(percent, accent, centerHTML) {
  return `<div class="ring-wrap">
    <svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
      <circle class="ring-bg" cx="60" cy="60" r="52"/>
      <circle class="ring-fill ring-${accent}" cx="60" cy="60" r="52" data-pct="${percent}"/>
    </svg>
    <div class="ring-center">${centerHTML}</div>
  </div>`;
}

// Ring center content. Done → a big check (the raw value can be many times the
// goal, e.g. 4,352h against 1,000h, which used to spill outside the circle). In
// progress → abbreviated value/goal, capped so it always fits, with the percent
// beneath. A long string (both numbers ≥1k) gets a smaller type class.
function ringCenter(ch, v, done, p) {
  if (done) return `<div class="ring-num ring-done" aria-label="Complete">✓</div>`;
  const cur = `${abbrev(v)}${ch.unit}`;
  const goal = `/${abbrev(ch.goal)}${ch.unit}`;
  const sm = (cur.length + goal.length) > 7 ? ' ring-num-sm' : '';
  return `<div class="ring-num${sm}">${cur}<span class="ring-goal">${goal}</span></div><div class="ring-pct">${p}%</div>`;
}

export function challengesHTML(ctx) {
  const rows = CHALLENGES.map(ch => {
    const v = ch.value(ctx);
    const done = v >= ch.goal;
    const p = pct(v, ch.goal);
    const diff = DIFFICULTY[ch.difficulty] || DIFFICULTY.easy;
    return { ch, v, done, p, diff };
  });
  // In-progress first, completed last; within each, easier first.
  rows.sort((a, b) => (a.done - b.done) || (a.diff.order - b.diff.order));

  const done = rows.filter(r => r.done).length;
  const cards = rows.map(({ ch, v, done, p, diff }) => `<div class="challenge-card${done ? ' done' : ''}">
    ${ringHTML(p, diff.accent, ringCenter(ch, v, done, p))}
    <div class="challenge-info">
      <div class="challenge-name">${ch.icon} ${esc(ch.name)} <span class="difficulty-pill diff-${ch.difficulty}">${diff.label}</span></div>
      <div class="challenge-sub">${esc(ch.sub)}</div>
      <div class="challenge-meta">${done ? '✅ Complete!' : `${(ch.goal - v).toLocaleString()}${ch.unit} to go`}</div>
    </div>
  </div>`).join('');

  return `<div class="d-sec-title">Lifetime Challenges <span class="badge-count">${done}/${CHALLENGES.length}</span></div>
    <div class="challenge-grid">${cards}</div>`;
}

export function badgesHTML(ctx) {
  const rows = BADGES.map(b => {
    const v = b.value(ctx);
    const earned = v >= b.goal;
    const isNew = earned && isRecentUnlock(b.id);
    // A meta badge sitting at 0 while the backfill is still running isn't really
    // "locked" — say so rather than implying the user hasn't done it.
    const pending = b.meta && ctx.metaCoverage < 1 && !earned;
    const p = pct(v, b.goal);
    const progress = !earned && !pending && v > 0
      ? `<div class="badge-bar"><div class="badge-bar-fill" style="width:0" data-pct="${p}"></div></div><div class="badge-prog">${v}${b.unit} / ${b.goal}${b.unit}</div>`
      : pending ? `<div class="badge-prog badge-pending">Calculating…</div>` : '';
    return `<div class="badge badge-${b.tier}${earned ? ' earned' : ''}${isNew ? ' badge-new' : ''}" title="${esc(b.desc)}">
      <div class="badge-icon">${b.icon}</div>
      <div class="badge-name">${esc(b.name)}</div>
      ${earned ? '<div class="badge-prog badge-done">Unlocked</div>' : progress || `<div class="badge-prog">${b.goal}${b.unit}</div>`}
    </div>`;
  }).join('');

  const got = BADGES.filter(b => b.value(ctx) >= b.goal).length;
  return `<div class="d-sec-title">Badges <span class="badge-count">${got}/${BADGES.length}</span></div>
    <div class="badge-grid">${rows}</div>`;
}

// Called from renderStats' post-paint rAF — same pattern as the genre/rating bars.
export function animateBadgeBars(ct) {
  ct.querySelectorAll('.ring-fill').forEach(el => {
    const p = Math.min(100, +el.dataset.pct || 0);
    el.style.strokeDashoffset = String(RING_C * (1 - p / 100));
  });
  ct.querySelectorAll('.badge-bar-fill').forEach(el => {
    el.style.width = (+el.dataset.pct || 0) + '%';
  });
}

export function initBadges() {
  // Silent: hydrate or seed. auth.js awaits its list loads before dispatching
  // cv:auth, so state is fully populated by the time this runs.
  document.addEventListener('cv:auth', () => {
    recentUnlocks.clear();
    if (state.user) syncBadges({ celebrate: false });
  });
  // The ONLY celebratory path — a real user action, and it fires on any page, so
  // marking something watched from a home-page card still celebrates there.
  document.addEventListener('cv:wl-changed', () => syncBadges({ celebrate: true }));
  document.addEventListener('cv:library-sync', () => syncBadges({ celebrate: false }));
  // A backfill unlock is a data-availability artifact, not an achievement.
  document.addEventListener('cv:meta-backfilled', () => syncBadges({ celebrate: false }));
}
