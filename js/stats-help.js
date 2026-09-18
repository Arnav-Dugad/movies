// ===== VISUAL HELP ON THE STATS PAGE =====
// Every block on Stats used to carry a paragraph under its heading explaining
// what it measures. Fifteen of those, above fifteen walls of figures, is what
// made the page feel like homework.
//
// The paragraph is not lost: each heading gains a small (?) that opens a card
// with the block's own animated scene beside the explanation. The page reads as
// figures; the words are one tap away, and they arrive with a picture.
import { illustration } from './illustrations.js';

// A scene per block, chosen for what the block measures.
export const SCENES = {
  'activity-section': 'calendar',
  'watch-diary': 'year',
  'tv-tracker': 'tv',
  'rewatch-panel': 'projector',
  'rating-intel': 'stats',
  'taste-section': 'compass',
  'tag-taste-profile': 'layers',
  'taste-changes': 'palette',
  'collection-health': 'shield',
  'franchise-panel': 'layers',
  'provider-reliability': 'globe',
  'provider-history-charts': 'radar',
  'director-loyalty': 'masks',
  'cast-milestones': 'friends',
  'director-network': 'spotlight',
  'smart-watch': 'search',
  'stats-achievements': 'trophy',
};

/** Pure: the scene for a panel, from the classes it carries. */
export function sceneFor(classNames) {
  const names = String(classNames || '').split(/\s+/);
  for (const name of names) if (SCENES[name]) return SCENES[name];
  return 'projector';
}

let uid = 0;
function enhance(panel) {
  const head = panel.querySelector(':scope > .stats-section-head');
  const copy = head?.querySelector(':scope > div');
  const blurb = copy?.querySelector(':scope > p');
  const title = copy?.querySelector(':scope > h2');
  if (!blurb || !title || copy.querySelector('.stats-help')) return;

  const id = `statsHelp${++uid}`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'stats-help';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', id);
  button.setAttribute('aria-label', `What ${title.textContent.trim()} measures`);
  button.innerHTML = '<span aria-hidden="true">?</span>';

  const pop = document.createElement('div');
  pop.className = 'stats-help-pop';
  pop.id = id;
  pop.hidden = true;
  pop.innerHTML = `<i class="stats-help-art" aria-hidden="true">${illustration(sceneFor(panel.className))}</i>`;
  pop.appendChild(blurb);

  // The heading and its (?) sit on one line; the card hangs under them.
  const line = document.createElement('div');
  line.className = 'stats-help-line';
  title.replaceWith(line);
  line.append(title, button);
  copy.appendChild(pop);
}

function closeAll(except = null) {
  document.querySelectorAll('.stats-help[aria-expanded="true"]').forEach(button => {
    if (button === except) return;
    button.setAttribute('aria-expanded', 'false');
    const pop = document.getElementById(button.getAttribute('aria-controls'));
    if (pop) pop.hidden = true;
  });
}

export function initStatsHelp() {
  const scan = () => document.querySelectorAll('#statsContent .stats-panel, #statsContent .stats-achievements').forEach(enhance);
  scan();

  let queued = false;
  const host = document.getElementById('statsContent');
  if (host) {
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; scan(); });
    }).observe(host, { childList: true, subtree: true });
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('.stats-help');
    if (!button) { if (!event.target.closest?.('.stats-help-pop')) closeAll(); return; }
    const pop = document.getElementById(button.getAttribute('aria-controls'));
    const open = button.getAttribute('aria-expanded') === 'true';
    closeAll(button);
    button.setAttribute('aria-expanded', String(!open));
    if (pop) pop.hidden = open;
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeAll(); });
}
