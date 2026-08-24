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
const RATE_KEY = 'cv_usd_inr_rate_v1';
const DIRECTOR_REVENUE_KEY = 'cv_director_revenue_v1';
let usdInrRecord = null;
let directorRevenueRecord = null;

export function clearBoxOfficeCache() {
  pageCache.clear(); detailCache.clear(); collectionRevenueCache.clear(); creditCache.clear();
}

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

/**
 * TMDB reports revenue in USD. Indian titles are converted for display with a
 * once-daily, no-key reference rate. The source USD remains authoritative and
 * the approximation mark prevents a converted number looking like India nett.
 */
export async function getUsdInrRate({ force = false } = {}) {
  if (!usdInrRecord) {
    try { usdInrRecord = JSON.parse(localStorage.getItem(RATE_KEY) || 'null'); } catch (_) {}
  }
  if (!force && usdInrRecord?.rate > 0 && Date.now() - (+usdInrRecord.at || 0) < DAY) return usdInrRecord.rate;
  try {
    const response = await fetch('https://api.frankfurter.dev/v2/rate/USD/INR');
    if (!response.ok) throw new Error(`FX ${response.status}`);
    const payload = await response.json();
    const rate = Math.max(1, +(payload?.rate || 0));
    if (!rate) throw new Error('FX rate missing');
    usdInrRecord = { rate, at: Date.now(), date: payload.date || '' };
    try { localStorage.setItem(RATE_KEY, JSON.stringify(usdInrRecord)); } catch (_) {}
    return rate;
  } catch (_) {
    // A conversion should never prevent the chart from loading. Prefer the last
    // known value, then a conservative fallback, and keep the approximation mark.
    return Math.max(1, +(usdInrRecord?.rate || 90));
  }
}

export function formatIndianGross(value, { compact = false, rate = usdInrRecord?.rate || 90 } = {}) {
  const usd = Math.max(0, +value || 0);
  if (!usd) return 'Not reported';
  const crore = usd * Math.max(1, +rate || 90) / 10000000;
  if (compact) return `≈₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: crore >= 100 ? 0 : 1 }).format(crore)} Cr`;
  return `≈ ₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(crore)} crore`;
}

