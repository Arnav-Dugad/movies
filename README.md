# movies

https://arnav-dugad.github.io/movies/

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

## Voice search

`js/voice.js` owns the microphone. `SpeechRecognition.start()` runs synchronously
inside the click so user activation survives, and `getUserMedia` is used only to
recover from a permission or capture failure — awaiting it first is what broke
desktop capture before. A watchdog covers Chrome's silent-no-start failure, and
the waveform is driven by the recogniser's own sound/speech events rather than a
second capture stream.

Commands: search, open a title, play a trailer, add or remove from your lists,
mark watched, rate (pre-selected, never auto-saved), and jump to any page.

## Firestore security rules

`firestore.rules` holds the rules this app needs. To apply them:

**Firebase Console → Firestore Database → Rules →** paste the file's contents **→ Publish.**

Sharing a list does not work until these are published: a friend has to be able to
read the owner's shared snapshot at `users/{uid}/shared/list_{listId}`. Raw
watchlist, ratings, watched and list data stay owner-only — the only cross-user
readable documents are the derived ones under `users/{uid}/shared/`.

If a list action fails, the toast now carries the Firestore error code
(e.g. `permission-denied`), which usually means these rules aren't published yet.
