// ===== SCORE BADGES ON A TITLE PAGE =====
// IMDb, the Tomatometer and Metacritic, beside the TMDB score CineVerse already
// shows. They arrive after the page has painted (js/scores.js) and slide in.
//
// Each badge is a quiet pill: the source's own small mark, then the number in
// the page's ink. The colour belongs to the mark, not the whole chip, so a row
// of four scores reads as one row rather than four competing lozenges.
import { scoresFor } from './scores.js';
import { prefs } from './prefs.js';

/** Pure: the badges to draw, in order, for one set of scores. */
export function badgesFor(scores = {}, { imdbId = '' } = {}) {
  const out = [];
  if (scores.imdb > 0) {
    out.push({
      key: 'imdb',
      value: scores.imdb.toFixed(1),
      title: `IMDb rating ${scores.imdb.toFixed(1)} out of 10`,
      href: imdbId ? `https://www.imdb.com/title/${imdbId}/ratings/` : '',
    });
  }
  if (scores.rt > 0) {
    const fresh = scores.rt >= 60;
    out.push({
      key: 'rt',
      tone: fresh ? 'fresh' : 'rotten',
      value: `${scores.rt}%`,
      title: `Rotten Tomatoes critics: ${scores.rt}% positive${scores.rtAverage ? ` (average ${scores.rtAverage}/10)` : ''}`,
      href: '',
    });
  }
  // The other half of the Tomatometer, when a key returned it: the audience
  // meter, in popcorn rather than tomato so the two never read as one number.
  if (scores.rtAudience > 0) {
    out.push({
      key: 'rtu',
      tone: scores.rtAudience >= 60 ? 'fresh' : 'rotten',
      value: `${scores.rtAudience}%`,
      title: `Rotten Tomatoes audience: ${scores.rtAudience}% liked it`,
      href: '',
    });
  }
  if (scores.metacritic > 0) {
    out.push({
      key: 'mc',
      tone: scores.metacritic >= 61 ? 'good' : scores.metacritic >= 40 ? 'mixed' : 'poor',
      value: String(scores.metacritic),
      title: `Metacritic: ${scores.metacritic} out of 100`,
      href: '',
    });
  }
  return out;
}

// The marks. Small, flat and drawn to the same 16px box so the row lines up.
const TOMATO = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8.6 3.1c2.6 0 4.7 2 4.7 4.7 0 2.9-2.1 5.3-4.9 5.3S3.5 10.7 3.5 7.8c0-2.6 2.1-4.7 4.7-4.7z"/><path d="M8.9 3c.2-1.1 1-2 2-2.4-.1 1.1-.8 2.1-2 2.4z" class="rt-leaf"/></svg>';
const SPLAT = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 2.4l1.5 1.3 1.9-.6-.2 2 1.7 1-1.3 1.5.6 1.9-2 .2-1 1.7-1.5-1.3-1.9.6.2-2-1.7-1 1.3-1.5-.6-1.9 2-.2z"/></svg>';
// The audience pair: a full tub, and a tipped-over one.
const POPCORN = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.2 6h7.6l-.9 7.2a.8.8 0 0 1-.8.7H5.9a.8.8 0 0 1-.8-.7L4.2 6z"/><path class="rt-puff" d="M5.4 5.3a1.5 1.5 0 0 1 .3-2.5 1.6 1.6 0 0 1 2.3-1 1.6 1.6 0 0 1 2.4 1 1.5 1.5 0 0 1 .2 2.5H5.4z"/></svg>';
const SPILL = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.1 7.5 10 5.1l2.4 6.8a.8.8 0 0 1-.5 1l-4 1.4a.8.8 0 0 1-1-.5L3.1 7.5z"/><path class="rt-puff" d="M3.4 6.8 2 3.2l3.8 1.1-2.4 2.5z"/></svg>';

const MARKS = {
  imdb: () => '<b class="score-mark score-imdb">IMDb</b>',
  rt: tone => `<span class="score-mark score-rt ${tone}">${tone === 'fresh' ? TOMATO : SPLAT}</span>`,
  rtu: tone => `<span class="score-mark score-rtu ${tone}">${tone === 'fresh' ? POPCORN : SPILL}</span>`,
  mc: tone => `<b class="score-mark score-mc ${tone}"></b>`,
};

// The source is a data attribute, never a class: `.score-imdb` and friends are
// the MARK's rules (a 17px yellow wordmark, a 15px square), and putting the same
// names on the pill collapsed it to the size of its own mark, with the number
// spilling over the tag beside it.
function badgeHTML(badge) {
  const mark = MARKS[badge.key](badge.tone);
  const inner = `${mark}<span class="score-value">${badge.value}</span>`;
  const attrs = `class="score-tag${badge.tone ? ` is-${badge.tone}` : ''}" data-score="${badge.key}" title="${badge.title}" data-dp="scores"`;
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
