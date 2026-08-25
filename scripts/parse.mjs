// Parsing for AYN's shipment dashboard (https://www.ayntec.com/pages/shipment-dashboard).
// The page body is a flat sequence of paragraphs: a bold date heading (YYYY/M/D,
// not zero-padded) followed by entry lines like
//   "AYN Thor White Max（512）: 2580xx--2627xx"
// Full-width punctuation, &nbsp; and duplicate lines appear inconsistently in
// the wild, so everything is normalised to plain ASCII text before matching.

const FULLWIDTH = new Map([
  ['（', '('],
  ['）', ')'],
  ['：', ':'],
  ['－', '-'],
  ['　', ' '],
]);

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"');
}

export function htmlToLines(html) {
  let s = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/[（）：－　]/g, (ch) => FULLWIDTH.get(ch));
  return s
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const DATE_RE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
const ENTRY_RE = /^AYN Thor (.+?)\s*:\s*(\d{4})xx\s*-{1,2}\s*(\d{4})xx$/i;

// "White Max (512)" / "White Max(512)" -> "White Max 512"; unknown names pass
// through untouched — new SKUs are data, not errors.
export function normaliseSku(raw) {
  return raw.replace(/\(\s*512\s*\)/, ' 512').replace(/\s+/g, ' ').trim();
}

export function parseDrops(lines) {
  const drops = [];
  let date = null;
  for (const line of lines) {
    const d = DATE_RE.exec(line.replace(/[*]/g, '').trim());
    if (d) {
      date = `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}`;
      continue;
    }
    const e = ENTRY_RE.exec(line);
    if (e && date) {
      drops.push({ date, sku: normaliseSku(e[1]), from: Number(e[2]), to: Number(e[3]) });
    }
  }
  return drops;
}

// Union incoming drops into the stored history, deduped on the full tuple.
// The live page trims its own history, so stored drops are never removed.
export function mergeDrops(existing, incoming) {
  const key = (d) => `${d.date}|${d.sku}|${d.from}|${d.to}`;
  const map = new Map(existing.map((d) => [key(d), d]));
  let added = 0;
  for (const d of incoming) {
    if (!map.has(key(d))) {
      map.set(key(d), d);
      added += 1;
    }
  }
  const merged = [...map.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.sku.localeCompare(b.sku) || a.from - b.from,
  );
  return { merged, added };
}

// Serialise with one drop per line so data.json diffs read as a changelog.
export function serialiseData(updated, drops) {
  const body = drops.map((d) => '  ' + JSON.stringify(d)).join(',\n');
  return `{\n"updated": ${JSON.stringify(updated)},\n"drops": [\n${body}\n]\n}\n`;
}
