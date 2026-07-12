// ===== DISCOVER / MOOD =====
import { tmdb } from './api.js';
import { moods } from './config.js';
import { toast, $ } from './ui.js';
import { buildCard, skelCards } from './cards.js';
import { registerActions } from './events.js';
import { observeReveals } from './effects.js';

export function initDiscover() {
  $('moodGrid').innerHTML = moods.map((m, i) => `<div class="mood-card" role="button" tabindex="0" data-action="pick-mood" data-idx="${i}"><span class="mood-emoji">${m.emoji}</span><div class="mood-name">${m.name}</div><div class="mood-sub">${m.sub}</div></div>`).join('');
}

async function pickMood(idx) {
  const m = moods[idx]; const res = $('moodResults');
  res.innerHTML = `<div class="d-sec-title">${m.emoji} ${m.name}</div><div class="row" style="padding:0 0 8px">${skelCards(6)}</div>`;
  res.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const t = m.type === 'multi' ? 'movie' : m.type;
  const params = { with_genres: m.genres, sort_by: 'vote_average.desc', 'vote_count.gte': 100, page: Math.floor(Math.random() * 5) + 1 };
  if (m.lang) params.with_original_language = m.lang;
  try {
    const d = await tmdb(`/discover/${t}`, params);
    res.innerHTML = `<div class="d-sec-title">${m.emoji} ${m.name} — ${d.results.length} picks for you</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px">${d.results.slice(0, 20).map(r => buildCard(r, t)).join('')}</div>`;
    observeReveals(res);
  } catch (e) { res.innerHTML = '<p style="color:var(--text3)">Could not load results</p>'; }
}

export async function randomPick(type) {
  const btn = $(type === 'movie' ? 'spinBtn' : 'spinBtnTV');
  btn.classList.add('spinning'); btn.disabled = true;
  try {
    const pg = Math.floor(Math.random() * 20) + 1;
    const d = await tmdb(`/discover/${type}`, { sort_by: 'popularity.desc', page: pg, 'vote_count.gte': 50 });
    const pick = d.results[Math.floor(Math.random() * d.results.length)];
    if (pick) {
      $('pickerResult').innerHTML = `<div style="width:160px">${buildCard(pick, type)}</div>`;
      toast(`Random pick: ${pick.title || pick.name}!`, 'success');
    }
  } catch (e) { toast('Something went wrong', 'error'); }
  finally { btn.classList.remove('spinning'); btn.disabled = false; }
}

export function initDiscoverActions() {
  registerActions({
    'pick-mood': (el) => pickMood(+el.dataset.idx),
    'random-pick': (el) => randomPick(el.dataset.type),
  });
}
