// ===== STATS + TASTE PROFILE =====
import { genreMap } from './config.js';
import { state } from './state.js';
import { $ } from './ui.js';
import { observeCountUps } from './effects.js';

export function renderStats() {
  const ct = $('statsContent');
  if (!ct) return;
  if (!state.user) {
    ct.innerHTML = `<div class="wl-empty" style="padding:40px 20px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:56px;height:56px;color:var(--text3);margin-bottom:14px;opacity:.5"><path d="M18 20V10M12 20V4M6 20v-6"/></svg><h3>Sign in to see your stats</h3><p>Create an account to track your viewing habits</p><br><button class="btn-primary" data-action="open-auth">Sign In</button></div>`;
    return;
  }
  const totalWL = state.watchlist.length;
  const totalRated = Object.keys(state.ratings).length;
  const totalWatched = Object.keys(state.watched).length;
  const avgRating = totalRated ? (Object.values(state.ratings).reduce((a, b) => a + b, 0) / totalRated).toFixed(1) : '0';
  const movies = state.watchlist.filter(w => w.type === 'movie').length;
  const shows = state.watchlist.filter(w => w.type === 'tv').length;

  // Genre breakdown
  const genreCounts = {};
  state.watchlist.forEach(w => (w.genres || []).forEach(gid => { const name = genreMap[gid]; if (name) genreCounts[name] = (genreCounts[name] || 0) + 1; }));
  const sortedGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxGenre = sortedGenres[0] ? sortedGenres[0][1] : 1;

  // Favorite decade from watchlist years
  const decadeCounts = {};
  state.watchlist.forEach(w => { const y = parseInt(w.year); if (y) { const dec = Math.floor(y / 10) * 10; decadeCounts[dec] = (decadeCounts[dec] || 0) + 1; } });
  const favDecade = Object.entries(decadeCounts).sort((a, b) => b[1] - a[1])[0];
  const topGenreName = sortedGenres[0] ? sortedGenres[0][0] : '—';

  ct.innerHTML = `
    <div class="genre-chart" style="background:linear-gradient(135deg,var(--red-soft),rgba(139,92,246,.05));margin-bottom:24px">
      <div class="d-sec-title" style="margin-bottom:12px">🎯 Your Taste Profile</div>
      <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:center">
        <div><div class="stat-label">Favorite Genre</div><div style="font-size:1.3rem;font-weight:800">${topGenreName}</div></div>
        <div><div class="stat-label">Favorite Era</div><div style="font-size:1.3rem;font-weight:800">${favDecade ? favDecade[0] + 's' : '—'}</div></div>
        <div><div class="stat-label">Avg Score</div><div style="font-size:1.3rem;font-weight:800;color:var(--gold)">${avgRating}<span style="font-size:.9rem;color:var(--text3)">/10</span></div></div>
      </div>
    </div>
    <div class="stats-overview">
      <div class="stat-big"><div class="stat-big-num" data-count="${totalWL}">0</div><div class="stat-big-label">In Watchlist</div></div>
      <div class="stat-big"><div class="stat-big-num" data-count="${totalWatched}">0</div><div class="stat-big-label">Watched</div></div>
      <div class="stat-big"><div class="stat-big-num" data-count="${totalRated}">0</div><div class="stat-big-label">Rated</div></div>
      <div class="stat-big"><div class="stat-big-num" data-count="${avgRating}" data-decimals="1">0</div><div class="stat-big-label">Avg Rating</div></div>
      <div class="stat-big"><div class="stat-big-num" data-count="${movies}">0</div><div class="stat-big-label">Movies</div></div>
      <div class="stat-big"><div class="stat-big-num" data-count="${shows}">0</div><div class="stat-big-label">TV Shows</div></div>
    </div>
    ${sortedGenres.length ? `<div class="genre-chart"><div class="d-sec-title">Your Top Genres</div><div class="genre-bar-wrap">${sortedGenres.map(([name, count]) => `<div class="genre-bar-item"><span class="gb-label">${name}</span><div class="gb-track"><div class="gb-fill" style="width:0">${count}</div></div></div>`).join('')}</div></div>` : ''}
    <div class="d-sec-title">Rating Distribution</div>
    <div style="display:flex;gap:4px;align-items:flex-end;height:120px;margin-bottom:32px;padding:0 4px">
      ${Array.from({ length: 10 }, (_, i) => { const score = i + 1; const count = Object.values(state.ratings).filter(r => r === score).length; const pct = totalRated ? Math.round(count / totalRated * 100) : 0; return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px"><div style="font-size:.65rem;color:var(--text3)">${count || ''}</div><div style="width:100%;height:${Math.max(pct, 2)}%;min-height:4px;background:linear-gradient(to top,var(--red),var(--gold));border-radius:4px 4px 0 0;transition:height 1s var(--ease)"></div><div style="font-size:.68rem;color:var(--text2);font-weight:600">${score}</div></div>`; }).join('')}
    </div>`;

  observeCountUps(ct);
  // Animate genre bars after paint.
  requestAnimationFrame(() => {
    ct.querySelectorAll('.genre-bar-item').forEach((item, i) => {
      const count = sortedGenres[i] ? sortedGenres[i][1] : 0;
      const fill = item.querySelector('.gb-fill');
      if (fill) fill.style.width = Math.round(count / maxGenre * 100) + '%';
    });
  });
}
