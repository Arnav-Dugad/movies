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
  // An admission ticket floating on a tilt, a light sweeping across it.
  ticket: id => `
    <defs>
      <linearGradient id="${id}-paper" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ff3b47"/><stop offset=".55" stop-color="#c8102e"/><stop offset="1" stop-color="#6d28d9"/>
      </linearGradient>
      <linearGradient id="${id}-shine" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <clipPath id="${id}-clip"><path d="M62 50 H178 a12 12 0 0 1 12 12 V78 a12 12 0 0 0 0 24 V118 a12 12 0 0 1 -12 12 H62 a12 12 0 0 1 -12 -12 V102 a12 12 0 0 0 0 -24 V62 a12 12 0 0 1 12 -12 Z"/></clipPath>
    </defs>
    <ellipse class="art-shadow" cx="120" cy="160" rx="66" ry="7"/>
    <g class="art-float a">
      <g transform="rotate(-8 120 90)">
        <path d="M62 50 H178 a12 12 0 0 1 12 12 V78 a12 12 0 0 0 0 24 V118 a12 12 0 0 1 -12 12 H62 a12 12 0 0 1 -12 -12 V102 a12 12 0 0 0 0 -24 V62 a12 12 0 0 1 12 -12 Z" fill="url(#${id}-paper)"/>
        <rect x="58" y="58" width="124" height="64" rx="8" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="1.5" stroke-dasharray="2 4"/>
        <path d="M150 56 V124" stroke="rgba(255,255,255,.55)" stroke-width="2" stroke-dasharray="3 5"/>
        <text x="102" y="87" text-anchor="middle" font-size="15" font-weight="800" letter-spacing="3" fill="#fff" font-family="system-ui, sans-serif">ADMIT</text>
        <text x="102" y="106" text-anchor="middle" font-size="15" font-weight="800" letter-spacing="3" fill="#fff" font-family="system-ui, sans-serif">ONE</text>
        <path class="art-star-spin" d="M170 80 l2.6 5.4 5.9 .9 -4.3 4.1 1 5.9 -5.2 -2.8 -5.2 2.8 1 -5.9 -4.3 -4.1 5.9 -.9z" fill="#fde68a" style="transform-origin:170px 89px"/>
        <g clip-path="url(#${id}-clip)"><g class="art-shine"><rect x="-10" y="30" width="46" height="120" fill="url(#${id}-shine)" transform="skewX(-18)"/></g></g>
      </g>
    </g>
    <g class="art-twinkle" fill="#fde68a">
      <path class="t1" d="M40 40 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z"/>
      <path class="t2" d="M206 34 l2.4 6 6 2.4 -6 2.4 -2.4 6 -2.4 -6 -6 -2.4 6 -2.4z"/>
      <path class="t3" d="M212 140 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6z"/>
    </g>`,

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
};

export const ILLUSTRATIONS = Object.keys(SCENES);

/** An animated scene as an inline SVG string. Unknown names fall back to the projector. */
export function illustration(name, { label = '', cls = '' } = {}) {
  const scene = SCENES[name] ? name : 'projector';
  const id = `cvart${++serial}`;
  const a11y = label ? `role="img" aria-label="${String(label).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])}"` : 'aria-hidden="true" focusable="false"';
  return `<svg class="cv-art cv-art-${scene}${cls ? ` ${cls}` : ''}" viewBox="0 0 240 180" ${a11y}>${SCENES[scene](id)}</svg>`;
}