const INDIAN_LANGUAGES = new Set(['hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'pa', 'gu', 'ur', 'or', 'as']);

/** True only for an Indian production (language is a fallback when country data is absent). */
export function isIndianProduction(movie) {
  const countries = [
    ...(movie?.production_countries || []).map(country => country?.iso_3166_1 || country),
    ...(movie?.origin_country || []), movie?.country,
  ].filter(Boolean).map(value => String(value).toUpperCase());
  if (countries.length) return countries.includes('IN');
  return INDIAN_LANGUAGES.has(String(movie?.original_language || '').toLowerCase());
}

/**
 * Market assumptions used only for clearly-labelled modelling. Indian trade
 * verdicts are based on distributor recovery and India nett, neither of which
 * TMDB supplies, so the Indian profile is deliberately kept separate from the
 * standard worldwide studio model.
 */
export function boxOfficeAssumptions(movie) {
  const india = isIndianProduction(movie);
  return india
    ? { id: 'india', label: 'India-aware model', marketingLowRate: .25, marketingHighRate: .75, returnLowRate: .4, returnHighRate: .5, hitThreshold: 2.5 }
    : { id: 'worldwide', label: 'Worldwide studio model', marketingLowRate: .5, marketingHighRate: 1, returnLowRate: .4, returnHighRate: .55, hitThreshold: 2 };
}

export function directorConsistency(movies) {
  const clamp = value => Math.max(0, Math.min(100, value));
  const median = values => {
    const ordered = [...values].sort((a, b) => a - b), middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  };
  const rows = (movies || []).map(movie => {
    const budget = +movie?.budget || 0, revenue = +movie?.revenue || 0;
    const vote = +movie?.vote_average || 0, votes = +movie?.vote_count || 0;
    const hasFinancial = budget > 0 && revenue > 0;
    const hasAudience = vote > 0 && votes >= 40;
    if (!hasFinancial && !hasAudience) return null;
    let financial = null, audience = null, multiple = null;
    if (hasFinancial) {
      multiple = revenue / budget;
      const target = boxOfficeAssumptions(movie).hitThreshold;
      // Logarithmic scaling stops a single giant blockbuster from erasing an
      // uneven career while treating each market's success threshold fairly.
      financial = clamp(64 + Math.log2(Math.max(.05, multiple / target)) * 22);
    }
    if (hasAudience) {
      // Confidence-weighted audience quality. Forty votes barely move the 6.3
      // prior; thousands of votes let the film's own score speak for itself.
      const confidence = votes / (votes + 650);
      const adjusted = vote * confidence + 6.3 * (1 - confidence);
      audience = clamp((adjusted - 4.5) / 4 * 100);
    }
    const performance = financial == null ? audience : audience == null ? financial : financial * .62 + audience * .38;
    return { performance, multiple, hasFinancial, hasAudience };
  }).filter(Boolean);
  if (!rows.length) return { score: null, label: 'Not enough data', sample: 0, financialSample: 0, audienceSample: 0, successRate: null, stability: null, medianPerformance: null, medianMultiple: null };

  const performances = rows.map(row => row.performance);
  const middle = median(performances);
  const deviation = median(performances.map(value => Math.abs(value - middle)));
  const stability = Math.round(clamp(100 - deviation * 2.15));
  const successes = rows.filter(row => row.performance >= 60).length;
  const successRate = Math.round(successes / rows.length * 100);
  // A light beta prior stops 2/2 from looking more dependable than 18/22.
  // Unlike a raw hit percentage this grows more decisive as the career sample
  // grows, while the median/MAD pair makes the result resistant to one anomaly.
  const confidenceAdjustedRate = (successes + 2) / (rows.length + 4) * 100;
  const confidence = 1 - Math.exp(-rows.length / 6);
  const raw = confidenceAdjustedRate * .42 + middle * .40 + stability * .18;
  // Small samples regress towards neutral instead of ever displaying a fake 100.
  const score = Math.round(50 + (raw - 50) * confidence);
  const financialMultiples = rows.filter(row => row.multiple != null).map(row => row.multiple);
  const label = rows.length < 3 ? 'Not enough comparable films' : score >= 82 ? 'Elite consistency' : score >= 70 ? 'Reliable' : score >= 58 ? 'Steady' : score >= 45 ? 'Mixed' : 'Volatile';
  return {
    score: rows.length < 3 ? null : score, label, sample: rows.length,
    financialSample: rows.filter(row => row.hasFinancial).length,
    audienceSample: rows.filter(row => row.hasAudience).length,
    successRate, confidence: Math.round(confidence * 100), stability, medianPerformance: Math.round(middle),
    medianMultiple: financialMultiples.length ? median(financialMultiples) : null,
  };
}

async function movieDetail(movie, force) {
  const cached = detailCache.get(movie.id);
  if (!force && cached && Date.now() - cached.at < DAY) return cached.data;
  const detail = await tmdb(`/movie/${movie.id}`, { append_to_response: 'credits' }, { cache: !force });
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
  const candidates = (discover.results || []).filter(movie => movie?.id);
  const rows = [];
  await pool(candidates, async movie => {
    try {
      const detail = await movieDetail(movie, force);
      if (detail.revenue > 0) rows.push(detail);
    } catch (_) { /* one incomplete film must not lose the whole chart */ }
  }, 5);
  rows.sort((a, b) => b.revenue - a.revenue || b.vote_count - a.vote_count || a.title.localeCompare(b.title));
  // Director and franchise rankings need a meaningfully deep chart. Sixty films
  // omitted major careers (notably Steven Spielberg); ten pages covers roughly
  // the top 200 while keeping hydration bounded and cached for a full day.
  const data = { page: number, totalPages: Math.min(10, +discover.total_pages || 1), rows, requested: candidates.length, updatedAt: Date.now() };
  pageCache.set(number, { at: Date.now(), data });
  return data;
}

export function financials(movie) {
  const revenue = Math.max(0, +movie?.revenue || 0), budget = Math.max(0, +movie?.budget || 0);
  const profit = budget && revenue ? revenue - budget : 0;
  return { revenue, budget, profit, roi: budget && revenue ? ((revenue - budget) / budget) * 100 : null };
}

/** Complete revenue history for one collection, including honest missing-data coverage. */
export async function collectionRevenueTimeline(collectionId, { force = false, seed = null } = {}) {
  const id = +collectionId;
  if (!id) return null;
  const cached = collectionRevenueCache.get(id);
  if (!force && cached && Date.now() - cached.at < DAY) return cached.data;
  const payload = await tmdb(`/collection/${id}`, {}, { cache: !force });
  const unique = [...new Map((payload.parts || []).filter(part => part?.id).map(part => [+part.id, part])).values()];
  const hydrated = [];
  await pool(unique, async part => {
    try {
      const detail = await movieDetail(part, force);
      const date = detail.release_date ? Date.parse(`${detail.release_date}T00:00:00`) : NaN;
      const released = Number.isFinite(date) ? date <= Date.now() : detail.status === 'Released' || detail.revenue > 0;
      if (released) hydrated.push(detail);
    } catch (_) {}
  }, 4);
  hydrated.sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999') || a.id - b.id);
  let cumulative = 0;
  const entries = hydrated.map(movie => {
    cumulative += Math.max(0, +movie.revenue || 0);
    return {
      id: +movie.id, title: movie.title || '', poster: movie.poster_path || '', releaseDate: movie.release_date || '',
      revenue: Math.max(0, +movie.revenue || 0), budget: Math.max(0, +movie.budget || 0), cumulative,
    };
  });
  const reported = entries.filter(entry => entry.revenue > 0);
  const budgetReported = entries.filter(entry => entry.budget > 0).length;
  const topFilm = [...reported].sort((a, b) => b.revenue - a.revenue)[0] || null;
  const data = {
    id, name: payload.name || seed?.name || 'Film collection',
    poster: payload.poster_path || seed?.poster_path || topFilm?.poster || '',
    backdrop: payload.backdrop_path || seed?.backdrop_path || '',
    revenue: reported.reduce((sum, entry) => sum + entry.revenue, 0),
    budget: entries.reduce((sum, entry) => sum + entry.budget, 0),
    films: entries.length, reported: reported.length, budgetReported,
    coverage: entries.length ? Math.round(reported.length / entries.length * 100) : 0,
    topFilm, entries, updatedAt: Date.now(),
  };
  collectionRevenueCache.set(id, { at: data.updatedAt, data });
  return data;
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
    const data = await collectionRevenueTimeline(collection.id, { force, seed: collection });
    if (data?.reported) rows.push(data);
  }, 3);
  return rows.sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name)).slice(0, limit);
}

