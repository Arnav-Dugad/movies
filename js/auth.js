// ===== AUTH =====
import { auth, db, firebase } from './firebase.js';
import { state, loadRecentlyViewed } from './state.js';
import { toast, $, trapFocus, lockScroll, unlockScroll } from './ui.js';
import { registerActions } from './events.js';
import { loadWatchlist, loadWatched } from './watchlist.js';
import { loadRatings } from './ratings.js';
import { loadLists } from './lists.js';
import { applyAvatar } from './avatar.js';
import { hydratePrefs } from './prefs.js';
import { REGIONS } from './config.js';
import { hydrateNotificationPrefs, resetNotificationPrefsForAuth } from './notification-prefs.js';
import { hydrateProviderHistory, resetProviderHistoryForAuth } from './provider-history.js';
import { hydrateStatsSections } from './stats.js';
import { loadEpisodeProgress, resetEpisodeProgressForAuth, hydrateEpisodeProgressFromCache } from './episodes.js';
import { hydrateFromCache, writeCache, clearLibraryCache, resetLibraryRuntime, ensureLibraryVersion, initLibraryCache, flushLibraryVersion } from './library-cache.js';
import { hydrateContinuePrefs } from './continue-prefs.js';
import { hydrateFranchisePrefs } from './franchise.js';

let authMode = 'login';
let delRelease = null;

