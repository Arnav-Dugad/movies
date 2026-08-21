# movies

https://arnav-dugad.github.io/movies/

## Deploying

CineVerse is a static SPA with clean URLs (`/movie/693134`, `/stats`, …). Every
host has to serve `index.html` for paths that do not match a file, or opening a
card in a new tab, refreshing, or following a shared link returns that host's 404
instead of the app.

| Host | File | What it does |
|---|---|---|
| Cloudflare Workers (`npx wrangler deploy`) | `wrangler.jsonc` | `assets.not_found_handling: "single-page-application"` — the SPA fallback |
| Cloudflare Workers | `.assetsignore` | keeps `.git/`, `.wrangler/`, and config files out of the upload |
| Cloudflare Workers / Pages | `_headers` | security and cache headers |
| Vercel | `vercel.json` | `rewrites` for the SPA fallback, `headers` for the same policy |

### Why there is no `_redirects`

The obvious Cloudflare SPA recipe — `/movie/* /index.html 200` — is rejected by
the API and **fails the whole deploy**:

```
Invalid _redirects configuration:
Line 15: Infinite loop detected in this rule. This would cause a redirect to
strip `.html` or `/index` and end up triggering this rule again.
```

With the default `html_handling` (`auto-trailing-slash`) Cloudflare already
rewrites `/index.html` to `/`, so a splat rule pointing at `/index.html` is a
cycle. Exact-path rules (`/stats /index.html 200`) validate fine; every rule with
a `*` does not. `not_found_handling` is the first-class mechanism and has no such
interaction, so it does the job alone.

### Caching

Nothing is fingerprinted, so HTML, JS, and CSS are served `must-revalidate`
(cheap 304s, instant deploys) while `/assets/*` caches for a week. A long cache on
unhashed files would pin visitors to an old build.

## Private lists

Any list can be locked with a 4-8 digit PIN. While locked its titles, count,
showcase, and duplicate-finder entries are never rendered, its membership is
hidden in the add-to-list picker, and it cannot be shared — locking a list also
revokes any share snapshot published earlier.

The PIN is never stored. `js/list-lock.js` writes a PBKDF2-SHA256 derivation
(150k iterations, random per-list salt) to the list document. Unlocking lasts for
the page session only; a reload always re-locks.

This is a privacy screen, not encryption: the titles stay in your own Firestore
documents and remain readable by anyone who can sign in as you. The UI says so.

## Continue Watching

TV is tracked per episode. One document per show at `users/{uid}/progress/{tv_<id>}`
holds the watched episode numbers by season, plus the show's structure (episodes
per season) and the last episode to have aired:

```
{ seasons: { "1": [1,2,3], "2": [1] }, structure: { "1": 7, "2": 13 },
  aired: { season: 2, episode: 4 } }
```

Carrying `structure` and `aired` on the document is what lets the home rail work
out "next up" instantly on a cold load, with zero TMDB requests — the episode
still and title are filled in afterwards and never block the render.

The detail page gets a per-episode tick, a season progress ring, **Mark season
watched**, and **Up to here** (the one action that makes a show you are already
halfway through trackable). Whole-season marking stops at the last aired episode,
so progress can never claim a completion that is not possible. Ticking the final
aired episode marks the show itself watched, keeping stats and badges consistent.

## Importing an existing history

`js/import-csv.js` reads the exports people actually have — Letterboxd
(`watched`, `ratings`, `diary`, `watchlist`), Trakt, and IMDb — with a CSV parser
that handles quoted fields, embedded commas and newlines, and doubled quotes.

Titles resolve to TMDB by `tmdb_id` first, then `imdb_id`, and only fall back to a
title+year search, so a match is exact wherever the export gave us something
exact. Rating scale is detected from the file (a five-star export is doubled) and
shown before anything is written. Diary rewatches collapse to one entry, keeping
the newest date and highest rating.

Every write merges: an import can add watched entries, ratings, and saved titles,
and can never delete one or overwrite a rating you already gave.

## Notification center

