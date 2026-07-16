// ===== SETTINGS PAGE (/settings) =====
import { state } from './state.js';
import { $, toast } from './ui.js';
import { registerActions } from './events.js';
import { REGIONS } from './config.js';

export function renderSettings() {
  const ct = $('settingsContent');
  if (!ct) return;
  if (!state.user) {
    ct.innerHTML = `<div class="wl-empty" style="padding:40px 20px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:56px;height:56px;color:var(--text3);margin-bottom:14px;opacity:.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg><h3>Sign in to change settings</h3><br><button class="btn-primary" data-action="open-auth">Sign In</button></div>`;
    return;
  }

  const regionOpts = REGIONS.map(([code, label]) => `<option value="${code}" ${code === state.region ? 'selected' : ''}>${label}</option>`).join('');

  ct.innerHTML = `
    <div class="settings-card">
      <div class="settings-row">
        <div class="settings-txt"><div class="settings-name">Where to Watch region</div><div class="settings-sub">Streaming availability shown on movie & show pages.</div></div>
        <select id="settingsRegion" class="watched-select" data-action="settings-region" aria-label="Region">${regionOpts}</select>
      </div>
    </div>

    <div class="d-sec-title" style="margin-top:28px">Data</div>
    <div class="settings-card">
      <div class="settings-row">
        <div class="settings-txt"><div class="settings-name">Clear search history</div><div class="settings-sub">Removes your recent searches on this account.</div></div>
        <button class="btn-glass" data-action="clear-search-history">Clear</button>
      </div>
      <div class="settings-row">
        <div class="settings-txt"><div class="settings-name">Sign out</div><div class="settings-sub">Sign out of CineVerse on this device.</div></div>
        <button class="btn-glass" data-action="sign-out">Sign out</button>
      </div>
    </div>

    <div class="d-sec-title" style="margin-top:28px;color:var(--red2)">Danger zone</div>
    <div class="settings-card danger-card">
      <div class="settings-row">
        <div class="settings-txt"><div class="settings-name">Delete account</div><div class="settings-sub">Permanently deletes your account and all your data. This cannot be undone.</div></div>
        <button class="del-confirm" style="padding:10px 18px" data-action="open-delete">Delete account</button>
      </div>
    </div>`;
}

export function initSettings() {
  registerActions({
    'settings-region': (el) => {
      state.region = el.value;
      try { localStorage.setItem('cv_region', state.region); } catch (e) {}
      toast('Region updated', 'success');
    },
    'clear-search-history': () => {
      state.searchHistory = [];
      if (state.user) { try { localStorage.removeItem('cv_history_' + state.user.uid); } catch (e) {} }
      toast('Search history cleared', 'info');
    },
  });
}
