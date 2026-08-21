// ===== MATURE CONTENT =====
// Off by default and invisible until switched on: no section renders, no chip
// appears, `include_adult` stays false, and nothing in the interface hints that
// the option exists. Turning it on is a deliberate act in Settings.
//
// TMDB has no "erotic" genre, so the collections are built from verified TMDB
// KEYWORDS instead (see MATURE_KEYWORDS in config.js). Everything still comes
// from TMDB's public metadata — the toggle only decides whether we ask for it.
import { tmdb } from './api.js';
import { MATURE_KEYWORDS } from './config.js';
import { $, esc, toast } from './ui.js';
import { buildCard, skelCards } from './cards.js';
import { registerActions } from './events.js';
import { observeReveals } from './effects.js';
import { prefs, updatePref } from './prefs.js';

let activeKeyword = MATURE_KEYWORDS[0].id;
let requestGen = 0;

export const matureOn = () => !!prefs.mature;

// The single place that decides whether a TMDB request may include adult
// results, so no caller can accidentally leak them in while the toggle is off.
export const adultParam = () => (matureOn() ? { include_adult: true } : {});

function keywordParams(id, page = 1) {
  return {
    with_keywords: String(id),
    sort_by: 'popularity.desc',
    'vote_count.gte': 8,
    include_adult: true,
    page,
  };
}

export async function fetchMatureRow(keywordId, page = 1) {
  if (!matureOn()) return [];
  const data = await tmdb('/discover/movie', keywordParams(keywordId, page)).catch(() => null);
  return (data?.results || []).filter(item => item.poster_path);
}

// ---------- Discover section ----------
export function matureSectionHTML() {
  if (!matureOn()) return '';
  const chips = MATURE_KEYWORDS.map(keyword =>
    `<button class="${keyword.id === activeKeyword ? 'active' : ''}" data-action="mature-keyword" data-id="${keyword.id}">${esc(keyword.name)}</button>`).join('');
  const current = MATURE_KEYWORDS.find(keyword => keyword.id === activeKeyword) || MATURE_KEYWORDS[0];
  return `<section class="mature-section" id="matureSection">
    <div class="discover-section-head">
      <div><span>After dark</span><h2>Mature collections</h2><p>${esc(current.blurb)}. Built from TMDB keywords, shown because you turned mature content on.</p></div>
      <div class="discover-section-tools">
        <button data-action="mature-blur-toggle" aria-pressed="${prefs.matureBlur ? 'true' : 'false'}">${prefs.matureBlur ? 'Artwork blurred' : 'Artwork visible'}</button>
        <button data-action="mature-off">Turn off</button>
      </div>
    </div>
    <div class="mature-chips" role="tablist">${chips}</div>
    <div class="browse-grid mature-grid" id="matureGrid">${skelCards(12)}</div>
    <p class="mature-note">Adult results are included in search and Discover only while this is on. Save anything private to a PIN-locked list from the + button on a poster.</p>
  </section>`;
}

export async function renderMatureRow() {
  const grid = $('matureGrid');
  if (!grid) return;
  const gen = ++requestGen;
  grid.innerHTML = skelCards(12);
  const results = await fetchMatureRow(activeKeyword);
  if (gen !== requestGen || !grid.isConnected) return;
  grid.innerHTML = results.length
    ? results.map(item => buildCard(item, 'movie')).join('')
    : '<p class="mature-empty">Nothing came back for this keyword right now.</p>';
  observeReveals(grid);
}

function repaintSection() {
  const host = $('matureSection');
  if (!host) return;
  host.outerHTML = matureSectionHTML();
  renderMatureRow();
}

export function initMature() {
  registerActions({
    'mature-keyword': element => {
      activeKeyword = +element.dataset.id || MATURE_KEYWORDS[0].id;
      document.querySelectorAll('.mature-chips button').forEach(button => button.classList.toggle('active', +button.dataset.id === activeKeyword));
      const current = MATURE_KEYWORDS.find(keyword => keyword.id === activeKeyword);
      const blurb = document.querySelector('#matureSection .discover-section-head p');
      if (blurb && current) blurb.textContent = `${current.blurb}. Built from TMDB keywords, shown because you turned mature content on.`;
      renderMatureRow();
    },
    'mature-blur-toggle': () => { updatePref('matureBlur', !prefs.matureBlur); repaintSection(); },
    'mature-off': () => {
      updatePref('mature', false);
      $('matureSection')?.remove();
      toast('Mature content hidden', 'info');
      document.dispatchEvent(new Event('cv:mature'));
    },
  });
}
