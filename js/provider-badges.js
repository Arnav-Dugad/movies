// Streaming-only provider marks for high-traffic poster cards.
// Desktop resolves them on intent (hover/focus); touch devices resolve near the
// viewport. Results are region-aware and cached locally to keep TMDB use modest.
import { tmdb } from './api.js';
import { IMG } from './config.js';
import { state } from './state.js';
import { esc } from './ui.js';

const CACHE_KEY = 'cv_stream_badges_v1';
const ROOTS = ['#homePage', '#moviesPage', '#tvPage', '#wlPage'];
const ROOT_SELECTOR = ROOTS.join(', ');
const scopedSelector = suffix => ROOTS.map(root => `${root} ${suffix}`).join(', ');
const MAX_CACHE = 450;
const POSITIVE_TTL = 14 * 24 * 60 * 60 * 1000;
const EMPTY_TTL = 3 * 24 * 60 * 60 * 1000;
const pending = new Map();
const queue = [];
let active = 0;
let cache = {};
let observer = null;

try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (_) { cache = {}; }

function cacheKey(card) { return `${state.region}:${card.dataset.type}:${card.dataset.id}`; }
function isEligible(card) {
  if (!card?.matches?.('.card[data-id][data-type]') || !card.closest(ROOT_SELECTOR)) return false;
  if (card.closest('#homePage') && (document.documentElement.dataset.cleanHomePosters === 'on' || document.documentElement.dataset.posterProviderLogo === 'hide')) return false;
  return true;
}

function saveCache() {
  try {
    const entries = Object.entries(cache).sort((a, b) => (b[1]?.ts || 0) - (a[1]?.ts || 0)).slice(0, MAX_CACHE);
    cache = Object.fromEntries(entries);
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (_) {}
}

function paint(card, providers) {
  if (!isEligible(card) || !Array.isArray(providers) || !providers.length) return;
  const frame = card.querySelector('.card-img');
  if (!frame || frame.querySelector('.card-provider-badge')) return;
  const names = providers.map(provider => provider.provider_name).filter(Boolean).join(', ');
  const logos = providers.slice(0, 2).map(provider => provider.logo_path
    ? `<img src="${IMG}w92${provider.logo_path}" alt="" loading="lazy">` : '').join('');
  if (!logos) return;
  frame.insertAdjacentHTML('afterbegin', `<span class="card-provider-badge" title="Stream on ${esc(names)}" aria-label="Stream on ${esc(names)}">${logos}${providers.length > 2 ? `<b>+${providers.length - 2}</b>` : ''}</span>`);
}

async function resolve(card) {
  if (!isEligible(card) || card.dataset.providerResolved === cacheKey(card)) return;
  const key = cacheKey(card);
  card.dataset.providerResolved = key;
  const saved = cache[key];
  const ttl = saved?.providers?.length ? POSITIVE_TTL : EMPTY_TTL;
  if (saved && Date.now() - saved.ts < ttl) { paint(card, saved.providers); return; }

  let promise = pending.get(key);
  if (!promise) {
    promise = new Promise(resolveTask => queue.push({ key, type: card.dataset.type, id: card.dataset.id, region: state.region, resolveTask }));
    pending.set(key, promise);
    drain();
  }
  const providers = await promise;
  if (cacheKey(card) === key && card.dataset.providerResolved === key) paint(card, providers);
}

function drain() {
  while (active < 4 && queue.length) {
    const task = queue.shift();
    active++;
    tmdb(`/${task.type}/${task.id}/watch/providers`).then(data => {
      const providers = (data?.results?.[task.region]?.flatrate || [])
        .filter(provider => provider.logo_path)
        .filter((provider, index, list) => list.findIndex(item => item.provider_id === provider.provider_id) === index)
        .slice(0, 4);
      cache[task.key] = { providers, ts: Date.now() };
      saveCache();
      task.resolveTask(providers);
    }).catch(() => task.resolveTask([])).finally(() => {
      pending.delete(task.key);
      active--;
      drain();
    });
  }
}

function observeCard(card) {
  if (!isEligible(card)) return;
  if (matchMedia('(hover: none), (pointer: coarse)').matches) observer?.observe(card);
}

function scan(node = document) {
  if (isEligible(node)) observeCard(node);
  node.querySelectorAll?.('.card[data-id][data-type]').forEach(observeCard);
}

export function initProviderBadges() {
  observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    observer.unobserve(entry.target);
    resolve(entry.target);
  }), { rootMargin: '260px 0px' });

  document.addEventListener('pointerover', event => {
    if (matchMedia('(hover: none), (pointer: coarse)').matches) return;
    const card = event.target.closest?.('.card[data-id][data-type]');
    if (isEligible(card)) resolve(card);
  }, { passive: true });
  document.addEventListener('focusin', event => {
    const card = event.target.closest?.('.card[data-id][data-type]');
    if (isEligible(card)) resolve(card);
  });

  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(scan)))
    .observe(document.body, { childList: true, subtree: true });
  document.addEventListener('cv:region', () => {
    document.querySelectorAll(scopedSelector('.card-provider-badge')).forEach(badge => badge.remove());
    document.querySelectorAll(scopedSelector('.card[data-id][data-type]')).forEach(card => {
      delete card.dataset.providerResolved;
      observeCard(card);
    });
  });
  document.addEventListener('cv:prefs', () => {
    document.querySelectorAll('#homePage .card-provider-badge').forEach(badge => badge.remove());
    document.querySelectorAll('#homePage .card[data-id][data-type]').forEach(card => {
      delete card.dataset.providerResolved;
      observeCard(card);
    });
  });
  scan();
}
