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
romance, seduction, sensual). Turning it on lets adult results into search and
adds two things: the After Dark hub on Discover, and an **Adult** choice in every
genre filter. Artwork stays blurred until hover by default, and anything
you save can go straight into a PIN-locked list.

Every search and discover call passes `adultFlag()` rather than a literal, so
adult results cannot leak in while the toggle is off. The preference is announced
as `cv:mature` from `js/prefs.js` itself — on a toggle, a reset, or a value
arriving from another device — so no surface is left describing a setting that
no longer applies.

### After Dark

A hub rather than a grid: a spotlight (shuffleable), five rails that each answer a
different question (critically acclaimed, streaming tonight in your region,
erotic thrillers, series, world cinema), and a collection browser with tiles for
every keyword plus "All After Dark", a Movies/Series switch, order (popular,
acclaimed, newest, hidden gems), era, language, a streaming-now switch, a real
count, paging, and its choices in the URL. A rail with nothing in it — "streaming tonight" in a thin
region — is removed rather than left empty, and comes back when the region
changes. Selections survive leaving Discover and coming back.

### Adult is a genre

`js/mature-filter.js` is the one definition of adult, shared by every genre
filter in the app: TMDB's `adult` flag, or any of the mature keywords. It is not a
separate filter — it is a genre choice, offered only while mature content is on:

| Page | Genre dropdown | Exclude dropdown |
|---|---|---|
| Movies, TV, Discover Studio | **Adult · 18+** | **No Adult** |
| Search, My List, Watched, filmographies, studio pages | **Adult · 18+** and **Everything but adult**, grouped under *Mature* | — |

Filmographies and studio/network pages had no genre filter at all; they have one
now, so adult has somewhere to live. Choosing Adult as the genre wins over "No
Adult" in the exclude list — the pair would otherwise match nothing.

- **Pages that ask `/discover`** apply it as parameters. Verified against the live
  API: `with_keywords` joined with `|` is an OR, and `without_keywords` excludes a
  title carrying *any* listed keyword. Adult pairs the keywords with
  `include_adult=true`; No Adult pairs the exclusion with `include_adult=false`,
  because 1,528 softcore titles are flagged adult without that keyword mattering.
- **Pages that filter titles they already hold** classify them. Stored keywords
  settle most titles; the rest are looked up once (`/{type}/{id}/keywords`),
  remembered on the device, and shared between pages so two surfaces never fetch
  the same title twice. Saved documents keep only 15 keywords, so a full slice
  without a match is treated as *unknown*, never as proof. An unknown title is
  held back either way — showing it could put an adult title on a page that asked
  for none — and the page says how many are still being checked.

Every read goes through `adultFromGenre()`, which answers "no filter" while mature
content is off, so an adult value left in a control — or in a shared link — can
never keep filtering. A dropdown with an adult choice selected carries the After
Dark accent, and with artwork blur on, its results are blurred like After Dark.
Release Reminders has no adult genre: its calendar is built from English and Hindi
release schedules that exclude adult titles at the source.

### Mature viewing stays private

An audit found two leaks, both closed:

- **Friends could see it.** The friend-readable taste document
  (`users/{uid}/shared/taste`) carried `seen` — every watched title id — and
  `favTitles`, the first eight saved titles with posters, including titles inside
  PIN-locked lists. It is now built with mature titles excluded from genre
  weights, `seen`, and favourites, and favourites skip every PIN-protected list.
  This holds no matter what the owner allows for their own recommendations.
  Before writing, publishing classifies any title its stored keywords cannot
  settle, so an adult title is never published for being merely unknown; it
  republishes whenever a verdict is learned or a list gains or loses a PIN.
- **Home learned from it.** Watching an erotic thriller made "erotic" a top story
  theme, which queried TMDB for more, headed a "Because you enjoy…" rail, and
  could put "Because you viewed <that title>" on Home. Now mature titles add no
  genre, theme, cast, director, or seed weight; cannot head a rail; and any
  candidate that is adult-flagged, fetched by a mature keyword, or known adult on
  the device is dropped before ranking (the recommendation audit counts these as
  *Mature, kept private*). Watch-party picks are shown to the whole room, so they
  exclude mature titles unless every member allows them.

Opting in takes two switches: mature content on, and **Let mature titles shape
recommendations** (off by default). Friends are excluded either way.

`tests/logic/mature-filter.test.mjs` pins the parameters, the adult genre choices,
the classification rules (including the 15-keyword truncation), de-duplicated
lookups, failure handling, the Watched filter, and when `cv:mature` is announced.
`tests/logic/mature-privacy.test.mjs` pins every privacy rule above.

## Filters live in the URL

Movies, TV, and Discover kept their filters in the page alone, so a reload reset
them and a copied link opened the unfiltered page. `js/url-state.js` now moves
each page's controls to and from the query string:

```
/movies?genre=adult&sort=vote_average.desc&year=2016
/tv?genre=10765&format=4&provider=8
/discover?type=tv&genre=35&streaming=0&ad=207767&ad_sort=acclaimed
```

- Only non-default values are written, so an untouched page keeps a clean URL.
- The address is rewritten with `replaceState`, never pushed: changing a filter is
  not a navigation, and Back should leave the page rather than undo a dropdown.
- A URL naming **any** of a page's filters decides **all** of them, so a shared link
  shows exactly what was shared. A URL naming none leaves the controls alone,
  which is what keeps filters across in-app visits.
- A value no option matches — an old link, or an adult genre while mature content
  is off — falls back to the default instead of selecting nothing.
- The streaming-provider list loads per region, so a provider in a link is applied
  once that list exists, before the first results are fetched.
- Discover's Studio rebuilds its collection from a link; arriving back at an
  identical, already-built collection does not refetch it. After Dark's browser
  keeps its own `ad_`-prefixed params beside the Studio's and drops them when
  mature content is switched off.

Movies and TV also gained a request guard: a slow response for an older filter can
no longer land after a newer one and paint results for choices no longer selected.

### Filters fold away

Every filter bar starts folded to a single **Filters** button, so a page opens on
its titles rather than on a wall of dropdowns. `js/filter-fold.js` covers Movies,
TV, My Lists, Watched (including its *More filters* panel), Releases, Discover's
Studio, search, notifications, Box Office, Franchises, studio and network pages,
person pages and After Dark.

- What you reach for every time stays out: search boxes, Watched's *Surprise me*,
  release preferences, Discover's *Show my matches*, the notification actions, the
  franchise watch-order switch and a person's credit count.
- The button counts the filters that are set and, while folded, names them
  ("Filters 2 · Animation · Top rated"), so a link that arrives with filters in its
  URL still says what is applied. A sort away from its default counts too.
- A bar you open stays open for the rest of the visit, including after the page
  redraws it. Opening it lets the controls fall into place one after another, the
  slider knobs on the button trade places and the count bumps when it changes.
- The bars are drawn by many modules, several of them on every repaint, so nothing
  changes at the source: a registry names each bar and what stays visible, and a
  mutation pass enhances a bar whenever it, or its button, is new. What counts as
  set compares each control with its markup default; a bar rebuilt from state,
  whose `selected` attributes follow the current value, compares with its first
  option instead.

## Hover previews

Every rail opens the same 409px panel (the size the Top 10 cards always had), after
the pointer rests on a poster for **1.5 seconds** — long enough that sweeping
across a rail, or pausing on the way to a poster's + button, never fires one.

