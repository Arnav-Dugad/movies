// Folded filter bars (js/filter-fold.js): what counts as a set filter, the
// button's summary, and a registry that still points at real markup.
import { readFileSync, readdirSync } from 'node:fs';
import { check, summary } from './harness.mjs';

const ROOT = new URL('../../', import.meta.url);
const SRC = new URL('js/', ROOT).href;
const fold = await import(SRC + 'filter-fold.js');

const select = (selectedIndex, defaultIndex = -1) => ({ tag: 'SELECT', selectedIndex, defaultIndex });

// Selects
check('a select on its first option is not set', !fold.isSet(select(0)));
check('a select moved off its first option is set', fold.isSet(select(2)));
check('a select whose markup marks a later default is not set on that default', !fold.isSet(select(1, 1)));
check('...and is set on its first option', fold.isSet(select(0, 1)));
check('a re-rendered bar ignores the selected attribute and uses the first option', fold.isSet(select(1, 1), true) && !fold.isSet(select(0, 1), true));
check('a select with nothing chosen is not set', !fold.isSet(select(-1)));

// Checkboxes and text
check('a checkbox matching its markup default is not set', !fold.isSet({ tag: 'INPUT', type: 'checkbox', checked: true, defaultChecked: true }));
check('a checkbox turned off from a checked default is set', fold.isSet({ tag: 'INPUT', type: 'checkbox', checked: false, defaultChecked: true }));
check('a re-rendered checkbox is set only when on', fold.isSet({ tag: 'INPUT', type: 'checkbox', checked: true, defaultChecked: true }, true) && !fold.isSet({ tag: 'INPUT', type: 'checkbox', checked: false, defaultChecked: false }, true));
check('a typed filter field is set', fold.isSet({ tag: 'INPUT', type: 'text', value: ' 1999 ' }));
check('an empty field is not set', !fold.isSet({ tag: 'INPUT', type: 'text', value: '   ' }));
check('a kept search box never counts as a filter', !fold.isSet({ tag: 'INPUT', type: 'text', value: 'dune', keep: true }));
check('buttons and other controls are not filters', !fold.isSet({ tag: 'BUTTON' }));

// Summary
check('no set filters, no summary', fold.summaryOf([]) === '');
check('labels are joined with a dot', fold.summaryOf(['Horror', 'Top rated']) === 'Horror · Top rated');
check('whitespace in labels is tidied and blanks dropped', fold.summaryOf(['  Rated\n 8+ ', '', null]) === 'Rated 8+');
check('past three the rest are counted', fold.summaryOf(['A', 'B', 'C', 'D', 'E']) === 'A · B · C +2');
check('the cap can be raised', fold.summaryOf(['A', 'B', 'C', 'D'], 9) === 'A · B · C · D');

// Registry
const markup = [readFileSync(new URL('index.html', ROOT), 'utf8'), ...readdirSync(new URL('js/', ROOT)).filter(f => f.endsWith('.js')).map(f => readFileSync(new URL(`js/${f}`, ROOT), 'utf8'))].join('\n');
const tokens = selector => [...selector.matchAll(/([#.])([\w-]+)/g)].map(([, kind, name]) => ({ kind, name }));
const present = ({ kind, name }) => (kind === '#' ? new RegExp(`id="${name}"`) : new RegExp(`class="[^"]*\\b${name}\\b`)).test(markup);
check('every bar has a unique id', new Set(fold.FOLDS.map(f => f.id)).size === fold.FOLDS.length);
for (const entry of fold.FOLDS) {
  const missing = [entry.host, entry.keep, entry.extra].filter(Boolean).flatMap(tokens).filter(token => !present(token));
  check(`the ${entry.id} bar's selectors match real markup`, missing.length === 0, missing.map(t => t.kind + t.name).join(' '));
}
check('every page with filters is folded', ['moviesPage', 'tvPage', 'wlControls', 'watchedControls', 'searchFilters', 'adToolbar'].every(id => fold.FOLDS.some(f => f.host.includes(`#${id}`)))
  && ['release-tools', 'discover-filter-grid', 'notification-tools', 'bo-page-tools', 'fp-toolbar', 'studio-filters', 'person-filters'].every(name => fold.FOLDS.some(f => f.host.includes(`.${name}`))));

summary();
