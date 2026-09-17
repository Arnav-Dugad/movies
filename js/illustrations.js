// ===== ANIMATED ILLUSTRATIONS =====
// Hand-built SVG scenes for the moments a page has nothing else to show: sign-in
// prompts, empty lists, searches with no matches, failed loads, the Your Year
// hero and the monthly recap. Each is a single inline SVG animated with CSS
// (css/refinements.css, "Animated illustrations"): transforms and opacity, plus
// a few dashed strokes that march or draw. It scales to any size without
// blurring and costs no requests.
//
// Every scene is decorative by default (aria-hidden); pass `label` when the
// picture carries meaning. Gradient ids are unique per call so two copies of a
// scene on one page never share (and break) each other's paint servers.
// Reduced motion stops every loop and leaves each scene on a composed frame.

let serial = 0;

/** Pure: a toothed gear outline centred at (cx, cy), for the gears scene. */
export function gearPath(cx, cy, outer, inner, teeth) {
  const step = Math.PI * 2 / teeth;
  const points = [];
  for (let tooth = 0; tooth < teeth; tooth++) {
    const at = tooth * step;
    for (const [radius, angle] of [[inner, at], [outer, at + step * 0.12], [outer, at + step * 0.42], [inner, at + step * 0.54]]) {
      points.push(`${(cx + radius * Math.cos(angle)).toFixed(1)} ${(cy + radius * Math.sin(angle)).toFixed(1)}`);
    }
  }
  return `M${points.join(' L')} Z`;
}

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
  // An admission ticket floating on a tilt, a light sweeping across it. It is
  // drawn twice, clipped either side of a ragged line down its perforation, so a
  // tap on Sign in can tear the stub away (initIllustrations, .torn).
  ticket: id => {
    const shape = 'M62 50 H178 a12 12 0 0 1 12 12 V78 a12 12 0 0 0 0 24 V118 a12 12 0 0 1 -12 12 H62 a12 12 0 0 1 -12 -12 V102 a12 12 0 0 0 0 -24 V62 a12 12 0 0 1 12 -12 Z';
    const tear = 'L150 40 L147 48 L153 56 L147 64 L153 72 L147 80 L153 88 L147 96 L153 104 L147 112 L153 120 L147 128 L150 140';
    const face = `
          <path d="${shape}" fill="url(#${id}-paper)"/>
          <rect x="58" y="58" width="124" height="64" rx="8" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="1.5" stroke-dasharray="2 4"/>
          <path d="M150 56 V124" stroke="rgba(255,255,255,.55)" stroke-width="2" stroke-dasharray="3 5"/>
          <text x="102" y="87" text-anchor="middle" font-size="15" font-weight="800" letter-spacing="3" fill="#fff" font-family="system-ui, sans-serif">ADMIT</text>
          <text x="102" y="106" text-anchor="middle" font-size="15" font-weight="800" letter-spacing="3" fill="#fff" font-family="system-ui, sans-serif">ONE</text>
          <path class="art-star-spin" d="M170 80 l2.6 5.4 5.9 .9 -4.3 4.1 1 5.9 -5.2 -2.8 -5.2 2.8 1 -5.9 -4.3 -4.1 5.9 -.9z" fill="#fde68a" style="transform-origin:170px 89px"/>
          <g clip-path="url(#${id}-clip)"><g class="art-shine"><rect x="-10" y="30" width="46" height="120" fill="url(#${id}-shine)" transform="skewX(-18)"/></g></g>`;
    return `
    <defs>
      <linearGradient id="${id}-paper" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ff3b47"/><stop offset=".55" stop-color="#c8102e"/><stop offset="1" stop-color="#6d28d9"/>
      </linearGradient>
      <linearGradient id="${id}-shine" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <clipPath id="${id}-clip"><path d="${shape}"/></clipPath>
      <clipPath id="${id}-main"><path d="M0 0 H150 ${tear} V180 H0 Z"/></clipPath>
      <clipPath id="${id}-stub"><path d="M240 0 H150 ${tear} V180 H240 Z"/></clipPath>
    </defs>
    <ellipse class="art-shadow" cx="120" cy="160" rx="66" ry="7"/>
    <g class="art-float a">
      <g transform="rotate(-8 120 90)">
        <g class="art-tear-main" clip-path="url(#${id}-main)">${face}</g>
        <g class="art-tear-stub" clip-path="url(#${id}-stub)">${face}</g>
        <g class="art-tear-bits" fill="#fecaca">
          <path class="bit1" d="M149 70 l4 2 -3 3 z"/><path class="bit2" d="M151 92 l-4 3 4 2 z"/><path class="bit3" d="M148 112 l5 1 -2 4 z"/>
        </g>
      </g>
    </g>
    <g class="art-twinkle" fill="#fde68a">
      <path class="t1" d="M40 40 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z"/>
      <path class="t2" d="M206 34 l2.4 6 6 2.4 -6 2.4 -2.4 6 -2.4 -6 -6 -2.4 6 -2.4z"/>
      <path class="t3" d="M212 140 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6z"/>
    </g>`;
  },

  // A magnifying glass sweeping along a strip of film, a question drifting above.
  search: id => `
    <defs>
      <linearGradient id="${id}-rim" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#e5e7eb"/><stop offset=".5" stop-color="#9ca3af"/><stop offset="1" stop-color="#4b5563"/>
      </linearGradient>
      <radialGradient id="${id}-lens" cx=".35" cy=".3" r=".75">
        <stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".6" stop-color="#7dd3fc" stop-opacity=".12"/><stop offset="1" stop-color="#0ea5e9" stop-opacity=".2"/>
      </radialGradient>
      <linearGradient id="${id}-frame" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#e50914"/>
      </linearGradient>
    </defs>
    <ellipse class="art-shadow" cx="120" cy="166" rx="84" ry="6"/>
    <g class="art-drift">
      <rect x="10" y="104" width="220" height="44" rx="6" fill="#15151f" stroke="var(--art-edge)" stroke-width="2"/>
      ${Array.from({ length: 11 }, (_, i) => `<rect x="${16 + i * 20}" y="108" width="9" height="5" rx="1.5" fill="#2e2e3d"/><rect x="${16 + i * 20}" y="139" width="9" height="5" rx="1.5" fill="#2e2e3d"/>`).join('')}
      ${[0, 1, 2, 3, 4].map(i => `<rect x="${18 + i * 42}" y="116" width="36" height="20" rx="3" fill="url(#${id}-frame)" opacity="${0.35 + i * 0.12}"/>`).join('')}
    </g>
    <g class="art-sweep">
      <path d="M118 96 L146 124" stroke="#374151" stroke-width="12" stroke-linecap="round"/>
      <path d="M121 99 L143 121" stroke="#6b7280" stroke-width="5" stroke-linecap="round"/>
      <circle cx="96" cy="74" r="30" fill="url(#${id}-lens)" stroke="url(#${id}-rim)" stroke-width="8"/>
      <path d="M80 62 a20 20 0 0 1 16 -8" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3" stroke-linecap="round"/>
    </g>
    <text class="art-question" x="176" y="58" text-anchor="middle" font-size="34" font-weight="800" fill="#fbbf24" font-family="system-ui, sans-serif">?</text>`,

  // Two friends side by side, a heart pulsing on the line that joins them.
  friends: id => `
    <defs>
      <linearGradient id="${id}-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f43f5e"/><stop offset="1" stop-color="#be123c"/></linearGradient>
      <linearGradient id="${id}-b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#6d28d9"/></linearGradient>
      <linearGradient id="${id}-link" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f43f5e"/><stop offset="1" stop-color="#38bdf8"/></linearGradient>
    </defs>
    <ellipse class="art-shadow" cx="120" cy="164" rx="86" ry="7"/>
    <path class="art-link" d="M76 92 C 100 60, 140 60, 164 92" fill="none" stroke="url(#${id}-link)" stroke-width="3" stroke-linecap="round" stroke-dasharray="6 8"/>
    <g class="art-float a">
      <circle cx="68" cy="84" r="20" fill="url(#${id}-a)"/>
      <path d="M36 150 a32 32 0 0 1 64 0 z" fill="url(#${id}-a)" opacity=".9"/>
      <circle cx="61" cy="82" r="2.4" fill="#fff"/><circle cx="75" cy="82" r="2.4" fill="#fff"/>
      <path d="M61 91 q7 6 14 0" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
    </g>
    <g class="art-float b">
      <circle cx="172" cy="84" r="20" fill="url(#${id}-b)"/>
      <path d="M140 150 a32 32 0 0 1 64 0 z" fill="url(#${id}-b)" opacity=".9"/>
      <circle cx="165" cy="82" r="2.4" fill="#fff"/><circle cx="179" cy="82" r="2.4" fill="#fff"/>
      <path d="M165 91 q7 6 14 0" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
    </g>
    <g class="art-heart" style="transform-origin:120px 62px">
      <path d="M120 74 C 104 62, 106 46, 116 46 C 119 46, 120 49, 120 49 C 120 49, 121 46, 124 46 C 134 46, 136 62, 120 74 Z" fill="#fb7185"/>
      <path d="M113 52 q2 -2 5 -1" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2" stroke-linecap="round"/>
    </g>
    <g class="art-twinkle" fill="#fde68a">
      <path class="t1" d="M30 40 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z"/>
      <path class="t2" d="M210 38 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z"/>
    </g>`,

  // A sofa facing a glowing screen, confetti drifting down.
  party: id => `
    <defs>
      <linearGradient id="${id}-screen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0ea5e9"/><stop offset=".5" stop-color="#7c3aed"/><stop offset="1" stop-color="#e50914"/></linearGradient>
      <linearGradient id="${id}-sofa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#be123c"/><stop offset="1" stop-color="#7f1d1d"/></linearGradient>
      <radialGradient id="${id}-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#a78bfa" stop-opacity=".5"/><stop offset="1" stop-color="#a78bfa" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="art-glow" cx="120" cy="58" rx="100" ry="50" fill="url(#${id}-glow)"/>
    <rect x="62" y="20" width="116" height="70" rx="10" fill="#0b0b12" stroke="var(--art-edge)" stroke-width="2"/>
    <rect class="art-hue" x="70" y="28" width="100" height="54" rx="6" fill="url(#${id}-screen)"/>
    <path class="art-play" d="M112 44 L132 55 L112 66 Z" fill="#fff" style="transform-origin:120px 55px"/>
    <ellipse class="art-shadow" cx="120" cy="166" rx="92" ry="6"/>
    <path d="M40 128 q0 -18 18 -18 h124 q18 0 18 18 v22 h-160 z" fill="url(#${id}-sofa)"/>
    <rect x="30" y="118" width="22" height="38" rx="10" fill="#9f1239"/><rect x="188" y="118" width="22" height="38" rx="10" fill="#9f1239"/>
    <path d="M58 128 h124" stroke="rgba(0,0,0,.25)" stroke-width="2"/><path d="M120 112 v36" stroke="rgba(0,0,0,.2)" stroke-width="2"/>
    <g>
      ${[[34, '#fbbf24', 0], [64, '#22d3ee', 1], [96, '#f43f5e', 2], [150, '#a78bfa', 3], [184, '#34d399', 4], [212, '#fbbf24', 5]].map(([x, fill, n]) => `<rect class="art-confetti c${n}" x="${x}" y="-8" width="6" height="10" rx="1.5" fill="${fill}" style="transform-origin:${x + 3}px -3px"/>`).join('')}
    </g>`,

  // A chart card whose bars grow and whose trend line draws itself.
  stats: id => `
    <defs>
      <linearGradient id="${id}-card" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#23232f"/><stop offset="1" stop-color="#121219"/></linearGradient>
      <linearGradient id="${id}-bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#0e7490"/></linearGradient>
      <linearGradient id="${id}-hot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbbf24"/><stop offset="1" stop-color="#e50914"/></linearGradient>
    </defs>
    <ellipse class="art-shadow" cx="120" cy="164" rx="80" ry="7"/>
    <rect x="40" y="26" width="160" height="126" rx="16" fill="url(#${id}-card)" stroke="var(--art-edge)" stroke-width="2"/>
    <rect x="54" y="40" width="46" height="7" rx="3.5" fill="var(--art-edge)"/><rect x="54" y="52" width="28" height="5" rx="2.5" fill="var(--art-edge)" opacity=".7"/>
    <path d="M54 136 H186" stroke="var(--art-edge)" stroke-width="2"/>
    ${[[60, 44, 0], [84, 30, 1], [108, 56, 2], [132, 40, 3], [156, 70, 4]].map(([x, h, n]) => `<rect class="art-bar b${n}" x="${x}" y="${134 - h}" width="16" height="${h}" rx="4" fill="url(#${id}-${n === 4 ? 'hot' : 'bar'})" style="transform-origin:${x + 8}px 134px"/>`).join('')}
    <path class="art-line" d="M68 96 L92 108 L116 80 L140 94 L164 60" fill="none" stroke="#fde68a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" pathLength="100" stroke-dasharray="100"/>
    <circle class="art-ping" cx="164" cy="60" r="5" fill="#fbbf24" style="transform-origin:164px 60px"/>
    <g class="art-twinkle" fill="#fde68a"><path class="t1" d="M204 22 l2.4 6 6 2.4 -6 2.4 -2.4 6 -2.4 -6 -6 -2.4 6 -2.4z"/></g>`,

  // A bell swinging on its hook, rings of sound going out from it.
  bell: id => `
    <defs>
      <linearGradient id="${id}-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset=".5" stop-color="#f59e0b"/><stop offset="1" stop-color="#b45309"/></linearGradient>
    </defs>
    <ellipse class="art-shadow" cx="120" cy="164" rx="56" ry="7"/>
    <g fill="none" stroke="#fbbf24" stroke-width="3" stroke-linecap="round">
      <path class="art-wave w1" d="M62 64 a70 70 0 0 0 0 60" style="transform-origin:120px 94px"/>
      <path class="art-wave w2" d="M44 54 a90 90 0 0 0 0 80" style="transform-origin:120px 94px"/>
      <path class="art-wave w1" d="M178 64 a70 70 0 0 1 0 60" style="transform-origin:120px 94px"/>
      <path class="art-wave w2" d="M196 54 a90 90 0 0 1 0 80" style="transform-origin:120px 94px"/>
    </g>
    <g class="art-swing" style="transform-origin:120px 30px">
      <circle cx="120" cy="30" r="6" fill="none" stroke="#9ca3af" stroke-width="3"/>
      <g class="art-clapper" style="transform-origin:120px 120px"><circle cx="120" cy="136" r="9" fill="#b45309"/></g>
      <path d="M120 36 C 92 36, 84 62, 84 92 L 76 124 H 164 L 156 92 C 156 62, 148 36, 120 36 Z" fill="url(#${id}-gold)"/>
      <rect x="70" y="120" width="100" height="10" rx="5" fill="#d97706"/>
      <path d="M98 60 C 96 72, 96 84, 96 96" stroke="#fff" stroke-opacity=".55" stroke-width="4" stroke-linecap="round" fill="none"/>
    </g>
    <circle class="art-ping" cx="160" cy="46" r="10" fill="#e50914" style="transform-origin:160px 46px"/>
    <text x="160" y="50.5" text-anchor="middle" font-size="12" font-weight="800" fill="#fff" font-family="system-ui, sans-serif">1</text>`,

  // A trophy catching a travelling glint, stars circling it.
  trophy: id => `
    <defs>
      <linearGradient id="${id}-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fef3c7"/><stop offset=".35" stop-color="#fbbf24"/><stop offset="1" stop-color="#b45309"/></linearGradient>
      <linearGradient id="${id}-shine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <clipPath id="${id}-cup"><path d="M84 30 H156 V62 C156 90, 138 106, 120 106 C102 106, 84 90, 84 62 Z"/></clipPath>
    </defs>
    <ellipse class="art-shadow" cx="120" cy="164" rx="60" ry="7"/>
    <path d="M84 40 H62 C58 72, 72 84, 90 86 M156 40 H178 C182 72, 168 84, 150 86" fill="none" stroke="url(#${id}-gold)" stroke-width="8" stroke-linecap="round"/>
    <path d="M84 30 H156 V62 C156 90, 138 106, 120 106 C102 106, 84 90, 84 62 Z" fill="url(#${id}-gold)"/>
    <g clip-path="url(#${id}-cup)"><g class="art-shine"><rect x="40" y="20" width="30" height="100" fill="url(#${id}-shine)" transform="skewX(-20)"/></g></g>
    <rect x="112" y="104" width="16" height="22" fill="#d97706"/>
    <rect x="88" y="124" width="64" height="14" rx="4" fill="#92400e"/><rect x="80" y="136" width="80" height="16" rx="5" fill="#451a03"/>
    <path class="art-star-spin" d="M120 50 l4.4 9 9.9 1.4 -7.2 7 1.7 9.8 -8.8 -4.6 -8.8 4.6 1.7 -9.8 -7.2 -7 9.9 -1.4z" fill="#fff7d6" style="transform-origin:120px 64px"/>
    <g class="art-orbit-x o1"><g class="art-orbit-y o1"><path d="M120 86 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#fde68a"/></g></g>
    <g class="art-orbit-x o2"><g class="art-orbit-y o2"><circle cx="120" cy="92" r="3" fill="#fb7185"/></g></g>`,

  // A compass whose needle hunts for north over a dotted route.
  compass: id => `
    <defs>
      <radialGradient id="${id}-face" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#2f2f40"/><stop offset="1" stop-color="#101018"/></radialGradient>
      <linearGradient id="${id}-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#b45309"/></linearGradient>
    </defs>
    <ellipse class="art-shadow" cx="120" cy="166" rx="64" ry="7"/>
    <path class="art-route" d="M18 150 C 50 120, 60 170, 96 150 S 150 120, 222 140" fill="none" stroke="#22d3ee" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="4 7" opacity=".7"/>
    <circle cx="120" cy="84" r="58" fill="url(#${id}-face)" stroke="url(#${id}-rim)" stroke-width="7"/>
    <g class="art-spin slow" style="transform-origin:120px 84px; animation-duration: 40s">
      ${Array.from({ length: 24 }, (_, i) => { const a = i * 15 * Math.PI / 180, r1 = i % 6 === 0 ? 40 : 45, r2 = 50; return `<path d="M${(120 + r1 * Math.sin(a)).toFixed(2)} ${(84 - r1 * Math.cos(a)).toFixed(2)} L${(120 + r2 * Math.sin(a)).toFixed(2)} ${(84 - r2 * Math.cos(a)).toFixed(2)}" stroke="rgba(255,255,255,${i % 6 === 0 ? '.6' : '.2'})" stroke-width="${i % 6 === 0 ? 2.4 : 1.4}" stroke-linecap="round"/>`; }).join('')}
    </g>
    <text x="120" y="52" text-anchor="middle" font-size="11" font-weight="800" fill="#fbbf24" font-family="system-ui, sans-serif">N</text>
    <g class="art-needle" style="transform-origin:120px 84px">
      <path d="M120 44 L129 84 L111 84 Z" fill="#e50914"/>
      <path d="M120 124 L129 84 L111 84 Z" fill="#e5e7eb"/>
    </g>
    <circle cx="120" cy="84" r="6" fill="#fbbf24" stroke="#78350f" stroke-width="2"/>`,

  // A plug and its socket easing apart and together, a spark between them.
  unplugged: id => `
    <defs>
      <linearGradient id="${id}-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a4d"/><stop offset="1" stop-color="#16161f"/></linearGradient>
      <linearGradient id="${id}-pin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#b45309"/></linearGradient>
    </defs>
    <ellipse class="art-shadow" cx="120" cy="150" rx="96" ry="6"/>
    <path d="M4 96 C 30 96, 36 90, 56 90" fill="none" stroke="#2a2a38" stroke-width="7" stroke-linecap="round"/>
    <path d="M236 96 C 210 96, 204 90, 184 90" fill="none" stroke="#2a2a38" stroke-width="7" stroke-linecap="round"/>
    <g class="art-plug">
      <rect x="54" y="68" width="42" height="44" rx="10" fill="url(#${id}-body)" stroke="var(--art-edge)" stroke-width="2"/>
      <rect x="96" y="76" width="18" height="7" rx="2" fill="url(#${id}-pin)"/><rect x="96" y="97" width="18" height="7" rx="2" fill="url(#${id}-pin)"/>
    </g>
    <g class="art-socket">
      <rect x="146" y="64" width="42" height="52" rx="10" fill="url(#${id}-body)" stroke="var(--art-edge)" stroke-width="2"/>
      <rect x="148" y="75" width="10" height="9" rx="2" fill="#0b0b12"/><rect x="148" y="96" width="10" height="9" rx="2" fill="#0b0b12"/>
      <circle cx="176" cy="90" r="4" fill="#e50914" class="art-blink"/>
    </g>
    <g class="art-zap" fill="#fbbf24" style="transform-origin:130px 90px">
      <path d="M131 70 L122 90 H131 L125 110 L140 86 H131 L137 70 Z"/>
    </g>`,

  // Two gears meshing: the big one turns, the small one answers at its own speed.
  gears: id => `
    <defs>
      <linearGradient id="${id}-steel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e5e7eb"/><stop offset=".45" stop-color="#9ca3af"/><stop offset="1" stop-color="#374151"/></linearGradient>
      <linearGradient id="${id}-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset=".5" stop-color="#f59e0b"/><stop offset="1" stop-color="#92400e"/></linearGradient>
    </defs>
    <ellipse class="art-shadow" cx="112" cy="164" rx="76" ry="7"/>
    <g class="art-gear-big" style="transform-origin:96px 96px">
      <path d="${gearPath(96, 96, 46, 37, 12)} M114 96 a18 18 0 1 0 -36 0 a18 18 0 1 0 36 0 Z" fill="url(#${id}-steel)" fill-rule="evenodd"/>
      ${[0, 60, 120, 180, 240, 300].map(a => `<circle cx="${(96 + 27 * Math.cos(a * Math.PI / 180)).toFixed(1)}" cy="${(96 + 27 * Math.sin(a * Math.PI / 180)).toFixed(1)}" r="3.4" fill="#1f2937"/>`).join('')}
      <circle cx="96" cy="96" r="9" fill="#e50914"/><circle cx="96" cy="96" r="3.5" fill="#fff" opacity=".8"/>
    </g>
    <g class="art-gear-small" style="transform-origin:154px 50px">
      <path d="${gearPath(154, 50, 30, 23, 8)} M164 50 a10 10 0 1 0 -20 0 a10 10 0 1 0 20 0 Z" fill="url(#${id}-gold)" fill-rule="evenodd"/>
      <circle cx="154" cy="50" r="5" fill="#7c3aed"/>
    </g>
    <g class="art-gear-tiny" style="transform-origin:170px 118px">
      <path d="${gearPath(170, 118, 20, 15, 7)} M176 118 a6 6 0 1 0 -12 0 a6 6 0 1 0 12 0 Z" fill="url(#${id}-steel)" fill-rule="evenodd" opacity=".85"/>
    </g>
    <g class="art-twinkle" fill="#fde68a">
      <path class="t1" d="M200 24 l2.4 6 6 2.4 -6 2.4 -2.4 6 -2.4 -6 -6 -2.4 6 -2.4z"/>
      <path class="t2" d="M36 40 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z"/>
    </g>`,

  // A radar screen: a sweep turns and each blip flares as the beam passes it.
  radar: id => `
    <defs>
      <radialGradient id="${id}-screen" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#0f2e2e"/><stop offset="1" stop-color="#07131a"/></radialGradient>
      <linearGradient id="${id}-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6b7280"/><stop offset="1" stop-color="#1f2937"/></linearGradient>
    </defs>
    <circle cx="120" cy="90" r="78" fill="url(#${id}-screen)" stroke="url(#${id}-rim)" stroke-width="6"/>
    <g fill="none" stroke="#22d3ee" stroke-opacity=".22" stroke-width="1.4">
      <circle cx="120" cy="90" r="24"/><circle cx="120" cy="90" r="48"/><circle cx="120" cy="90" r="70"/>
      <path d="M50 90 H190 M120 20 V160"/>
    </g>
    <g class="art-radar-sweep" style="transform-origin:120px 90px">
      <path d="M120 90 L190 90 A70 70 0 0 0 169.5 40.5 Z" fill="#22d3ee" opacity=".16"/>
      <path d="M120 90 L190 90 A70 70 0 0 0 184.7 63.2 Z" fill="#22d3ee" opacity=".2"/>
      <path d="M120 90 L190 90" stroke="#67e8f9" stroke-width="2.4" stroke-linecap="round"/>
    </g>
    ${[[150, 70, 'b1'], [95, 120, 'b2'], [140, 125, 'b3'], [80, 65, 'b4']].map(([x, y, cls]) => `<circle class="art-blip ${cls}" cx="${x}" cy="${y}" r="4.5" fill="${cls === 'b1' ? '#f43f5e' : '#34d399'}" style="transform-origin:${x}px ${y}px"/>`).join('')}
    <circle cx="120" cy="90" r="4" fill="#67e8f9"/>`,

  // A file rising into a cloud, its progress bar filling beneath.
  upload: id => `
    <defs>
      <linearGradient id="${id}-cloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#6d28d9"/></linearGradient>
      <linearGradient id="${id}-sheet" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f8fafc"/><stop offset="1" stop-color="#cbd5e1"/></linearGradient>
      <linearGradient id="${id}-bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e50914"/><stop offset="1" stop-color="#a78bfa"/></linearGradient>
    </defs>
    <g class="art-float a">
      <path d="M84 62 a22 22 0 0 1 8 -42 a30 30 0 0 1 56 6 a20 20 0 0 1 8 36 Z" fill="url(#${id}-cloud)"/>
      <path d="M96 30 q10 -10 24 -6" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>
    </g>
    <g class="art-arrow-up">
      <path d="M120 58 V92" stroke="#fbbf24" stroke-width="5" stroke-linecap="round"/>
      <path d="M108 70 L120 56 L132 70" fill="none" stroke="#fbbf24" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <g class="art-float b">
      <path d="M92 96 H136 L152 112 V160 H92 Z" fill="url(#${id}-sheet)"/>
      <path d="M136 96 V112 H152" fill="#94a3b8"/>
      ${[0, 1, 2, 3].map(i => `<rect x="100" y="${118 + i * 9}" width="${[44, 34, 40, 28][i]}" height="4" rx="2" fill="#64748b" opacity=".55"/>`).join('')}
      <text x="112" y="112" font-size="9" font-weight="800" fill="#e50914" font-family="system-ui, sans-serif">CSV</text>
    </g>
    <rect x="70" y="168" width="100" height="6" rx="3" fill="var(--art-edge)"/>
    <rect class="art-progress" x="70" y="168" width="100" height="6" rx="3" fill="url(#${id}-bar)" style="transform-origin:70px 171px"/>`,

  // A padlock whose shackle lifts and closes as its PIN dots light in turn.
  lock: id => `
    <defs>
      <linearGradient id="${id}-body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset=".5" stop-color="#f59e0b"/><stop offset="1" stop-color="#92400e"/></linearGradient>
      <radialGradient id="${id}-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fbbf24" stop-opacity=".45"/><stop offset="1" stop-color="#fbbf24" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="art-glow" cx="120" cy="96" rx="80" ry="60" fill="url(#${id}-glow)"/>
    <ellipse class="art-shadow" cx="120" cy="160" rx="54" ry="6"/>
    <path class="art-shackle" d="M96 76 V56 a24 24 0 0 1 48 0 V76" fill="none" stroke="#9ca3af" stroke-width="11" stroke-linecap="round"/>
    <rect x="80" y="72" width="80" height="68" rx="16" fill="url(#${id}-body)"/>
    <rect x="86" y="78" width="68" height="8" rx="4" fill="#fff" opacity=".3"/>
    <circle cx="120" cy="102" r="9" fill="#451a03"/><path d="M116 106 h8 l-2 16 h-4 z" fill="#451a03"/>
    ${[0, 1, 2, 3].map(i => `<circle class="art-pin p${i}" cx="${96 + i * 16}" cy="158" r="4.5" fill="#fbbf24"/>`).join('')}`,

  // A rocket climbing through streaking stars, its flame flickering.
  rocket: id => `
    <defs>
      <linearGradient id="${id}-hull" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#cbd5e1"/><stop offset=".5" stop-color="#f8fafc"/><stop offset="1" stop-color="#94a3b8"/></linearGradient>
      <linearGradient id="${id}-flame" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffbeb"/><stop offset=".3" stop-color="#fbbf24"/><stop offset=".75" stop-color="#f97316"/><stop offset="1" stop-color="#e50914" stop-opacity=".15"/></linearGradient>
    </defs>
    ${[[40, 20, 's1'], [70, 60, 's2'], [196, 30, 's3'], [176, 110, 's1'], [30, 120, 's2'], [214, 76, 's3']].map(([x, y, cls]) => `<path class="art-streak ${cls}" d="M${x} ${y} v18" stroke="#fde68a" stroke-width="2" stroke-linecap="round" opacity=".7"/>`).join('')}
    <g class="art-rocket">
      <g transform="rotate(28 120 90)">
        <path class="art-flame" d="M106 126 Q120 186 134 126 Z" fill="url(#${id}-flame)" style="transform-origin:120px 128px"/>
        <path d="M120 22 C 140 40, 144 80, 138 122 H102 C 96 80, 100 40, 120 22 Z" fill="url(#${id}-hull)"/>
        <path d="M102 98 L84 128 L102 122 Z" fill="#e50914"/><path d="M138 98 L156 128 L138 122 Z" fill="#e50914"/>
        <path d="M120 22 C 130 30, 135 40, 137 50 H103 C 105 40, 110 30, 120 22 Z" fill="#e50914"/>
        <circle cx="120" cy="74" r="11" fill="#1e293b" stroke="#94a3b8" stroke-width="3"/>
        <circle cx="116" cy="70" r="3.5" fill="#7dd3fc" opacity=".8"/>
        <rect x="112" y="118" width="16" height="10" rx="2" fill="#475569"/>
      </g>
    </g>
    ${[[78, 160, 'p1'], [100, 168, 'p2'], [60, 150, 'p3']].map(([x, y, cls]) => `<circle class="art-puff ${cls}" cx="${x}" cy="${y}" r="12" fill="#f1f5f9" opacity=".5" style="transform-origin:${x}px ${y}px"/>`).join('')}`,

  // An hourglass draining, then turning over to begin again.
  hourglass: id => `
    <defs>
      <linearGradient id="${id}-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b45309"/><stop offset="1" stop-color="#78350f"/></linearGradient>
      <linearGradient id="${id}-sand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></linearGradient>
    </defs>
    <ellipse class="art-shadow" cx="120" cy="166" rx="50" ry="6"/>
    <g class="art-hourglass" style="transform-origin:120px 90px">
      <path d="M92 32 H148 C148 64, 126 78, 124 90 C126 102, 148 116, 148 148 H92 C92 116, 114 102, 116 90 C114 78, 92 64, 92 32 Z" fill="rgba(186,230,253,.12)" stroke="rgba(186,230,253,.45)" stroke-width="2"/>
      <path class="art-sand-top" d="M98 44 H142 C140 62, 124 76, 120 86 C116 76, 100 62, 98 44 Z" fill="url(#${id}-sand)" style="transform-origin:120px 86px"/>
      <path class="art-sand-bottom" d="M98 136 H142 C140 118, 124 104, 120 94 C116 104, 100 118, 98 136 Z" fill="url(#${id}-sand)" style="transform-origin:120px 136px"/>
      <path class="art-stream" d="M120 88 V134" stroke="#fbbf24" stroke-width="2" stroke-dasharray="3 4"/>
      <rect x="80" y="22" width="80" height="12" rx="5" fill="url(#${id}-wood)"/>
      <rect x="80" y="146" width="80" height="12" rx="5" fill="url(#${id}-wood)"/>
      <path d="M86 34 V146 M154 34 V146" stroke="#92400e" stroke-width="4" stroke-linecap="round"/>
    </g>`,

  // Gold coins dropping onto a stack beside a rising line.
  coins: id => `
    <defs>
      <linearGradient id="${id}-coin" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b45309"/><stop offset=".5" stop-color="#fbbf24"/><stop offset="1" stop-color="#b45309"/></linearGradient>
      <linearGradient id="${id}-top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fef3c7"/><stop offset="1" stop-color="#f59e0b"/></linearGradient>
    </defs>
    <ellipse class="art-shadow" cx="120" cy="164" rx="80" ry="7"/>
    <path class="art-line" d="M40 140 L78 116 L108 124 L150 84 L196 52" fill="none" stroke="#34d399" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" pathLength="100" stroke-dasharray="100"/>
    <path d="M186 50 L198 50 L198 62" fill="none" stroke="#34d399" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" class="art-ping" style="transform-origin:196px 52px"/>
    ${[0, 1, 2, 3, 4].map(i => `<g class="art-coin c${i}"><rect x="96" y="${140 - i * 12}" width="48" height="12" fill="url(#${id}-coin)"/><ellipse cx="120" cy="${152 - i * 12}" rx="24" ry="7" fill="#92400e"/><ellipse cx="120" cy="${140 - i * 12}" rx="24" ry="7" fill="url(#${id}-top)"/>${i === 4 ? `<text x="120" y="${144 - i * 12}" text-anchor="middle" font-size="10" font-weight="900" fill="#92400e" font-family="system-ui, sans-serif">$</text>` : ''}</g>`).join('')}
    <g class="art-twinkle" fill="#fde68a"><path class="t1" d="M162 100 l2.4 6 6 2.4 -6 2.4 -2.4 6 -2.4 -6 -6 -2.4 6 -2.4z"/><path class="t2" d="M76 70 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z"/></g>`,

  // A stage between swaying curtains, two spotlights crossing on a star.
  spotlight: id => `
    <defs>
      <linearGradient id="${id}-curtain" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7f1d1d"/><stop offset=".5" stop-color="#dc2626"/><stop offset="1" stop-color="#7f1d1d"/></linearGradient>
      <linearGradient id="${id}-beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fef3c7" stop-opacity=".55"/><stop offset="1" stop-color="#fef3c7" stop-opacity="0"/></linearGradient>
      <radialGradient id="${id}-floor" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fde68a" stop-opacity=".45"/><stop offset="1" stop-color="#fde68a" stop-opacity="0"/></radialGradient>
    </defs>
    <rect x="20" y="146" width="200" height="14" rx="4" fill="#3f2a1d"/>
    <ellipse class="art-glow" cx="120" cy="146" rx="64" ry="14" fill="url(#${id}-floor)"/>
    <path class="art-beam-l" d="M44 14 L100 146 H140 Z" fill="url(#${id}-beam)" style="transform-origin:44px 14px"/>
    <path class="art-beam-r" d="M196 14 L140 146 H100 Z" fill="url(#${id}-beam)" style="transform-origin:196px 14px"/>
    <path class="art-star-spin" d="M120 104 l6 12.2 13.4 1.9 -9.7 9.5 2.3 13.4 -12 -6.3 -12 6.3 2.3 -13.4 -9.7 -9.5 13.4 -1.9z" fill="#fbbf24" style="transform-origin:120px 124px"/>
    <path class="art-curtain-l" d="M8 8 H64 C58 50, 70 96, 50 150 H8 Z" fill="url(#${id}-curtain)" style="transform-origin:8px 8px"/>
    <path class="art-curtain-r" d="M232 8 H176 C182 50, 170 96, 190 150 H232 Z" fill="url(#${id}-curtain)" style="transform-origin:232px 8px"/>
    <rect x="4" y="2" width="232" height="14" rx="4" fill="#991b1b"/>
    ${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<circle cx="${24 + i * 27}" cy="16" r="5" fill="#b91c1c"/>`).join('')}`,
};

export const ILLUSTRATIONS = Object.keys(SCENES);

/** An animated scene as an inline SVG string. Unknown names fall back to the projector. */
export function illustration(name, { label = '', cls = '' } = {}) {
  const scene = SCENES[name] ? name : 'projector';
  const id = `cvart${++serial}`;
  const a11y = label ? `role="img" aria-label="${String(label).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])}"` : 'aria-hidden="true" focusable="false"';
  return `<svg class="cv-art cv-art-${scene}${cls ? ` ${cls}` : ''}" viewBox="0 0 240 180" ${a11y}>${SCENES[scene](id)}</svg>`;
}

const motionReduced = () => {
  const root = document.documentElement;
  return root.dataset.motion === 'reduced' || (root.dataset.motion !== 'full' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
};

/**
 * A tap on Sign in beside a ticket tears the stub off along its perforation
 * first; the sign-in dialog opens once the tear has played, and the ticket mends
 * itself a moment later. Reduced motion opens the dialog straight away.
 */
export function initIllustrations() {
  if (typeof window === 'undefined') return;
  window.addEventListener('click', event => {
    const button = event.target.closest?.('[data-action="open-auth"]');
    if (!button) return;
    if (button.dataset.tearing === 'go') { delete button.dataset.tearing; return; }
    let ticket = null;
    for (let node = button.parentElement, depth = 0; node && depth < 3 && !ticket; node = node.parentElement, depth++) ticket = node.querySelector('.cv-art-ticket');
    if (!ticket || ticket.classList.contains('torn') || motionReduced()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    ticket.classList.add('torn');
    setTimeout(() => { button.dataset.tearing = 'go'; button.click(); }, 460);
    setTimeout(() => ticket.classList.remove('torn'), 2400);
  }, true);
}
