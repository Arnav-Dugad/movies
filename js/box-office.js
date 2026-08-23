// ===== WORLDWIDE BOX OFFICE DATA =====
// TMDB can sort discover results by revenue but does not include the amount in
// those result rows. Hydrate each page with movie details, in a bounded pool, so
// every number displayed by CineVerse is the reported value rather than a guess.
import { tmdb, pool } from './api.js';

const pageCache = new Map();
const detailCache = new Map();
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
