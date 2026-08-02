// ===== QR CODE GENERATOR =====
// A small, self-contained QR encoder (byte mode, versions 1–10, all four error
// levels) — no external library and no third-party QR image service, so a friend
// code renders offline and nothing leaves the page. Faithful to the QR Model 2
// spec (Reed–Solomon over GF(256), the standard mask/penalty selection); the
// algorithm mirrors Nayuki's well-known reference implementation.
//
// Public API: qrSvg(text, { ecl }) -> an <svg> string (black on white + quiet
// zone), ready to drop into innerHTML.

const ECL = { L: 0, M: 1, Q: 2, H: 3 };

// EC codewords per block and number of blocks, indexed [ecl][version] (v1–v10;
// index 0 is padding). Beyond v10 is unused here — a friend URL never needs it.
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],  // L
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26], // M
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24], // Q
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28], // H
];
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],  // L
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],  // M
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],  // Q
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],  // H
];

function numRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}
const rawCodewords = ver => Math.floor(numRawDataModules(ver) / 8);
const numDataCodewords = (ver, ecl) => rawCodewords(ver) - ECC_PER_BLOCK[ecl][ver] * NUM_BLOCKS[ecl][ver];

// ---- GF(256) arithmetic (primitive polynomial 0x11D) ----
const EXP = new Uint8Array(256), LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
})();
function gfMul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[(LOG[a] + LOG[b]) % 255]; }

// Reed–Solomon generator polynomial of the given degree.
function rsDivisor(degree) {
  const result = new Uint8Array(degree); result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 2);
  }
  return result;
}
function rsRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1); result[result.length - 1] = 0;
    for (let i = 0; i < result.length; i++) result[i] ^= gfMul(divisor[i], factor);
  }
  return result;
}

// ---- Bit helpers ----
function appendBits(bb, val, len) { for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1); }
function utf8Bytes(str) { return Array.from(new TextEncoder().encode(str)); }
const getBit = (x, i) => ((x >>> i) & 1) !== 0;

// ---- Data encoding + ECC interleave ----
function encodeData(text, ecl) {
  const data = utf8Bytes(text);
  let version = 0, ccBits = 0, cap = 0;
  for (let v = 1; v <= 10; v++) {
    const cc = v < 10 ? 8 : 16;
    if (4 + cc + data.length * 8 <= numDataCodewords(v, ecl) * 8) { version = v; ccBits = cc; break; }
  }
  if (!version) throw new Error('QR: text too long');
  const nData = numDataCodewords(version, ecl);
  cap = nData * 8;

  const bb = [];
  appendBits(bb, 0x4, 4);            // byte mode
  appendBits(bb, data.length, ccBits);
  data.forEach(b => appendBits(bb, b, 8));
  appendBits(bb, 0, Math.min(4, cap - bb.length));    // terminator
  appendBits(bb, 0, (8 - bb.length % 8) % 8);         // byte-align
  for (let pad = 0xEC; bb.length < cap; pad ^= 0xEC ^ 0x11) appendBits(bb, pad, 8);

  const dataCodewords = [];
  for (let i = 0; i < bb.length; i += 8) { let byte = 0; for (let j = 0; j < 8; j++) byte = (byte << 1) | bb[i + j]; dataCodewords.push(byte); }
  return { version, all: addEccAndInterleave(dataCodewords, version, ecl) };
}

function addEccAndInterleave(data, ver, ecl) {
  const numBlocks = NUM_BLOCKS[ecl][ver];
  const blockEccLen = ECC_PER_BLOCK[ecl][ver];
  const raw = rawCodewords(ver);
  const numShort = numBlocks - raw % numBlocks;
  const shortLen = Math.floor(raw / numBlocks);
  const div = rsDivisor(blockEccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const datLen = shortLen - blockEccLen + (i < numShort ? 0 : 1);
    const dat = data.slice(k, k + datLen); k += datLen;
    const ecc = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);           // placeholder to square up interleaving
    blocks.push(dat.concat(Array.from(ecc)));
  }
  const result = [];
  for (let i = 0; i < blocks[0].length; i++)
    for (let j = 0; j < blocks.length; j++)
      if (i !== shortLen - blockEccLen || j >= numShort) result.push(blocks[j][i]);
  return result;
}

// ---- Matrix ----
function alignmentPositions(ver) {
  if (ver === 1) return [];
  const num = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (num * 2 - 2)) * 2;
  const pos = [6];
  for (let p = ver * 4 + 10; pos.length < num; p -= step) pos.splice(1, 0, p);
  return pos;
}

