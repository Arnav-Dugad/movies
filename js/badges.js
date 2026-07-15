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

// ===== SEASONS =====
// The four windows tile all 12 months, so activeSeason() always resolves.
const SEASONS = [
  { id: 'winter', name: 'Winter Watch', icon: '❄️', sub: 'Cosy season viewing', startMonth: 12, endMonth: 2, goal: 10, accent: 'cyan' },
  { id: 'spring', name: 'Spring Awakening', icon: '🌱', sub: 'Fresh picks for a fresh season', startMonth: 3, endMonth: 5, goal: 10, accent: 'green' },
  { id: 'summer', name: 'Summer Blockbusters', icon: '☀️', sub: 'Popcorn season', startMonth: 6, endMonth: 8, goal: 12, accent: 'gold' },
  { id: 'fall', name: 'Fall Festival', icon: '🍂', sub: 'Awards season warm-up', startMonth: 9, endMonth: 11, goal: 10, accent: 'red' },
];

export const YEAR_GOAL = 52;

// Resolve the season window containing `now`. Windows are LOCAL time, and the
// instance is anchored to the year the window OPENED — so Dec 2026 and Jan 2027
// both resolve to `winter_2026` with identical bounds instead of splitting the
// user's progress across the new year.
export function activeSeason(now = new Date()) {
  const m = now.getMonth() + 1, y = now.getFullYear();
  for (const def of SEASONS) {
    const wraps = def.startMonth > def.endMonth;              // Dec -> Feb
    const inIt = wraps ? (m >= def.startMonth || m <= def.endMonth)
                       : (m >= def.startMonth && m <= def.endMonth);
    if (!inIt) continue;
    const sy = (wraps && m <= def.endMonth) ? y - 1 : y;
    return {
      def, seasonYear: sy, id: `${def.id}_${sy}`,
      start: new Date(sy, def.startMonth - 1, 1).getTime(),
      // Exclusive end: the 1st of the month AFTER endMonth. `new Date(y, 2, 1)`
      // is March 1 (month index 2), which is exactly what winter's endMonth:2 wants.
      end: new Date(wraps ? sy + 1 : sy, def.endMonth, 1).getTime(),
    };
  }
  return null;
}

// ===== CONTEXT =====
// The only timestamp we have. Handles a real Firestore Timestamp, the local
// {seconds} mirror written by toggleWatched, and the raw sentinel (-> 0, ignored).
function tsOf(d) {
  const w = d && d.watchedAt;
  if (!w) return 0;
  if (typeof w.seconds === 'number') return w.seconds * 1000;
  if (typeof w.toMillis === 'function') return w.toMillis();
  return 0;
}

function maxEntry(m) {
  let best = null;
  for (const [key, v] of m) if (!best || v.n > best.n) best = { key, ...v };
  return best;
}