// Read the profile doc (avatar + created) into state so the Profile page and the
// nav/dropdown avatars can render. Non-fatal — falls back to the initial avatar.
// Returns the account's libraryVersion so the caller can decide whether the five
// collection reads are needed at all (see js/library-cache.js).
async function loadProfile() {
  let libraryVersion = 0;
  state.profile = { avatar: null, created: null, headline: '', bio: '', location: '', favoriteFilm: '', favoriteFilmId: null, favoriteFilmPoster: '', pinnedBadges: [], onboarded: false, seedGenres: [] };
  state.recommendationFeedback = { dismissed: [], history: [], rotation: 0, lastRecommendationActivityAt: 0, lastRotatedAt: 0 };
  state.notificationRead = [];
  resetNotificationPrefsForAuth();
  resetProviderHistoryForAuth();
  state.statsSnapshot = null;
  hydrateStatsSections(null);
  resetEpisodeProgressForAuth();
  hydrateContinuePrefs(null);
  hydrateFranchisePrefs(null);
  if (!state.user) return 0;
  let localFeedback = {};
  try { localFeedback = JSON.parse(localStorage.getItem(`cv_rec_feedback_${state.user.uid}`) || '{}'); } catch (_) {}
  const hasFeedback = feedback => Array.isArray(feedback?.dismissed) || Array.isArray(feedback?.history);
  const useFeedback = (feedback = {}) => {
    const dismissed = Array.isArray(feedback.dismissed) ? feedback.dismissed : [];
    const history = Array.isArray(feedback.history) ? feedback.history : [];
    state.recommendationFeedback = {
      dismissed: dismissed.filter(value => typeof value === 'string').slice(0, 150),
      history: history.filter(Boolean).slice(0, 100),
      rotation: Math.max(0, Math.floor(+(feedback.rotation || 0))),
      lastRecommendationActivityAt: Math.max(0, +(feedback.lastRecommendationActivityAt || 0)),
      lastRotatedAt: Math.max(0, +(feedback.lastRotatedAt || 0)),
    };
  };
  // Start with the device backup so recommendation history still works offline;
  // the owner-only Firestore profile replaces it when the cloud read succeeds.
  useFeedback(localFeedback);
  try {
    const d = await db.collection('users').doc(state.user.uid).get();
      if (d.exists) {
        const x = d.data(), feedback = x.recommendationFeedback || {};
        libraryVersion = Math.max(0, Math.floor(+x.libraryVersion || 0));
        hydratePrefs(x.experiencePrefs);
        hydrateNotificationPrefs(x.notificationPreferences);
        const cloudRegion = x.experiencePrefs?.region;
        if (cloudRegion && REGIONS.some(([code]) => code === cloudRegion)) {
          const regionChanged = state.region !== cloudRegion;
          state.region = cloudRegion;
          try { localStorage.setItem('cv_region', cloudRegion); } catch (_) {}
          if (regionChanged) document.dispatchEvent(new Event('cv:region'));
        }
        hydrateProviderHistory(x.providerHistory);
        hydrateStatsSections(x.statsSections);
        hydrateContinuePrefs(x.continueWatching);
        hydrateFranchisePrefs(x.franchisePrefs);
      state.profile = {
        avatar: x.avatar || null, created: x.created || null,
        headline: String(x.headline || '').slice(0, 70), bio: String(x.bio || '').slice(0, 220),
        location: String(x.location || '').slice(0, 60), favoriteFilm: String(x.favoriteFilm || '').slice(0, 80),
        favoriteFilmId: Number.isInteger(+x.favoriteFilmId) && +x.favoriteFilmId > 0 ? +x.favoriteFilmId : null,
        favoriteFilmPoster: /^\/[\w.-]+$/.test(String(x.favoriteFilmPoster || '')) ? String(x.favoriteFilmPoster) : '',
        pinnedBadges: Array.isArray(x.pinnedBadges) ? x.pinnedBadges.filter(value => typeof value === 'string').slice(0, 3) : [],
        // First-run flow: shown once, and only to an account with nothing in it.
        onboarded: !!x.onboarded,
        seedGenres: Array.isArray(x.seedGenres) ? x.seedGenres.map(Number).filter(Number.isFinite).slice(0, 8) : [],
      };
      state.statsSnapshot = x.statsSnapshot || null;
      state.notificationRead = Array.isArray(x.notificationRead) ? x.notificationRead.filter(value => typeof value === 'string').slice(-400) : [];
      const localTime = +(localFeedback.clientUpdatedAt || 0), cloudTime = +(feedback.clientUpdatedAt || 0);
      const localIsNewer = hasFeedback(localFeedback) && localTime > cloudTime;
      useFeedback(localIsNewer || !hasFeedback(feedback) ? localFeedback : feedback);
      if (localIsNewer) {
        // This is the retry path for a prior offline user action. It happens only
        // when the device copy proves newer, so normal profile loads never write.
        db.collection('users').doc(state.user.uid).set({
          recommendationFeedback: { ...localFeedback, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
        }, { merge: true }).catch(error => console.warn('recommendation feedback retry', error));
      }
    }
  } catch (e) { console.error('loadProfile', e); }
  return libraryVersion;
}

export function initAuth() {
  initLibraryCache();
  auth.onAuthStateChanged(async u => {
    state.user = u;
    updateAuthUI();
    if (u) {
      // Paint the library from this device before the network answers, then let
      // the profile read (one document, which we needed anyway) say whether any
      // of it is out of date. Unchanged means five collection reads are skipped.
      const cachedVersion = hydrateFromCache(u.uid);
      const serverVersion = await loadProfile();
      if (cachedVersion > 0 && cachedVersion === serverVersion) {
        // loadProfile resets episode progress for the new session; its own device
        // mirror restores it without touching Firestore.
        hydrateEpisodeProgressFromCache();
      } else {
        await Promise.all([loadWatchlist(), loadRatings(), loadWatched(), loadLists(), loadEpisodeProgress()]);
        writeCache(u.uid, await ensureLibraryVersion(u.uid, serverVersion));
      }
      updateAuthUI();   // re-render now that the avatar has loaded
      try { state.searchHistory = JSON.parse(localStorage.getItem('cv_history_' + u.uid) || '[]'); } catch (e) { state.searchHistory = []; }
    } else {
      resetLibraryRuntime();
      state.watchlist = []; state.ratings = {}; state.watched = {}; state.searchHistory = [];
      state.lists = []; state.profile = { avatar: null, created: null, headline: '', bio: '', location: '', favoriteFilm: '', favoriteFilmId: null, favoriteFilmPoster: '', pinnedBadges: [], onboarded: false, seedGenres: [] };
      state.recommendationFeedback = { dismissed: [], history: [], rotation: 0, lastRecommendationActivityAt: 0, lastRotatedAt: 0 };
      state.notificationRead = [];
      resetNotificationPrefsForAuth();
      resetProviderHistoryForAuth();
      state.statsSnapshot = null;
      hydrateStatsSections(null);
      resetEpisodeProgressForAuth();
    }
    loadRecentlyViewed();
    document.dispatchEvent(new Event('cv:auth'));
  });

  document.addEventListener('cv:open-auth', openAuth);

  // Close profile dropdown on outside click.
  document.addEventListener('click', e => {
    const dd = $('profileDD');
    if (dd && dd.classList.contains('active') && !e.target.closest('#profileDD') && !e.target.closest('#navAv')) dd.classList.remove('active');
  });

  registerActions({
    'open-auth': () => { openAuth(); const dd = $('profileDD'); if (dd) dd.classList.remove('active'); },
    'close-auth': () => closeAuth(),
    'switch-auth': (el) => switchAuth(el.dataset.mode),
    'auth-submit': () => handleAuth(),
    'google-auth': () => handleGoogleAuth(),
    'profile-auth': () => handleProfileAuth(),
    'toggle-profile': () => toggleProfile(),
    'reset-password': (el, e) => resetPassword(e),
    'sign-out': () => { flushLibraryVersion(); clearLibraryCache(state.user?.uid); auth.signOut(); const dd = $('profileDD'); if (dd) dd.classList.remove('active'); toast('Signed out', 'info'); },
    'open-delete': () => openDelete(),
    'close-delete': () => closeDelete(),
    'confirm-delete': () => confirmDelete(),
  });

  const dov = $('delOv');
  if (dov) dov.addEventListener('click', e => { if (e.target === dov) closeDelete(); });
}

export function updateAuthUI() {
  const u = state.user;
  const name = u ? (u.displayName || u.email || '?') : '?';
  const av = u ? state.profile.avatar : null;
  applyAvatar($('navAv'), av, name);
  applyAvatar($('ddAv'), av, name);
  $('ddName').textContent = u ? (u.displayName || 'User') : 'Guest';
  $('ddEmail').textContent = u ? u.email : 'Sign in to continue';
  // When signed in, the top item is hidden and the dedicated ddSignOut item at
  // the bottom handles sign-out — otherwise there'd be two Sign Out buttons.
  const da = $('ddAuth');
  da.style.display = u ? 'none' : 'flex';
  $('ddSignOut').style.display = u ? 'flex' : 'none';
  // Settings entry is only meaningful when signed in. (The profile-head block —
  // ddHead — doubles as the Profile button; it falls back to opening auth when
  // signed out, so it stays visible in both states.)
  ['ddSettings'].forEach(id => { const el = $(id); if (el) el.style.display = u ? 'flex' : 'none'; });
}

// Save name + avatar from the Profile page. Updates Firebase Auth, the profile doc,
// and the public profile (so friends see the new name/avatar), then refreshes the UI.
export async function saveProfile({ name, avatar, headline = '', bio = '', location = '', favoriteFilm = '', favoriteFilmId = null, favoriteFilmPoster = '', pinnedBadges = [] }) {
  const u = state.user;
  if (!u) return { ok: false, msg: 'Sign in first' };
  const nm = (name || '').trim();
  if (!nm) return { ok: false, msg: 'Name cannot be empty' };
  const extras = {
    headline: String(headline || '').trim().slice(0, 70), bio: String(bio || '').trim().slice(0, 220),
    location: String(location || '').trim().slice(0, 60), favoriteFilm: String(favoriteFilm || '').trim().slice(0, 80),
    favoriteFilmId: Number.isInteger(+favoriteFilmId) && +favoriteFilmId > 0 ? +favoriteFilmId : null,
    favoriteFilmPoster: /^\/[\w.-]+$/.test(String(favoriteFilmPoster || '')) ? String(favoriteFilmPoster) : '',
    pinnedBadges: [...new Set(Array.isArray(pinnedBadges) ? pinnedBadges : [])].filter(value => typeof value === 'string').slice(0, 3),
  };
  try {
    if (nm !== u.displayName) await u.updateProfile({ displayName: nm });
    await db.collection('users').doc(u.uid).set({ name: nm, avatar: avatar || null, ...extras }, { merge: true });
    // Mirror to the friend-visible public profile (best-effort).
    db.collection('publicProfiles').doc(u.uid).set({ name: nm, nameLower: nm.toLowerCase(), avatar: avatar || null }, { merge: true }).catch(() => {});
    state.profile = { ...state.profile, avatar: avatar || null, ...extras };
    updateAuthUI();
    document.dispatchEvent(new Event('cv:auth'));   // re-render profile + friends
    return { ok: true, msg: 'Profile saved!' };
  } catch (e) { console.error('saveProfile', e); return { ok: false, msg: 'Could not save — try again' }; }
}

export function openAuth() { $('authOverlay').classList.add('active'); }
export function closeAuth() { $('authOverlay').classList.remove('active'); $('authErr').classList.remove('show'); }
export function isAuthOpen() { return $('authOverlay').classList.contains('active'); }

function switchAuth(m) {
  authMode = m;
  document.querySelectorAll('.auth-tab').forEach((t, i) => t.classList.toggle('active', m === 'login' ? i === 0 : i === 1));
  $('authNameField').style.display = m === 'signup' ? 'block' : 'none';
  $('authBtn').textContent = m === 'login' ? 'Sign In' : 'Create Account';
  $('authForgot').style.display = m === 'login' ? 'block' : 'none';
  $('authErr').classList.remove('show');
}

function showAuthErr(msg) { $('authErrText').textContent = msg; $('authErr').classList.add('show'); }

async function handleAuth() {
  const email = $('authEmail').value.trim(), pass = $('authPass').value, name = $('authName').value.trim(), btn = $('authBtn');
  if (!email || !pass) return showAuthErr('Please fill in all fields');
  btn.disabled = true; btn.textContent = 'Please wait...';
  try {
    if (authMode === 'login') { await auth.signInWithEmailAndPassword(email, pass); }
    else {
      if (!name) { showAuthErr('Please enter your name'); return; }
      const c = await auth.createUserWithEmailAndPassword(email, pass);
      await c.user.updateProfile({ displayName: name });
      await db.collection('users').doc(c.user.uid).set({ name, email, created: firebase.firestore.FieldValue.serverTimestamp() });
    }
    closeAuth();
    toast(authMode === 'login' ? 'Welcome back!' : 'Account created!', 'success');
  } catch (e) {
    const m = { 'auth/email-already-in-use': 'Email already in use', 'auth/wrong-password': 'Incorrect password', 'auth/user-not-found': 'No account found', 'auth/weak-password': 'Password must be 6+ characters', 'auth/invalid-email': 'Invalid email address', 'auth/invalid-credential': 'Invalid email or password' };
    showAuthErr(m[e.code] || e.message);
  } finally {
    btn.disabled = false; btn.textContent = authMode === 'login' ? 'Sign In' : 'Create Account';
  }
}

async function handleGoogleAuth() {
  try {
    const p = new firebase.auth.GoogleAuthProvider();
    const r = await auth.signInWithPopup(p);
    if (r.additionalUserInfo?.isNewUser) await db.collection('users').doc(r.user.uid).set({ name: r.user.displayName, email: r.user.email, created: firebase.firestore.FieldValue.serverTimestamp() });
    closeAuth();
    toast('Signed in with Google!', 'success');
  } catch (e) { if (e.code !== 'auth/popup-closed-by-user') showAuthErr(e.message); }
}

function handleProfileAuth() {
  if (state.user) { auth.signOut(); toggleProfile(); toast('Signed out', 'info'); }
  else { openAuth(); toggleProfile(); }
}

function toggleProfile() { $('profileDD').classList.toggle('active'); }

async function resetPassword(e) {
  if (e) e.preventDefault();
  const email = $('authEmail').value.trim();
  if (!email) return showAuthErr('Enter your email first');
  try { await auth.sendPasswordResetEmail(email); toast('Password reset email sent!', 'success'); }
  catch (e2) { showAuthErr(e2.message); }
}

// ===== DELETE ACCOUNT =====
const providerOf = (u) => (u && u.providerData && u.providerData[0] && u.providerData[0].providerId) || 'password';

export function openDelete() {
  if (!state.user) return;
  const trigger = document.activeElement;
  const isPw = providerOf(state.user) === 'password';
  // For a password account the field is doing double duty: it confirms intent AND
  // satisfies Firebase's recent-login requirement, so we can reauthenticate BEFORE
  // deleting anything rather than discovering the problem half-way through.
  $('delReauth').innerHTML = isPw
    ? `<div class="auth-field" style="margin-bottom:14px;text-align:left"><label for="delPass">Confirm your password</label><input type="password" id="delPass" placeholder="Your password" autocomplete="current-password"></div>`
    : `<p class="del-note">You'll be asked to confirm with Google before anything is deleted.</p>`;
  $('delErr').classList.remove('show');
  const btn = $('delBtn');
  btn.disabled = false;
  btn.textContent = 'Delete account';
  const ov = $('delOv');
  ov.classList.add('active');
  lockScroll();
  delRelease = trapFocus(ov, trigger);
  const f = $('delPass');
  if (f) f.focus();
}

export function closeDelete() {
  const ov = $('delOv');
  // Idempotent — closeAllModals() calls this on every navigation, and an
  // unbalanced unlockScroll() would corrupt the lock's reference count.
  if (!ov || !ov.classList.contains('active')) return;
  ov.classList.remove('active');
  unlockScroll();
  if (delRelease) { delRelease(); delRelease = null; }
}

export function isDeleteOpen() { const ov = $('delOv'); return !!ov && ov.classList.contains('active'); }

function showDelErr(msg) { $('delErrText').textContent = msg; $('delErr').classList.add('show'); }

// Firestore has no client-side recursive delete: subcollections must be listed and
// removed doc by doc. Batched (the server caps a batch at 500).
async function deleteAll(refs) {
  for (let i = 0; i < refs.length; i += 450) {
    const batch = db.batch();
    refs.slice(i, i + 450).forEach(r => batch.delete(r));
    await batch.commit();
  }
}

async function deleteSub(uid, name) {
  const snap = await db.collection('users').doc(uid).collection(name).get();
  await deleteAll(snap.docs.map(d => d.ref));
}

// Every place this account leaves data. allSettled per group so one failure (e.g. a
// shared friendship doc the rules won't let us touch) can't strand the rest.
async function purgeUserData(uid, email) {
  const jobs = [
    deleteSub(uid, 'watchlist'),
    deleteSub(uid, 'watched'),
    deleteSub(uid, 'ratings'),
    deleteSub(uid, 'lists'),
    deleteSub(uid, 'shared'),
    db.collection('publicProfiles').doc(uid).delete(),
    (async () => {
      const snap = await db.collection('friendships').where('members', 'array-contains', uid).get();
      await deleteAll(snap.docs.map(d => d.ref));
    })(),
    (async () => {
      const [to, from] = await Promise.all([
        db.collection('friendRequests').where('to', '==', uid).get(),
        db.collection('friendRequests').where('from', '==', uid).get(),
      ]);
      await deleteAll([...to.docs, ...from.docs].map(d => d.ref));
    })(),
  ];
  if (email) jobs.push(db.collection('emailIndex').doc(email.trim().toLowerCase()).delete());
  const results = await Promise.allSettled(jobs);
  // The profile doc goes last — it's the anchor the rest hangs off.
  await db.collection('users').doc(uid).delete().catch(() => {});
  return results.filter(r => r.status === 'rejected').length;
}

function purgeLocal(uid) {
  ['cv_history_', 'cv_recent_', 'cv_badges_', 'cv_notification_read_', 'cv_notification_prefs_'].forEach(k => { try { localStorage.removeItem(k + uid); } catch (_) {} });
  try { Object.keys(localStorage).filter(key => key.startsWith(`cv_notification_cache_v2_${uid}_`) || key.startsWith(`cv_provider_history_${uid}_`)).forEach(key => localStorage.removeItem(key)); } catch (_) {}
}

async function confirmDelete() {
  const u = state.user;
  if (!u) return closeDelete();
  const btn = $('delBtn');
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  $('delErr').classList.remove('show');

  const uid = u.uid, email = u.email;
  try {
    // 1. Reauthenticate FIRST. Firebase rejects delete() on a stale session, and
    //    discovering that after the data is gone would leave an empty account.
    if (providerOf(u) === 'password') {
      const pass = ($('delPass') || {}).value || '';
      if (!pass) throw { code: 'cv/no-password' };
      await u.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(email, pass));
    } else {
      await u.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
    }

    // 2. Data while we're still authorised to write, 3. then the account itself.
    const failed = await purgeUserData(uid, email);
    purgeLocal(uid);
    await u.delete();

    closeDelete();
    toast(failed ? 'Account deleted (some shared data may remain)' : 'Your account has been deleted', failed ? 'info' : 'success');
    document.dispatchEvent(new CustomEvent('cv:go', { detail: '/' }));
  } catch (e) {
    const m = {
      'cv/no-password': 'Please enter your password to confirm',
      'auth/wrong-password': 'Incorrect password',
      'auth/invalid-credential': 'Incorrect password',
      'auth/too-many-requests': 'Too many attempts — try again later',
      'auth/popup-closed-by-user': 'Confirmation cancelled — nothing was deleted',
      'auth/user-mismatch': 'That account does not match the one signed in',
      'auth/requires-recent-login': 'Please sign out and back in, then try again',
    };
    showDelErr(m[e.code] || e.message || 'Could not delete account');
    btn.disabled = false;
    btn.textContent = 'Delete account';
  }
}
