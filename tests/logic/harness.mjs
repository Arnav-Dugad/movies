// Minimal browser shim so the pure-logic modules can be exercised in Node.
const store = new Map();
const noopEl = () => ({
  className: '', innerHTML: '', textContent: '', dataset: {}, style: {}, hidden: false,
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, appendChild() {}, addEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], focus() {}, clientWidth: 700,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 700, height: 200 }), contains: () => false,
});

globalThis.window = { firebase: null, matchMedia: () => ({ matches: false }), isSecureContext: true };
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
globalThis.document = {
  documentElement: { lang: 'en', dataset: {} },
  getElementById: () => null,
  addEventListener() {}, dispatchEvent() { return true; },
  querySelector: () => null, querySelectorAll: () => [],
  visibilityState: 'visible', hasFocus: () => true, activeElement: null, body: noopEl(),
  createElement: tag => {
    if (tag === 'div' || tag === 'textarea') {
      const node = { _t: '' };
      Object.defineProperty(node, 'textContent', { get() { return node._t; }, set(v) { node._t = v == null ? '' : String(v); } });
      Object.defineProperty(node, 'innerHTML', {
        get() { return node._t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
        set(v) { node._t = String(v); },
      });
      Object.defineProperty(node, 'value', { get() { return node._t; } });
      return node;
    }
    return noopEl();
  },
};
globalThis.Event = class { constructor(type) { this.type = type; } };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US', mediaDevices: undefined, vibrate() {} }, configurable: true, writable: true });
globalThis.location = { pathname: '/watchlist', href: 'https://x.test/watchlist', origin: 'https://x.test', search: '' };

const docStub = () => ({ set: async () => {}, get: async () => ({ exists: false }), delete: async () => {} });
const firestoreStub = { collection: () => ({ doc: () => ({ ...docStub(), collection: () => ({ doc: docStub, get: async () => ({ empty: true, docs: [] }) }) }) }), batch: () => ({ set() {}, delete() {}, commit: async () => {} }) };
globalThis.window.firebase = {
  initializeApp() {},
  auth: () => ({ onAuthStateChanged() {} }),
  firestore: Object.assign(() => firestoreStub, { FieldValue: { serverTimestamp: () => 'TS', delete: () => 'DELETE' } }),
};

const green = s => `\x1b[32m${s}\x1b[0m`, red = s => `\x1b[31m${s}\x1b[0m`;
let pass = 0, fail = 0;
export function check(name, condition, extra = '') {
  if (condition) { pass++; console.log(`${green('PASS')} ${name}`); }
  else { fail++; console.log(`${red('FAIL')} ${name} ${extra}`); }
}
export function summary() {
  console.log(`\n${fail ? red(`${fail} failing`) : green('all green')} · ${pass} passed`);
  if (fail) process.exitCode = 1;
}