The age certificate on the panel, and on the detail page, is the one for your
chosen streaming region (`certificationFor` in `js/config.js`), falling back to
the US only when TMDB has none for that region. The preview used to read the
browser's language — `en-US` on a laptop in India showed the US rating — and the
detail page was hard-wired to the US and read only the first release entry, which
is often blank. Changing region clears the preview cache.

## Discover type scale

Measured in the browser, Discover's supporting text rendered at 7.7-10.4px. It now
follows one scale by role (the Discover block in `css/refinements.css`): uppercase
captions 11.5px, buttons, pills and meta 13px, select values 13.8px, descriptions
14.4px. After Dark follows the same scale. Nothing on the page renders below 11px.

Settings and Stats had the same problem (7.5-9px captions). Rather than restyle
hundreds of selectors by hand, `tests/tools/type-scale.mjs` reads every stylesheet
in the order `index.html` loads them, finds each font-size rule for a class that
Settings or Stats actually renders, and writes `css/type-scale.css`: the same
rules, scoped to those pages and in the same order, with anything under 13.5px
lifted onto an 11-14px ramp. Re-run it after adding CSS to either page.

## Light theme

**Profile menu → Light theme**, or **Settings → Theme** (Dark, Light, Match
device). The choice is stored with the other experience preferences and syncs to
your account.

CineVerse was designed dark: roughly 550 KB of CSS with over a thousand
hand-picked colours beyond the tokens in `css/variables.css`. A forked light
stylesheet would drift from the dark one on the first commit. Instead
`js/theme.js` **compiles** the light theme from the live stylesheets:

- For every rule in every same-origin sheet, it copies only the colour-bearing
  declarations into a new rule with the same selector, inside the same
  `@media`/`@supports` wrappers, in the same order.
- Each colour is rewritten in OKLCH. Neutrals flip lightness along a tuned curve
  (near-black surfaces become warm stone, near-white ink becomes charcoal) and
  keep their hue. Saturated accents keep their colour and are only deepened where
  they were too bright to read on paper. Type is deepened more than fills, so a
  pale cyan figure still clears contrast. Dark shadows stay dark and soften.
- It knows three situations a formula would get wrong. White ink on a saturated
  fill (the red button) is kept. A near-white plate with no ink of its own (a
  studio logo card, a QR code, a switch knob) stays white. Cards whose copy sits
  directly on a photograph (the Discover spotlight, the franchise banner, list
  covers) stay dark "islands".

The cascade still resolves correctly because every colour declaration is copied,
changed or not, with identical specificity and order, after all the originals.
So among colour properties the copies alone decide the winner, exactly as the
originals did. Switching back to dark disables the compiled sheet.
`css/light.css` holds what no formula can know: the hand-tuned palette, nav
glass, the hero and backdrop washes, and the dark-island tokens.

**Not white.** The first light palette sat at near-white with white cards, and it
glared on a site that is mostly artwork. The page is now warm stone (`#e6e2da`),
cards step up a shade rather than to white, and the compiler's lightness curve
tops out at the same stone. Every ink token was measured: text 13.4:1, secondary
7.4:1, tertiary 5.6:1 on the page and 5.0:1 on cards, accents above 4.5:1.

`js/theme.js` is a classic script in `<head>`, placed after the stylesheets, so
it runs before first paint: a light reader never sees a dark flash. The compile
takes about 65 ms on a desktop and happens only for light readers.

Two details matter on paper that the dark theme hid:

- **Title logos.** Most TMDB logos are white lettering. `js/logo-tone.js` samples
  each logo once (a tiny canvas read of a CORS copy) and tags it: white logos
  become ink, and white type beside a colourful mark has its lightness inverted
  with the hue kept, so The Dark Knight's bat stays blue.
- **The film comes first.** The hero and title-page washes used to fog most of the
  trailer. They now cover only what text needs: an oval behind the copy at the
  bottom left, a short band under the navigation, and a fade into the page at the
  very bottom (a stronger bottom fade on phones, where the copy spans the width).
  Scope films carry black bars inside a 16:9 video, so the hero trailer is zoomed
  1.28x to push them out of frame rather than hide them under paper.

The switch itself: going light, the paper page opens as a circle from the switch
with a warm bloom that lingers; going dark, it closes back into the switch. Both
use the View Transitions API, so the page swaps once under a snapshot instead of
every element animating its colours. Browsers without it get a circular wipe, and
reduced motion switches instantly.

**On phones** the switch used to take one and a half to two seconds to start
(measured with the CPU slowed 4×): the light theme was compiled on the first
switch, glass rebuilt a copy of every background, and every home section, on
screen or not, was restyled under the snapshot. Now the light theme is compiled
ahead of time while the browser is idle (or at the first touch of the profile
menu or a theme switch), glass edits rules in place, and off-screen home sections
skip rendering until they are near (`content-visibility: auto`). On the same
slowed phone the circle starts in about half a second.

## Detail pages, your way

**Settings → Detail pages → What appears** has a switch for every part of a
title's page, grouped as Title header, Actions, Panels, Facts and Sections, down
to a single fact card (vote count, original title, spoken languages…). Each group
has Hide all / Show all, and one button shows everything again.

`js/detail-parts.js` is the single catalogue. Settings draws its switches from
it, `js/prefs.js` cleans stored choices against it, and the detail template tags
each element with `data-dp="<key>"`. Hidden parts become one generated rule, so
an open title page changes the instant a switch is flipped. Hiding is presentation
only: nothing is fetched differently and switching a part back on loses nothing.
The choice syncs with your other preferences.

## Clean and minimal

`css/minimal.css` loads after every other sheet except the light theme's hand-tuned
layer, and quiets the site without removing a feature or an animation:

- **Kickers**, the small capitals above a heading, are one muted ink everywhere
  instead of a different colour per panel.
- **Heroes** on Stats, Settings, Profile, Notifications, Releases, Discover, Box
  Office, Franchises and Your Year share one neutral surface with a single faint
  accent in a corner (sky blue on Box Office, gold on Franchises, red elsewhere).
- **Panels** on Stats, Profile, Settings and Discover's Studio share one flat
  surface. The tinted glows each panel painted in its own colour and the large
  drop shadows are gone; a hairline border separates them.
- **Tiles** lose their corner glows. Profile's stat icons and numbers are plain
  ink, and the header links beside Your Cineprint are neutral pills.
- **Home** section icons and recommendation-rail glyphs sit on the heading without
  a box.
- **Everywhere else** the same goes for the kickers on My Lists, Profile's
  panels, Discover's results and Surprise, notifications and their preferences,
  title-page sections, people, import, PIN and share dialogs. Status badges, the
  Danger zone and labels printed over artwork keep their colour.

Its selectors repeat a class (`.stats-panel.stats-panel`) to outrank the
single-class variant rules they replace without ids, so the glass layer still
finds every panel and the light compile pairs each rule with its own light copy.

## Cinema glass

With **Settings → Glass effects** on *Rich cinema glass* (the default), the site
sits on a softly lit stage (red, violet, cyan and a little amber, deeply
blurred) and its surfaces are glass over it, in both themes:

- **Panels** let that light through, carry a faint lit top edge, and pick up a
  sheen: a soft diagonal band that travels across each panel as it scrolls past.
- **Menus and dialogs** (the profile menu, the notification popover, the rating,
  sign-in and share dialogs) are frosted: translucent, with the page behind them
  blurred.
- Accents, tints and images stay exactly as designed.

Settings shows both choices as **live previews**: a tiny lit stage with a panel
over it, the rich one drifting and catching its sheen, the quiet one flat. They
form a radio group, so the arrow keys move the choice.

