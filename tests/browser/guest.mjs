// Keep browser tests away from real accounts and Firestore writes.
export async function bootGuest(page) {
  await page.route('https://www.gstatic.com/firebasejs/**', route =>
    route.fulfill({ contentType: 'application/javascript', body: '/* test stub */' }));
  await page.addInitScript(() => {
    window.__cvWrites = [];
    localStorage.setItem('cv_onboarding_guest_v1', JSON.stringify({ done: true, region: 'IN', seedGenres: [] }));
    const snapshot = { exists: false, empty: true, docs: [], data: () => ({}), forEach() {} };
    const ref = {
      collection: () => ref, doc: () => ref, where: () => ref, orderBy: () => ref, limit: () => ref,
      get: async () => snapshot, set: async value => { window.__cvWrites.push(value); }, update: async value => { window.__cvWrites.push(value); }, add: async () => ref, delete: async () => {},
      onSnapshot: callback => { callback(snapshot); return () => {}; },
    };
    const authInstance = { onAuthStateChanged: callback => { queueMicrotask(() => callback(null)); return () => {}; }, signOut: async () => {} };
    const auth = () => authInstance;
    auth.GoogleAuthProvider = class {};
    auth.EmailAuthProvider = { credential: () => ({}) };
    const firestore = () => ({ collection: () => ref, batch: () => ({ set() {}, update() {}, delete() {}, commit: async () => {} }), runTransaction: async worker => worker({ get: ref2 => ref2.get(), set: (ref2, value, options) => ref2.set(value, options), update: (ref2, value) => ref2.update(value), delete: ref2 => ref2.delete() }) });
    firestore.FieldValue = { serverTimestamp: () => Date.now(), increment: value => value, arrayUnion: (...values) => values, arrayRemove: (...values) => values, delete: () => null };
    window.firebase = { initializeApp() {}, auth, firestore };
  });
}
