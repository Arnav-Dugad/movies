// ===== CENTRAL EVENT DELEGATION =====
// Every interactive element carries data-action="name" (+ optional data-* payload).
// Feature modules register handlers here. This replaces all inline onclick handlers,
// which fixes the class of bugs where titles containing ' or " broke the markup.

const handlers = new Map();

export function registerActions(map) {
  for (const [name, fn] of Object.entries(map)) handlers.set(name, fn);
}

function dispatch(el, e) {
  const action = el.dataset.action;
  const fn = handlers.get(action);
  // Real links keep the browser's native new-tab/window behaviour. A normal
  // primary click is still handled by the SPA router for the smooth transition.
  if (el.tagName === 'A' && el.hasAttribute('href') &&
      (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return false;
  if (fn) { e.preventDefault(); fn(el, e); return true; }
  return false;
}

export function initDelegation() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    // SELECT/INPUT act on 'change' (handled below) — dispatching (and
    // preventDefault-ing) their click would stop native controls like a
    // <select> from opening its dropdown at all.
    if (el && el.tagName !== 'SELECT' && el.tagName !== 'INPUT') dispatch(el, e);
  });

  // Form controls (select/input) dispatch on change, not click.
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-action]');
    if (el && (el.tagName === 'SELECT' || el.tagName === 'INPUT')) dispatch(el, e);
  });

  // Keyboard activation for role="button" / data-action elements (a11y).
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('[data-action]');
    if (!el) return;
    // Let native controls (and real links with href) handle their own keys.
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (tag === 'A' && el.hasAttribute('href')) return;
    // Space should not scroll when activating a custom control.
    if (e.key === ' ') e.preventDefault();
    dispatch(el, e);
  });
}

// Read a JSON payload from data-item safely.
export function readItem(el) {
  try { return JSON.parse(el.dataset.item || '{}'); }
  catch (e) { return {}; }
}