### Settings you can see

The glass picker is no longer the only preview in Settings (`js/settings.js`):

- **Theme, Content density, Text size and Interface motion** are rows of live
  previews too: a miniature page in cinema dark, in paper light, and split
  diagonally for Match device; three roomy posters against five compact ones; a
  standard and a large "Aa"; and a poster that floats, swoops with a motion trail,
  or holds still. Each row is a radio group. Picking a theme plays the same circular
  switch as the profile menu.
- **Switches that change a look carry a drawing** that follows the switch: the
  lights drift for Moving lights, a toast slides up for Cast and Streak milestones,
  a poster glows in its colour for Title colour, lines brighten for High-contrast
  type, the navigation bar shrinks for Compact navigation, captions vanish for Hide
  titles, badges fall away for Clean posters, a poster opens into a landscape
  trailer for Hover previews, an equaliser plays for Ambient hero previews, a poster
  tilts for Poster depth, a phone buzzes for Haptics, and lines blur for Spoiler
  shield. The drawing is CSS keyed to the switch's state, so it changes the instant
  the switch does.
- **Poster controls starts with one live poster** carrying every badge the
  switches allow: the streaming logo, match badge, your rating and the watched tick
  stacked the way real posters stack them, the community rating, Not interested,
  quick rating and Add to list. Turn a switch off and that badge leaves, with the
  ones below moving up; Clean posters empties it and Hide titles drops the caption.
- A preference changed anywhere else while Settings is open (the profile menu's
  theme switch, another device) moves the matching preview.
- The theme previews keep their own palettes in either theme: they are redeclared
  in `css/light.css`, so the light compiler never turns the dark preview light.

### Finding your way around Settings

- **Search.** A search field at the top filters Settings as you type: a row stays
  when its name and description contain every word, a section whose heading matches
  keeps all its rows, and the matched words are highlighted. A match inside the
  closed Maturity disclosure opens it (and closes it again when the search moves on).
  Enter scrolls to the first match with a gold pulse; Escape clears. With nothing
  found, a searching magnifier suggests other words.
- **Jump bar.** Beside the search, a chip for every section scrolls to it and
  follows along as you scroll. A gold dot on a chip means something in that section
  differs from its default. The bar stays in view while you scroll.
- **Section heads.** Every section opens with its own animated picture (a palette
  for Appearance, a poster whose badges pop for Poster controls, a projector, a
  compass, a shield for Maturity, stacked cards for the title-page sections, a
  padlock for Privacy, a globe for Region, a vault for Backup, gears for
  Maintenance) and one line on what it covers.
- **Reset this section.** Sections that hold preferences have a Reset button
  beside the heading, with a count of what differs from the defaults. It returns
  only that section; a theme change plays the usual circular switch. At the
  defaults it reads "Defaults" and is disabled.
- **Changed from default.** A gold dot beside a setting's name marks one you have
  changed, explained by a small legend in the toolbar.
- **Privacy at a glance.** Above the privacy switches, "Friends can see" lists your
  name in search, your hours-club badges and your taste summary, each ticked or
  crossed out and locked as its switch changes, beside what is never shared.
- **Backup in three steps.** Download, keep it safe, restore (which merges and never
  deletes newer records), drawn as three linked cards.
- **Region.** The chosen country is shown as a code badge and its name, and follows
  the picker. **The globe turns to it:** each region has a rough longitude, so the
  land starts where the old region stood and slides the short way round (east for
  India to Japan, across the date line for New Zealand to the US), taking longer the
  further it goes, before the pin lands.
- **Recently changed.** A strip under the search lists the last three settings you
  changed on this device, newest first: the setting, what it was and what it is now
  ("Content density: Comfortable → Compact · 2 min ago"). **Show** opens its section
  and scrolls the setting into view with a pulse; **Undo** puts back what it was (a
  theme plays its circular switch). Changing the same setting again replaces its
  entry. A section reset, or the full reset under Maintenance, is one entry that
  undoes as one. Changes that arrive from another device are not listed, and an
  undo does not add an entry.
- **Section previews.** Resting the pointer on a chip in the jump bar (or reaching it
  with the keyboard) shows a small card with that section's animated picture, its
  one line and how many of its settings you have changed. Scrolling hides it.
- **Sections fold on phones.** On a narrow screen every section starts folded to its
  heading, its picture, name, one line and Reset, so Settings reads as a short list.
  Tap a heading (or its chevron) to open it; which are open is remembered. Search,
  the jump bar and Show open what they need.
- **Scenes that answer here too.** The vault door swings open, glowing, with the file
  inside, once a backup (or the watched-only export) has been handed to the browser,
  and closes again. Turning a privacy switch off snaps the padlock shut with a flash.

How it works (`js/glass.js`): the panels are styled in hundreds of rules, and
the light theme is compiled from those same rules, so glass edits the matching
rules **in place** through the CSSOM instead of adding a stylesheet:

- Only rules whose subject (the last compound of the selector) is a panel or a
  dialog change, and in them only near-opaque **neutral** surface colours. Theme
  tokens such as `var(--bg2)` are resolved against the palette the rule applies
  in.
- A selector list that mixes panels with other elements is split, so the other
  elements keep exactly what they had.
- Editing in place adds no rules, so specificity, order and media queries resolve
  as written, and a theme switch costs no more style work than it would without
  glass. (The first version copied every background declaration into a ~90 KB
  sheet, which made each theme switch restyle the page twice.)
- Every edit is logged, and undone for *Quiet and focused* and around the light
  theme compile, which must read the stylesheets as written.
- The sheen is one extra top background layer, positioned by a `--glass-sheen`
  value that is updated only for panels on screen, at most once per frame while
  scrolling. Reduced motion and quiet glass stop it.
- With a mouse, a panel also catches a soft **pointer light** where the cursor
  is: one more top layer, a wide faint circle at `--spot-x`/`--spot-y`. Panels
  whose own rule is only a tinted gradient get the sheen and the light too.
  `--spot-x`, `--spot-y` and `--glass-sheen` are registered as non-inheriting
  properties, so moving them restyles the panel and not everything inside it.
- The top and bottom navigation are deeper glass (more see-through, blurred and
  saturated), and glass and primary buttons carry a lit top edge.
- **Undo is exact.** A rule written with the `background` shorthand reports a
  colour-only layer as `initial` in every layer list, and a list containing
  `initial` cannot be written back, so the browser silently ignored the undo and
  glass layers stayed on under *Quiet and focused*. Every value glass writes or
  restores now has those entries replaced with the property's initial value.
- A test page-walk compares every element's background with glass on and off
  across sixteen pages in both themes. The only differences allowed are
  transparency on surfaces, the sheen and pointer-light layers and the lit edge.

### Moving lights

The stage's lights drift slowly toward where you tap or click and lean the way
you scroll, then settle back (`js/stage.js`). The drift is two CSS variables,
eased toward a target on each frame while the lights move and left alone at rest.
The lights read them through `translate`, so the drift combines with their own
slow animation. **Settings → Moving lights** turns it off, and reduced motion
keeps the lights still.

## Scroll hints

On touch screens and narrow windows, every horizontal row fades on the edge that
has more to show: the right edge at the start, both edges in the middle, the
left at the end, none when everything fits (`js/scroll-hints.js`). The fade
widths are registered CSS properties, so it eases between states. Desktop rows
keep their arrows and no fade.

## Posters

