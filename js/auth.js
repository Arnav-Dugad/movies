// ===== AUTH =====
import { auth, db, firebase } from './firebase.js';
import { state, loadRecentlyViewed } from './state.js';
import { toast, $ } from './ui.js';
import { registerActions } from './events.js';
import { loadWatchlist, loadWatched } from './watchlist.js';
import { loadRatings } from './ratings.js';

let authMode = 'login';

export function initAuth() {
  auth.onAuthStateChanged(async u => {
    state.user = u;
    updateAuthUI();
    if (u) {
      await Promise.all([loadWatchlist(), loadRatings(), loadWatched()]);
      try { state.searchHistory = JSON.parse(localStorage.getItem('cv_history_' + u.uid) || '[]'); } catch (e) { state.searchHistory = []; }
    } else {
      state.watchlist = []; state.ratings = {}; state.watched = {}; state.searchHistory = [];
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
    'sign-out': () => { auth.signOut(); toggleProfile(); toast('Signed out', 'info'); },
  });
}

function updateAuthUI() {
  const u = state.user;
  const i = u ? (u.displayName || u.email || '?')[0].toUpperCase() : '?';
  $('navAv').textContent = i;
  $('ddAv').textContent = i;
  $('ddName').textContent = u ? (u.displayName || 'User') : 'Guest';
  $('ddEmail').textContent = u ? u.email : 'Sign in to continue';
  // When signed in, the top item is hidden and the dedicated ddSignOut item at
  // the bottom handles sign-out — otherwise there'd be two Sign Out buttons.
  const da = $('ddAuth');
  da.style.display = u ? 'none' : 'flex';
  $('ddSignOut').style.display = u ? 'flex' : 'none';
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