// One pass over state.watched builds everything every badge needs, so predicates
// stay O(1) and the whole registry costs one traversal.
export function buildCtx(now = Date.now()) {
  const year = new Date(now).getFullYear();
  const yStart = new Date(year, 0, 1).getTime();
  const yEnd = new Date(year + 1, 0, 1).getTime();
  const season = activeSeason(new Date(now));

  const c = {
    now, year, season,
    watchedTotal: 0, movies: 0, shows: 0,
    wlTotal: state.watchlist.length,
    ratedTotal: 0, avgRating: 0, perfect: 0,
    minutes: 0, metaKnown: 0,
    genre: new Map(), decade: new Map(), director: new Map(), actor: new Map(),
    thisYear: 0, seasonCount: 0,
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
    if (d.director) bump(c.director, d.director, { id: d.directorId || 0 });
    (d.cast || []).forEach(p => { if (p && p.id) bump(c.actor, p.id, { name: p.name || '' }); });

    const ts = tsOf(d);
    if (ts) {
      if (ts >= yStart && ts < yEnd) c.thisYear++;
      if (season && ts >= season.start && ts < season.end) c.seasonCount++;
    }
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
  // Volume
  B('first_watch', 'First Steps', 'Mark your first title as watched', '🎬', 'bronze', 1, c => c.watchedTotal),
  B('watch_10', 'Getting Started', 'Watch 10 titles', '🍿', 'bronze', 10, c => c.watchedTotal),
  B('watch_50', 'Cinephile', 'Watch 50 titles', '🎞️', 'silver', 50, c => c.watchedTotal),
  B('watch_100', 'Centurion', 'Watch 100 titles', '💯', 'gold', 100, c => c.watchedTotal),
  B('watch_250', 'Living Archive', 'Watch 250 titles', '🏛️', 'platinum', 250, c => c.watchedTotal),
  // Hours (needs backfilled runtime)
  B('hours_24', 'A Full Day', 'Watch 24 hours of content', '⏳', 'bronze', 24, c => c.hours, { unit: 'h', meta: true }),
  B('hours_100', 'Time Traveller', 'Watch 100 hours of content', '🕰️', 'silver', 100, c => c.hours, { unit: 'h', meta: true }),
  B('hours_500', 'Marathoner', 'Watch 500 hours of content', '🏃', 'gold', 500, c => c.hours, { unit: 'h', meta: true }),
  // Ratings
  B('rate_1', 'Critic in Training', 'Rate your first title', '⭐', 'bronze', 1, c => c.ratedTotal),
  B('rate_25', 'Sharp Eye', 'Rate 25 titles', '🧐', 'silver', 25, c => c.ratedTotal),
  B('rate_100', 'Head Critic', 'Rate 100 titles', '🏆', 'gold', 100, c => c.ratedTotal),
  B('perfect_10', 'Masterpiece', 'Give a title a perfect 10', '🔟', 'silver', 1, c => c.perfect),
  // Breadth
  B('genre_5', 'Explorer', 'Watch 5 different genres', '🧭', 'bronze', 5, c => c.distinctGenres),
  B('genre_12', 'Omnivore', 'Watch 12 different genres', '🌐', 'gold', 12, c => c.distinctGenres),
  B('decade_5', 'Time Capsule', 'Watch titles from 5 different decades', '📼', 'silver', 5, c => c.distinctDecades),
  // Loyalty (needs backfilled director/cast)
  B('director_5', 'Director Devotee', 'Watch 5 titles by one director', '🎥', 'silver', 5, c => (c.topDirector ? c.topDirector.n : 0), { meta: true }),
  B('actor_10', 'Fan Club', 'Watch 10 titles with one actor', '🌟', 'gold', 10, c => (c.topActor ? c.topActor.n : 0), { meta: true }),
  // Lists
  B('wl_25', 'Curator', 'Keep 25 titles in your watchlist', '📋', 'bronze', 25, c => c.wlTotal),
];

export const earnedIds = ctx => BADGES.filter(b => b.value(ctx) >= b.goal).map(b => b.id);

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

function ringHTML(percent, accent, centerHTML) {
  return `<div class="ring-wrap">
    <svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
      <circle class="ring-bg" cx="60" cy="60" r="52"/>
      <circle class="ring-fill ring-${accent}" cx="60" cy="60" r="52" data-pct="${percent}"/>
    </svg>
    <div class="ring-center">${centerHTML}</div>
  </div>`;
}

export function challengesHTML(ctx) {
  const s = ctx.season;
  const cards = [];

  if (s) {
    const p = pct(ctx.seasonCount, s.def.goal);
    cards.push(`<div class="challenge-card">
      ${ringHTML(p, s.def.accent, `<div class="ring-num">${ctx.seasonCount}<span class="ring-goal">/${s.def.goal}</span></div><div class="ring-pct">${p}%</div>`)}
      <div class="challenge-info">
        <div class="challenge-name">${s.def.icon} ${esc(s.def.name)}</div>
        <div class="challenge-sub">${esc(s.def.sub)}</div>
        <div class="challenge-meta">${ctx.seasonCount >= s.def.goal ? '✅ Challenge complete!' : `${s.def.goal - ctx.seasonCount} to go · ends ${new Date(s.end - 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}</div>
      </div>
    </div>`);
  }

  const yp = pct(ctx.thisYear, YEAR_GOAL);
  cards.push(`<div class="challenge-card">
    ${ringHTML(yp, 'purple', `<div class="ring-num">${ctx.thisYear}<span class="ring-goal">/${YEAR_GOAL}</span></div><div class="ring-pct">${yp}%</div>`)}
    <div class="challenge-info">
      <div class="challenge-name">🎯 ${ctx.year} Goal</div>
      <div class="challenge-sub">Watch ${YEAR_GOAL} titles this year</div>
      <div class="challenge-meta">${ctx.thisYear >= YEAR_GOAL ? '✅ Goal smashed!' : `${YEAR_GOAL - ctx.thisYear} to go`}</div>
    </div>
  </div>`);

  return `<div class="d-sec-title">Viewing Challenges</div>
    <div class="challenge-grid">${cards.join('')}</div>`;
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
  // A backfill unlock is a data-availability artifact, not an achievement.
  document.addEventListener('cv:meta-backfilled', () => syncBadges({ celebrate: false }));
}
