// ===== STATS + TASTE PROFILE =====
import { genreMap } from './config.js';
import { state } from './state.js';
import { $, esc } from './ui.js';
import { registerActions } from './events.js';
import { observeCountUps } from './effects.js';
import { buildCtx, badgesHTML, challengesHTML, animateBadgeBars } from './badges.js';
import { ensureWatchedMeta } from './watched-meta.js';

let statsScope = 'all'; // 'all' | 'movie' | 'tv'

// Build every metric for a given media scope so the All / Movies / TV toggle can
// re-render the whole page from one source of truth.
function computeStats(scope) {
  const inScope = t => scope === 'all' || t === scope;
  const watchlist = state.watchlist.filter(w => inScope(w.type));
  const ratingEntries = Object.entries(state.ratings).filter(([k]) => scope === 'all' || k.startsWith(scope + '_'));
  const watchedKeys = Object.keys(state.watched).filter(k => scope === 'all' || k.startsWith(scope + '_'));

  const totalWL = watchlist.length;
  const totalRated = ratingEntries.length;
  const totalWatched = watchedKeys.length;
  const avgRating = totalRated ? (ratingEntries.reduce((a, [, v]) => a + v, 0) / totalRated).toFixed(1) : '0';

  // Taste profile (genres + era) draws from BOTH the watchlist and watched history,
  // deduped — otherwise a scope where the user has only *watched* titles (common for
  // TV) computes nothing. Watched docs carry genres/year (enriched on write/backfill).
  const titleMap = new Map();
  watchlist.forEach(w => titleMap.set(`${w.type}_${w.tmdbId}`, { genres: w.genres || [], year: w.year }));
  Object.entries(state.watched).forEach(([k, d]) => {
    if (!inScope(d.type)) return;
    const ex = titleMap.get(k);
    if (ex) { if (!ex.genres.length && d.genres) ex.genres = d.genres; if (!ex.year && d.year) ex.year = d.year; }
    else titleMap.set(k, { genres: d.genres || [], year: d.year });
  });
  const titles = [...titleMap.values()];

  const genreCounts = {};
  titles.forEach(t => (t.genres || []).forEach(gid => { const name = genreMap[gid]; if (name) genreCounts[name] = (genreCounts[name] || 0) + 1; }));
  const sortedGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const decadeCounts = {};
  titles.forEach(t => { const y = parseInt(t.year); if (y) { const dec = Math.floor(y / 10) * 10; decadeCounts[dec] = (decadeCounts[dec] || 0) + 1; } });
  const favDecade = Object.entries(decadeCounts).sort((a, b) => b[1] - a[1])[0];

  const ratingCounts = Array.from({ length: 10 }, (_, i) => ratingEntries.filter(([, v]) => v === i + 1).length);

  return {
    totalWL, totalRated, totalWatched, avgRating, sortedGenres, favDecade,
    topGenreName: sortedGenres[0] ? sortedGenres[0][0] : '—',
    // Read off the already-scoped `watchlist`, not state.watchlist — these tiles
    // only render in the 'all' scope today, but reading the unscoped list made
    // them silently wrong the moment they didn't.
    movies: watchlist.filter(w => w.type === 'movie').length,
    shows: watchlist.filter(w => w.type === 'tv').length,
    ratingCounts,
  };
}

// Lifetime watch time + the two "who do you watch" highlights the backfill unlocks.
// Hours are approximate: a TV show contributes its FULL run (we don't track
// per-episode viewing), so the number is labelled with a ≈ rather than implied exact.
function hoursTile(ctx) {
  if (!ctx.watchedTotal) return '';
  const pending = ctx.metaCoverage < 1;
  const days = (ctx.hours / 24).toFixed(1);
  const cards = [
    `<div class="stat-big" title="Approximate: TV shows count their full run, since per-episode viewing isn't tracked.">
      <div class="stat-big-num">${pending ? '<span class="badge-pending">…</span>' : `≈<span data-count="${ctx.hours}">0</span>`}</div>
      <div class="stat-big-label">Hours Watched</div>
    </div>`,
    `<div class="stat-big"><div class="stat-big-num">${pending ? '<span class="badge-pending">…</span>' : `≈${days}`}</div><div class="stat-big-label">Days Watched</div></div>`,
  ];
  if (ctx.topDirector) cards.push(`<div class="stat-big"><div class="stat-big-name">${esc(ctx.topDirector.key)}</div><div class="stat-big-label">Top Director · ${ctx.topDirector.n}</div></div>`);
  if (ctx.topActor) cards.push(`<div class="stat-big"><div class="stat-big-name">${esc(ctx.topActor.name)}</div><div class="stat-big-label">Most Seen Actor · ${ctx.topActor.n}</div></div>`);
  return `<div class="d-sec-title">Watch Time</div><div class="stats-overview">${cards.join('')}</div>`;
}

