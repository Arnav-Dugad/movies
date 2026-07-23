# movies

https://arnav-dugad.github.io/movies/

## Firestore security rules

`firestore.rules` holds the rules this app needs. To apply them:

**Firebase Console → Firestore Database → Rules →** paste the file's contents **→ Publish.**

Sharing a list does not work until these are published: a friend has to be able to
read the owner's shared snapshot at `users/{uid}/shared/list_{listId}`. Raw
watchlist, ratings, watched and list data stay owner-only — the only cross-user
readable documents are the derived ones under `users/{uid}/shared/`.

If a list action fails, the toast now carries the Firestore error code
(e.g. `permission-denied`), which usually means these rules aren't published yet.
