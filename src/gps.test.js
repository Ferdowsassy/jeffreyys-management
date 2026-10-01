import test from 'node:test';
import assert from 'node:assert/strict';
import {gpsTimestamp} from './gps.js';
test('GPS capture time supports epoch units without manufacturing fresh locations', () => {
  const now = Date.parse('2026-10-01T18:00:00Z');
  const fix = now - 10000;
  assert.equal(gpsTimestamp(fix,now),fix);
  assert.equal(gpsTimestamp(fix * 1000,now),fix);
  assert.equal(gpsTimestamp(fix / 1000,now),fix);
  for (const invalid of [now - 60000, (now - 60000) * 1000, now + 60000, NaN, Infinity, null, 'invalid']) assert.equal(gpsTimestamp(invalid,now),null);
});