**Badges never overlap.** A poster's top-left corner can hold the streaming badge,
a "% match" badge, your rating and the watched tick. They form one stack: each
takes the next slot below whatever is above it, from slot heights set once per
size. The phone home rows use smaller badges, and their own position rules had put
the watched tick straight on top of your rating; they now set smaller slot heights
instead. Every combination is checked on phone and desktop.

**Settings → Poster controls → Hide titles under posters** removes the title,
year and type line from every poster on the site. It is off by default and syncs
to your account.

Posters on Home, Movies and TV are larger and further apart: 218px wide on
desktop Home rails (was 188px) with 30px between them, and a 190px minimum column
on the Movies and TV grids (was 145px) with 30px gaps. Tablets and phones get 120-152px rail
posters and two roomy columns. Compact density keeps a tighter version of the same
rhythm, and Top 10 and wide cards keep their own proportions.

## Title page poster

The title row is a flex row, so the poster card stretched to the height of the
copy beside it. With a rewatch strip under the buttons, a blank band hung below
the artwork. On desktop the card now keeps the height of its own poster.

## Page transitions

Opening a title morphs what you pressed into the title page (`js/transitions.js`,
driven by `js/router.js`): a poster flies into the page's poster, a backdrop
(the home hero, a Continue Watching still, a hover preview) into the banner, and a
title logo (the hero's, a preview's, a "Because you liked …" rail heading's, which
is now a link) into the page's logo. Back runs the same morph onto the card you
came from when it is on screen, and returns you to where you were scrolled.

- Only artwork visible on screen is named, and each source is trimmed with a
  `clip-path` to the part its row or hero frame shows, so nothing flies in from
  outside the screen.
- Names come off the sources inside the transition callback, after the old page
  was snapshotted, so a name is never held twice.
- The title page paints the pressed artwork at once, and swaps in the full page
  only after the morph finishes; the full-size poster and banner load over the
  smaller copy already on screen, so nothing blinks.
- The new page is scrolled into place inside the swap, with smooth scrolling
  switched off for that moment. Scroll positions are kept in history state and
  restored on Back and Forward.
- Pages fade through (out in 200ms, in over 420ms); artwork glides for 580ms on a
  long deceleration. Reduced motion skips all of it.

Two bugs surfaced on the way. On phones every page transition from a title page
was aborted, because the title glow widened the document; it is clipped now. And
the hover preview closed itself on the click that opened a title, before the
morph could read it.

## Poster placeholders

Loading posters are shaped like the artwork they are waiting for
(`cardArt` in `js/cards.js`): the tile takes the poster's own colour when this
device has sampled it, a 92px copy blurs in almost at once, and the full poster
fades in over it once loaded.

## Title colour

A title page takes a colour from its poster (`js/ambient.js`): the glow behind
the header, the primary button, the progress bars. The colour is chosen by hue
weighted by vividness, so a flame's orange beats a large brown background; a
colourless poster keeps the site's red. It is fitted in OKLCH so white text on the
button clears 4.5:1. **Settings → Appearance → Title colour** turns it off.

The glow is a box centred on the poster whose gradient reaches transparent at
its own edges, so it can never end in a visible line.

The trailer behind a title (and behind the home hero) plays in a 16:9 frame that
covers the banner. The banner is capped at 60% of the screen height, so on a
wide window its box is far wider than 16:9, and a YouTube embed letterboxes
inside whatever box it gets: it used to play as a narrow strip with dark sides.

## Layout audit

Every main page was measured at 1920, 1440, 1024, 768, 390 and 360px for
horizontal overflow, elements escaping the screen, overlapping siblings in grids
and flex rows, and cut-off select and search text. What it found and fixed:

- **Profile:** the dashboard's main column is a grid with no column template, so
  its track grew to the Completed series row and pushed every panel under the
  sidebar. It is now a 0-minimum track.
- **Continue Watching (phones):** the Edit button grew into the row and squeezed
  the heading onto two lines.
- **Filter rows (phones):** selects took equal shares whatever their longest
  option, cutting off "Worldwide gross", "Recently watched" and "Any metadata
  quality", and crushing the Releases search field. Controls now take the width
  their content needs and wrap. Person-page filters stack two to a row, with the
  label above.
- **Collection pages:** the title sat under the fixed Back button.
- **Stats provider chart (≤768px):** the date row overlapped the line.
- **Discover rows (360px):** the edge bleed overshot the gutter by 2px.
- **Completed series cards:** a two-line finish date misaligned a card's buttons.

The overlaps that remain are deliberate: stacked provider logos, Top 10 numerals
behind posters, the award logo stack and the profile's poster wall.

## Icons

Every emoji and text symbol in the interface is a drawn SVG from `js/icons.js`:
one 24px grid, 1.75 stroke, soft duotone fills, sized to the text around it.
Lists saved with an emoji icon still show the matching drawn icon.

## Illustrations

Thirty-two animated scenes drawn as inline SVG (`js/illustrations.js`) stand in
wherever a page has nothing else to show, and in a few places that deserve one:

| Scene | Where |
|---|---|
| Admission ticket with a travelling shine | Every sign-in prompt: lists, watched, friends, watch party, profile, settings, franchises, shared lists |
| Magnifying glass sweeping a film strip | Searches, filters and shared lists with no matches |
| Plug and socket with a spark | Failed loads: franchises, box office, release calendar, Discover moods, shared lists |
| Chart whose bars grow and line draws | Stats before sign-in |
| Bell swinging with sound rings | Release reminders with nothing to show; notifications before sign-in |
| Trophy with a glint and orbiting stars | Franchises with nothing to show |
| Two friends and a beating heart | Friends, before the first friend |
| Sofa, glowing screen and confetti | Watch party, before the first friend |
| Compass hunting for north | Discover's surprise pick when none is found |
| Popcorn, projector, retro TV, clapperboard | Empty lists, empty watched history, empty inbox, Your Year's empty cards |
| Desk calendar, reel-and-TV orbit | The monthly recap, the Your Year hero |
| Meshing gears | The Settings hero |
| Radar sweep with blips that flare as the beam passes | The notification centre's hero and its loading screen |
| Coins stacked beside a rising line | The Box Office hero |
| A CSV rising into a cloud with a filling progress bar | The import dialog's drop zone |
| Padlock whose shackle lifts as its PIN dots light | The PIN dialog for private lists |
| Compass, rocket climbing through streaking stars, stage with spotlights | Onboarding: the region step, the genre step and the last step |
| Hourglass that drains and turns over | Loading: Hours clubs, Cast milestones, director and actor completion, franchises |
| Palette, badge-popping poster, shield, stacked cards, padlock, globe, vault, gears | The heads of the Settings sections |
| Mailbox raising its flag as a letter drops in | The notification popover with nothing in it |
| Phone reading a QR code | The friend QR scanner, behind the camera until it starts (and if it cannot) |
| Comedy and tragedy masks | A person's credits when a filter leaves none |
| Stage with swaying curtains and crossing spotlights | A shared list with nothing on it yet |
| Retro TV, projector | Stats' empty TV Tracker and Rewatches panels |

**Scenes that answer what happens:**

- **Radar by category.** The notification radar shows a blip for each category with
  unread items, in that category's colour (Episodes violet, Releases gold, Streaming
  green, Departures orange, Recaps pink, History cyan), at its own bearing and larger
  the more there are. Each flares as the sweep passes it. A key under the hero spells
  the colours out with counts, and each entry filters the inbox to that category.
