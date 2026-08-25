// Shared pure logic: derived series, rates, ETA, sku decomposition, chart
// scale. Imported by the browser app (app.js) and the node test suite —
// keep this file DOM-free.

export const DAY = 86400000;
export const GAP_DAYS = 4; // whole-line silence longer than this = pause, not slowdown

export function frontiers(drops) {
  const m = new Map();
  for (const d of drops) m.set(d.sku, Math.max(m.get(d.sku) ?? -Infinity, d.to));
  return m;
}

export function seriesFor(drops, sku) {
  const pts = [];
  let max = -Infinity;
  for (const d of drops) {
    if (d.sku !== sku) continue;
    max = Math.max(max, d.to);
    const last = pts[pts.length - 1];
    if (last && last.date === d.date) last.frontier = max;
    else pts.push({ date: d.date, frontier: max });
  }
  return pts;
}

export function allDates(drops) {
  return [...new Set(drops.map((d) => d.date))].sort();
}

export const daysBetween = (a, b) => (new Date(b) - new Date(a)) / DAY;

// Days elapsed between two dates, excluding whole-line pauses (gaps with no
// drops for any SKU longer than GAP_DAYS — e.g. the July factory holiday).
export function activeDays(dates, from, to) {
  let sum = 0;
  for (let i = 1; i < dates.length; i++) {
    const a = dates[i - 1];
    const b = dates[i];
    if (b <= from || a >= to) continue;
    const gap = daysBetween(a < from ? from : a, b > to ? to : b);
    if (daysBetween(a, b) <= GAP_DAYS) sum += gap;
  }
  return sum;
}

export function computeEta(drops, sku, block, now = Date.now()) {
  const series = seriesFor(drops, sku);
  if (!series.length) return { kind: 'no-data' };
  const frontier = series[series.length - 1].frontier;
  const packMax = Math.max(...frontiers(drops).values());
  const remaining = block - frontier;
  if (remaining <= 0) return { kind: 'passed', frontier };

  const dates = allDates(drops);
  const lastAll = dates[dates.length - 1];
  const gain = frontier - series[0].frontier;
  if (gain <= 0) return { kind: 'no-data', frontier, remaining };
  const rOverall = gain / Math.max(1, daysBetween(series[0].date, lastAll));
  const rActive = gain / Math.max(1, activeDays(dates, series[0].date, lastAll));

  const opt = new Date(now + (remaining / rActive) * DAY);
  const cons = new Date(now + (remaining / rOverall) * DAY);
  const mid = new Date((opt.getTime() + cons.getTime()) / 2);
  return { kind: 'eta', frontier, remaining, packMax, rActive, rOverall, opt, cons, mid };
}

// ---------- sku decomposition (mirrors AYN's order page: model × color) ----------

export const COLORS = ['Black', 'White', 'Rainbow', 'Clear Purple'];

// "Clear Purple Max 512" -> {color:"Clear Purple", model:"Max 512"}. SKUs that
// don't start with a known color (future surprises) become colorless models.
export function splitSku(sku) {
  const color = COLORS.find((c) => sku.startsWith(c + ' '));
  return color ? { color, model: sku.slice(color.length + 1) } : { color: null, model: sku };
}

// ---------- chart scale ----------

// Domain is truncated to where the action is, stretched to include the
// viewer's block however far out order numbers have climbed.
export function chartScale(values, block, geom = {}) {
  const { W = 460, labelW = 128, rightPad = 48 } = geom;
  let lo = Math.min(...values) - 80;
  let hi = Math.max(...values) + 40;
  if (block != null) {
    lo = Math.min(lo, block - 40);
    hi = Math.max(hi, block + 40);
  }
  const step = [50, 100, 200, 500, 1000].find((s) => (hi - lo) / s <= 4.5) ?? 1000;
  const x = (v) => labelW + ((v - lo) / (hi - lo)) * (W - labelW - rightPad);
  return { lo, hi, step, x };
}
