# movies

https://arnav-dugad.github.io/movies/

## Publishing the security rules

**`firestore.rules` in this repository is not what Firebase enforces.** Firebase
enforces whatever was last pasted into **Firebase Console → Firestore Database →
Rules → Publish**. When a release adds a subcollection — `movieProgress` is the
most recent — every write to it is denied until the rules are republished.

The client is offline-first, so a denied write does not look like an error: the
feature keeps working on the device that made it and silently does not exist
anywhere else. That is exactly how one account ends up showing a different
Continue Watching rail on a phone and a laptop, with a different number of
titles and a different number starred.

`js/rules-notice.js` now turns that silence into a message. A denial is never
normal for an owner writing to their own document, so the first one per
collection raises a toast naming the collection and the fix, and logs the
console line that says what to do. Nothing retries or works around it — the
rules have to be published.

`tests/sync.test.mjs` proves the rules FILE is right by writing to every
collection Continue Watching depends on. It cannot prove the deployment is.

## Opening a page by URL

Firebase resolves the signed-in account asynchronously, so any page reached
directly — a shared link, a refresh, "open in new tab" — renders before the
library exists. Everything computed from it at render time was therefore wrong
and stayed wrong: a film you had watched showed an empty tick, no rating, and no
rewatch history until you navigated away and back.

Pages now rebuild when the account arrives. The detail and collection pages track
which account their current render was built for and re-run it once that changes;
the router does the same for the curated, countdown, and reminder pages. Every
TMDB response behind them is already cached, so the correction costs a re-render
and no network, and it happens once, within a second of load.

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

Episode availability has one definition in `js/episode-times.js`: a confirmed
broadcaster timestamp wins, otherwise the TMDB date unlocks at local midnight,
and a missing date stays unavailable. Tracked shows refresh once a day and when
the app returns to the foreground, so a newly released episode reopens the queue
without requiring a detail-page visit. The tracker reports **Caught up**,
**Season completed**, and **Series completed** separately.

### What the tracker refuses to get wrong

Several defects were fixed together, and each has a named regression test:

- A season the show **dropped** in a re-numbering could push the watched count
  past the aired total and read as complete. Ticks in a season the structure no
  longer lists are still reported, but cannot satisfy completion on their own.
- A show whose structure had **never synced** could read as 100% finished. With no
  aired total there is no completion, only progress.
- TMDB's aired marker **lags real releases**, producing "11 of 10 aired". Every
  bulk action caps at the marker, so a tick beyond it can only be a deliberate
  single mark — the stronger signal — and the denominator rises to match.
- Un-ticking the last episode left `completedAt` stamped, so a show in progress
  kept reporting a finish date.
- **Up to here** was the one bulk action that did not cap at the aired marker, so
  it could mark episodes nobody could have watched yet.
- Every write **returned a success value while signed out**, so a tap painted a
  tick, toasted "marked watched", and saved nothing. They return `null` now, and
  the UI treats that as "nothing happened".
- A metadata refresh went through the whole-document writer, so opening a show
  could overwrite the episodes another device had just ticked. Structure and the
  aired marker are now merged on their own and never carry `seasons`.
- The per-episode log is capped at 400 rows per show, so a long-running series
  quietly lost its oldest entries and the chart under-reported. Every total still
  counts those episodes — only their place on the timeline is gone — and the
  chart now says how many are counted but not dated.

### Two devices, one show

The progress document used to be written whole. Two devices ticking different
episodes inside the debounce window each sent a complete copy, and the second one
silently erased the first one's tick.

Unioning the two watched sets is not a fix: a union cannot tell "this device has
not seen that tick yet" from "this device deliberately un-ticked it", so every
un-tick would come back from the dead. Each season therefore carries a second
set — `removed` — and every episode is in exactly one of three states: watched,
removed, or never touched. Writes go through a transaction that merges the
server's document with this device's edit:

| this device | the server | result |
|---|---|---|
| watched | never touched | watched |
| removed | never touched | removed |
| watched | watched | watched |
| removed | removed | removed |
| watched | removed | the more recently edited document wins |

Only the last row is a real conflict, and it needs two devices to disagree about
the *same* episode at the same time. Edits to different episodes never collide.
On an exact timestamp tie removal wins, which makes the merge symmetric and errs
toward the safer mistake: a tick you have to redo beats an episode reappearing
after you removed it.

Clearing a season or resetting a show records tombstones rather than deleting
anything, so those are intents that propagate too — a stale copy on another
device cannot re-create what you cleared. The cost is one document read per
debounced batch of ticks.

### Shows watched before episode tracking existed

They have a `watched` document and no progress document, so they would read as 0%
forever. A one-time background pass reconstructs the episodes that had really
aired on the date each show was *originally* marked; seasons released later are
never backdated. Failed lookups remain retryable. Settings also has a one-button
**Episode Progress Repair** that repeats that historical reconstruction and then
refreshes every tracked show's current shape.

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