- **Radar arrivals.** Unread notifications this visit has not seen before are
  arrivals. When they land (opening the inbox with new items, a refresh that brings
  more, a monthly recap appearing) the blips of their categories flare in turn, a ring
  ripples out from the centre and the count bumps. The radar is carried across the
  inbox's redraws, with fresh blips when the counts change; a blip drawn later is
  given the delay that keeps it in step with the sweep.
- **The mailbox flag goes up.** The notification popover's heading carries a small
  mailbox. When something arrives while the popover is open, a letter drops in and
  the flag rises, then lowers a few seconds later. The mailbox is carried across the
  popover's repaints.
- **Coins rise.** The Box Office coins rest as a stack and drop in one by one, with
  their line redrawing, when you switch between Movies, Franchises and Directors or
  change the sort. The page repaints its shell on every search keystroke and page of
  results, and the coins are carried across, so typing never replays them.
- **The hourglass turns over at three seconds.** Its sand runs out in three seconds
  and the glass turns, so a load that passes three seconds is marked by the turn, and
  a line such as "Still working. Collections are read from TMDB the first time."
  fades in under the loader at the same moment. Its turn once shared an animation
  name with the desk calendar's page flip and overrode it; each has its own now.
- **Launch on Continue.** In onboarding, Continue on the genre step sends the rocket
  off-screen (flame flaring, smoke bursting) before the last step, and on the region
  step spins the compass needle. Reduced motion moves on at once.

**The ticket tears.** On a sign-in prompt, tapping **Sign in** tears the ticket's stub
away along its perforation (with a few paper flecks) before the sign-in dialog
opens, and the ticket mends itself a moment later. The ticket is drawn twice,
clipped either side of one ragged line down the perforation, so the halves meet
exactly until they part. Reduced motion opens the dialog straight away.

They animate with CSS (transforms and opacity, plus a few dashed strokes that march
or draw), stay sharp at any size, cost no requests, and give every copy its own
gradient ids so two on one page never clash. Reduced motion holds each one on a
composed frame.

## Haptics

With **Settings → Mobile haptics** on, a phone answers you with a small
vocabulary of buzzes (`js/haptics.js`). Each has a weight, so the "saved" that
follows a press in the same instant replaces the press's tap instead of being
swallowed by it.

| Buzz | When |
|---|---|
| Detent (the lightest) | each poster that passes as you swipe a row; each section heading that passes the middle of the screen as you scroll; each star as you slide a finger along the rating stars; each place a dragged Continue Watching card would land |
| Edge | swiping into either end of a row; scrolling to the very top or bottom of a page |
| Tap | any other button or link |
| Select | navigation, tabs, filters and sorts, switches and chips, the Filters button, choosing a star |
| Tick / untick | an episode, a season, "up to here", marking a title watched (from the outcome: a refused tick gives none) |
| Pin | pinning or hiding in Continue Watching; picking a card up to reorder it |
| Drop | letting a reordered card go somewhere new |
| Swipe | swiping the hero to the next slide |
| Land | the ticket stub arriving in My List |
| Notify | new notifications arriving while the inbox or the popover is open |
| Success | saving, sharing, copying, exporting, importing, restoring, rating, marking all read, a finished season, a success message |
| Warning | deleting, removing, clearing, resetting, dismissing, dropping, leaving, signing out, an error message |
| Celebrate | badges, a rating's confetti, cast and streak milestones, a finished series, the Watch Party's first pick |

- Actions are matched by whole words, so *Discover presets* select rather than
  warn, and the Watched page's filters select rather than succeed.
- Scroll detents only follow a finger that moved. A row scrolled by its arrows or
  the keyboard, and the smooth scroll a tap starts (Back to top, a jump link),
  stay silent; a flick keeps its detents while it coasts.
- A success message right after a press that already buzzed stays quiet.
- iPhones, which have no Vibration API, get the system's selection tap through a
  hidden native switch. That only works inside a press, so scroll detents and
  late messages are felt on Android only.

## Feel

`css/feel.css` with `js/scroll-feel.js`, `js/ticket-stub.js`, `js/continue-lift.js`
and `js/sticky-bars.js`:

- **Posters lean with the scroll.** Scroll a row sideways and its posters (and
  Continue Watching cards) lean against the motion, further the faster you go (up
  to 9°), then settle upright once the row stops. The lean is eased so one uneven
  frame does not jerk it, and the wait before settling stretches when frames are
  arriving slowly, so a busy phone does not flicker. It follows **Poster depth
  effect** in Settings and never runs under reduced motion.
- **A ticket stub for every title you watch.** Marking a title watched (from a
  title page or a hover preview) tears a small red ticket stub off its
  poster and sends it along an arc into My List, in the bar at the bottom of a
  phone or across the top of a desktop (your avatar otherwise). The tab bounces,
  a "+1" rises from it and a phone gives a light landing tap. Like the tick, it
  answers the press rather than waiting for the server to confirm the save.
- **Continue Watching lifts.** With a mouse, a card's artwork lifts toward you
  and leans after the pointer, a soft light follows the pointer across it, and a
  show's card crossfades from the show's artwork to the still of the episode you
  are about to watch, tagged *Next episode*. On a phone the still simply takes the
  card's place, as before. A show without artwork of its own, or whose artwork
  fails to load, shows the still.
- **Scenes on small screens.** Box Office's coins, the notification radar and
  Settings' gears used to be hidden on phones. The coins now sit beside the Box
  Office title, and the radar and the gears sit above their page's title.
- **Sticky bars close the gap.** Stats' section index, the Settings toolbar,
  Discover's jump bar, the notification toolbar and the Box Office and Franchises
  toolbars stick a few pixels under the navigation, and the page used to show
  through those pixels as it scrolled. While a bar is stuck, a shelf fills the gap.

## Season heatmap

A TV title page has a **Season heatmap** under its seasons (`js/season-heatmap.js`):
a row per season, a square per episode, and a tick on each episode you have seen.

- **Two colourings.** *Rating* uses TMDB's rating in fixed bands (under 6, 6, 7,
  7.5, 8, 8.5, 9+) on a gradient from red through amber and yellow to green.
  *Standouts* compares each episode with its own season's average: red below,
  grey within 0.2, green above, in symmetric steps of 0.2, 0.5 and 1 point. So a
  strong episode in a weak season still stands out. Each step was chosen in OKLCH
  so the tick drawn on it keeps at least 4:1 contrast, in both themes. The choice
  is remembered.
- **Readout.** Hovering, focusing or tapping a square shows its still, air date,
  runtime, rating and votes, how it compares with its season, and when you
  watched it, with an Open button.
- **Rows** end with a sparkline of the season's ratings and its average; the
  strongest season (three or more rated episodes) is marked.
- **Insights:** the peak episode, how many of the show's best episodes you have
  seen, and up to three of the best aired episodes you have not.
- **First open:** the squares light up in the order you watched them, each tick
  drawing itself as its square arrives. Episodes marked before the log began come
  first.
- **Keyboard:** the grid is one tab stop; arrows move, Home and End jump along a
  season, Enter opens. On touch the first tap shows the readout, the second opens.
- **Fit:** short seasons get larger squares, and on a phone squares shrink so a
  season stays on one line.

Unrated episodes are hatched, unaired ones outlined, and "best" needs five votes.
Every square's label carries its numbers, so colour is never the only signal.
It loads only when opened and can be hidden under **Settings → Detail pages**.

## Ticks that draw themselves

A tick you have just made strokes in, short arm first, on the episode button,
the watched overlay on its still, and the heatmap.

