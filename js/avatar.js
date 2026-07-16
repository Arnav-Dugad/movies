// ===== AVATAR HELPERS =====
// A user's avatar is either a preset {emoji, grad} or null (fall back to a colored
// initial). These render into an existing circle element (nav, dropdown, friend row,
// profile header) without changing its size/shape — only its background + content.
import { AVATAR_GRADS } from './config.js';
import { esc } from './ui.js';

const DEFAULT_GRAD = 'linear-gradient(135deg,var(--red),var(--purple))';

export function avatarBg(av) {
  return (av && AVATAR_GRADS[av.grad]) || DEFAULT_GRAD;
}

export function avatarGlyph(av, name) {
  if (av && av.emoji) return av.emoji;
  return (name || '?').trim()[0]?.toUpperCase() || '?';
}

// Paint an avatar into a circle element in place.
export function applyAvatar(el, av, name) {
  if (!el) return;
  el.style.background = avatarBg(av);
  el.textContent = avatarGlyph(av, name);
}

// Inline markup for avatars built inside an innerHTML blast (friend rows, etc.).
export function avatarInner(av, name, cls = 'friend-av') {
  return `<div class="${cls}" style="background:${avatarBg(av)}">${esc(avatarGlyph(av, name))}</div>`;
}
