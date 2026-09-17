// ===== ANIMATED ILLUSTRATIONS =====
// Hand-built SVG scenes for the moments a page has nothing else to show: empty
// lists, the Your Year hero and the monthly recap. Each is a single inline SVG
// animated only with CSS transforms and opacity (css/refinements.css, "Animated
// illustrations"), so it stays on the compositor, scales to any size without
// blurring and costs no requests.
//
// Every scene is decorative by default (aria-hidden); pass `label` when the
// picture carries meaning. Gradient ids are unique per call so two copies of a
// scene on one page never share (and break) each other's paint servers.
// Reduced motion stops every loop and leaves each scene on a composed frame.

let serial = 0;

const SCENES = {
  // A projector throwing a flickering beam, both reels turning, dust in the light.
  projector: id => `
    <defs>
      <linearGradient id="${id}-beam" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fde68a" stop-opacity=".85"/>
        <stop offset=".55" stop-color="#fbbf24" stop-opacity=".22"/>
        <stop offset="1" stop-color="#fbbf24" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="${id}-body" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#3a3a4d"/><stop offset="1" stop-color="#15151f"/>
      </linearGradient>
      <radialGradient id="${id}-lens" cx=".35" cy=".35" r=".7">
        <stop offset="0" stop-color="#fff7d6"/><stop offset=".45" stop-color="#fbbf24"/><stop offset="1" stop-color="#b45309"/>
      </radialGradient>
    </defs>
    <ellipse class="art-shadow" cx="92" cy="160" rx="70" ry="7"/>
    <path class="art-beam" d="M132 92 L236 44 L236 150 Z" fill="url(#${id}-beam)"/>
    <g class="art-motes" fill="#fef3c7">
      <circle class="art-mote m1" cx="170" cy="92" r="1.6"/><circle class="art-mote m2" cx="196" cy="80" r="1.2"/>
      <circle class="art-mote m3" cx="184" cy="114" r="1.4"/><circle class="art-mote m4" cx="214" cy="98" r="1"/>
      <circle class="art-mote m5" cx="158" cy="104" r="1.1"/>
    </g>
    <g class="art-spin slow" style="transform-origin:62px 44px">
      <circle cx="62" cy="44" r="26" fill="url(#${id}-body)" stroke="var(--art-edge)" stroke-width="2"/>
      <circle cx="62" cy="44" r="6" fill="#e50914"/>
      ${[0, 72, 144, 216, 288].map(a => `<circle cx="${(62 + 15 * Math.cos(a * Math.PI / 180)).toFixed(2)}" cy="${(44 + 15 * Math.sin(a * Math.PI / 180)).toFixed(2)}" r="5" fill="#0b0b12"/>`).join('')}
    </g>
    <g class="art-spin" style="transform-origin:112px 50px">
      <circle cx="112" cy="50" r="20" fill="url(#${id}-body)" stroke="var(--art-edge)" stroke-width="2"/>
      <circle cx="112" cy="50" r="5" fill="#7c3aed"/>
      ${[30, 150, 270].map(a => `<circle cx="${(112 + 11 * Math.cos(a * Math.PI / 180)).toFixed(2)}" cy="${(50 + 11 * Math.sin(a * Math.PI / 180)).toFixed(2)}" r="4" fill="#0b0b12"/>`).join('')}
    </g>
    <path d="M62 70 C70 78 100 76 112 70" fill="none" stroke="#2a2a38" stroke-width="3"/>
    <rect x="34" y="72" width="100" height="56" rx="12" fill="url(#${id}-body)" stroke="var(--art-edge)" stroke-width="2"/>
    <rect x="46" y="84" width="40" height="8" rx="4" fill="#e50914" opacity=".85"/>
    <rect x="46" y="98" width="26" height="6" rx="3" fill="var(--art-edge)"/>
    <circle class="art-blink" cx="118" cy="114" r="3.2" fill="#22c55e"/>
    <rect x="126" y="84" width="14" height="22" rx="4" fill="#23232f"/>
    <circle class="art-flicker" cx="140" cy="95" r="9" fill="url(#${id}-lens)"/>
    <path d="M52 128 L42 158 M116 128 L126 158" stroke="#2a2a38" stroke-width="5" stroke-linecap="round"/>`,

  // A clapperboard that snaps shut, with a spark on the clap.
  clapper: id => `
    <defs>
      <linearGradient id="${id}-slate" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2d2d3d"/><stop offset="1" stop-color="#12121a"/>
      </linearGradient>
    </defs>
    <ellipse class="art-shadow" cx="120" cy="162" rx="78" ry="7"/>
    <rect x="52" y="70" width="136" height="84" rx="10" fill="url(#${id}-slate)" stroke="var(--art-edge)" stroke-width="2"/>
    <rect x="52" y="58" width="136" height="16" fill="#0b0b12"/>
    ${[0, 1, 2, 3, 4].map(i => `<path d="M${60 + i * 28} 58 h14 l-10 16 h-14 z" fill="#f5f5f7"/>`).join('')}
    <g class="art-clap" style="transform-origin:54px 56px">
      <rect x="52" y="40" width="136" height="16" rx="3" fill="#0b0b12" stroke="var(--art-edge)" stroke-width="2"/>
      ${[0, 1, 2, 3, 4].map(i => `<path d="M${64 + i * 28} 40 h14 l-10 16 h-14 z" fill="#e50914"/>`).join('')}
    </g>
    <circle cx="56" cy="57" r="4" fill="#9ca3af"/>
    <rect x="66" y="88" width="56" height="6" rx="3" fill="var(--art-edge)"/>
    <rect x="66" y="104" width="92" height="6" rx="3" fill="var(--art-edge)" opacity=".7"/>
    <rect x="66" y="120" width="40" height="18" rx="5" fill="#e50914" opacity=".9"/>
    <rect x="114" y="120" width="40" height="18" rx="5" fill="#7c3aed" opacity=".75"/>
    <g class="art-spark" fill="#fbbf24">
      <path d="M200 30 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z"/>
      <path d="M216 58 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" opacity=".8"/>
      <path d="M186 16 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6z" opacity=".7"/>
    </g>`,

  // A retro television with a wobbling antenna and a rolling, glowing picture.
  tv: id => `
    <defs>
      <linearGradient id="${id}-screen" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#7c3aed"/><stop offset=".55" stop-color="#e50914"/><stop offset="1" stop-color="#0ea5e9"/>
      </linearGradient>
      <linearGradient id="${id}-case" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#3a3a4d"/><stop offset="1" stop-color="#17171f"/>
      </linearGradient>
      <clipPath id="${id}-clip"><rect x="58" y="58" width="96" height="72" rx="14"/></clipPath>
    </defs>
    <ellipse class="art-shadow" cx="120" cy="164" rx="74" ry="7"/>
    <g class="art-antenna" style="transform-origin:120px 44px">
      <path d="M120 44 L94 12 M120 44 L150 8" stroke="#6b7280" stroke-width="3" stroke-linecap="round"/>
      <circle cx="94" cy="12" r="4" fill="#e50914"/><circle cx="150" cy="8" r="4" fill="#0ea5e9"/>
    </g>
    <rect x="40" y="44" width="160" height="104" rx="22" fill="url(#${id}-case)" stroke="var(--art-edge)" stroke-width="2"/>
    <g clip-path="url(#${id}-clip)">
      <rect class="art-hue" x="58" y="58" width="96" height="72" fill="url(#${id}-screen)"/>
      <g class="art-scan" fill="#000" opacity=".22">
        ${Array.from({ length: 16 }, (_, i) => `<rect x="58" y="${50 + i * 6}" width="96" height="2"/>`).join('')}
      </g>
      <path class="art-play" d="M98 80 L122 94 L98 108 Z" fill="#fff"/>
    </g>
    <rect x="58" y="58" width="96" height="72" rx="14" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="2"/>
    <circle cx="176" cy="74" r="8" fill="#23232f" stroke="var(--art-edge)" stroke-width="2"/>
    <path class="art-dial" d="M176 74 L176 67" stroke="#fbbf24" stroke-width="2.4" stroke-linecap="round" style="transform-origin:176px 74px"/>
    <circle cx="176" cy="100" r="5" fill="#23232f" stroke="var(--art-edge)" stroke-width="2"/>
    <rect x="166" y="114" width="20" height="3" rx="1.5" fill="var(--art-edge)"/><rect x="166" y="121" width="20" height="3" rx="1.5" fill="var(--art-edge)"/>
    <path d="M70 148 L60 160 M170 148 L180 160" stroke="#2a2a38" stroke-width="5" stroke-linecap="round"/>`,

  // A striped popcorn bucket with kernels popping out on staggered arcs.
  popcorn: id => `
    <defs>
      <linearGradient id="${id}-cup" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#b91c1c"/><stop offset=".5" stop-color="#ef4444"/><stop offset="1" stop-color="#991b1b"/>
      </linearGradient>
      <radialGradient id="${id}-kernel" cx=".4" cy=".35" r=".7">
        <stop offset="0" stop-color="#fffbeb"/><stop offset=".7" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/>
      </radialGradient>
    </defs>
    <ellipse class="art-shadow" cx="120" cy="164" rx="60" ry="7"/>
    ${[[92, 64, 1], [120, 54, 2], [148, 64, 3], [106, 40, 4], [136, 42, 5]].map(([x, y, n]) => `<g class="art-pop p${n}" style="transform-origin:${x}px ${y}px"><circle cx="${x}" cy="${y}" r="9" fill="url(#${id}-kernel)"/><circle cx="${x - 6}" cy="${y + 3}" r="6" fill="url(#${id}-kernel)"/><circle cx="${x + 6}" cy="${y + 2}" r="6.5" fill="url(#${id}-kernel)"/></g>`).join('')}
    <g class="art-heap">
      ${[[84, 78], [100, 70], [118, 74], [136, 70], [154, 78], [92, 86], [126, 84], [146, 88], [110, 88]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="11" fill="url(#${id}-kernel)"/>`).join('')}
    </g>
    <path d="M72 86 H168 L156 160 H84 Z" fill="url(#${id}-cup)"/>
    ${[0, 1, 2].map(i => `<path d="M${88 + i * 26} 86 H${100 + i * 26} L${98 + i * 24} 160 H${88 + i * 24} Z" fill="#fff" opacity=".92"/>`).join('')}
    <rect x="68" y="82" width="104" height="10" rx="5" fill="#dc2626"/>
    <rect x="104" y="116" width="32" height="16" rx="4" fill="#0b0b12" opacity=".85"/>
    <text x="120" y="128.5" text-anchor="middle" font-size="10" font-weight="800" fill="#fbbf24" font-family="system-ui, sans-serif">POP</text>`,

  // A desk calendar whose page turns over to a starred date.
  calendar: id => `
    <defs>
      <linearGradient id="${id}-head" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#e50914"/><stop offset="1" stop-color="#7c3aed"/>
      </linearGradient>
      <linearGradient id="${id}-page" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2a2a38"/><stop offset="1" stop-color="#15151f"/>
      </linearGradient>
    </defs>
    <ellipse class="art-shadow" cx="120" cy="162" rx="70" ry="7"/>
    <rect x="58" y="40" width="124" height="114" rx="16" fill="url(#${id}-page)" stroke="var(--art-edge)" stroke-width="2"/>
    <rect x="58" y="40" width="124" height="30" rx="16" fill="url(#${id}-head)"/>
    <rect x="58" y="56" width="124" height="14" fill="url(#${id}-head)"/>
    ${Array.from({ length: 12 }, (_, i) => `<rect x="${72 + (i % 4) * 26}" y="${82 + Math.floor(i / 4) * 20}" width="16" height="12" rx="3" fill="var(--art-edge)" opacity="${i === 6 ? 0 : .8}"/>`).join('')}
    <g class="art-star" style="transform-origin:132px 108px"><path d="M132 98 l3.2 6.6 7.2 1 -5.2 5 1.3 7.2 -6.5 -3.4 -6.5 3.4 1.3 -7.2 -5.2 -5 7.2 -1z" fill="#fbbf24"/></g>
    <g class="art-flip" style="transform-origin:120px 70px">
      <rect x="58" y="70" width="124" height="84" rx="12" fill="#1f1f2b" stroke="var(--art-edge)" stroke-width="2"/>
      <text x="120" y="124" text-anchor="middle" font-size="40" font-weight="800" fill="rgba(255,255,255,.85)" font-family="system-ui, sans-serif">1</text>
    </g>
    <rect x="84" y="30" width="8" height="20" rx="4" fill="#9ca3af"/><rect x="148" y="30" width="8" height="20" rx="4" fill="#9ca3af"/>`,

  // Your Year: a film reel and a television held in one orbit, stars circling both.
  year: id => `
    <defs>
      <linearGradient id="${id}-ring" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#e50914"/><stop offset=".5" stop-color="#7c3aed"/><stop offset="1" stop-color="#0ea5e9"/>
      </linearGradient>
      <linearGradient id="${id}-dark" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#3a3a4d"/><stop offset="1" stop-color="#15151f"/>
      </linearGradient>
      <linearGradient id="${id}-screen" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0ea5e9"/><stop offset="1" stop-color="#7c3aed"/>
      </linearGradient>
    </defs>
    <g class="art-orbit-ring"><ellipse cx="120" cy="92" rx="104" ry="40" fill="none" stroke="url(#${id}-ring)" stroke-width="2" stroke-dasharray="4 7" opacity=".7"/></g>
    <g class="art-float a">
      <g class="art-spin" style="transform-origin:72px 88px">
        <circle cx="72" cy="88" r="34" fill="url(#${id}-dark)" stroke="var(--art-edge)" stroke-width="2"/>
        <circle cx="72" cy="88" r="7" fill="#e50914"/>
        ${[0, 60, 120, 180, 240, 300].map(a => `<circle cx="${(72 + 20 * Math.cos(a * Math.PI / 180)).toFixed(2)}" cy="${(88 + 20 * Math.sin(a * Math.PI / 180)).toFixed(2)}" r="6" fill="#0b0b12"/>`).join('')}
      </g>
    </g>
    <g class="art-float b">
      <rect x="128" y="62" width="78" height="58" rx="14" fill="url(#${id}-dark)" stroke="var(--art-edge)" stroke-width="2"/>
      <rect class="art-hue" x="137" y="70" width="60" height="42" rx="8" fill="url(#${id}-screen)"/>
      <path class="art-play" d="M160 82 L176 91 L160 100 Z" fill="#fff" style="transform-origin:167px 91px"/>
      <path d="M150 120 L144 132 M184 120 L190 132" stroke="#2a2a38" stroke-width="4" stroke-linecap="round"/>
    </g>
    <!-- Each orbiter rides the ring as two eased sways a quarter-turn apart, so it stays round. -->
    <g class="art-orbit-x o1"><g class="art-orbit-y o1"><circle cx="120" cy="92" r="4.5" fill="#fbbf24"/></g></g>
    <g class="art-orbit-x o2"><g class="art-orbit-y o2"><circle cx="120" cy="92" r="3.2" fill="#22d3ee"/></g></g>
    <g class="art-twinkle" fill="#fde68a">
      <path class="t1" d="M36 30 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z"/>
      <path class="t2" d="M204 26 l2.4 6 6 2.4 -6 2.4 -2.4 6 -2.4 -6 -6 -2.4 6 -2.4z"/>
      <path class="t3" d="M120 150 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6z"/>
    </g>`,
};

export const ILLUSTRATIONS = Object.keys(SCENES);

/** An animated scene as an inline SVG string. Unknown names fall back to the projector. */
export function illustration(name, { label = '', cls = '' } = {}) {
  const scene = SCENES[name] ? name : 'projector';
  const id = `cvart${++serial}`;
  const a11y = label ? `role="img" aria-label="${String(label).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])}"` : 'aria-hidden="true" focusable="false"';
  return `<svg class="cv-art cv-art-${scene}${cls ? ` ${cls}` : ''}" viewBox="0 0 240 180" ${a11y}>${SCENES[scene](id)}</svg>`;
}
