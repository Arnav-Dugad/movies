// ===== CURATED COLLECTION PAGE (/collection/:id) =====
// "See all" on any home row opens the exact curated set that row previews — the
// SAME endpoint + params — paged, instead of dumping the user on a generic
// /movies page that threw the curation away.
import { tmdb } from './api.js';
import { $ } from './ui.js';
import { buildCard, personCard, skelCards } from './cards.js';
import { registerActions } from './events.js';
import { observeReveals } from './effects.js';
import { SECTIONS } from './home.js';

let reqGen = 0, curSec = null, page = 1, maxPage = 1;

const keep = (s, item) => s.type === 'person' ? item.profile_path : item.poster_path;
function cardFor(s, item, index = 0) {
  if (s.type === 'person') return personCard(item);
  const t = s.type === 'multi' ? (item.media_type || 'movie') : s.type;
  if (s.t10) return `<article class="collection-rank-card"><span class="collection-rank-num">${index + 1}</span>${buildCard(item, t)}</article>`;
  return buildCard(item, t);
}

export async function openCollection2(id) {
  const gen = ++reqGen;
  const s = SECTIONS.find(x => x.id === id);
  const ct = $('collectionContent');
  if (!ct) return;
  if (!s) { ct.innerHTML = '<div style="text-align:center;padding:120px 20px"><p style="color:var(--text3)">Unknown collection</p><br><button class="btn-primary" data-action="back">Back</button></div>'; document.title = 'CineVerse'; return; }
  curSec = s; page = 1;
  document.title = `${s.t} — CineVerse`;
  ct.innerHTML = `<div class="browse-top"><h1>${s.icon} ${s.t}</h1>${s.t10 ? '<p class="collection-kicker">The definitive weekly countdown · ranked 1–10</p>' : ''}</div><div class="browse-grid${s.t10 ? ' collection-rank-grid' : ''}" id="collGrid">${skelCards(s.t10 ? 10 : 12)}</div><div class="load-more" id="collMore"></div>`;
  try {
    const d = await tmdb(s.p, { ...(s.params || {}), page: 1 });
    if (gen !== reqGen) return;
    maxPage = s.t10 ? 1 : Math.min(d.total_pages || 1, 500);
    const grid = $('collGrid');
    const results = (d.results || []).filter(x => keep(s, x)).slice(0, s.t10 ? 10 : 20);
    grid.innerHTML = results.map((x, index) => cardFor(s, x, index)).join('') || '<p style="color:var(--text3);padding:20px 0">Nothing here right now.</p>';
    renderMore();
    observeReveals(ct);
  } catch (e) {
    console.error('openCollection2', e);
    ct.innerHTML = '<div style="text-align:center;padding:120px 20px"><p style="color:var(--text3)">Failed to load</p><br><button class="btn-primary" data-action="back">Back</button></div>';
  }
}

function renderMore() {
  const m = $('collMore'); if (!m) return;
  m.innerHTML = page < maxPage ? '<button data-action="coll-more">Load More</button>' : '';
}

async function loadMore() {
  if (!curSec || page >= maxPage) return;
  const next = ++page;
  try {
    const d = await tmdb(curSec.p, { ...(curSec.params || {}), page: next });
    const grid = $('collGrid'); if (!grid) return;
    const offset = (next - 1) * 20;
    grid.insertAdjacentHTML('beforeend', (d.results || []).filter(x => keep(curSec, x)).map((x, index) => cardFor(curSec, x, offset + index)).join(''));
    renderMore();
    observeReveals(grid);
  } catch (e) { console.error('collection loadMore', e); }
}

export function initCollection() {
  registerActions({
    'see-all': (el) => document.dispatchEvent(new CustomEvent('cv:go', { detail: `/collection/${el.dataset.id}` })),
    'coll-more': () => loadMore(),
  });
}
