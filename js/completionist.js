// ===== COMPLETIONIST =====
// "You've seen 8 of 12 Christopher Nolan films", with the films you have not
// seen listed best-rated first. Used by the Completionist panel on Stats (your
// most-watched directors and actors) and by every person page.
//
// What counts as one of someone's films, so the count means something:
//   - a feature released on or before today (an announced film cannot be a gap);
//   - with at least 50 TMDB votes, the point where a film is established enough
//     to count against you. A film you HAVE seen always counts, however obscure;
//   - directors: credits with the job "Director";
//   - actors: acting roles only — appearances as themselves (documentary and
//     talk-show "Self" credits) and uncredited cameos are left out;
//   - documentaries follow the Stats "Exclude documentaries" switch.
// The pure functions make no requests; loadCompletion (the one both pages use,
// so their counts always agree) fetches what it needs.
import { tmdb } from './api.js';

export const MIN_VOTES = 50;
const DOCUMENTARY = 99;
const SELF_ROLE = /\b(self|himself|herself|themselves|narrator \(archive|archive footage)\b/i;
const UNCREDITED = /uncredited/i;

const yearOf = credit => +(String(credit.release_date || '').slice(0, 4)) || 0;
const releasedBy = (credit, now) => {
  const raw = credit.release_date;
  if (!raw) return false;
  const date = new Date(`${raw}T00:00:00`);
  return !Number.isNaN(date.getTime()) && date <= now;
};

/** Pure: the credits that count as `role`'s films ('director' | 'actor'), one per film. */
export function eligibleFilms(credits = {}, role = 'director', { watched = new Set(), now = new Date(), excludeDocumentaries = false } = {}) {
  const seen = watched instanceof Set ? watched : new Set(watched);
  const source = role === 'actor'
    ? (credits.cast || []).filter(credit => !SELF_ROLE.test(credit.character || '') && !UNCREDITED.test(credit.character || ''))
    : (credits.crew || []).filter(credit => credit.job === 'Director');
  const films = new Map();
  for (const credit of source) {
    const id = +credit.id;
    if (!id || films.has(id)) continue;
    if (credit.media_type && credit.media_type !== 'movie') continue;
    const mine = seen.has(id);
    if (!mine && !releasedBy(credit, now)) continue;
    if (excludeDocumentaries && (credit.genre_ids || []).map(Number).includes(DOCUMENTARY)) continue;
    if (!mine && (+credit.vote_count || 0) < MIN_VOTES) continue;
    films.set(id, credit);
  }
  return [...films.values()];
}

/**
 * Pure: how much of a person's work you have seen.
 * @returns {{ id, name, profile, role, seen, total, percent, gaps: object[] }}
 *   gaps are the unseen films, highest TMDB rating first (more votes breaks a tie).
 */
export function completionFor(person, credits, role, options = {}) {
  const watched = options.watched instanceof Set ? options.watched : new Set(options.watched || []);
  const films = eligibleFilms(credits, role, { ...options, watched });
  const seen = films.filter(film => watched.has(+film.id)).length;
  const gaps = films
    .filter(film => !watched.has(+film.id))
    .sort((a, b) => (+b.vote_average || 0) - (+a.vote_average || 0) || (+b.vote_count || 0) - (+a.vote_count || 0) || yearOf(b) - yearOf(a))
    .slice(0, options.gapLimit || 24)
    .map(film => ({
      id: +film.id, title: film.title || film.original_title || 'Untitled', year: yearOf(film),
      rating: Math.round((+film.vote_average || 0) * 10) / 10, votes: +film.vote_count || 0, poster: film.poster_path || '',
    }));
  return {
    id: +person.id, name: person.name || '', profile: person.profile || '', role,
    seen, total: films.length, percent: films.length ? Math.round((seen / films.length) * 100) : 0,
    gaps, gapCount: films.length - seen,
  };
}

/** "You've seen 8 of 12 Christopher Nolan films" — or the finished form. */
export function completionHeadline(item) {
  if (!item?.total) return `No established ${item?.name ? `${item.name} ` : ''}films yet`;
  const noun = item.total === 1 ? 'film' : 'films';
  if (item.seen >= item.total) return `You've seen all ${item.total} ${item.name} ${noun}`;
  return `You've seen ${item.seen} of ${item.total} ${item.name} ${noun}`;
}

/**
 * Films of at least 41 minutes this person directed (or acted in), from TMDB's
 * discover index: credits carry no runtime, so "Exclude shorts" asks discover.
 */
export async function featureLengthFilmIds(personId, role = 'director') {
  const params = { [role === 'actor' ? 'with_cast' : 'with_crew']: String(personId), 'with_runtime.gte': 41, sort_by: 'popularity.desc' };
  const first = await tmdb('/discover/movie', params);
  const pages = Math.min(20, Math.max(1, +(first.total_pages || 1)));
  const rest = pages > 1 ? await Promise.all(Array.from({ length: pages - 1 }, (_, index) => tmdb('/discover/movie', { ...params, page: index + 2 }))) : [];
  return new Set([...(first.results || []), ...rest.flatMap(page => page.results || [])].map(item => +item.id).filter(Boolean));
}

/**
 * One person's completion with the Stats switches applied. `credits` (movie
 * credits: { cast, crew }) may be passed when the caller already has them.
 */
export async function loadCompletion(person, role, { watched, excludeShorts = false, excludeDocumentaries = false, gapLimit = 12, credits = null } = {}) {
  const seen = watched instanceof Set ? watched : new Set(watched || []);
  const [data, featureIds] = await Promise.all([
    credits ? Promise.resolve(credits) : tmdb(`/person/${person.id}/movie_credits`),
    excludeShorts ? featureLengthFilmIds(person.id, role) : Promise.resolve(null),
  ]);
  const keep = credit => !featureIds || featureIds.has(+credit.id) || seen.has(+credit.id);
  return completionFor(person, { cast: (data.cast || []).filter(keep), crew: (data.crew || []).filter(keep) }, role, { watched: seen, excludeDocumentaries, gapLimit });
}

/** Which role a person page should measure: their known-for department decides. */
export const roleForDepartment = department => (department === 'Directing' ? 'director' : 'actor');
