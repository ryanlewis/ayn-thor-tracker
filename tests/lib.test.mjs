// Unit tests for the human-framing helpers in lib.js (humanizeDays,
// lastMove, dropLog, packPace). Fixture-based, plus a smoke pass over the
// real data.json to keep them honest against live shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { humanizeDays, lastMove, dropLog, packPace } from '../public/lib.js';

const seed = JSON.parse(
  readFileSync(new URL('../public/data.json', import.meta.url), 'utf8'),
).drops;

// Two SKUs, one whole-line pause (01-03 → 01-10 is a 7-day gap > GAP_DAYS).
const fixture = [
  { date: '2026-01-01', sku: 'A', from: 100, to: 110 },
  { date: '2026-01-03', sku: 'A', from: 110, to: 130 },
  { date: '2026-01-03', sku: 'B', from: 195, to: 200 },
  { date: '2026-01-10', sku: 'A', from: 130, to: 160 },
  { date: '2026-01-12', sku: 'B', from: 200, to: 220 },
];

test('humanizeDays: rough human buckets', () => {
  assert.equal(humanizeDays(0.3), 'today');
  assert.equal(humanizeDays(-2), 'today');
  assert.equal(humanizeDays(1.2), '1 day');
  assert.equal(humanizeDays(9), '9 days');
  assert.equal(humanizeDays(13.7), 'about 2 weeks'); // rounds to 14
  assert.equal(humanizeDays(45), 'about 6 weeks');
  assert.equal(humanizeDays(70), 'about 2 months');
});

test('lastMove: latest date and that day\'s total gain', () => {
  assert.deepEqual(lastMove(fixture, 'A'), { date: '2026-01-10', gain: 30 });
  assert.deepEqual(lastMove(fixture, 'B'), { date: '2026-01-12', gain: 20 });
  assert.equal(lastMove(fixture, 'Nope'), null);
  // same-day split slices sum
  const split = [...fixture, { date: '2026-01-12', sku: 'B', from: 220, to: 225 }];
  assert.deepEqual(lastMove(split, 'B'), { date: '2026-01-12', gain: 25 });
});

test('dropLog: newest dates first, biggest slice first within a day', () => {
  const log = dropLog(fixture, 2);
  assert.deepEqual(log.map((d) => d.date), ['2026-01-12', '2026-01-10']);
  const jan3 = dropLog(fixture, 4).find((d) => d.date === '2026-01-03');
  assert.deepEqual(jan3.items.map((i) => i.sku), ['A', 'B']); // +20 before +5
  assert.deepEqual(jan3.items[0], { sku: 'A', from: 110, to: 130, gain: 20 });
});

test('packPace: pause-aware, falls back to lifetime on short history', () => {
  // active days: 2 (01→03) + 0 (pause) + 2 (10→12) = 4; total width 85
  const p = packPace(fixture); // 14-day window unreachable → recent === overall
  assert.equal(p.overall, 85 / 4);
  assert.equal(p.recent, p.overall);
  // 2-active-day window reaches back to 01-10: only B's +20 slice, over 2 days
  const p2 = packPace(fixture, 2);
  assert.equal(p2.recent, 10);
  assert.equal(packPace([fixture[0]]), null);
});

test('packPace: republished overlapping slices do not double-count', () => {
  const over = [
    { date: '2026-01-01', sku: 'A', from: 100, to: 150 },
    { date: '2026-01-03', sku: 'A', from: 100, to: 170 }, // republished wider
  ];
  assert.equal(packPace(over).overall, (170 - 100) / 2); // frontier gain, not 50+70
});

test('smoke: real data.json shapes', () => {
  const pace = packPace(seed);
  assert.ok(pace.recent > 0 && Number.isFinite(pace.recent));
  assert.ok(pace.overall > 0 && Number.isFinite(pace.overall));
  const log = dropLog(seed);
  assert.ok(log.length === 4 && log[0].date > log[3].date);
  for (const day of log) {
    for (const it of day.items) assert.ok(it.gain > 0, `${day.date} ${it.sku} gain > 0`);
  }
  const mv = lastMove(seed, day0sku(log));
  assert.ok(mv.date >= '2026-06-15' && mv.gain > 0);
  function day0sku(l) { return l[0].items[0].sku; }
});