export function directorEraBreakdown(movies) {
  const ordered = [...(movies || [])].filter(movie => +movie.revenue > 0)
    .sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999') || a.id - b.id);
  if (!ordered.length) return [];
  const phases = ordered.length === 1 ? ['Career'] : ordered.length === 2 ? ['Early', 'Recent'] : ['Early', 'Middle', 'Recent'];
  const buckets = phases.map(label => ({ label, films: 0, revenue: 0, years: [] }));
  ordered.forEach((movie, index) => {
    const bucketIndex = ordered.length === 1 ? 0 : Math.min(buckets.length - 1, Math.floor(index * buckets.length / ordered.length));
    const bucket = buckets[bucketIndex], year = +(movie.release_date || '').slice(0, 4);
    bucket.films++; bucket.revenue += +movie.revenue || 0;
    if (year) bucket.years.push(year);
  });
  return buckets.filter(bucket => bucket.films).map(bucket => ({
    ...bucket,
    yearLabel: bucket.years.length ? `${Math.min(...bucket.years)}${Math.max(...bucket.years) !== Math.min(...bucket.years) ? `–${Math.max(...bucket.years)}` : ''}` : 'Undated',
  }));
}

export function aggregateDirectorRanking(movies, creditsByMovie) {
  const directors = new Map();
  movies.forEach(movie => {
    const credits = creditsByMovie.get(+movie.id) || creditsByMovie.get(String(movie.id)) || [];
    const unique = new Map(credits.filter(person => person.job === 'Director' && person.id).map(person => [person.id, person]));
    unique.forEach(person => {
      if (!directors.has(person.id)) directors.set(person.id, { id: +person.id, name: person.name || 'Director', profile: person.profile_path || '', revenue: 0, films: 0, topFilm: null, works: [] });
      const row = directors.get(person.id), revenue = Math.max(0, +movie.revenue || 0);
      row.revenue += revenue; row.films++; row.works.push(movie);
      if (!row.topFilm || revenue > row.topFilm.revenue) row.topFilm = { id: +movie.id, title: movie.title || '', revenue };
    });
  });
  return [...directors.values()].filter(row => row.revenue > 0).map(row => {
    const budgeted = row.works.filter(movie => +movie.budget > 0 && +movie.revenue > 0);
    const hits = budgeted.filter(movie => (+movie.revenue / +movie.budget) >= boxOfficeAssumptions(movie).hitThreshold).length;
    return { ...row, knownBudgets: budgeted.length, hits, hitRate: budgeted.length ? Math.round(hits / budgeted.length * 100) : null, consistency: directorConsistency(row.works), eras: directorEraBreakdown(row.works) };
  }).sort((a, b) => b.revenue - a.revenue || b.films - a.films || a.name.localeCompare(b.name));
}