## Top 10 This Week

Two charts — films and series — each a countdown rather than a grid with numbers
bolted on. The leader gets the space it earns (backdrop, poster, overview, and a
trailer fetched after paint) and the other nine read downward as a chart.

Movement is the half of a chart nobody can fake, and no free API publishes last
week's ranking. So CineVerse keeps its own: the ten ids and the week they were
seen, on the device, **per chart** — one shared record would have each chart
reporting movement against the other's ranking. A chip appears only when there is
a snapshot from a genuinely **earlier** week to compare against: never on a first
visit, never on a reload in the same week, and never invented. Direction is
carried by an arrow and a number as well as colour.

Recording this week's ranking destroys last week's, so the comparison is made
once per chart per page load and reused. Without that, anything that re-renders
the page would compare the chart against the copy it had just written and quietly
drop every chip — on exactly the visit they existed for.

## Recommendations

Each rail is headed by the thing it is about: a round photograph for a person, a
poster for a title, and the emoji glyph only where there is nothing to show — a
theme and a genre have no picture. The artwork costs no extra request; director
headshots and the top five cast profiles are already on the watched documents
from the metadata backfill.

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
npm run test:logic    # 430+ assertions, no dependencies and no Java
npm run coverage      # proves the rules suite is complete
npm install && npm run test:rules   # rules + two-device sync (needs a JDK)
npm run test:browser  # real clicks, reloads, account switches and offline retry
```

All of it runs on every push — `.github/workflows/tests.yml` — alongside a parse
check and an import-resolution check over all 62 modules. There is no build step
to catch a syntax error or a renamed export before Cloudflare would.

`tests/logic/` runs the real application modules against a small browser shim —
list locking, the episode ledger, CSV import, every stats figure, rewatch
counting, and collection completion. It needs nothing installed.
`episodes-integrity.test.mjs` is regression cover specifically: every block names
the wrong behaviour it exists to prevent, so a change that reintroduces one fails
with the reason attached rather than a bare assert.

`tests/browser/` drives the real detail tracker in Chromium through actual
delegated clicks. It covers the initial season, advancing next-episode action,
reload persistence, account isolation, offline reconciliation, and a newly
arrived episode. This suite is also a separate CI gate.

`tests/rules.test.mjs` loads the real `firestore.rules` into the Firestore
emulator and covers every `match` path: owner-only collections, the deliberately
shared `users/{uid}/shared/` surface, friend discovery, the friend graph, and
rewatch history, the sign-in cache counter, and default-deny for anything
undeclared. The emulator is a Java process, so this half needs a JDK on `PATH`
(on Windows, `JAVA_HOME` usually has to be set explicitly — see
`tests/README.md`). 33 tests, all passing.

`coverage.mjs` is the cheap half: it proves the suite is *complete* by checking
that every rule path is named in the tests, so adding a collection without a test
fails immediately. No Java needed.

`sync.test.mjs` runs two Firestore clients as one account against the same
emulator — a phone and a laptop — and asserts that everything Continue Watching
depends on converges: ticks made on both devices, an un-tick that a stale device
must not resurrect, an aired marker that can only move forward, a season that
grew, rewatch counts, and every star, hide, drag order and reset. It uses its own
project id, because the rules suite clears Firestore between its own tests and
Node runs the two files concurrently.

### Publishing the rules

**Firebase Console → Firestore Database → Rules →** paste `firestore.rules` **→ Publish.**

Sharing a list does not work until these are published: a friend has to be able to
read the owner's shared snapshot at `users/{uid}/shared/list_{listId}`. Raw
watchlist, ratings, watched, list, and episode-progress data stay owner-only — the
only cross-user readable documents are the derived ones under `users/{uid}/shared/`.

If a list action fails, the toast carries the Firestore error code (usually
`permission-denied`), which normally means the rules are not published yet.

## Continue Watching

The rail ordered itself strictly by what was watched most recently: a good
default and a bad rule. **Edit** turns on pinning, hiding, and reordering.

The rail lists **every** show in progress rather than an arbitrary first dozen —
a show cut off at position 13 is a show you never get back to. Episode stills are
fetched for what is on screen and the rest arrive as the rail is scrolled, so
length costs nothing until it is looked at.

Two lists do the editing — `pinned` (ordered ids that come first) and `hidden`
(ids the rail never shows). Moving a card *is* pinning it to that position, so
arbitrary ordering and "keep this at the front" are one concept rather than two;
unpin and a show returns to the automatic order in the right place. Hiding never
touches episode progress, and hidden shows are listed while editing so bringing
one back is a single tap. Both lists live on the profile document, which sign-in
already reads.

When you are one or two episodes from your own best day, the rail says so. It
counts single ticks only, like the record itself — a personal best you could set
by pressing "mark season watched" would be worth nothing.

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
caveat. The Activity Pulse reports repeat viewing beside new titles, because a
month spent rewatching otherwise reads as a month off.

### Television counts by season

Nobody restarts a sixty-episode run to see their favourite year again, so the
show-level count is the wrong unit for TV. A finished season's toolbar gains a
rewatch control and its own tally; an unfinished season does not have one, since
there is no such thing as a rewatch of something you have not watched. Un-ticking
an episode retires the count along with the completion it belonged to, and a
season rewatch adds no episodes and no rows to the episode log — it is a repeat,
not new viewing.

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

**`/franchises`** is where the whole picture lives. Every series in one place,
each expandable to its full running order with what you have seen marked, what a
finish would cost in hours, and — separately — which entries you *skipped* rather
than simply not reached yet. "You have three left" and "you skipped the third
one" are different problems and are reported as such.

Runtime is not on a TMDB collection payload, so a finish time can only be
estimated: it averages the entries in that series you have already watched, which
is the most relevant sample available, and it is always labelled approximate and
never shown with nothing to average.

Home carries a **Finish the Franchise** rail built from the same data, ranked by
what is actually finishable — a series one film from complete is a better
recommendation than anything the scorer can produce, because the interest is
already proven and the gap is a fact rather than an inference. A series you have
deliberately abandoned can be set aside from the rail; watch history alone can
never learn that, because not finishing something is exactly what "in progress"
looks like. Set-aside series stay counted on the Franchises page, so nothing
disappears.

Membership costs no extra request — `belongs_to_collection` is stamped onto
watched documents by the metadata backfill that already fetches runtime, credits,
and keywords. Collection lookups are cached on the device for a month, so a
repeat visit costs nothing at all.

### Television has no collections

TMDB publishes collections for film only. TV families are therefore derived from
titles — a show that declares its franchise before a colon or a dash — and the
interface says so plainly. The rule is deliberately strict (an explicit
separator, or a whole title matching a stem another show declared) because a
loose one would put *Love, Death & Robots* in a family with *Love Island* and
invent a franchise nobody is in. The denominator is what TMDB search returned for
that name, labelled **found**, never "exists"; a show you have demonstrably
watched counts as seen even when search fails to return it.

## Fewer reads on sign-in

Signing in read four whole library collections every time — on a large library, hundreds
of document reads to fetch data that had not changed since the last page load.

`js/library-cache.js` keeps a version counter on the profile document, which
sign-in already reads, so checking it is free. Every mutation increments it. The
page paints from a device cache immediately, then compares versions: equal means
nothing changed anywhere and the four reads are skipped, taking sign-in from
hundreds of reads to one. Episode progress is intentionally outside that version:
it always merges the device and server ledgers, so its correctness no longer
depends on a separate non-atomic counter update.

It cannot serve stale data. The local counter is only ever advanced by this
device's own increments, so it is always less than or equal to the server's — a
false *miss* is possible and harmless, while a false *hit* would require our count
to exceed the server's, which cannot happen. Three guards cover the rest: a failed
increment leaves a dirty flag that forces a full read until it lands, the cache
expires after seven days regardless, and a library too large for `localStorage`
falls back to reading rather than guessing.

Writers do not call into the cache directly. Every module that changes the
library already ends with `cv:wl-changed`, so the cache hooks that event — a write path added
later is covered by the convention it already follows.

## First-run onboarding

A new account used to land on a home page personalised from nothing. Three
questions fix that, and each has a real consequence: the region becomes the one
used for every provider lookup, and the chosen genres are folded into the taste
profile with a weight of 1.4 each — enough to decide the first session, and
outvoted within a dozen titles by actual viewing, which contributes 1.5 or more
apiece.

It appears once, for anyone with an empty library — including a visitor who has
not signed up, since that is exactly who is looking at the emptiest version of the
app. A guest's answers live on the device, steer recommendations and provider
lookups immediately, and are adopted by the first account created there, so nobody
answers the same three questions twice. The guest copy is dropped on adoption, so
a shared device cannot leak one person's answers into the next account signed in
on it. Skipping counts as answering, and whatever was chosen before the skip is
still kept.

## Voice search

`js/voice.js` owns the microphone. `SpeechRecognition.start()` runs synchronously
inside the click so user activation survives, and `getUserMedia` is used only to
recover from a permission or capture failure — awaiting it first is what broke
desktop capture before. A watchdog covers Chrome's silent-no-start failure, and
the waveform is driven by the recogniser's own sound/speech events rather than a
second capture stream.

Commands: search, open a title, play a trailer, add or remove from your lists,
mark watched, rate (pre-selected, never auto-saved), and jump to any page.
