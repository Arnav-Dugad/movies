// ===== PREFERENCES (region only) =====
import { state } from './state.js';
import { REGIONS } from './config.js';

export function loadPrefs() {
  try {
    // Restore the persisted "Where to Watch" region, but only if it's still a
    // supported region (older builds allowed regions no longer offered).
    const r = localStorage.getItem('cv_region');
    if (r && REGIONS.some(([code]) => code === r)) state.region = r;
    // One-time cleanup of preferences from removed features (accent themes,
    // cinema mode) so no stale state lingers.
    localStorage.removeItem('cv_theme');
    localStorage.removeItem('cv_cinema');
  } catch (e) {}
}
