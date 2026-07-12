// ===== TMDB FETCH =====
import { AK, BASE } from './config.js';

const tmdbCache = new Map();

export async function tmdb(p, params = {}) {
  const key = p + JSON.stringify(params);
  if (tmdbCache.has(key)) {
    const c = tmdbCache.get(key);
    if (Date.now() - c.ts < 3e5) return c.data;
  }
  const u = new URL(`${BASE}${p}`);
  u.searchParams.set('api_key', AK);
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') u.searchParams.set(k, v); });

  let lastErr;
  // One retry on transient failure (network / 429 / 5xx).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(u, { signal: ctrl.signal });
      clearTimeout(to);
      if (!r.ok) {
        if ((r.status === 429 || r.status >= 500) && attempt === 0) { await sleep(600); continue; }
        throw new Error(r.status);
      }
      const data = await r.json();
      tmdbCache.set(key, { data, ts: Date.now() });
      if (tmdbCache.size > 200) {
        const oldest = [...tmdbCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
        for (let i = 0; i < 50; i++) tmdbCache.delete(oldest[i][0]);
      }
      return data;
    } catch (e) {
      lastErr = e;
      if (attempt === 0) { await sleep(500); continue; }
    }
  }
  throw lastErr || new Error('tmdb failed');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
