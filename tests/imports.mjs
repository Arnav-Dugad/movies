// Static check: every `import { a, b } from './x.js'` names something x.js exports.
// Catches the class of bug a syntax check cannot — a renamed or removed export.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from this file, so it runs the same on a CI runner as it does here.
const DIR = fileURLToPath(new URL('../js/', import.meta.url));
const files = readdirSync(DIR).filter(f => f.endsWith('.js'));
const src = new Map(files.map(f => [f, readFileSync(join(DIR, f), 'utf8')]));

function exportsOf(text) {
  const out = new Set();
  for (const m of text.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)) out.add(m[1]);
  for (const m of text.matchAll(/^export\s+(?:const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)) out.add(m[1]);
  for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gm))
    for (const piece of m[1].split(','))
      { const name = piece.trim().split(/\s+as\s+/).pop().trim(); if (name) out.add(name); }
  if (/^export\s+default/m.test(text)) out.add('default');
  return out;
}

const exportMap = new Map([...src].map(([f, t]) => [f, exportsOf(t)]));
let problems = 0, checked = 0;

for (const [file, text] of src) {
  for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/([A-Za-z0-9._-]+)['"]/g)) {
    const target = m[2];
    if (!exportMap.has(target)) { console.log(`MISSING MODULE  ${file} -> ${target}`); problems++; continue; }
    for (const piece of m[1].split(',')) {
      const name = piece.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      checked++;
      if (!exportMap.get(target).has(name)) { console.log(`MISSING EXPORT  ${file}: '${name}' is not exported by ${target}`); problems++; }
    }
  }
  // Also verify dynamic imports resolve to a real file.
  for (const m of text.matchAll(/import\(\s*['"]\.\/([A-Za-z0-9._-]+)['"]\s*\)/g))
    if (!exportMap.has(m[1])) { console.log(`MISSING MODULE  ${file} -> ${m[1]} (dynamic)`); problems++; }
}

console.log(`\n${checked} named imports checked across ${files.length} modules · ${problems} problem(s)`);
process.exit(problems ? 1 : 0);