export function renderStats() {
  const ct = $('statsContent');
  if (!ct) return;
  if (!state.user) {
    ct.innerHTML = `<div class="wl-empty" style="padding:40px 20px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:56px;height:56px;color:var(--text3);margin-bottom:14px;opacity:.5"><path d="M18 20V10M12 20V4M6 20v-6"/></svg><h3>Sign in to see your stats</h3><p>Create an account to track your viewing habits</p><br><button class="btn-primary" data-action="open-auth">Sign In</button></div>`;
    return;
  }

  const s = computeStats(statsScope);
  const maxGenre = s.sortedGenres[0] ? s.sortedGenres[0][1] : 1;
  const scopeLabel = statsScope === 'movie' ? 'Movies' : statsScope === 'tv' ? 'TV Shows' : 'All';
  // Badges and challenges are account-wide, so they're computed off the full
  // context and rendered ABOVE the scope toggle — scoping them to "Movies" would
  // imply "Movies badges", which isn't a thing.
  const ctx = buildCtx();

  const toggle = `<div class="wl-tabs" style="margin-bottom:20px">
    ${[['all', 'All'], ['movie', 'Movies'], ['tv', 'TV Shows']].map(([f, label]) =>
      `<div class="wl-tab ${statsScope === f ? 'active' : ''}" role="button" tabindex="0" data-action="stats-filter" data-filter="${f}">${label}</div>`).join('')}
  </div>`;

  // The Movies / TV Shows split tiles only make sense in the "All" scope.
  const splitTiles = statsScope === 'all'
    ? `<div class="stat-big"><div class="stat-big-num" data-count="${s.movies}">0</div><div class="stat-big-label">Movies</div></div>
       <div class="stat-big"><div class="stat-big-num" data-count="${s.shows}">0</div><div class="stat-big-label">TV Shows</div></div>`
    : '';

  ct.innerHTML = `
    ${challengesHTML(ctx)}
    ${badgesHTML(ctx)}
    ${hoursTile(ctx)}
    ${toggle}
    <div class="genre-chart" style="background:linear-gradient(135deg,var(--red-soft),rgba(139,92,246,.05));margin-bottom:24px">
      <div class="d-sec-title" style="margin-bottom:12px">🎯 Your ${scopeLabel} Taste Profile</div>
      <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:center">
        <div><div class="stat-label">Favorite Genre</div><div style="font-size:1.3rem;font-weight:800">${s.topGenreName}</div></div>
        <div><div class="stat-label">Favorite Era</div><div style="font-size:1.3rem;font-weight:800">${s.favDecade ? s.favDecade[0] + 's' : '—'}</div></div>
        <div><div class="stat-label">Avg Score</div><div style="font-size:1.3rem;font-weight:800;color:var(--gold)">${s.avgRating}<span style="font-size:.9rem;color:var(--text3)">/10</span></div></div>
      </div>
    </div>
    <div class="stats-overview">
      <div class="stat-big"><div class="stat-big-num" data-count="${s.totalWL}">0</div><div class="stat-big-label">In Watchlist</div></div>
      <div class="stat-big"><div class="stat-big-num" data-count="${s.totalWatched}">0</div><div class="stat-big-label">Watched</div></div>
      <div class="stat-big"><div class="stat-big-num" data-count="${s.totalRated}">0</div><div class="stat-big-label">Rated</div></div>
      <div class="stat-big"><div class="stat-big-num" data-count="${s.avgRating}" data-decimals="1">0</div><div class="stat-big-label">Avg Rating</div></div>
      ${splitTiles}
    </div>
    ${s.sortedGenres.length ? `<div class="genre-chart"><div class="d-sec-title">Your Top ${scopeLabel === 'All' ? '' : scopeLabel + ' '}Genres</div><div class="genre-bar-wrap">${s.sortedGenres.map(([name, count]) => `<div class="genre-bar-item"><span class="gb-label">${name}</span><div class="gb-track" title="${count} title${count !== 1 ? 's' : ''} in ${name}"><div class="gb-fill" style="width:0">${count}</div></div></div>`).join('')}</div></div>` : ''}
    <div class="d-sec-title">Rating Distribution</div>
    ${s.totalRated ? `<div class="rating-dist">
      ${s.ratingCounts.map((count, i) => {
        const score = i + 1;
        const pct = Math.round(count / s.totalRated * 100);
        return `<div class="rd-col" title="${count} rating${count !== 1 ? 's' : ''} at ${score}/10">
          <div class="rd-count">${count || ''}</div>
          <div class="rd-track"><div class="rd-fill" style="height:0" data-pct="${pct}"></div></div>
          <div class="rd-score">${score}</div>
        </div>`;
      }).join('')}
    </div>` : `<div class="rating-dist-empty">Rate a few ${statsScope === 'tv' ? 'shows' : statsScope === 'movie' ? 'movies' : 'titles'} to see your distribution here.</div>`}`;

  observeCountUps(ct);
  // Animate bars after paint (pixel heights computed against the fixed-height
  // .rd-track — percentage heights collapse against the auto-sized flex column).
  requestAnimationFrame(() => {
    ct.querySelectorAll('.genre-bar-item').forEach((item, i) => {
      const count = s.sortedGenres[i] ? s.sortedGenres[i][1] : 0;
      const fill = item.querySelector('.gb-fill');
      if (fill) fill.style.width = Math.round(count / maxGenre * 100) + '%';
    });
    ct.querySelectorAll('.rd-fill').forEach(fill => {
      const pct = +fill.dataset.pct || 0;
      const trackHeight = fill.parentElement.clientHeight || 90;
      fill.style.height = pct > 0 ? Math.max(Math.round(trackHeight * pct / 100), 3) + 'px' : '0';
    });
    animateBadgeBars(ct);
  });

  // Fire-and-forget: fills in runtime/director/cast for hours + loyalty badges.
  // Never awaited — the page is already painted; cv:meta-backfilled re-renders.
  ensureWatchedMeta();
}

export function initStats() {
  registerActions({
    'stats-filter': (el) => { statsScope = el.dataset.filter; renderStats(); },
  });
}
