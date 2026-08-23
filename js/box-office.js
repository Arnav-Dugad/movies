// ===== WORLDWIDE BOX OFFICE DATA =====
// TMDB can sort discover results by revenue but does not include the amount in
// those result rows. Hydrate each page with movie details, in a bounded pool, so
// every number displayed by CineVerse is the reported value rather than a guess.
import { tmdb, pool } from './api.js';

const pageCache = new Map();
const detailCache = new Map();
const collectionRevenueCache = new Map();
const creditCache = new Map();
const DAY = 86400000;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const formatGross = (value, { compact = false } = {}) => {
  const amount = Math.max(0, +value || 0);
  if (!amount) return 'Not reported';
  if (compact) return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(amount);
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
};

async function movieDetail(movie, force) {
  const cached = detailCache.get(movie.id);
  if (!force && cached && Date.now() - cached.at < DAY) return cached.data;
  const detail = await tmdb(`/movie/${movie.id}`, {}, { cache: !force });
  const data = {
    ...movie, ...detail,
    title: detail.title || movie.title || '',
    poster_path: detail.poster_path || movie.poster_path || '',
    backdrop_path: detail.backdrop_path || movie.backdrop_path || '',
    revenue: Math.max(0, +detail.revenue || 0), budget: Math.max(0, +detail.budget || 0),
  };
  detailCache.set(movie.id, { at: Date.now(), data });
  return data;
}

/** One authoritative revenue-ranked page, with missing amounts excluded. */
export async function grossingMoviesPage(page = 1, { force = false } = {}) {
  const number = Math.max(1, Math.floor(+page || 1));
  const cached = pageCache.get(number);
  if (!force && cached && Date.now() - cached.at < DAY) return cached.data;
  const discover = await tmdb('/discover/movie', {
    sort_by: 'revenue.desc', page: number,
    'primary_release_date.lte': today(), 'vote_count.gte': 50,
  }, { cache: !force });
  const rows = [];
  await pool((discover.results || []).filter(movie => movie?.id), async movie => {
    try {
      const detail = await movieDetail(movie, force);
      if (detail.revenue > 0) rows.push(detail);
    } catch (_) { /* one incomplete film must not lose the whole chart */ }
  }, 5);
  rows.sort((a, b) => b.revenue - a.revenue || b.vote_count - a.vote_count || a.title.localeCompare(b.title));
  const data = { page: number, totalPages: Math.min(3, +discover.total_pages || 1), rows };
  pageCache.set(number, { at: Date.now(), data });
  return data;
}

export function financials(movie) {
  const revenue = Math.max(0, +movie?.revenue || 0), budget = Math.max(0, +movie?.budget || 0);
  const profit = budget && revenue ? revenue - budget : 0;
  return { revenue, budget, profit, roi: budget && revenue ? ((revenue - budget) / budget) * 100 : null };
}

/** Rank the collections represented by a revenue chart, hydrating every released part. */
export async function franchiseBoxOfficeLeague(movies, { force = false, limit = 20 } = {}) {
  const collections = new Map();
  movies.forEach(movie => {
    const collection = movie?.belongs_to_collection;
    if (collection?.id && !collections.has(collection.id)) collections.set(collection.id, collection);
  });
  const rows = [];
  await pool([...collections.values()], async collection => {
    const cached = collectionRevenueCache.get(collection.id);
    if (!force && cached && Date.now() - cached.at < DAY) { rows.push(cached.data); return; }
    const payload = await tmdb(`/collection/${collection.id}`, {}, { cache: !force });
    const released = (payload.parts || []).filter(part => part?.id && (!part.release_date || Date.parse(`${part.release_date}T00:00:00`) <= Date.now()));
    const hydrated = [];
    await pool(released, async part => {
      try {
        const detail = await movieDetail(part, force);
        if (detail.revenue > 0 || (detail.release_date && Date.parse(`${detail.release_date}T00:00:00`) <= Date.now())) hydrated.push(detail);
      } catch (_) {}
    }, 4);
    const films = hydrated.filter(film => film.revenue > 0);
    films.sort((a, b) => b.revenue - a.revenue);
    if (!films.length) return;
    const data = {
      id: +collection.id, name: payload.name || collection.name || 'Film collection',
      poster: payload.poster_path || collection.poster_path || films[0].poster_path || '',
      backdrop: payload.backdrop_path || collection.backdrop_path || films[0].backdrop_path || '',
      revenue: films.reduce((sum, film) => sum + film.revenue, 0),
      budget: films.reduce((sum, film) => sum + (+film.budget || 0), 0),
      films: hydrated.length, reported: films.length, topFilm: films[0],
    };
    collectionRevenueCache.set(collection.id, { at: Date.now(), data }); rows.push(data);
  }, 3);
  return rows.sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name)).slice(0, limit);
}

export function aggregateDirectorRanking(movies, creditsByMovie) {
  const directors = new Map();
  movies.forEach(movie => {
    const credits = creditsByMovie.get(+movie.id) || creditsByMovie.get(String(movie.id)) || [];
    const unique = new Map(credits.filter(person => person.job === 'Director' && person.id).map(person => [person.id, person]));
    unique.forEach(person => {
      if (!directors.has(person.id)) directors.set(person.id, { id: +person.id, name: person.name || 'Director', profile: person.profile_path || '', revenue: 0, films: 0, topFilm: null });
      const row = directors.get(person.id), revenue = Math.max(0, +movie.revenue || 0);
      row.revenue += revenue; row.films++;
      if (!row.topFilm || revenue > row.topFilm.revenue) row.topFilm = { id: +movie.id, title: movie.title || '', revenue };
    });
  });
  return [...directors.values()].filter(row => row.revenue > 0).sort((a, b) => b.revenue - a.revenue || b.films - a.films || a.name.localeCompare(b.name));
}

/** Directors ranked across the films currently loaded in the all-time chart. */
export async function directorBoxOfficeRanking(movies, { force = false, limit = 30 } = {}) {
  const creditsByMovie = new Map();
  await pool(movies, async movie => {
    let record = creditCache.get(movie.id);
    if (force || !record || Date.now() - record.at >= DAY) {
      const data = await tmdb(`/movie/${movie.id}/credits`, {}, { cache: !force });
      record = { at: Date.now(), crew: data.crew || [] }; creditCache.set(movie.id, record);
    }
    creditsByMovie.set(+movie.id, record.crew);
  }, 5);
  return aggregateDirectorRanking(movies, creditsByMovie).slice(0, limit);
}
