import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToLines, parseDrops, mergeDrops, normaliseSku } from '../scripts/parse.mjs';

// Every format quirk observed in the wild: full-width parens/colon, ASCII
// parens with a leading space, &nbsp;, single-hyphen separator, duplicate
// lines, bold date headings, non-zero-padded dates.
const FIXTURE = `
<div>
<p><strong>2026/8/15</strong></p>
<p>AYN Thor Black Base: 2428xx--2431xx</p>
<p>AYN Thor White Max（512）: 2580xx--2627xx</p>
<p>AYN Thor Clear Purple Max (512): 2446xx--2490xx</p>
<p>&nbsp;</p>
<p><strong>2026/8/13</strong></p>
<p>AYN Thor Clear Purple Pro：2484xx-2498xx</p>
<p>AYN Thor Black Max（512）:&nbsp;2472xx--2490xx</p>
<p>AYN Thor Black Max（512）: 2472xx--2490xx</p>
<p>AYN Thor Solar Flare Ultra: 2100xx--2200xx</p>
</div>
`;

test('parses dated drops with all observed quirks', () => {
  const drops = parseDrops(htmlToLines(FIXTURE));
  assert.deepEqual(drops[0], { date: '2026-08-15', sku: 'Black Base', from: 2428, to: 2431 });
  assert.deepEqual(drops[1], { date: '2026-08-15', sku: 'White Max 512', from: 2580, to: 2627 });
  assert.deepEqual(drops[2], { date: '2026-08-15', sku: 'Clear Purple Max 512', from: 2446, to: 2490 });
  assert.deepEqual(drops[3], { date: '2026-08-13', sku: 'Clear Purple Pro', from: 2484, to: 2498 });
});

test('unknown SKU names pass through as new SKUs', () => {
  const drops = parseDrops(htmlToLines(FIXTURE));
  assert.ok(drops.some((d) => d.sku === 'Solar Flare Ultra'));
});

test('entries before any date heading are dropped', () => {
  const drops = parseDrops(['AYN Thor Black Base: 2428xx--2431xx', '2026/8/15']);
  assert.equal(drops.length, 0);
});

test('merge dedupes on the full tuple, including within one fetch', () => {
  const drops = parseDrops(htmlToLines(FIXTURE));
  const dupes = drops.filter((d) => d.sku === 'Black Max 512');
  assert.equal(dupes.length, 2); // parser keeps both; merge collapses them
  const { merged, added } = mergeDrops([], drops);
  assert.equal(merged.filter((d) => d.sku === 'Black Max 512').length, 1);
  assert.equal(added, drops.length - 1);
});

test('merge never removes stored history the page has trimmed', () => {
  const old = [{ date: '2026-06-15', sku: 'Black Max', from: 2125, to: 2202 }];
  const { merged } = mergeDrops(old, parseDrops(htmlToLines(FIXTURE)));
  assert.ok(merged.some((d) => d.date === '2026-06-15'));
});

test('normaliseSku handles 512 variants and spacing', () => {
  assert.equal(normaliseSku('White Max(512)'), 'White Max 512');
  assert.equal(normaliseSku('Clear Purple Max (512)'), 'Clear Purple Max 512');
  assert.equal(normaliseSku('  Rainbow   Pro '), 'Rainbow Pro');
});
