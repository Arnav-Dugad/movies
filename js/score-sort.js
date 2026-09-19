// ===== SORTING BY IMDb =====
// Three pages can order titles by their IMDb rating: My List, Watched and
// search results. The numbers come from the device's outside-scores cache
// (js/scores.js), which is shared, so a title fetched on one page is already
// sorted on the next.
//
// This is the one place that fills the gaps: it fetches what the cache is
// missing for the list in hand, a few at a time, says so while it works, and
// redraws once they have landed. A title still waiting sorts last rather than
// pretending to be a zero, so nothing ever claims a score it does not have.
import { toast } from './ui.js';
import { prefetchScores } from './scores.js';

/**
 * Fetch the IMDb scores a list is missing, then redraw.
 * @param {{ tmdbId?: number, id?: number|string, type?: string }[]} items
 * @param {() => void} redraw  called once, only if anything new arrived
 */
export function fetchIMDbScores(items, redraw) {
  const list = (items || [])
    .map(item => ({ tmdbId: +(item.tmdbId || item.id || 0), type: item.type === 'tv' ? 'tv' : 'movie' }))
    .filter(item => item.tmdbId);
  if (!list.length) return Promise.resolve(0);
  let said = false;
  const announce = () => { if (!said) { said = true; toast('Fetching IMDb ratings…', 'info'); } };
  return prefetchScores(list, announce).then(done => {
    if (!done) return 0;
    redraw?.();
    toast(`${done} IMDb rating${done === 1 ? '' : 's'} added`, 'success');
    return done;
  }).catch(() => 0);
}
