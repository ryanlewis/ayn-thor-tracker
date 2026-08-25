#!/usr/bin/env node
// Fetch AYN's shipment dashboard, parse the drops, merge into public/data.json.
// Exit codes: 0 ok, 1 fetch/network error, 2 parsed zero drops (page shape
// changed?). data.json is left untouched on any non-zero exit so the site
// keeps serving the last good history.
import { readFileSync, writeFileSync } from 'node:fs';
import { htmlToLines, parseDrops, mergeDrops, serialiseData } from './parse.mjs';

const PAGE_URL = 'https://www.ayntec.com/pages/shipment-dashboard';
const DATA_PATH = new URL('../public/data.json', import.meta.url);
const UA = 'ayn-thor-tracker (+https://github.com/ryanlewis/ayn-thor-tracker; once-daily shipment check)';

let res;
try {
  res = await fetch(PAGE_URL, { headers: { 'User-Agent': UA }, redirect: 'follow' });
} catch (err) {
  console.error(`fetch failed: ${err.message}`);
  process.exit(1);
}
if (!res.ok) {
  console.error(`fetch failed: HTTP ${res.status}`);
  process.exit(1);
}

const drops = parseDrops(htmlToLines(await res.text()));
if (drops.length === 0) {
  console.error('parsed zero drops — page format may have changed; keeping last good data.json');
  process.exit(2);
}

const stored = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
const { merged, added } = mergeDrops(stored.drops, drops);
console.log(
  `parsed ${drops.length} drops across ${new Set(drops.map((d) => d.sku)).size} SKUs; ${added} new`,
);
writeFileSync(DATA_PATH, serialiseData(new Date().toISOString(), merged));