The inbox is derived, never invented. Episode dates come from TMDB, exact
timestamps only when TVmaze publishes an airstamp, and streaming uses `flatrate`
(subscription) offers only — rent and buy are never counted.

Items are scored and grouped by urgency (Needs attention / Today / This week /
Coming later / Recently detected), carry live countdowns inside three days, and
can be snoozed for 24 hours or dismissed. Desktop alerts are optional, local, and
fire only for urgent unread items while the tab is in the background — there is
no push server and no subscription endpoint.

### Streaming Departure Warning

No free catalog API publishes a leave date, so CineVerse never claims one. It
diffs consecutive scans of your region instead and reports three verifiable
signals: **departed** (every detected subscription source is gone), **shrinking**
(a service that carried the title dropped it, others remain), and **one source
left** (down to a single service from a previously wider catalog). Titles you
saved but have not watched rank highest.

### Provider History Charts

`js/provider-charts.js` renders which services gained or lost the most titles
from your library, plus your streamable catalog over time. Gains/losses use a
diverging pair validated for colour-vision deficiency (cyan-600 / orange-600
rather than green/red), and direction, sign, and direct labels repeat the meaning
so hue is never the only channel. A table view carries the same data.

Both features are seeded by `js/provider-history.js`, which keeps a per-title
snapshot, an append-only change log, and one catalog sample per day.

## Stats

Sections are ordered by what answers "how am I doing" first — Activity Pulse,
then Rating & Library, then the deeper taste and collection analysis. Each one
collapses independently and remembers its state on `users/{uid}.statsSections`,
so the layout follows the account rather than the device. A collapsed section is
not hidden with CSS: its body is a thunk that is never called, so the Director
Network SVG and the provider charts cost nothing (and skip their network calls)
while closed.

## Recommendations

The rails show a different slice of your ranked pool every time CineVerse is
opened. A device-local counter bumps once per page load (no Firestore write) and
is added to the stored cross-device rotation; discover pages are varied by the
same counter so the underlying pool changes too, not just the window over it.
It is deliberately silent — there is no banner explaining it, the rails simply
differ. Ranking itself never changes randomly, only which part of it you see
first, and in-app navigation never reshuffles.

## Streaming regions

`REGIONS` in `js/config.js` lists the 60 countries TMDB returns watch-provider
data for. The flag is derived from the ISO 3166-1 alpha-2 code rather than typed,
so a wrong flag beside a country is impossible by construction; the name is always
rendered next to it because Windows has no flag glyphs and falls back to the two
letters.

## Security rules

`tests/` holds an emulator suite covering every `match` path in `firestore.rules`
— owner-only collections, the deliberately shared `users/{uid}/shared/` surface,
friend discovery, the friend graph, and default-deny for anything undeclared.

```
cd tests && npm install && npm test     # needs a JDK: the emulator is a Java process
node tests/coverage.mjs                 # no Java needed
```

`coverage.mjs` is the cheap half: it proves the suite is *complete* by checking
that every rule path is named in the tests, so adding a collection without a test
fails immediately.

### Publishing them

**Firebase Console → Firestore Database → Rules →** paste `firestore.rules` **→ Publish.**

Sharing a list does not work until these are published: a friend has to be able to
read the owner's shared snapshot at `users/{uid}/shared/list_{listId}`. Raw
watchlist, ratings, watched, list, and episode-progress data stay owner-only — the
only cross-user readable documents are the derived ones under `users/{uid}/shared/`.

If a list action fails, the toast carries the Firestore error code (usually
`permission-denied`), which normally means the rules are not published yet.

## Voice search

`js/voice.js` owns the microphone. `SpeechRecognition.start()` runs synchronously
inside the click so user activation survives, and `getUserMedia` is used only to
recover from a permission or capture failure — awaiting it first is what broke
desktop capture before. A watchdog covers Chrome's silent-no-start failure, and
the waveform is driven by the recogniser's own sound/speech events rather than a
second capture stream.

Commands: search, open a title, play a trailer, add or remove from your lists,
mark watched, rate (pre-selected, never auto-saved), and jump to any page.
