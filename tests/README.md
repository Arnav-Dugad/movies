# CineVerse tests

Two suites with very different requirements.

```
cd tests
npm install          # only needed for the rules suite
npm run test:logic   # no dependencies, no Java — just Node
npm run coverage     # no dependencies
npm run test:rules   # needs npm install AND a JDK
npm test             # all three
```

## `logic/` — pure-logic suites (Node only)

Runs against the real application modules with a small browser shim
(`logic/harness.mjs`) standing in for `document`, `localStorage`, and the
Firebase compat SDK. No network, no emulator, no dependencies — `npm run
test:logic` works on a fresh clone with nothing installed.

| Suite | Covers |
|---|---|
| `list-lock.test.mjs` | PBKDF2 derivation, PIN verify, lock/unlock, share refusal |
| `episodes.test.mjs` | aired totals, `markUpTo`, unaired guards, completion, resume queue |
| `episodes-advanced.test.mjs` | log honesty (bulk vs single), whole-show marking, legacy back-fill, `episodeStats` |
| `import-csv.test.mjs` | RFC 4180 parsing, Letterboxd/IMDb/Trakt shapes, rating scales, de-duplication |
| `stats.test.mjs` | every headline figure against a hand-computed collection, plus empty and malformed input |

Each file runs in its own process (`node --test`), which matters: the suites
mutate the shared `state` singleton and would otherwise interfere.

## `rules.test.mjs` — Firestore security rules (needs a JDK)

The Firestore emulator is a Java process, so this suite cannot run without a JDK
on `PATH`. On Windows, `JAVA_HOME` usually needs setting explicitly:

```bash
export JAVA_HOME="/c/Program Files/Java/jdk-26.0.2.1"
export PATH="$JAVA_HOME/bin:$PATH"
npm run test:rules
```

It loads the real `firestore.rules` into the emulator and asserts the property
that matters: raw collection data is owner-only, and the only cross-user readable
documents are the derived snapshots under `users/{uid}/shared/`. It also proves
undeclared paths are denied by default.

Expect `PERMISSION_DENIED` lines in the output — those are the emulator logging
the denials that the negative tests assert.

## `coverage.mjs` — completeness check (no dependencies)

The emulator suite proves the rules *behave*; this proves the suite is
*complete*. It parses every `match` path out of `firestore.rules` and fails if
one is not named in the tests, so adding a collection without a test for it is
caught immediately.