## Rail shadows

A horizontal scroller clips in both directions, so a poster's hover lift and
shadow were cut off at the rail's edges, most visibly with titles under posters
hidden. Home rails have room above and below, taken back with negative margins so
nothing moves, and the scroll arrows stay centred on the posters.

## Hero

After four seconds, the home, Movies and TV heroes collapse to the title logo
alone. Badge, meta, genres, description and buttons fold away. Hovering, focusing
or tapping the hero brings them back, and the timer restarts when you leave.
Reduced motion keeps everything visible.

### Home entrances

- Section headings wipe in from the left as their row arrives, their icon (or the
  poster or face beside a recommendation rail) pops in and See All slides in with
  a small nudge of its arrow.
- Each poster eases back from a slight zoom while it fades up.
- The hero's caption (badge, title, meta, genres, description, buttons) rises
  again, in order, every time a slide becomes the active one, not only on the
  first.
- Continue Watching's progress bars fill once the row is in view, one card after
  another.

Reduced motion, from the system or from Settings, turns all of them off.

## Mobile navigation

Search sits in the middle of the bottom bar: Home, Movies, TV, **Search**,
Releases, My List, Series.

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
timestamps only when TVmaze publishes an airstamp with a real airtime, and
streaming uses `flatrate` (subscription) offers only — rent and buy are never
counted.

**Placeholder times are not exact times.** TVmaze stamps a release that has no
published time (most streaming drops) at 12:00 UTC. The title page, Release
Reminders and notifications used to show that as an exact local time: Silo's next
episode read "Fri, Jul 9, 5:30 PM · TVmaze" in India. `exactStamp` in
`js/episode-times.js` now accepts a stamp only when TVmaze also gives an airtime,
including stamps cached before the fix. Everything else counts down to TMDB's
date and says "Date confirmed". Episode availability uses the same rule.

The bell's unread pulse used to be a ring drawn inside the button, and it read as
a stray pink circle. The pulse now belongs to the red count badge, only for items
that need attention.

Items are scored and grouped by urgency (Needs attention / Today / Your monthly
recap / This week / Coming later / Recently detected), carry live countdowns inside
three days, and can be snoozed for 24 hours or dismissed. Desktop alerts are
optional, local, and fire only for urgent unread items (and the monthly recap on
the 1st) while the tab is in the background — there is no push server and no
subscription endpoint.

### Monthly recap

On the 1st of each month the inbox gains a card for the month before
(`js/monthly-recap.js`): the films you watched and the series you finished, the
time spent on films, your top-rated film, and a fan of up to four posters. It
opens that month on **Your Year**. It is worked out on the device each time the
inbox is scored and never cached, so it appears at midnight and always matches
your history, and it stays until the next month's recap replaces it. It can raise
a desktop alert on the 1st only. **Notification preferences → Monthly recap**
turns it off. Adult titles never appear.

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
the Watch Diary, then the TV Tracker, then Rating & Library, then the deeper taste and collection
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

### Completionist

The Director Loyalty panel is now **Completionist**, for directors and actors:
*"You've seen 8 of 12 Christopher Nolan films"*, a progress bar, and the films
you have not seen, best rated first. Every person page shows the same line for
that person. A film counts when it is released and has at least 50 TMDB votes, or
when you have seen it. Actors are measured on acting roles, leaving out
appearances as themselves and uncredited cameos. **Exclude shorts** and **Exclude
documentaries** apply on both pages, which share one loader so their numbers
always agree.

Person pages also list the **people they keep working with**, counted only over
films you have seen (`js/collaborations.js`):

- *"You've seen 6 films where Christopher Nolan directed Cillian Murphy"*: an
  actor's directors, or a director's actors (within the first twelve billed).
- *"… with Cillian Murphy and Tom Hardy together"*: co-stars, when both are within
  the first eight billed.

Roles come from each film's own credits. A link needs two films, someone who both
directed and co-starred appears once as director, and each link shows the films
it counts.

### Cast milestones

*"You've now watched 30 hours of Adam Scott"*, counted from TMDB episode credits
(`js/cast-hours.js`). A season's billed cast count for every episode of that
season you watched, and guest stars for their own episodes, using each episode's
runtime. Stats lists the people you have spent the most time with and the next
milestone for each. Person pages say how long you have watched that person, and a
toast marks each milestone (5, 10, 20, 30… hours) as a tick crosses it. Season
credits are kept on the device in IndexedDB. A milestone is announced only when
every watched season is known and more episodes have been watched, so a refreshed
runtime or an un-tick never triggers one. **Settings → Cast milestones** turns the
toast off.

**Streak milestones** use the same toast, with a flame in the gauge: 7, 30 and 100
days in a row with something watched (`js/streak-milestones.js`). A milestone
belongs to the day it is reached: it is announced only when your streak, counted the
Watch Diary's way (viewing only, never bulk marks), is exactly that long and includes
today, and only once per streak on a device. So a streak that passed 30 weeks ago
never announces 30, a second episode that evening does not repeat it, and a new
streak can earn each one again. It is checked after your own ticks and watched
marks, not after a sync. **Settings → Streak milestones** turns it off.

**Hours clubs** are the badges: 10, 25, 50, 100, 250, 500 and 1,000 hours with one
person. Your profile shows them as rings with progress to the next club. The
first time a badge appears on a device its ring fills like a gauge and the club
number rolls up like an odometer, each digit spinning a full turn before it
settles. After that it rests, finished. The milestone toast always rolls. A
title page's cast list marks everyone you are in a club with (a chip in the
club's colour under their photo), from credits the device already holds. Friends see them under your name on their Friends page. They are
published to `users/{uid}/shared/milestones`, the same friend-readable surface as
the taste profile, so no new security rule was needed.

- Only the person, the club and whole hours rounded down to ten are shared,
  never which shows or episodes.
- Shows classified as adult never count toward a published badge.
- Badges are published only from a complete count: a device that has not read
  every season's credits yet cannot overwrite them with fewer.
- Nothing is written when the badges have not changed.
- A friend's badges are read at most once every ten minutes.
- **Settings → Share hours clubs** stops sharing and deletes the document.

Anyone can be **removed** from your clubs with the × on their badge (always
visible on touch). The next person with the most time moves up into the twelve
shown, and the panel lists everyone removed, each with their photo, club and
hours and their own **Restore** button (plus **Restore all** when there are
several). The list starts folded to one line, the removed people's faces and a
count, and opens with a tap; it stays as you left it while you move around. The choice
is saved with your preferences and syncs across devices. A removed person also
leaves what friends see, the cast-list chips on title pages, and milestone
toasts.

### Watch Diary

Daily and monthly viewing, drawn from data the library already holds, so it
needs no request:

- **Month calendar.** Each day is shaded by minutes watched (one hue, darker is
  more) and carries a small fan of that day's posters.
- **Day reel.** A 24-hour ribbon places every film and episode at the time you
  marked it, with the same items as a list beneath.
- **TV this month.** Episodes, TV time, shows, days with TV, and binge days
  (three or more episodes) for the month in view. Every show you watched is
  listed with its episode span ("S1 E8 – S2 E2"), episodes, days and time, ranked
  by episodes. A show whose runtime TMDB does not report shows a dash, not a
  guess.
- **Year strip.** Hours per month for the last twelve months, stacked films and
  TV with a legend, each month headed by its most-watched poster. Pick a month to
  open it in the calendar. On a phone the strip opens scrolled to the month in
  view (it used to open on the oldest month, with every month that had data
  off-screen), and the tallest month's poster no longer rises out of the chart.
