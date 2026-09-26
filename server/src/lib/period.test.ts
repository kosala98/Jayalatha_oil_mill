import assert from 'node:assert/strict';
import { test } from 'node:test';
import { periodStart } from './period';

const LK = 330; // UTC+5:30

test('today starts at local midnight in Sri Lanka', () => {
  // 2026-09-12 01:00 in Colombo = 2026-09-11 19:30Z
  const now = new Date('2026-09-11T19:30:00Z');
  assert.equal(periodStart('today', LK, now)?.toISOString(), '2026-09-11T18:30:00.000Z');
});

test('just before local midnight is still the previous day', () => {
  const now = new Date('2026-09-11T18:29:00Z'); // 23:59 Colombo on the 11th
  assert.equal(periodStart('today', LK, now)?.toISOString(), '2026-09-10T18:30:00.000Z');
});

test('week starts on Monday', () => {
  // Saturday 2026-09-12 14:00 Colombo → Monday 2026-09-07 00:00 Colombo
  const now = new Date('2026-09-12T08:30:00Z');
  assert.equal(periodStart('week', LK, now)?.toISOString(), '2026-09-06T18:30:00.000Z');
});

test('on a Monday the week starts that same day', () => {
  const now = new Date('2026-09-07T04:00:00Z');
  assert.equal(periodStart('week', LK, now)?.toISOString(), '2026-09-06T18:30:00.000Z');
});

test('Sunday belongs to the week that began the previous Monday', () => {
  const now = new Date('2026-09-13T10:00:00Z');
  assert.equal(periodStart('week', LK, now)?.toISOString(), '2026-09-06T18:30:00.000Z');
});

test('month and year', () => {
  const now = new Date('2026-09-12T08:30:00Z');
  assert.equal(periodStart('month', LK, now)?.toISOString(), '2026-08-31T18:30:00.000Z');
  assert.equal(periodStart('year', LK, now)?.toISOString(), '2025-12-31T18:30:00.000Z');
});

test('all has no lower bound', () => {
  assert.equal(periodStart('all', LK), undefined);
});
