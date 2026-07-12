// ===== COMMAND PALETTE (Ctrl/Cmd+K) =====
import { tmdb } from './api.js';
import { IMG } from './config.js';
import { esc, debounce, $ } from './ui.js';
import { registerActions } from './events.js';

const ic = {
  nav: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
};

const COMMANDS = [
  { label: 'Home', kw: 'home', icon: ic.nav, action: 'show-page', data: { page: 'home' } },
  { label: 'Movies', kw: 'movies films', icon: '🎬', action: 'show-page', data: { page: 'movies' } },
  { label: 'TV Shows', kw: 'tv series shows', icon: '📺', action: 'show-page', data: { page: 'tv' } },
  { label: 'Discover by Mood', kw: 'discover mood', icon: '🧭', action: 'show-page', data: { page: 'discover' } },
  { label: 'My Watchlist', kw: 'watchlist list saved', icon: '🔖', action: 'show-page', data: { page: 'watchlist' } },
  { label: 'My Stats', kw: 'stats profile taste', icon: '📊', action: 'show-page', data: { page: 'stats' } },
  { label: 'Search', kw: 'search find', icon: ic.search, action: 'open-search', data: {} },
  { label: 'Random Movie', kw: 'random surprise movie', icon: '🎲', action: 'random-pick', data: { type: 'movie' }, then: 'discover' },
  { label: 'Random Show', kw: 'random surprise tv show', icon: '🎲', action: 'random-pick', data: { type: 'tv' }, then: 'discover' },
  { label: 'Toggle Cinema Mode', kw: 'cinema dark theatre', icon: '🎦', action: 'toggle-cinema', data: {} },
  { label: 'Toggle Compare Mode', kw: 'compare versus head to head', icon: '⚖️', action: 'toggle-compare', data: {} },
  { label: 'Keyboard Shortcuts', kw: 'keyboard shortcuts help', icon: '⌨️', action: 'toggle-kb', data: {} },
  ...['red', 'blue', 'purple', 'green', 'orange', 'pink', 'gold'].map(t => ({ label: `Theme: ${t[0].toUpperCase() + t.slice(1)}`, kw: 'theme color accent ' + t, icon: '🎨', action: 'set-theme', data: { t } })),
];

let sel = 0;
let searchToken = 0;

export function openCmdk() {
  $('cmdkOv').classList.add('active');
  const input = $('cmdkIn'); input.value = '';
  render('');
  setTimeout(() => input.focus(), 60);
}
export function closeCmdk() { $('cmdkOv').classList.remove('active'); }
export function isCmdkOpen() { return $('cmdkOv').classList.contains('active'); }

function render(q, tmdbResults = null) {
  const list = $('cmdkList');
  const query = q.trim().toLowerCase();
  const cmds = query ? COMMANDS.filter(c => (c.label + ' ' + c.kw).toLowerCase().includes(query)) : COMMANDS;

  let html = '';
  if (cmds.length) {
    html += `<div class="cmdk-group-label">Actions</div>`;
    html += cmds.map(c => {
      const dataAttrs = Object.entries(c.data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
      const then = c.then ? `data-then="${c.then}"` : '';
      return `<div class="cmdk-item" data-cmd data-action="${c.action}" ${dataAttrs} ${then}><span class="cmdk-ic">${c.icon}</span><div class="cmdk-meta"><div class="cmdk-t">${esc(c.label)}</div></div></div>`;
    }).join('');
  }
  if (tmdbResults && tmdbResults.length) {
    html += `<div class="cmdk-group-label">Titles</div>`;
    html += tmdbResults.map(r => {
      const t = r.media_type === 'person' ? 'person' : (r.media_type || 'movie');
      const title = r.title || r.name || '';
      const year = (r.release_date || r.first_air_date || '').slice(0, 4);
      const thumb = (r.poster_path || r.profile_path) ? `${IMG}w92${r.poster_path || r.profile_path}` : '';
      const act = t === 'person' ? 'open-person' : 'open-detail';
      const dataT = t === 'person' ? '' : `data-type="${t}"`;
      const sub = t === 'person' ? 'Person' : `${year || ''}${year ? ' · ' : ''}${t === 'tv' ? 'TV' : 'Movie'}`;
      return `<div class="cmdk-item" data-cmd data-action="${act}" data-id="${r.id}" ${dataT}>${thumb ? `<img class="cmdk-thumb" src="${thumb}" alt="">` : `<span class="cmdk-ic">${t === 'person' ? '👤' : '🎬'}</span>`}<div class="cmdk-meta"><div class="cmdk-t">${esc(title)}</div><div class="cmdk-s">${sub}</div></div></div>`;
    }).join('');
  }
  if (!html) html = `<div class="cmdk-empty">No matches for "${esc(q)}"</div>`;
  list.innerHTML = html;
  sel = 0;
  updateSel();
}

function updateSel() {
  const items = $('cmdkList').querySelectorAll('.cmdk-item');
  items.forEach((el, i) => el.classList.toggle('sel', i === sel));
  const cur = items[sel];
  if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
}

const liveSearch = debounce(async (q) => {
  const token = ++searchToken;
  try {
    const d = await tmdb('/search/multi', { query: q });
    if (token !== searchToken) return;
    const results = (d.results || []).filter(r => (r.media_type === 'person' ? true : r.poster_path)).slice(0, 6);
    render(q, results);
  } catch (e) { render(q, []); }
}, 250);

export function initCmdk() {
  const input = $('cmdkIn');
  input.addEventListener('input', function () {
    const q = this.value.trim();
    if (q.length >= 2) liveSearch(q); else render(this.value);
  });
  input.addEventListener('keydown', e => {
    const items = $('cmdkList').querySelectorAll('.cmdk-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); updateSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); updateSel(); }
    else if (e.key === 'Enter') { e.preventDefault(); const cur = items[sel]; if (cur) cur.click(); }
  });

  // A real click on an item runs its data-action via global delegation.
  // This listener only closes the palette (+ optional page pre-switch). It never
  // re-dispatches, so there's no loop.
  $('cmdkList').addEventListener('click', e => {
    const el = e.target.closest('.cmdk-item'); if (!el) return;
    const then = el.dataset.then;
    if (then) document.dispatchEvent(new CustomEvent('cv:navigate', { detail: then }));
    closeCmdk();
  });

  $('cmdkOv').addEventListener('click', e => { if (e.target === $('cmdkOv')) closeCmdk(); });

  registerActions({ 'open-cmdk': () => openCmdk(), 'close-cmdk': () => closeCmdk() });
}