function buildMatrix(version, ecl, all) {
  const size = version * 4 + 17;
  const M = Array.from({ length: size }, () => new Array(size).fill(false));
  const F = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { M[y][x] = dark; F[y][x] = true; };

  // Timing patterns.
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  // Finder patterns + separators.
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= size || y < 0 || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  // Alignment patterns (skip the ones overlapping finders).
  const ap = alignmentPositions(version);
  for (const ax of ap) for (const ay of ap) {
    if ((ax === 6 && ay === 6) || (ax === 6 && ay === size - 7) || (ax === size - 7 && ay === 6)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  drawFormat(set, size, ecl, 0);   // placeholder; redrawn with the chosen mask
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const bits = version << 12 | rem;
    for (let i = 0; i < 18; i++) { const b = getBit(bits, i); const a = size - 11 + i % 3, c = Math.floor(i / 3); set(a, c, b); set(c, a, b); }
  }

  // Data with the zigzag walk.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j;
      const upward = ((right + 1) & 2) === 0;
      const y = upward ? size - 1 - v : v;
      if (!F[y][x] && i < all.length * 8) { M[y][x] = getBit(all[i >>> 3], 7 - (i & 7)); i++; }
    }
  }

  // Pick the mask with the lowest penalty.
  let best = 0, bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(M, F, mask); drawFormat(set, size, ecl, mask);
    const p = penalty(M);
    if (p < bestPenalty) { bestPenalty = p; best = mask; }
    applyMask(M, F, mask);   // undo
  }
  applyMask(M, F, best); drawFormat(set, size, ecl, best);
  return M;
}

function drawFormat(set, size, ecl, mask) {
  const ECL_BITS = [1, 0, 3, 2];   // L, M, Q, H
  const data = (ECL_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  for (let i = 0; i <= 5; i++) set(8, i, getBit(bits, i));
  set(8, 7, getBit(bits, 6)); set(8, 8, getBit(bits, 7)); set(7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, getBit(bits, i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, getBit(bits, i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, getBit(bits, i));
  set(8, size - 8, true);   // always dark
}

function applyMask(M, F, mask) {
  const size = M.length;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (F[y][x]) continue;
    let invert;
    switch (mask) {
      case 0: invert = (x + y) % 2 === 0; break;
      case 1: invert = y % 2 === 0; break;
      case 2: invert = x % 3 === 0; break;
      case 3: invert = (x + y) % 3 === 0; break;
      case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
      case 5: invert = (x * y) % 2 + (x * y) % 3 === 0; break;
      case 6: invert = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
      default: invert = ((x + y) % 2 + (x * y) % 3) % 2 === 0; break;
    }
    if (invert) M[y][x] = !M[y][x];
  }
}

// The four standard penalty rules for choosing a mask.
function penalty(M) {
  const size = M.length; let p = 0;
  const runScore = (get) => {
    for (let a = 0; a < size; a++) {
      let run = 1, prev = get(a, 0);
      for (let b = 1; b < size; b++) { const c = get(a, b); if (c === prev) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; } else { run = 1; prev = c; } }
    }
  };
  runScore((a, b) => M[a][b]);   // rows
  runScore((a, b) => M[b][a]);   // cols
  // 2x2 blocks.
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++)
    if (M[y][x] === M[y][x + 1] && M[y][x] === M[y + 1][x] && M[y][x] === M[y + 1][x + 1]) p += 3;
  // Finder-like 1:1:3:1:1 patterns.
  const pat = (get) => {
    for (let a = 0; a < size; a++) {
      let bits = 0;
      for (let b = 0; b < size; b++) {
        bits = ((bits << 1) & 0x7FF) | (get(a, b) ? 1 : 0);
        if (b >= 10 && (bits === 0x05D || bits === 0x5D0)) p += 40;
      }
    }
  };
  pat((a, b) => M[a][b]); pat((a, b) => M[b][a]);
  // Dark-module balance.
  let dark = 0; M.forEach(row => row.forEach(c => { if (c) dark++; }));
  const total = size * size;
  p += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return p;
}

// ---- Public ----
// Returns the module matrix (boolean[][]) for `text`.
export function qrMatrix(text, ecl = 'M') {
  const e = ECL[ecl] != null ? ECL[ecl] : 1;
  const { version, all } = encodeData(text, e);
  return buildMatrix(version, e, all);
}

// Returns a self-contained <svg> string: black modules on a white field with a
// 4-module quiet zone (both required for a scanner to lock on).
export function qrSvg(text, { ecl = 'M', margin = 4, cls = '' } = {}) {
  const M = qrMatrix(text, ecl);
  const n = M.length, dim = n + margin * 2;
  let path = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (M[y][x]) path += `M${x + margin} ${y + margin}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"${cls ? ` class="${cls}"` : ''} role="img" aria-label="QR code"><rect width="${dim}" height="${dim}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

// Shared by Friends and Profile. The QR opens the app with the friend code in
// the query string, whatever domain/base path CineVerse is deployed under.
export function friendAddUrl(code) {
  try { return new URL('?add=' + encodeURIComponent(code), location.href).href; }
  catch (_) { return `${location.origin}/?add=${encodeURIComponent(code)}`; }
}

export function friendQrSvg(code) {
  return qrSvg(friendAddUrl(code), { ecl: 'M', cls: 'qr-svg' });
}
