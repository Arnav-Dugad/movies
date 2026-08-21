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
watched**, **Up to here** (the one action that makes a show you are already
halfway through trackable), and **I have seen it all**. Whole-season marking stops
at the last aired episode, so progress can never claim a completion that is not
possible. Ticking the final aired episode marks the show itself watched, and
marking a show watched anywhere fills its episodes — the two directions stay in
agreement instead of a "watched" show sitting at 0%.

### Shows watched before episode tracking existed

They have a `watched` document and no progress document, so they would read as 0%
forever. A one-time background pass fills them in using the date each was
*originally* marked, capped per run and remembered on the device so a show you
later un-tick is never silently re-filled.

### Why the log carries a `bulk` flag

Each watched episode is logged as `[season, episode, when, bulk]`. Ticking
episodes one at a time is real viewing; a whole-season mark, a whole-show mark, or
a back-filled history is bookkeeping. Both belong in the episodes-over-time chart,
but only the first is a binge — so the longest-sitting figure counts single ticks
and says so. Bulk marks carry the moment they were actually marked, with no
fabricated spacing.

## Mature content

Off by default and invisible until switched on: no section renders, no chip
appears, `include_adult` stays false everywhere, and nothing in the interface
hints that the option exists. It lives behind a disclosure in Settings.

TMDB has no "erotic" genre, so the collections are built from verified TMDB
**keywords** (erotic, softcore, erotic thriller, erotica, erotic comedy, erotic
romance, seduction, sensual). Turning it on adds an After Dark section to Discover
and lets adult results into search. Artwork stays blurred until hover by default,
and anything you save can go straight into a PIN-locked list.

Every search and discover call passes `adultFlag()` rather than a literal, so
adult results cannot leak in while the toggle is off.

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
then the TV Tracker, then Rating & Library, then the deeper taste and collection
analysis.

**Watch time was wrong and is now right.** A TV show marked watched from the
detail page stored one episode's runtime, while one finished through the episode
tracker stored the whole series — the same show contributed 45 minutes or 40
hours depending on which button was used. Watch time now reads from the episode
ledger where it exists (episodes watched x episode length), falls back to
`episodeRuntime x episodeCount`, then to the stored runtime, and reports what
percentage of watched titles have a known runtime instead of implying all of them
do. Titles with no reported runtime are excluded rather than guessed, and the
"longest title" figure is movies-only because ranking a 62-episode series against
a two-hour film by total minutes answers nothing.

`tests/logic/stats.test.mjs` asserts 50 arithmetic properties against a
hand-computed collection, including empty and malformed input (no NaN, no
percentage above 100). Each section collapses independently and remembers its
state on `users/{uid}.statsSections`,
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

## Tests

```
cd tests
npm run test:logic    # 250 assertions, no dependencies and no Java
npm install && npm test   # adds the Firestore rules suite (needs a JDK)
```

`tests/logic/` runs the real application modules against a small browser shim —
list locking, the episode ledger, CSV import, every stats figure, rewatch
counting, and collection completion. It needs nothing installed.

`tests/rules.test.mjs` loads the real `firestore.rules` into the Firestore
emulator and covers every `match` path: owner-only collections, the deliberately
shared `users/{uid}/shared/` surface, friend discovery, the friend graph, and
default-deny for anything undeclared. The emulator is a Java process, so this
half needs a JDK on `PATH` (on Windows, `JAVA_HOME` usually has to be set
explicitly — see `tests/README.md`). 29 tests, all passing.

`coverage.mjs` is the cheap half: it proves the suite is *complete* by checking
that every rule path is named in the tests, so adding a collection without a test
fails immediately. No Java needed.

## Rewatch tracking

A watched entry is a count, not a boolean. The first viewing is play 1; **Log a
rewatch** on a title's page appends a dated play, and the Watched page gains a
`3x` badge, a rewatch filter, and two sort orders.

There is no migration. Entries written before this existed carry no `plays` field
and read as exactly one viewing stamped with their `watchedAt`, so every account
has a complete history from the moment it ships — a document only grows the new
fields once it is actually rewatched. Dates are capped at 60 per title while
`plays` keeps counting, so a total is never wrong, only less detailed.

The Rewatches stats block measures repeat time with the *same* runtime model as
headline watch time (`runtimeOf`), so the two figures can be compared without a
caveat.

## Franchise completion

"Part of the Alien Collection" was a link and nothing more. The banner now
carries a completion meter, and a `/collection/:id` page opens with where you
stand and a **Carry on with...** button pointing at the earliest entry you have
not seen. A Franchises block in Stats ranks every series in your history by how
close it is to done.

Completion is measured against **released** entries only, for the same reason the
episode tracker caps at the last aired episode: a series with an announced sequel
is not 80% complete, it is complete with more coming, and counting a film nobody
can watch yet against you produces a number that can never reach 100.

Membership costs no extra request — `belongs_to_collection` is stamped onto
watched documents by the metadata backfill that already fetches runtime, credits,
and keywords.

## Fewer reads on sign-in

Signing in read five whole collections every time — on a large library, hundreds
of document reads to fetch data that had not changed since the last page load.

`js/library-cache.js` keeps a version counter on the profile document, which
sign-in already reads, so checking it is free. Every mutation increments it. The
page paints from a device cache immediately, then compares versions: equal means
nothing changed anywhere and the five reads are skipped, taking sign-in from
hundreds of reads to one.

It cannot serve stale data. The local counter is only ever advanced by this
device's own increments, so it is always less than or equal to the server's — a
false *miss* is possible and harmless, while a false *hit* would require our count
to exceed the server's, which cannot happen. Three guards cover the rest: a failed
increment leaves a dirty flag that forces a full read until it lands, the cache
expires after seven days regardless, and a library too large for `localStorage`
falls back to reading rather than guessing.

Writers do not call into the cache directly. Every module that changes the
library already ends with `cv:wl-changed` (and the episode ledger with
`cv:episode-progress`), so the cache hooks those two events — a write path added
later is covered by the convention it already follows.

## First-run onboarding

A new account used to land on a home page personalised from nothing. Three
questions fix that, and each has a real consequence: the region becomes the one
used for every provider lookup, and the chosen genres are folded into the taste
profile with a weight of 1.4 each — enough to decide the first session, and
outvoted within a dozen titles by actual viewing, which contributes 1.5 or more
apiece.

It appears once, only for an account with an empty library, and skipping counts
as answering. Whatever was chosen before the skip is still kept.

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
