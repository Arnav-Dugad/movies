import { check, summary } from './harness.mjs';

const SRC = new URL('../../js/', import.meta.url).href;
const { mergeContinuePrefs } = await import(SRC + 'continue-prefs.js');

const remote = { pinned: ['tv_100'], hidden: ['movie_8'], clientUpdatedAt: 100 };
const pinOnePiece = [{ type: 'pin', key: 'tv_37854', value: true, at: 200, id: 'pc' }];
const merged = mergeContinuePrefs(remote, pinOnePiece);
check('a new device pin keeps the other device pin', merged.pinned.join(',') === 'tv_37854,tv_100', JSON.stringify(merged));
check('a pin never erases remote hidden choices', merged.hidden.join(',') === 'movie_8', JSON.stringify(merged));

const unpin = mergeContinuePrefs(merged, [{ type: 'pin', key: 'tv_37854', value: false, at: 300, id: 'mobile' }]);
check('an explicit unpin removes only that title', unpin.pinned.join(',') === 'tv_100', JSON.stringify(unpin));

const hidden = mergeContinuePrefs(merged, [{ type: 'hide', key: 'tv_37854', value: true, at: 400, id: 'mobile' }]);
check('hiding a title removes its pin atomically', !hidden.pinned.includes('tv_37854') && hidden.hidden.includes('tv_37854'), JSON.stringify(hidden));

const reset = mergeContinuePrefs(merged, [{ type: 'reset', at: 500, id: 'reset' }]);
check('reset clears the shared continue layout', !reset.pinned.length && !reset.hidden.length, JSON.stringify(reset));

const migrated = mergeContinuePrefs(remote, [{
  type: 'snapshot', at: 600, id: 'legacy-pc',
  value: { pinned: ['tv_37854'], hidden: ['movie_9'], clientUpdatedAt: 600 },
}]);
check('a newer legacy PC snapshot keeps its One Piece pin and unrelated cloud pins', migrated.pinned.join(',') === 'tv_37854,tv_100', JSON.stringify(migrated));
check('legacy migration resolves only the keys that device explicitly chose', migrated.hidden.includes('movie_8') && migrated.hidden.includes('movie_9'), JSON.stringify(migrated));

summary();
