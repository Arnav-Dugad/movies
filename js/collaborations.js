// ===== PERSON-TO-PERSON LINKS =====
// "You've seen 6 films where Christopher Nolan directed Cillian Murphy."
// A person page lists the people this person keeps working with, counted only
// over the films YOU have seen:
//   - an actor's directors ("… where Nolan directed Cillian Murphy");
//   - a director's actors ("… where Nolan directed Michael Caine");
//   - an actor's co-stars, when both are top-billed ("… with Cillian Murphy and
//     Tom Hardy together").
// Credits come from each watched film's TMDB credits, so the role is the one the
// person had in that film, not the one they are best known for. A link needs at
// least two films; directors are listed before co-stars when counts tie.
import { tmdb } from './api.js';

const TOP_BILLED = 8;        // co-stars: both within the first eight billed
const DIRECTED_CAST = 12;    // a director's actors: within the first twelve billed
const RELATION_ORDER = { 'directed-them': 0, 'they-directed': 1, 'co-star': 2 };

/**
 * Pure: links from films the viewer has seen.
 * @param {number} personId
 * @param {{ id, title, poster, year, directors: object[], cast: object[] }[]} films
 *   cast entries carry TMDB's billing `order`
 */
export function collaborationLinks(personId, films, { minCount = 2, limit = 4 } = {}) {
  const pid = +personId;
  const links = new Map();
  const add = (key, relation, other, film) => {
    const link = links.get(key) || { relation, other: { id: +other.id, name: other.name || '', profile: other.profile || other.profile_path || '' }, films: new Map() };
    link.films.set(+film.id, { id: +film.id, title: film.title || '', poster: film.poster || '', year: film.year || 0 });
    links.set(key, link);
  };
  for (const film of films || []) {
    const directors = (film.directors || []).filter(person => +person.id);
    const cast = (film.cast || []).filter(person => +person.id);
    const directed = directors.some(person => +person.id === pid);
    const billing = cast.find(person => +person.id === pid);
    if (billing) {
      for (const director of directors) if (+director.id !== pid) add(`d${director.id}`, 'directed-them', director, film);
      if ((+billing.order || 0) < TOP_BILLED) {
        for (const star of cast) if (+star.id !== pid && (+star.order || 0) < TOP_BILLED) add(`c${star.id}`, 'co-star', star, film);
      }
    }
    if (directed) {
      for (const star of cast) if (+star.id !== pid && (+star.order || 0) < DIRECTED_CAST) add(`a${star.id}`, 'they-directed', star, film);
    }
  }
  return [...links.values()]
    .map(link => ({ ...link, films: [...link.films.values()].sort((a, b) => (b.year || 0) - (a.year || 0)), count: link.films.size }))
    .filter(link => link.count >= minCount && link.other.name)
    // Someone who both directed and starred beside this person appears once, under
    // the stronger relation.
    .filter((link, index, all) => all.findIndex(other => other.other.id === link.other.id && (other.count > link.count || (other.count === link.count && RELATION_ORDER[other.relation] < RELATION_ORDER[link.relation]))) === -1)
    .sort((a, b) => b.count - a.count || RELATION_ORDER[a.relation] - RELATION_ORDER[b.relation] || a.other.name.localeCompare(b.other.name))
    .slice(0, limit);
}

/** "You've seen 6 films where Christopher Nolan directed Cillian Murphy". `mark` wraps each name (emphasis in HTML). */
export function linkSentence(link, personName, mark = name => name) {
  const films = `${link.count} film${link.count === 1 ? '' : 's'}`;
  const person = mark(personName), other = mark(link.other.name);
  if (link.relation === 'directed-them') return `You've seen ${films} where ${other} directed ${person}`;
  if (link.relation === 'they-directed') return `You've seen ${films} where ${person} directed ${other}`;
  return `You've seen ${films} with ${person} and ${other} together`;
}

/**
 * The watched films in a person's movie credits, with their credits fetched
 * (the most-voted forty, four requests at a time).
 */
export async function watchedFilmsWithCredits(movieCredits, watchedIds, { cap = 40 } = {}) {
  const seen = watchedIds instanceof Set ? watchedIds : new Set(watchedIds || []);
  const unique = new Map();
  for (const credit of movieCredits || []) if (seen.has(+credit.id) && !unique.has(+credit.id)) unique.set(+credit.id, credit);
  const picks = [...unique.values()].sort((a, b) => (+b.vote_count || 0) - (+a.vote_count || 0)).slice(0, cap);
  const films = new Array(picks.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < picks.length) {
      const index = cursor++;
      const credit = picks[index];
      try {
        const data = await tmdb(`/movie/${credit.id}/credits`);
        films[index] = {
          id: +credit.id, title: credit.title || credit.original_title || '', poster: credit.poster_path || '',
          year: +(String(credit.release_date || '').slice(0, 4)) || 0,
          directors: (data.crew || []).filter(person => person.job === 'Director').map(person => ({ id: person.id, name: person.name, profile: person.profile_path || '' })),
          cast: (data.cast || []).map(person => ({ id: person.id, name: person.name, profile: person.profile_path || '', order: +person.order || 0 })),
        };
      } catch (_) { films[index] = null; }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return films.filter(Boolean);
}
