// ===== FIREBASE INIT =====
// Uses the Firebase compat SDK loaded via <script> in index.html (global `firebase`).
import { firebaseConfig } from './config.js';

// Bind the global compat namespace to a module-local so it can be re-exported.
const firebase = window.firebase;

firebase.initializeApp(firebaseConfig);

export const auth = firebase.auth();
export const db = firebase.firestore();
export { firebase };