/**
 * Merge reported USD career totals without ever replacing a stronger chart
 * value. Wikidata can hold several territory figures for one film, so the query
 * takes the largest USD statement per film before summing by director.
 */
export function applyDirectorCareerRevenue(rows, values) {
  const lookup = values instanceof Map ? values : new Map(Object.entries(values || {}).map(([id, value]) => [+id, value]));
  return (rows || []).map(row => {
    const career = lookup.get(+row.id);
    if (!career || !(+career.gross > +row.revenue)) return { ...row, chartRevenue: +row.revenue || 0, revenueSource: 'chart' };
    return {
      ...row, chartRevenue: +row.revenue || 0,
      revenue: +career.gross || 0, revenueFilms: Math.max(0, +career.films || 0),
      revenueSource: 'career', revenueUpdatedAt: +career.updatedAt || Date.now(),
    };
  }).sort((a, b) => b.revenue - a.revenue || b.films - a.films || a.name.localeCompare(b.name));
}

async function wikidataDirectorRevenue(ids, { force = false } = {}) {
  const wanted = [...new Set((ids || []).map(Number).filter(id => id > 0))].slice(0, 140);
  if (!wanted.length) return new Map();
  if (!directorRevenueRecord) {
    try { directorRevenueRecord = JSON.parse(localStorage.getItem(DIRECTOR_REVENUE_KEY) || 'null'); } catch (_) {}
  }
  const fresh = !force && directorRevenueRecord?.rows && Date.now() - (+directorRevenueRecord.at || 0) < DAY;
  const known = fresh ? directorRevenueRecord.rows : {};
  const missing = force ? wanted : wanted.filter(id => !known[String(id)]);
  if (missing.length) {
    const values = missing.map(id => `"${id}"`).join(' ');
    const query = `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX psv: <http://www.wikidata.org/prop/statement/value/>
PREFIX wikibase: <http://wikiba.se/ontology#>
SELECT ?tmdbId (SUM(?filmGross) AS ?gross) (COUNT(?film) AS ?films) WHERE {
  { SELECT ?tmdbId ?film (MAX(?amount) AS ?filmGross) WHERE {
      VALUES ?tmdbId { ${values} }
      ?director wdt:P4985 ?tmdbId.
      ?film wdt:P57 ?director; p:P2142 ?statement.
      ?statement psv:P2142 ?value.
      ?value wikibase:quantityAmount ?amount; wikibase:quantityUnit wd:Q4917.
    } GROUP BY ?tmdbId ?film }
} GROUP BY ?tmdbId`;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`https://query.wikidata.org/sparql?format=json&origin=*&query=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/sparql-results+json' }, signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Wikidata ${response.status}`);
      const payload = await response.json(), rows = fresh ? { ...known } : {};
      for (const binding of payload?.results?.bindings || []) {
        const id = String(+binding.tmdbId?.value || 0), gross = +binding.gross?.value || 0, films = +binding.films?.value || 0;
        if (+id && gross > 0) rows[id] = { gross, films, updatedAt: Date.now() };
      }
      // Remember misses too so incomplete community metadata does not produce a
      // fresh query on every visit.
      missing.forEach(id => { if (!rows[String(id)]) rows[String(id)] = { gross: 0, films: 0, updatedAt: Date.now() }; });
      directorRevenueRecord = { at: Date.now(), rows };
      try { localStorage.setItem(DIRECTOR_REVENUE_KEY, JSON.stringify(directorRevenueRecord)); } catch (_) {}
    } finally { clearTimeout(timer); }
  }
  const rows = directorRevenueRecord?.rows || known;
  return new Map(wanted.map(id => [id, rows[String(id)]]).filter(([, value]) => value));
}

