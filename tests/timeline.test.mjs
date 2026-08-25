// Time-machine test: replays ~90 days of simulated future through the REAL
// pipeline (htmlToLines → parseDrops → mergeDrops → computeEta/chartScale).
// Exercises the failure modes the handoff warns about:
//   - the page trims its own history (only a rolling window is ever visible)
//   - whole-line pauses (October holiday) must not whipsaw ETAs
//   - new SKUs appear mid-stream
//   - order numbers keep climbing — late buyers have far-out blocks
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { htmlToLines, parseDrops, mergeDrops, serialiseData } from '../scripts/parse.mjs';
import { frontiers, computeEta, chartScale, splitSku, DAY } from '../public/lib.js';

const seed = JSON.parse(
  readFileSync(new URL('../public/data.json', import.meta.url), 'utf8'),
).drops;

const iso = (t) => new Date(t).toISOString().slice(0, 10);
const key = (d) => `${d.date}|${d.sku}|${d.from}|${d.to}`;

// Render drops the way AYN's page does, cycling through every format quirk.
function pageHtml(drops) {
  const byDate = new Map();
  for (const d of drops) {
    if (!byDate.has(d.date)) byDate.set(d.date, []);
    byDate.get(d.date).push(d);
  }
  const dates = [...byDate.keys()].sort().reverse(); // newest first, like the real page
  let html = '<div class="page">\n';
  let i = 0;
  for (const date of dates) {
    const [y, m, day] = date.split('-').map(Number);
    html += `<p><strong>${y}/${m}/${day}</strong></p>\n`;
    for (const d of byDate.get(date)) {
      i += 1;
      const name = d.sku.endsWith(' 512')
        ? d.sku.slice(0, -4) + (i % 2 ? '（512）' : ' (512)')
        : d.sku;
      const colon = i % 3 ? ':' : '：';
      const sep = i % 5 ? '--' : '-';
      const pad = i % 4 ? ' ' : '&nbsp;';
      html += `<p>AYN Thor ${name}${colon}${pad}${d.from}xx${sep}${d.to}xx</p>\n`;
      if (i % 11 === 0) html += `<p>AYN Thor ${name}${colon} ${d.from}xx--${d.to}xx</p>\n`; // duplicate line
    }
    html += '<p>&nbsp;</p>\n';
  }
  return html + '</div>';
}

