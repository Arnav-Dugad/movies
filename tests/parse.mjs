// ===== MODULE PARSE CHECK =====
// `node tests/parse.mjs` — parses every file in js/ as an ES module and fails if
// any does not parse.
//
// `node --check file.js` is not enough here: without a package.json saying
// "module", Node can accept a file that is not valid as the ES module the
// browser loads, and a shell loop over it only fails when the LAST file fails.
// A template placeholder left inside a plain '…' string passed that check and
// would have broken Discover. Reading the source on stdin with
// --input-type=module parses each file exactly as the browser does.
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const dir = new URL('../js/', import.meta.url);
const files = readdirSync(dir).filter(name => name.endsWith('.js')).sort();
let failed = 0;
for (const name of files) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: readFileSync(new URL(name, dir)), encoding: 'utf8' });
  if (result.status !== 0) {
    failed++;
    console.log(`\x1b[31mFAIL\x1b[0m js/${name}\n${(result.stderr || '').split('\n').slice(0, 6).join('\n')}`);
  }
}
console.log(failed ? `\x1b[31m${failed} of ${files.length} modules do not parse\x1b[0m` : `\x1b[32mall ${files.length} modules parse\x1b[0m`);
if (failed) process.exitCode = 1;