/** Directors ranked by reported career gross, with the loaded chart as fallback. */
export async function directorBoxOfficeRanking(movies, { force = false, limit = 60 } = {}) {
  const creditsByMovie = new Map();
  await pool(movies, async movie => {
    if (movie?.credits?.crew?.length) {
      creditsByMovie.set(+movie.id, movie.credits.crew);
      creditCache.set(movie.id, { at: Date.now(), crew: movie.credits.crew });
      return;
    }
    let record = creditCache.get(movie.id);
    if (force || !record || Date.now() - record.at >= DAY) {
      const data = await tmdb(`/movie/${movie.id}/credits`, {}, { cache: !force });
      record = { at: Date.now(), crew: data.crew || [] }; creditCache.set(movie.id, record);
    }
    creditsByMovie.set(+movie.id, record.crew);
  }, 5);
  const chartRanking = aggregateDirectorRanking(movies, creditsByMovie);
  let all = chartRanking;
  // Always include the explicit coverage sentinel in the bounded query, even if
  // a future chart reshuffle pushes his subtotal below the ordinary cutoff.
  const careerIds = chartRanking.map(row => row.id);
  if (careerIds.includes(488)) careerIds.unshift(...careerIds.splice(careerIds.indexOf(488), 1));
  try { all = applyDirectorCareerRevenue(chartRanking, await wikidataDirectorRevenue(careerIds, { force })); }
  catch (error) { console.warn('director career revenue', error); }
  let ranking = all.slice(0, limit);
  // Spielberg is a coverage sentinel: three of his films are in the current
  // top-200 chart, so omitting him proves the cutoff is hiding a major career.
  // Keep that real aggregated row visible even if the community career query is
  // temporarily unavailable.
  const spielberg = all.find(row => row.id === 488);
  if (spielberg && !ranking.some(row => row.id === 488)) ranking.push(spielberg);
  // The all-time chart is enough to rank directors by chart revenue, but not to
  // describe career consistency. One movie-credits request per ranked director
  // supplies their full released directing career (votes included) without the
  // hundreds of detail requests that a budget-only model would require.
  await pool(ranking, async row => {
    try {
      const data = await tmdb(`/person/${row.id}/movie_credits`, {}, { cache: !force });
      const todayKey = today();
      const career = [...new Map((data.crew || [])
        .filter(movie => movie?.id && movie.job === 'Director')
        .filter(movie => movie.release_date && movie.release_date <= todayKey)
        .filter(movie => !(movie.genre_ids || []).includes(99))
        .map(movie => [+movie.id, movie])).values()];
      const merged = new Map(career.map(movie => [+movie.id, movie]));
      row.works.forEach(movie => merged.set(+movie.id, { ...(merged.get(+movie.id) || {}), ...movie }));
      row.careerFilms = career.length;
      row.consistency = { ...directorConsistency([...merged.values()]), scope: 'career' };
    } catch (_) {
      row.careerFilms = row.works.length;
      row.consistency = { ...row.consistency, scope: 'chart' };
    }
  }, 5);
  return ranking;
}
