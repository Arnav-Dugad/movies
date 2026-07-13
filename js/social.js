// ===== SOCIAL LAYER (friends + shared taste) =====
// Only DERIVED, non-sensitive taste data is ever shared cross-user
// (users/{uid}/shared/taste). Raw watchlist/ratings/watched stay owner-only.
// All Firestore queries are single-field or a single array-contains, so NO
// composite indexes are required.
import { db, firebase } from './firebase.js';
import { state } from './state.js';
import { debounce } from './ui.js';
import { buildTasteProfile } from './recommend.js';

export const social = { code: '', friends: [], reqIn: [], reqOut: [], ready: false };

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O/1/I)
export function normCode(s) { return (s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(); }
export function displayCode(code) { return code ? 'CINE-' + code : ''; }
function genCode() { let c = ''; for (let i = 0; i < 6; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]; return c; }
function pairId(a, b) { return [a, b].sort().join('__'); }
const ts = () => firebase.firestore.FieldValue.serverTimestamp();
const emailKey = (email) => (email || '').trim().toLowerCase();

// ----- Bootstrap: ensure a public profile + friend code exist for this user -----
async function ensurePublicProfile(u) {
  const ref = db.collection('publicProfiles').doc(u.uid);
  let snap;
  try { snap = await ref.get(); } catch (e) { console.error('ensurePublicProfile read', e); return; }
  let code = snap.exists ? snap.data().code : '';
  const name = u.displayName || (u.email || '').split('@')[0] || 'CineVerse User';
  if (!code) {
    // Find an unused code (a few attempts; collisions are astronomically rare).
    for (let i = 0; i < 5 && !code; i++) {
      const cand = genCode();
      try { const q = await db.collection('publicProfiles').where('code', '==', cand).limit(1).get(); if (q.empty) code = cand; }
      catch (e) { code = cand; } // if the query fails, just use it
    }
    code = code || genCode();
  }
  social.code = code;
  try {
    await ref.set({ uid: u.uid, name, nameLower: name.toLowerCase(), code, updatedAt: ts() }, { merge: true });
    if (u.email) await db.collection('emailIndex').doc(emailKey(u.email)).set({ uid: u.uid }, { merge: true });
  } catch (e) { console.error('ensurePublicProfile write', e); }
}

// ----- Publish my derived taste profile (friend-readable) -----
export async function publishTaste() {
  if (!state.user) return;
  const p = buildTasteProfile(state);
  const favTitles = (state.watchlist || []).slice(0, 8).map(w => ({ id: w.tmdbId, type: w.type, title: w.title, poster: w.poster || '' }));
  const doc = {
    name: state.user.displayName || (state.user.email || '').split('@')[0] || 'User',
    genreWeights: p.genreWeights, topGenres: p.topGenres, seen: [...p.seen],
    favTitles, movieBias: p.movieBias, updatedAt: ts(),
  };
  try { await db.collection('users').doc(state.user.uid).collection('shared').doc('taste').set(doc); }
  catch (e) { console.error('publishTaste', e); }
}

// ----- Friend graph -----
export async function loadFriends() {
  if (!state.user) { social.friends = []; social.reqIn = []; social.reqOut = []; return; }
  const uid = state.user.uid;
  try {
    const [fs, incoming, outgoing] = await Promise.all([
      db.collection('friendships').where('members', 'array-contains', uid).get(),
      db.collection('friendRequests').where('to', '==', uid).get(),
      db.collection('friendRequests').where('from', '==', uid).get(),
    ]);
    social.friends = fs.docs.map(d => { const x = d.data(); const other = (x.members || []).find(m => m !== uid); return { uid: other, name: (x.names || {})[other] || 'Friend', pairId: d.id }; }).filter(f => f.uid);
    social.reqIn = incoming.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => r.status === 'pending');
    social.reqOut = outgoing.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => r.status === 'pending');
    social.ready = true;
  } catch (e) { console.error('loadFriends', e); }
}

export function isFriend(uid) { return social.friends.some(f => f.uid === uid); }

export async function sendRequest(toUid, toName) {
  if (!state.user) return { ok: false, msg: 'Sign in first' };
  if (toUid === state.user.uid) return { ok: false, msg: "That's your own code" };
  if (isFriend(toUid)) return { ok: false, msg: 'Already friends' };
  if (social.reqOut.some(r => r.to === toUid) || social.reqIn.some(r => r.from === toUid)) return { ok: false, msg: 'Request already pending' };
  try {
    await db.collection('friendRequests').add({
      from: state.user.uid, fromName: state.user.displayName || 'You',
      to: toUid, toName: toName || 'Friend', status: 'pending', createdAt: ts(),
    });
    await loadFriends();
    return { ok: true, msg: 'Request sent!' };
  } catch (e) { console.error('sendRequest', e); return { ok: false, msg: 'Could not send request' }; }
}

export async function acceptRequest(req) {
  if (!state.user) return;
  try {
    await db.collection('friendships').doc(pairId(req.from, req.to)).set({
      members: [req.from, req.to],
      names: { [req.from]: req.fromName || 'Friend', [req.to]: req.toName || 'Friend' },
      since: ts(),
    });
    await db.collection('friendRequests').doc(req.id).set({ status: 'accepted' }, { merge: true });
    await loadFriends();
  } catch (e) { console.error('acceptRequest', e); }
}

export async function declineRequest(req) {
  try { await db.collection('friendRequests').doc(req.id).set({ status: 'declined' }, { merge: true }); await loadFriends(); }
  catch (e) { console.error('declineRequest', e); }
}

// ----- Lookups -----
export async function resolveCode(codeInput) {
  const code = normCode(codeInput);
  if (code.length < 4) return null;
  try { const q = await db.collection('publicProfiles').where('code', '==', code).limit(1).get(); return q.empty ? null : q.docs[0].data(); }
  catch (e) { console.error('resolveCode', e); return null; }
}
export async function resolveEmail(email) {
  const k = emailKey(email);
  if (!k.includes('@')) return null;
  try {
    const idx = await db.collection('emailIndex').doc(k).get();
    if (!idx.exists) return null;
    const p = await db.collection('publicProfiles').doc(idx.data().uid).get();
    return p.exists ? p.data() : null;
  } catch (e) { console.error('resolveEmail', e); return null; }
}
export async function searchByName(q) {
  const s = (q || '').trim().toLowerCase();
  if (s.length < 2) return [];
  try {
    const res = await db.collection('publicProfiles').where('nameLower', '>=', s).where('nameLower', '<', s + '').limit(10).get();
    return res.docs.map(d => d.data()).filter(p => p.uid !== state.user?.uid);
  } catch (e) { console.error('searchByName', e); return []; }
}
export async function getFriendTaste(uid) {
  try { const d = await db.collection('users').doc(uid).collection('shared').doc('taste').get(); return d.exists ? d.data() : null; }
  catch (e) { console.error('getFriendTaste', e); return null; }
}

// ----- Init: bootstrap on auth, republish taste on list changes -----
const republish = debounce(() => publishTaste(), 1500);
export function initSocial() {
  document.addEventListener('cv:auth', async () => {
    if (!state.user) { social.code = ''; social.friends = []; social.reqIn = []; social.reqOut = []; social.ready = false; document.dispatchEvent(new Event('cv:social')); return; }
    await ensurePublicProfile(state.user);
    await Promise.all([publishTaste(), loadFriends()]);
    document.dispatchEvent(new Event('cv:social'));
  });
  document.addEventListener('cv:wl-changed', () => { if (state.user) republish(); });
}
