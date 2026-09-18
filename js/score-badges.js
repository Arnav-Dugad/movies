// ===== SCORE BADGES ON A TITLE PAGE =====
// IMDb, the Tomatometer and Metacritic, beside the TMDB score CineVerse already
// shows. They arrive after the page has painted (js/scores.js), slide in, and
// each one links out to where it came from. A title with no outside scores shows
// nothing extra, and a reader who has turned scores off in Settings sees none of
// it at all.
import { scoresFor } from './scores.js';
import { prefs } from './prefs.js';

/** Pure: the badges to draw, in order, for one set of scores. */
export function badgesFor(scores = {}, { imdbId = '' } = {}) {
  const out = [];
  if (scores.imdb > 0) {
    out.push({ key: 'imdb', label: 'IMDb', value: scores.imdb.toFixed(1), suffix: '', title: `IMDb rating ${scores.imdb.toFixed(1)} out of 10`, href: imdbId ? `https://www.imdb.com/title/${imdbId}/ratings/` : '' });
  }
  if (scores.rt > 0) {
    out.push({ key: scores.rt >= 60 ? 'rt fresh' : 'rt rotten', label: 'Tomatometer', value: String(scores.rt), suffix: '%', title: `Rotten Tomatoes: ${scores.rt}% of critics positive${scores.rtAverage ? ` (average ${scores.rtAverage}/10)` : ''}`, href: '' });
  }
  if (scores.metacritic > 0) {
    const tone = scores.metacritic >= 61 ? 'mc good' : scores.metacritic >= 40 ? 'mc mixed' : 'mc poor';
    out.push({ key: tone, label: 'Metascore', value: String(scores.metacritic), suffix: '', title: `Metacritic: ${scores.metacritic} out of 100`, href: '' });
  }
  return out;
}

const MARKS = {
  imdb: '<b class="score-mark imdb">IMDb</b>',
  rt: '<svg class="score-mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4.2c3.9 0 7.3 2.9 7.3 6.9 0 4.6-3.3 8.7-7.3 8.7s-7.3-4.1-7.3-8.7c0-4 3.4-6.9 7.3-6.9z"/><path fill="currentColor" d="M12.4 4.4c.2-1 .9-1.9 1.9-2.4-.2 1-.9 1.9-1.9 2.4z"/></svg>',
  mc: '<b class="score-mark mc">M</b>',
};

function badgeHTML(badge) {
  const family = badge.key.split(' ')[0];
  const inner = `${MARKS[family] || ''}<span>${badge.value}${badge.suffix}</span>`;
  const attrs = `class="dtag score-tag ${badge.key}" title="${badge.title}" data-dp="scores"`;
  return badge.href
    ? `<a ${attrs} href="${badge.href}" target="_blank" rel="noopener">${inner}</a>`
    : `<span ${attrs}>${inner}</span>`;
}

/**
 * Fill a title page's tag row with outside scores.
 * @param {HTMLElement} host   the page container
 * @param {string} imdbId      tt-id from TMDB's external_ids
 * @param {'movie'|'tv'} type
 */
export async function mountScoreBadges(host, imdbId, type = 'movie') {
  const row = host?.querySelector?.('.detail-tags');
  if (!row || !imdbId || prefs.showRatings === false) return null;
  row.querySelectorAll('.score-tag').forEach(tag => tag.remove());
  const scores = await scoresFor(imdbId, type);
  const badges = badgesFor(scores, { imdbId });
  if (!badges.length || !row.isConnected) return scores;
  const anchor = row.querySelector('[data-dp="rating"]') || row.firstElementChild;
  const markup = badges.map(badgeHTML).join('');
  if (anchor) anchor.insertAdjacentHTML('afterend', markup); else row.insertAdjacentHTML('beforeend', markup);
  row.querySelectorAll('.score-tag').forEach((tag, index) => tag.style.setProperty('--score-i', String(index)));
  return scores;
}
