// ===== PERSON PAGE =====
import { tmdb } from './api.js';
import { IMG, PH } from './config.js';
import { esc, $ } from './ui.js';
import { buildCard } from './cards.js';
import { registerActions } from './events.js';
import { observeReveals } from './effects.js';

let reqGen = 0; // bumped on every openPerson() call; guards against a slower, stale fetch overwriting a newer one

export async function openPerson(id) {
  const gen = ++reqGen;
  const ct = $('personContent');
  ct.innerHTML = '<div style="text-align:center;padding:100px"><div class="loader-text">Loading...</div></div>';
  document.title = 'Loading… — CineVerse';
  try {
    const [p, credits] = await Promise.all([tmdb(`/person/${id}`), tmdb(`/person/${id}/combined_credits`)]);
    // Bail if the user has since opened a different person page.
    if (gen !== reqGen) return;
    document.title = `${p.name} — CineVerse`;
    const photo = p.profile_path ? `${IMG}w342${p.profile_path}` : PH;
    const knownFor = (credits.cast || []).sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0)).slice(0, 14);
    const directed = (credits.crew || []).filter(c => c.job === 'Director').sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0)).slice(0, 10);
    const age = p.birthday ? Math.floor((new Date() - new Date(p.birthday)) / (365.25 * 24 * 60 * 60 * 1000)) : '';
    ct.innerHTML = `
      <div class="person-top">
        <div class="person-photo"><img src="${photo}" alt="${esc(p.name)}" data-ph="${PH}"></div>
        <div class="person-head">
          <h1 class="person-name">${esc(p.name)}</h1>
          <div class="person-dept">${esc(p.known_for_department) || ''}</div>
          ${p.biography ? `<p class="person-bio" id="personBio">${esc(p.biography)}</p><span class="detail-overview-toggle" id="personBioToggle" data-action="toggle-bio" hidden>Read more</span>` : ''}
          <div class="person-stats">
            ${p.birthday ? `<div class="person-stat"><strong>Born:</strong> ${new Date(p.birthday).toLocaleDateString()}${age ? ' (' + age + ')' : ''}</div>` : ''}
            ${p.place_of_birth ? `<div class="person-stat"><strong>From:</strong> ${esc(p.place_of_birth)}</div>` : ''}
            ${p.deathday ? `<div class="person-stat"><strong>Died:</strong> ${new Date(p.deathday).toLocaleDateString()}</div>` : ''}
            ${credits.cast?.length ? `<div class="person-stat"><strong>Credits:</strong> ${credits.cast.length} roles</div>` : ''}
          </div>
        </div>
      </div>
      ${knownFor.length ? `<div class="d-sec-title">Known For</div><div class="similar-row">${knownFor.map(k => buildCard(k, k.media_type || 'movie')).join('')}</div>` : ''}
      ${directed.length ? `<div class="d-sec-title" style="margin-top:28px">Directed</div><div class="similar-row">${directed.map(k => buildCard(k, k.media_type || 'movie')).join('')}</div>` : ''}`;
    observeReveals(ct);
    const syncBio = () => {
      const bio = $('personBio'), toggle = $('personBioToggle'); if (!bio || !toggle) return;
      toggle.hidden = !(bio.scrollHeight > bio.clientHeight + 4);
    };
    requestAnimationFrame(syncBio);
    if (document.fonts?.ready) document.fonts.ready.then(() => requestAnimationFrame(syncBio)).catch(() => {});
  } catch (e) { ct.innerHTML = '<div style="text-align:center;padding:100px 20px"><p style="color:var(--text3)">Failed to load</p><br><button class="btn-primary" data-action="back">Back</button></div>'; }
}

export function initPerson() {
  registerActions({
    'open-person': (el, e) => { if (e) e.stopPropagation(); document.dispatchEvent(new CustomEvent('cv:go', { detail: `/person/${+el.dataset.id}` })); },
    'toggle-bio': (el) => {
      const bio = $('personBio'); if (!bio) return;
      const clamped = bio.style.webkitLineClamp !== 'unset';
      bio.style.webkitLineClamp = clamped ? 'unset' : '8';
      el.textContent = clamped ? 'Show less' : 'Read more';
    },
  });
}
