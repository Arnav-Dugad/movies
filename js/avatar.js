// ===== AVATAR HELPERS =====
// A user's avatar is either a preset {emoji, grad} or null (fall back to a colored
// initial). These render into an existing circle element (nav, dropdown, friend row,
// profile header) without changing its size/shape — only its background + content.
import { AVATARS, AVATAR_GRADS } from './config.js';
import { esc } from './ui.js';

const DEFAULT_GRAD = 'linear-gradient(135deg,var(--red),var(--purple))';

function legacyIndex(av) {
  const value = `${av?.emoji || ''}|${av?.grad || ''}`;
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return AVATARS.length ? hash % AVATARS.length : 0;
}

export function avatarPreset(av) {
  if (!av) return null;
  return AVATARS.find(item => item.id === av.id) || (av.emoji ? AVATARS[legacyIndex(av)] : null);
}

export function avatarPresetId(av) { return avatarPreset(av)?.id || ''; }

export function avatarBg(av) {
  const preset = avatarPreset(av);
  return AVATAR_GRADS[preset?.grad || av?.grad] || DEFAULT_GRAD;
}

export function avatarGlyph(av, name) {
  if (avatarPreset(av)) return '';
  return (name || '?').trim()[0]?.toUpperCase() || '?';
}

export function avatarMarkup(av, name) {
  const preset = avatarPreset(av);
  return preset ? `<img src="${preset.src}" alt="" loading="lazy">` : esc(avatarGlyph(av, name));
}

// Paint an avatar into a circle element in place.
export function applyAvatar(el, av, name) {
  if (!el) return;
  el.style.background = avatarBg(av);
  el.classList.toggle('has-avatar-image', !!avatarPreset(av));
  // Drops the neutral silhouette the markup ships with, so the placeholder is
  // only ever visible until the real avatar is known.
  el.classList.remove('avatar-pending');
  el.innerHTML = avatarMarkup(av, name);
}

// Inline markup for avatars built inside an innerHTML blast (friend rows, etc.).
export function avatarInner(av, name, cls = 'friend-av') {
  return `<div class="${cls}${avatarPreset(av) ? ' has-avatar-image' : ''}" style="background:${avatarBg(av)}">${avatarMarkup(av, name)}</div>`;
}
