// ===== PREFERENCES: THEME + CINEMA MODE =====
import { state } from './state.js';
import { toast } from './ui.js';
import { registerActions } from './events.js';

export function setTheme(t) {
  state.currentTheme = t;
  document.documentElement.setAttribute('data-theme', t === 'red' ? '' : t);
  document.querySelectorAll('.theme-dot').forEach(d => d.classList.toggle('active', d.dataset.t === t));
  try { localStorage.setItem('cv_theme', t); } catch (e) {}
}

export function toggleCinema() {
  state.cinemaMode = !state.cinemaMode;
  document.documentElement.setAttribute('data-cinema', state.cinemaMode);
  toast(state.cinemaMode ? 'Cinema mode on' : 'Cinema mode off', 'info');
  try { localStorage.setItem('cv_cinema', state.cinemaMode); } catch (e) {}
}

export function loadPrefs() {
  try {
    const t = localStorage.getItem('cv_theme'); if (t) setTheme(t);
    const c = localStorage.getItem('cv_cinema'); if (c === 'true') { state.cinemaMode = true; document.documentElement.setAttribute('data-cinema', 'true'); }
    const r = localStorage.getItem('cv_region'); if (r) state.region = r;
  } catch (e) {}
}

export function initPrefs() {
  registerActions({
    'set-theme': (el) => setTheme(el.dataset.t),
    'toggle-cinema': () => toggleCinema(),
  });
}
