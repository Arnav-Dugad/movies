import './harness.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchCommand } from '../../js/search.js';

test('a perfect rating is parsed as ten, not one', () => {
  assert.equal(parseSearchCommand('movies rated 10').filters.rating, 10);
  assert.equal(parseSearchCommand('movies rated below 10').filters.ratingMax, 10);
});

test('runtime and vote constraints cannot accidentally set a rating floor', () => {
  const hours = parseSearchCommand('movies over 2 hours').filters;
  assert.equal(hours.runtimeMin, 120);
  assert.equal(hours.rating, 0);
  const votes = parseSearchCommand('movies with at least 1000 votes').filters;
  assert.equal(votes.minVotes, 1000);
  assert.equal(votes.rating, 0);
  assert.equal(parseSearchCommand('movies with at least 1,000 votes').filters.rating, 0);
  assert.equal(parseSearchCommand('movies over 2 hours rated 8.5').filters.rating, 8.5);
});