test('90-day simulation: trims, pause, new SKU, climbing order numbers', () => {
  const start = new Date('2026-08-16').getTime();
  const end = new Date('2026-11-15').getTime();
  const pauseFrom = '2026-10-01';
  const pauseTo = '2026-10-08';
  const PAGE_WINDOW = 42; // days of history the page retains

  // Live per-SKU frontier state, seeded from real data.
  const state = new Map(frontiers(seed));
  const skus = [...state.keys()];
  let simDrops = []; // everything "AYN" has ever published in the sim
  let history = [...seed]; // our merged store
  let prevFrontiers = new Map(state);
  let prevRemaining2761 = Infinity;
  let prevRemaining3410 = Infinity;
  let passedDate = null;
  const activeRates = [];

  let dayIndex = 0;
  for (let t = start; t <= end; t += DAY, dayIndex++) {
    const date = iso(t);

    // --- AYN's side: publish drops (deterministic pseudo-random cadence) ---
    const paused = date >= pauseFrom && date <= pauseTo;
    if (!paused) {
      skus.forEach((sku, si) => {
        if ((dayIndex + si) % 3 !== 0) return; // each SKU drops every ~3 days
        const gain = 8 + ((dayIndex * 7 + si * 13) % 20); // 8–27 blocks
        const from = state.get(sku);
        state.set(sku, from + gain);
        simDrops.push({ date, sku, from, to: from + gain });
      });
      if (date === '2026-09-20') {
        // brand-new SKU appears (batch 7 colourway) at a fresh number
        state.set('Titanium Pro', 2600);
        simDrops.push({ date, sku: 'Titanium Pro', from: 2580, to: 2600 });
      }
    }

    // --- our side: daily fetch of the trimmed page, real pipeline ---
    const windowStart = iso(t - PAGE_WINDOW * DAY);
    const visible = [...seed, ...simDrops].filter((d) => d.date >= windowStart);
    const parsed = parseDrops(htmlToLines(pageHtml(visible)));
    assert.ok(parsed.length > 0, `${date}: parsed something`);

    const before = new Set(history.map(key));
    const { merged } = mergeDrops(history, parsed);
    for (const k of before) {
      assert.ok(merged.some((d) => key(d) === k), `${date}: no history lost (${k})`);
    }
    history = merged;

    // round-trip through the on-disk format
    const reloaded = JSON.parse(serialiseData(new Date(t).toISOString(), history));
    assert.equal(reloaded.drops.length, history.length, `${date}: serialise round-trip`);

    // frontiers never regress
    const fr = frontiers(history);
    for (const [sku, f] of prevFrontiers) {
      assert.ok((fr.get(sku) ?? -Infinity) >= f, `${date}: ${sku} frontier monotonic`);
    }
    prevFrontiers = fr;

    // --- weekly checkpoint: the viewer's ETAs stay sane as time passes ---
    if (dayIndex % 7 === 0) {
      const near = computeEta(history, 'Rainbow Pro', 2761, t);
      if (near.kind === 'eta') {
        assert.ok(near.remaining < prevRemaining2761, `${date}: block 2761 converging`);
        assert.ok(near.opt <= near.cons, `${date}: eta window ordered`);
        assert.ok(near.rActive > 2 && near.rActive < 15, `${date}: active rate sane through pause (${near.rActive.toFixed(1)})`);
        activeRates.push(near.rActive);
        prevRemaining2761 = near.remaining;
      } else if (near.kind === 'passed' && !passedDate) {
        passedDate = date;
      }

      // a late buyer: order numbers kept climbing past the original 2761
      const far = computeEta(history, 'Rainbow Pro', 3410, t);
      assert.equal(far.kind, 'eta', `${date}: far-out block 3410 still gets an estimate`);
      assert.ok(far.remaining <= prevRemaining3410, `${date}: block 3410 converging`);
      prevRemaining3410 = far.remaining;

      // chart must keep the far marker on-canvas whatever the domain
      const values = [...fr.values()];
      for (const block of [2761, 3410, 9999]) {
        const { lo, hi, step, x } = chartScale(values, block);
        assert.ok(lo < hi && [50, 100, 200, 500, 1000].includes(step), `${date}: tick step valid for ${block}`);
        const mx = x(block);
        assert.ok(mx >= 128 && mx <= 460, `${date}: marker for ${block} on-canvas (x=${mx.toFixed(1)})`);
        for (const f of values) {
          assert.ok(x(f) >= 128 - 1e-9, `${date}: bar end for frontier ${f} on-canvas`);
        }
      }
    }
  }

  // the order eventually ships, in a plausible window
  assert.ok(passedDate, 'block 2761 was eventually passed');
  assert.ok(passedDate >= '2026-09-15' && passedDate <= '2026-11-01', `passed on ${passedDate}`);

  // active rate stayed stable across the October pause (no whipsaw)
  const spread = Math.max(...activeRates) / Math.min(...activeRates);
  assert.ok(spread < 1.8, `active rate stable across pause (spread ×${spread.toFixed(2)})`);

  // seed drops the page stopped showing months ago are still in the store
  assert.ok(history.some((d) => d.date === '2026-06-15'), 'June seed survives 90 days of trimmed pages');

  // the new SKU flowed through and decomposes as a colorless model chip
  assert.ok(frontiers(history).has('Titanium Pro'), 'new SKU picked up');
  assert.deepEqual(splitSku('Titanium Pro'), { color: null, model: 'Titanium Pro' });

  // dedupe: no tuple appears twice despite duplicate page lines every 11th entry
  assert.equal(new Set(history.map(key)).size, history.length, 'no duplicate tuples');
});