- **Your week.** Minutes by weekday for the month, the peak day highlighted, with
  your current streak of days with viewing (still alive on a day with nothing yet),
  the best run that month and the best ever. Bulk marks never count.
- **Compared and marked.** The month's watch time says how it compares with the
  month before, its biggest day wears a star on the calendar, and the Biggest day
  tile opens that day.
- **Moving around.** The calendar is one tab stop: arrow keys move a day or a
  week, Page Up and Page Down a month, and future days are skipped. On a touch
  screen, swipe the calendar sideways to change month. **This month** jumps back.
  The calendar slides in the direction you moved, and bars grow only when the
  month changes, not on every day you pick.
- **On this day.** A row above the calendar shows what you watched on today's date
  in earlier years, newest first ("1 year ago · 2025"), each title once with its
  episode ("S2 E4"), episode count or viewings. Bulk marks are not memories. With
  nothing from earlier years it stays out of the way.
- **A legend for the marks:** the star is your biggest day, the dot a day with only
  bulk marks, the ring today.
- **The TV list folds** after six shows behind **Show all N shows**, remembered for
  the month in view.
- **The Streak tile shimmers** once when today's viewing has made your streak longer.
  It waits until the tile is actually on screen, and remembers each step of the
  streak so the same step never shimmers twice.

Films count each play (a rewatch is its own day). Episodes come from the
per-episode log, read with one rule shared with the binge forecast
(`viewingLog` in `js/episodes.js`): single ticks are viewing, and so is a batch
the size of one sitting (at most six hours of the show, or six episodes when the
runtime is unknown), such as **Up to here** after an evening. The show's first
batch is the catch-up everyone does when they start tracking, and a whole season,
a whole show or a back-filled history is bookkeeping: listed on its day as
"marked", never shading a day or adding minutes. The personal-best binge record in
the TV Tracker still counts single ticks only.

### Season recap

Finish a season and CineVerse offers a shareable card. A prompt appears when the
last episode was actually watched, not swept in by a whole-season mark, and every
finished season has a **Recap** button on its toolbar. The card shows:

- when you started and finished;
- days taken, your pace, binge days (three or more episodes) and longest sitting;
- watch time, from TMDB's per-episode runtimes;
- when you tend to watch (below);
- the season's top-rated episode, which is TMDB's community rating (the card
  says so), ignoring episodes with fewer than three votes.

Pace, binge days and sittings use the Diary's viewing rule. A season marked in one
press has none of them, and the card says "Marked as watched" instead. It shares
through the same studio as the spoiler-free card: native share, download, or copy
the show's link.

### Series finale

Finish a whole series by watching its last episode and CineVerse offers a finale
card instead of a season recap; a **Finale card** button also sits on the title
page of any completed series. It covers every season: dates, total episodes and
time, overall pace, binge days, your **fastest season** (the highest pace among
seasons you watched as viewing, so a season marked in one press never wins), a bar
per season's pace, and the best-rated episode you watched.

In the share studio the card assembles itself: frame, poster and title, then the
figures tile by tile, then the pace strip with each season's bar rising in turn,
and the best episode last. One drawing function renders any moment of that, so
the shared PNG is exactly its final frame, and it is ready to share from the
start. Reduced motion shows the finished card.

Your **profile** has a **Completed series** shelf: every series you have
finished (dropped shows excluded), newest first, each with its finale card.
Hovering a card (or its turn button on touch and keyboard) flips it to the run
in numbers: seasons, episodes, days, watch time, and the fastest season or pace.

**Year in series.** The shelf offers a card for each of your three most recent
years with finishes (`js/series-year.js`). It shows:

- how many series you finished that year;
- episodes and watch time across those runs;
- your fastest finish (viewing only, so a run marked in one press never wins);
- your biggest run;
- a centred wall of their posters, and a bar for each month you finished one.

A series belongs to the year its last episode was marked. Like the finale card,
it assembles itself in the share studio and shares its final frame.

**Year in films.** Your Cineprint panel offers the same kind of card for films,
built from your watched history (`js/films-year.js`):

- how many films you watched that year, and how many viewings with rewatches;
- the hours, from each film's runtime times its viewings that year (it says
  "from known runtimes" when some films have none);
- your top-rated film, your favourite genre, and the film you rewatched most (or
  the director you watched most);
- a wall of the year's films, highest rated first, and a bar for each month of
  viewings.

Each dated viewing counts in its own year, so a favourite first seen in 2024 and
rewatched in 2026 counts once in each. Adult titles never appear.

Both cards share one drawing module (`js/year-card.js`). Month bars rise one
after another, and the busiest month (every month tied for it) rises in gold
with a soft glow that grows with the bar.

### Your Year

`/year` (or `/year/2026`) puts the two cards side by side (`js/your-year.js`),
each drawing itself as it scrolls into view, under a combined total: films,
finished series, watch time across both and the busiest month, with one month
chart that stacks film viewings and series finishes. The watch time says what it
adds: that year's film viewings plus the whole runs of the series finished that
year. Tapping a month (or opening a monthly recap) lists exactly what made it up,
and `?month=8` in the address opens August. Open it from the profile menu or
**Your year** on the Cineprint panel; every year with something in it is a chip at
the top, and an empty year says what will fill it. The page reuses the cards' own
summaries, so its numbers always match what you share. Adult titles never appear
on the page, the film card or the series card.

- **Totals count up** from zero the first time the panel comes into view on a
  visit (never under reduced motion, and not again when the page rebuilds).
- **Compared with the year before:** films, series and watch time each carry a
  "+3 vs 2025" chip when that year has anything in it.
- **Highlights:** the year in moments (the first and most recent watch of the
  year, your top-rated film, the biggest series run, and the most rewatched film
  or the fastest finish), each linking to its title, beside a bar chart of the
  year's films by genre.
- **Cards** play once per visit. A data refresh redraws them finished instead of
  replaying, and a **Replay** button on each card plays it again.
- The month bars take arrow keys, Home and End.
- **Month recap** fans out the month's three standouts (best-rated films first,
  then finished series) beside its heading.
- **Year chips** are one sideways row that scrolls with a fade on the edge that has
  more, on phones and on desktop, where a mouse wheel moves it sideways. The year
  shown is scrolled into view.
- **Genre bars re-sort** when you switch years: each bar starts where its genre
  stood, and as wide as it was, in the year you came from, then glides to its new
  place and width; genres new to the year fade in.

**Watch Party** celebrates the first pick the matcher finds for an account: the party
scene pops up over the result and throws confetti. Once only, and never under
reduced motion.

### Viewing patterns

*"You watch Severance in the evenings, The Bear on weekend afternoons"* heads the
TV Tracker, and each show's title page names its own pattern under the forecast.
`js/pacing.js` reads when episodes were marked, the only clock CineVerse has, as
a stand-in for when they were watched:

- Bookkeeping marks are excluded, and a batch counts once, as one sitting.
- After midnight belongs to the night before, so 1 a.m. on Saturday is a Friday
  night.
- A pattern is claimed only with five or more sittings over at least three days,
  and a clear lean: 60% on weekends or at most 20% on weekends, and/or half the
  sittings in one part of the day. Otherwise nothing is said.
- The cross-show sentence uses shows watched in the last 90 days, one per pattern.
- **Settings → Detail pages** can hide it like any other part.

### Binge forecast

