// ===== RULES COVERAGE CHECK =====
// Runs without Java or the emulator: `node tests/coverage.mjs`.
//
// The emulator suite proves the rules BEHAVE correctly. This proves the suite is
// COMPLETE — every `match` path declared in firestore.rules is named somewhere in
// rules.test.mjs. Adding a collection to the rules without a test for it fails
// here, which is the regression this whole exercise exists to prevent.
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const tests = readFileSync(new URL('./rules.test.mjs', import.meta.url), 'utf8');

// Collect every declared match path, ignoring the database/documents wrapper.
const declared = [...rules.matchAll(/match\s+([^\s{]+)\s*\{/g)]
  .map(match => match[1])
  .filter(path => !path.startsWith('/databases'));

// A path is covered when its last literal segment appears in the test file.
// Wildcards ({uid}, {docId}) carry no name, so the literal ahead of them is what
// identifies the collection.
function literalSegment(path) {
  const segments = path.split('/').filter(Boolean).filter(segment => !segment.startsWith('{'));
  return segments.at(-1) || '';
}

const missing = [];
const covered = [];
for (const path of declared) {
  const name = literalSegment(path);
  if (!name) continue;
  (tests.includes(name) ? covered : missing).push(`${name}   (${path})`);
}

const green = value => `\x1b[32m${value}\x1b[0m`;
const red = value => `\x1b[31m${value}\x1b[0m`;

console.log(`firestore.rules declares ${declared.length} match paths\n`);
for (const entry of covered) console.log(`  ${green('covered')}  ${entry}`);
for (const entry of missing) console.log(`  ${red('MISSING')}  ${entry}`);

// The suite must also assert the three contexts that make the rules meaningful.
const contexts = [
  ['owner context', 'authenticatedContext'],
  ['unauthenticated context', 'unauthenticatedContext'],
  ['negative assertions', 'assertFails'],
  ['positive assertions', 'assertSucceeds'],
  ['default-deny check', 'undeclared'],
];
console.log('');
let contextGaps = 0;
for (const [label, needle] of contexts) {
  const ok = tests.includes(needle);
  if (!ok) contextGaps++;
  console.log(`  ${ok ? green('present') : red('MISSING')}  ${label}`);
}

if (missing.length || contextGaps) {
  console.log(`\n${red(`${missing.length} uncovered path(s), ${contextGaps} missing context(s)`)}`);
  process.exitCode = 1;
} else {
  console.log(`\n${green('every declared rule path is covered')}`);
}
