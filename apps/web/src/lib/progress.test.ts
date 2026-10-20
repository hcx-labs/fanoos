import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumePosition, mergeOfflineProgress } from './progress.ts';

test('short downloads preserve a useful resume point', () => {
  assert.equal(resumePosition(12.5, 19), 12);
  assert.equal(resumePosition(18.9, 19), undefined);
  assert.equal(resumePosition(5, 200), undefined);
  assert.equal(resumePosition(40, 200), 40);
  assert.equal(resumePosition(599, 600), undefined);
  assert.equal(resumePosition(Number.NaN, 600), undefined);
});
test('reconnect merges changed positions, removes completed ones, and preserves other-device progress', () => {
  assert.deepEqual(mergeOfflineProgress({ a: 30, b: 80, c: 100 }, { a: 50, c: null }), { a: 50, b: 80 });
});
