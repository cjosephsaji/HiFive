import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { parseUsage } from '../dist/browser/usagePage.js';

test('parses 5-hour and weekly resets using account timezone',()=>{
  const now=DateTime.fromISO('2026-09-17T18:00:00',{zone:'Asia/Kolkata'});
  const parsed=parseUsage('5 hour usage limit\nResets 9:14 PM\nWeekly limit\nResets Sep 22, 2026, 3:55 PM','Asia/Kolkata',now);
  assert.equal(parsed.fiveHour.timestamp,'2026-09-17T15:44:00.000Z');
  assert.equal(parsed.weekly.timestamp,'2026-09-22T10:25:00.000Z');
});
test('rejects missing 5-hour reset',()=>{
  assert.equal(parseUsage('Weekly limit resets tomorrow','Asia/Kolkata'),null);
});
