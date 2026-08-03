// Region-aware streaming-provider catalog shared by Movies, TV and Discover.
// Selecting a provider is always paired with TMDB's `flatrate` monetization type,
// so rentals and purchases never leak into results.
import { tmdb } from './api.js';
import { state } from './state.js';
import { esc } from './ui.js';

const cache = new Map();

export async function providerCatalog(type, region = state.region) {
  const key = `${region}:${type}`;
  if (cache.has(key)) return cache.get(key);
  const request = tmdb(`/watch/providers/${type}`, { watch_region: region }).then(data =>
    (data.results || [])
      .filter(provider => provider.provider_id && provider.logo_path)
      .sort((a, b) => (a.display_priority ?? 999) - (b.display_priority ?? 999) || a.provider_name.localeCompare(b.provider_name))
  ).catch(() => { cache.delete(key); return []; });
  cache.set(key, request);
  return request;
}

export async function fillProviderSelect(select, type, { preserve = true } = {}) {
  if (!select) return;
  const current = preserve ? select.value : '', region = state.region;
  const requestId = String(+(select.dataset.providerLoad || 0) + 1);
  select.dataset.providerLoad = requestId;
  select.disabled = true;
  select.innerHTML = '<option value="">Loading services…</option>';
  const providers = await providerCatalog(type, region);
  if (select.dataset.providerLoad !== requestId || state.region !== region) return;
  select.innerHTML = '<option value="">All streaming services</option>' + providers
    .map(provider => `<option value="${provider.provider_id}">${esc(provider.provider_name)}</option>`).join('');
  if (current && [...select.options].some(option => option.value === current)) select.value = current;
  select.disabled = false;
}

export function applyProviderFilter(params, providerId, region = state.region) {
  if (!providerId) return params;
  params.with_watch_providers = providerId;
  params.watch_region = region;
  params.with_watch_monetization_types = 'flatrate';
  return params;
}