Shows in progress say when you will finish, on the detail page and in the Stats
TV Tracker: *"At your pace of 5 episodes a week, you'll finish the 6 left in 10
days — around Sep 25."* Pace is your viewing on that show over the last 30 days,
falling back to all of it, then to your usual pace across shows you have not
dropped. Slow paces read per week or per month rather than "0 episodes a day".

**Why it was missing.** Pace used to count single ticks only, so anyone who marks
with **Up to here** or **Set position** had no pace at all, and the forecast
silently never appeared. It now uses the Diary's viewing rule above. When there is
still no date it says why instead of disappearing: *"Mark a couple of episodes as
you watch them and a finish date appears here"*, or *"Paused for 3 months — a
finish date comes back when you pick it up again"*. Dropped and caught-up shows
have nothing to forecast.

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

Rails carry a heading only, with no sub-heading line under it. A rail about one
title names it with the title's official logo: "Because you liked" followed by
The Dark Knight's logo. The plain name shows until the logo has loaded and stays
as the image's alt text. `js/logo-tone.js` samples rail logos in both themes, so
dark artwork is lifted to white on the dark theme and white lettering becomes ink
on the light one.

### Returning this month

A Home rail, just under Continue Watching, of shows you have finished (caught up
in the tracker, or marked watched) whose next season premieres this calendar
month. Each poster carries its premiere, *S38 · Sep 27* or *S14 · Out now*. The
date is TMDB's: a season's `air_date` is its first episode, and a next episode
that opens a later season covers seasons listed without a date. A tracked show
counts as finished through its latest aired season, never through an announced
one. Ended, cancelled and dropped shows are left out. The badge is its own
element, so hiding match badges in Settings does not hide premiere dates.

The rails show a different slice of your ranked pool every time CineVerse is
opened. A device-local counter bumps once per page load (no Firestore write) and
is added to the stored cross-device rotation; discover pages are varied by the
same counter so the underlying pool changes too, not just the window over it.
It is deliberately silent — there is no banner explaining it, the rails simply
differ. Ranking itself never changes randomly, only which part of it you see
first, and in-app navigation never reshuffles.

### Series and what you are watching now

Recommendations now include TV, and they lean toward what you are watching
lately. Films watched in the last three weeks weigh 1.6x. Shows you are part-way
through seed their own TMDB recommendations. Movie genres are mapped to their TV
equivalents (Action → Action & Adventure, Sci-Fi → Sci-Fi & Fantasy…) so a film
taste finds series too. Two rails use this: **Because you're watching …**, which
only admits titles from that show's seed with real genre overlap, and **Series for
You**. Shows you already track are never recommended back to you. Private mature
viewing stays out, as before.

### Tuned to the episodes you just watched

For the show you are in the middle of, **Because you're watching …** follows the
mood of your latest episodes rather than the whole show, and its heading's
tooltip says so: *"Tuned to
S1 E3–E5: betrayal, espionage, murder"*.

TMDB has no keywords for episodes (that endpoint returns 404), and an episode's
overview is a sentence or two. So `js/watching-mood.js` reads the overviews of
the last three episodes you marked (the newest counts most) and that season's
overview, and matches them against a lexicon of about 45 moods. Each mood is a
set of phrases that clearly signal it ("betrays", "cover-up", "on the run") and
the TMDB keyword ids that catalogue it. Every id was checked against TMDB for an
exact name and a real body of titles. Ambiguous words ("loss", "team") are left
out, and episode titles are not read because they are often metaphors. The show's
own TMDB keywords corroborate a mood, and become moods themselves when an episode
names them as whole words.

Titles in that mood come from TMDB Discover (the mood keywords, restricted to the
show's own genres, with Drama set aside when a more specific genre exists). They
lead the rail only when at least four honest matches exist. Otherwise the rail
follows the show as before rather than claiming a mood it did not find. With no
sub-heading line, what the rail is tuned to is the heading's tooltip.

## Streaming regions

`REGIONS` in `js/config.js` lists the 60 countries TMDB returns watch-provider
data for. The flag is derived from the ISO 3166-1 alpha-2 code rather than typed,
so a wrong flag beside a country is impossible by construction; the name is always
rendered next to it because Windows has no flag glyphs and falls back to the two
letters.

## Tests

```
cd tests
npm run test:logic    # 960+ assertions, no dependencies and no Java
npm run coverage      # proves the rules suite is complete
npm install && npm run test:rules   # rules + two-device sync (needs a JDK)
npm run test:browser  # real clicks, reloads, account switches and offline retry
```

All of it runs on every push — `.github/workflows/tests.yml` — alongside a parse
check (`tests/parse.mjs`) and an import-resolution check over all 100 modules.
There is no build step to catch a syntax error or a renamed export before
Cloudflare would. The parse check reads each file as the ES module the browser
loads: `node --check` passed a module with a template placeholder left in a plain
string, which would have broken Discover.

`tests/logic/` runs the real application modules against a small browser shim —
list locking, the episode ledger, CSV import, every stats figure, rewatch
counting, collection completion, the light-theme compiler (`theme.test.mjs`), and
the binge forecast, Watch Diary, detail parts, preferences and logo tone
(`batch-features.test.mjs`), and the viewing rule, forecast reasons, the Diary's TV
month, episode moods and Up Next countdowns (`tv-intelligence.test.mjs`), and viewing
patterns, season recaps, the season-complete signal, the returning rail and exact
episode times (`season-intelligence.test.mjs`), and the icon set, poster colour,
transition geometry, completionist, cast milestones, series finale and season
heatmap (`premium-batch.test.mjs`), and hours clubs, person-to-person links, heatmap
standouts, insights and watch order, the finale build-up and the Completed series
shelf (`social-heatmap.test.mjs`), and the year-in-series card, shelf flip figures,
odometer numbers and first-sight badges (`year-shelf.test.mjs`), and cinema glass,
the year-in-films card, the shared year-card pieces, scroll hints and removing
people from Hours clubs (`glass-years.test.mjs`), and Your Year, the monthly
recap, moving lights, the illustrations, year comparisons and highlights, and the
diary's streaks, weekdays, month totals and On this day, streak milestones, gear
geometry, the tearing ticket, the radar's arrival parts and Settings section resets
(`year-page.test.mjs`), which also covers the globe's turn, Recently changed,
setting values in words, the radar's category blips and unread counts, and the
folded filter bars: what counts as a set filter, the button's summary and a
registry that still matches the markup (`filter-fold.test.mjs`), and how the site
feels: every action's haptic signature and weight, the lean and its settling,
row detents and edges, headings crossing the middle, the ticket stub's arc, the
Continue Watching lift and the sticky bars (`feel.test.mjs`). It needs nothing
installed.
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

The rail is deliberately quiet: artwork with a thin progress line, the show's
name, and one line for the next episode and how many are left. The count of
shows sits beside the heading.

### Up Next

Shows you are caught up on lead the rail with a countdown when their next episode
has a date within 30 days: *Season finale · Tomorrow*, *In 5 days*, or a live
*1d 04:12:33*. The date is TMDB's next episode. A live hours-minutes-seconds count
runs only when TVmaze publishes that episode with a real airtime. Streaming drops
with no time are stamped noon UTC by TVmaze, which is a placeholder, so those
cards count calendar days instead of inventing a moment. When an episode is out,
the card says **Out now**, the show is re-checked with TMDB, and once its aired
marker moves it returns to the rail as a normal card. A card stays at most three
days after release. Ended, dropped and hidden shows never get one, and one timer
drives every countdown, only while one is on screen.

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
