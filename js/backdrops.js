// ===== MOVING BACKDROPS =====
// The light behind the site, in six styles: the classic Aurora, folding Silk,
// a breathing Mesh, a drifting Nebula, sweeping projector Beams, and Still for
// a room that holds its breath.
//
// All six are drawn from the same four layers inside `.aurora` and animated
// entirely in CSS (css/backdrops.css), so switching between them costs one
// attribute and no JavaScript runs per frame. The pointer and scroll drift
// (js/stage.js) still moves whichever style is on.
import { prefs } from './prefs.js';

export const BACKDROPS = [
  ['aurora', 'Aurora', 'Two soft blooms, the CineVerse classic'],
  ['silk', 'Silk', 'Wide bands of colour folding over each other'],
  ['mesh', 'Mesh', 'Four lights breathing against each other'],
  ['nebula', 'Nebula', 'A deep cloud drifting behind a field of stars'],
  ['beams', 'Beams', 'Projector light sweeping a dark room'],
  ['still', 'Still', 'The same light, holding its breath'],
];

export const DEFAULT_BACKDROP = 'aurora';
const NAMES = new Set(BACKDROPS.map(([key]) => key));

/** Pure: a stored value cleaned to a style this build knows. */
export const backdropName = value => (NAMES.has(String(value)) ? String(value) : DEFAULT_BACKDROP);

/** Pure: how many layers a style draws (the rest stay empty). */
export const LAYERS = 4;

/** Put the layers in place, once. */
export function mountLayers(host = document.querySelector('.aurora')) {
  if (!host || host.querySelector('.bd-layer')) return host;
  for (let i = 0; i < LAYERS; i++) {
    const layer = document.createElement('i');
    layer.className = 'bd-layer';
    layer.setAttribute('aria-hidden', 'true');
    host.appendChild(layer);
  }
  return host;
}

/** The small live swatch used by the Settings picker. */
export function previewHTML(style) {
  const layers = Array.from({ length: LAYERS }, () => '<i class="bd-layer"></i>').join('');
  return `<span class="bd-preview" data-style="${backdropName(style)}">${layers}</span>`;
}

export function applyBackdrop(value = prefs.backdrop) {
  document.documentElement.dataset.backdrop = backdropName(value);
}

export function initBackdrops() {
  mountLayers();
  applyBackdrop();
  document.addEventListener('cv:prefs', () => applyBackdrop());
}
