// ayn-thor-tracker frontend. No framework, hand-rolled SVG.
// Reads data.json ({updated, drops:[{date,sku,from,to}]}) and renders the
// pack chart, the viewer's marker + ETA, and a frontier sparkline.
// All derived-data math lives in lib.js, shared with the node test suite.

import {
  frontiers, seriesFor, allDates, computeEta, chartScale, COLORS, splitSku,
  humanizeDays, lastMove, dropLog, packPace, DAY,
} from './lib.js';

const STALE_HOURS = 60; // tolerates one missed twice-daily cron run
const LS_KEY = 'ayn-thor-tracker';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = (s) => s.toLowerCase().replace(/\s+/g, '-');
const fmtDate = (d) => d.toISOString().slice(0, 10);
const shortSku = (s) => s.replace('Clear Purple', 'CP');

// ---------- rendering ----------

function renderChart(drops, sel) {
  const packs = [...frontiers(drops)].sort((a, b) => b[1] - a[1]);

  const W = 460;
  const labelW = 128;
  const rightPad = 48;
  const pitch = 26;
  const barH = 12;
  const top = sel ? 30 : 14;
  const axisY = top + packs.length * pitch + 6;
  const H = axisY + 26;

  const { lo, hi, step, x } = chartScale(packs.map(([, f]) => f), sel?.block, { W, labelW, rightPad });
  let ticks = '';
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    ticks += `<line x1="${x(v)}" y1="${axisY}" x2="${x(v)}" y2="${axisY + 4}" stroke="var(--rule-strong)"/>
      <text x="${x(v)}" y="${axisY + 17}" text-anchor="middle" font-size="10" fill="var(--fg-2)">${v}xx</text>`;
  }

  let rows = '';
  packs.forEach(([sku, f], i) => {
    const y = top + i * pitch;
    const mine = sel && sku === sel.sku;
    const fill = mine ? 'var(--fg)' : i === 0 ? 'var(--fg-2)' : 'var(--fg-3)';
    const labelFill = mine ? 'var(--fg)' : 'var(--fg-2)';
    rows += `<text x="${labelW - 10}" y="${y + barH - 2}" text-anchor="end" font-size="11" fill="${labelFill}">${esc(shortSku(sku)).toLowerCase()}${mine ? ' *' : ''}</text>
      <rect x="${x(lo)}" y="${y}" width="${Math.max(1, x(f) - x(lo))}" height="${barH}" fill="${fill}"/>
      <text x="${x(f) + 6}" y="${y + barH - 2}" font-size="11" fill="var(--fg-1)">${f}</text>`;
  });

  let marker = '';
  if (sel) {
    const mx = x(sel.block);
    const anchor = mx > W - 90 ? 'end' : 'middle';
    marker = `<line x1="${mx}" y1="16" x2="${mx}" y2="${axisY}" stroke="var(--fg)" stroke-width="1" stroke-dasharray="5 4"/>
      <text x="${anchor === 'end' ? mx - 6 : mx}" y="11" text-anchor="${anchor}" font-size="11" fill="var(--fg)">you: ${sel.block}xx</text>`;
  }

  $('#chart-wrap').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Shipping frontier per model">
    <line x1="${labelW}" y1="${axisY}" x2="${W - rightPad + 20}" y2="${axisY}" stroke="var(--rule)"/>
    ${ticks}${rows}${marker}</svg>`;
}

function renderSpark(drops, sku) {
  const series = seriesFor(drops, sku);
  if (series.length < 2) {
    $('#spark-section').hidden = true;
    return;
  }
  const dates = allDates(drops);
  const t0 = new Date(series[0].date).getTime();
  const t1 = new Date(dates[dates.length - 1]).getTime();
  const f0 = series[0].frontier;
  const f1 = series[series.length - 1].frontier;

  const W = 460;
  const H = 96;
  const padL = 4;
  const padR = 52;
  const top = 10;
  const base = H - 22;
  const x = (t) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const y = (f) => base - ((f - f0) / Math.max(1, f1 - f0)) * (base - top);

  let path = `M ${x(t0)} ${y(f0)}`;
  for (let i = 1; i < series.length; i++) {
    const t = new Date(series[i].date).getTime();
    path += ` H ${x(t)} V ${y(series[i].frontier)}`;
  }
  path += ` H ${x(t1)}`;

  $('#spark-title').textContent = `${sku.toLowerCase()} over time`;
  $('#spark-wrap').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(sku)} frontier over time">
    <line x1="${padL}" y1="${base}" x2="${W - padR + 40}" y2="${base}" stroke="var(--rule)"/>
    <path d="${path}" fill="none" stroke="var(--fg)" stroke-width="1.5"/>
    <text x="${x(t1) + 6}" y="${y(f1) + 4}" font-size="11" fill="var(--fg-1)">${f1}</text>
    <text x="${padL}" y="${base + 15}" font-size="10" fill="var(--fg-2)">${series[0].date}</text>
    <text x="${W - padR + 40}" y="${base + 15}" text-anchor="end" font-size="10" fill="var(--fg-2)">${dates[dates.length - 1]}</text>
  </svg>`;
  $('#spark-section').hidden = false;
}

function renderEta(drops, sel) {
  const box = $('#eta');
  if (!sel) {
    box.hidden = true;
    return;
  }
  const r = computeEta(drops, sel.sku, sel.block);
  const name = sel.sku.toLowerCase();
  const caveat = $('#eta-caveat');
  caveat.hidden = true;

  if (r.kind === 'no-data') {
    $('#eta-headline').textContent = 'not enough data';
    $('#eta-detail').textContent = `no shipping history for ${name} yet — check back after the next drop.`;
  } else if (r.kind === 'passed') {
    $('#eta-headline').textContent = 'shipped (or imminent)';
    $('#eta-detail').textContent = `the ${name} frontier (${r.frontier}xx) has passed your block ${sel.block}xx. if nothing has arrived, check your order status with ayn.`;
  } else {
    const rel = humanizeDays((r.mid.getTime() - Date.now()) / DAY);
    $('#eta-headline').innerHTML =
      `~${fmtDate(r.mid)} <span class="rel">${rel === 'today' ? 'any day now' : `${esc(rel)} away`}</span>` +
      `<span class="range">window: ${fmtDate(r.opt)} → ${fmtDate(r.cons)}</span>`;
    const mv = lastMove(drops, sel.sku);
    const since = (Date.now() - new Date(mv.date).getTime()) / DAY;
    $('#eta-detail').textContent =
      `${name} frontier: ${r.frontier}xx · you: ${sel.block}xx · ${r.remaining} blocks to go\n` +
      `rate: ~${r.rActive.toFixed(1)} blocks/day active · ~${r.rOverall.toFixed(1)} overall\n` +
      `last ${name} drop: ${mv.date} (+${mv.gain}) · ${since < 1 ? 'today' : `${humanizeDays(since)} ago`}`;
    if (r.packMax >= sel.block) {
      caveat.textContent = `the pack leader (${r.packMax}xx) is already past your number — waiting on the ${name} sweep`;
      caveat.hidden = false;
    } else if (sel.block > r.packMax + 250) {
      caveat.textContent = 'long extrapolation — the further out, the rougher the guess';
      caveat.hidden = false;
    }
  }
  box.hidden = false;
}

function renderLog(drops, sel) {
  const log = dropLog(drops, 4);
  if (!log.length) {
    $('#log-section').hidden = true;
    return;
  }
  let rows = '';
  for (const day of log) {
    day.items.forEach((it, i) => {
      const mine = sel && it.sku === sel.sku;
      rows += `<tr class="${i === 0 ? 'log__day' : ''}${mine ? ' log__mine' : ''}">
        <td class="log__date">${i === 0 ? day.date : ''}</td>
        <td>${esc(shortSku(it.sku)).toLowerCase()}${mine ? ' *' : ''}</td>
        <td class="log__range">${it.from}xx → ${it.to}xx</td>
        <td class="log__gain">+${it.gain}</td></tr>`;
    });
  }
  const pace = packPace(drops);
  $('#pace-line').textContent = pace
    ? `sweep pace, all models: ~${Math.round(pace.recent)} blocks/day lately · ~${Math.round(pace.overall)} long-run`
    : '';
  $('#log-wrap').innerHTML = `<table class="log" aria-label="latest drops">${rows}</table>`;
  $('#log-section').hidden = false;
}

function renderMeta(data) {
  const dates = allDates(data.drops);
  const fetched = new Date(data.updated);
  $('#meta-line').textContent =
    `last drop: ${dates[dates.length - 1]} · last fetched: ${fetched.toISOString().slice(0, 16).replace('T', ' ')} utc`;
  const staleHours = (Date.now() - fetched.getTime()) / 3600000;
  if (staleHours > STALE_HOURS) {
    const el = $('#stale');
    el.textContent = `# data last fetched ${Math.floor(staleHours / 24)}d ago — the updater may be stuck; frontiers may have moved since.`;
    el.hidden = false;
  }
}

// ---------- state + form ----------

function readState(skus) {
  const bySlug = new Map(skus.map((s) => [slug(s), s]));
  const q = new URLSearchParams(location.search);
  const stored = (() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) ?? {}; } catch { return {}; }
  })();
  const block = Number(q.get('block') ?? stored.block);
  const sku = bySlug.get(q.get('sku') ?? stored.sku);
  return Number.isInteger(block) && block >= 1000 && block <= 9999 && sku ? { block, sku } : null;
}

function writeState(sel) {
  localStorage.setItem(LS_KEY, JSON.stringify({ block: sel.block, sku: slug(sel.sku) }));
  const q = new URLSearchParams();
  q.set('block', sel.block);
  q.set('sku', slug(sel.sku));
  history.replaceState(null, '', `?${q}`);
}

// ---------- picker (mirrors AYN's order page: model × color) ----------

const SWATCH = new Map([
  ['Black', 'swatch--black'],
  ['White', 'swatch--white'],
  ['Rainbow', 'swatch--rainbow'],
  ['Clear Purple', 'swatch--clear-purple'],
]);
const MODEL_ORDER = ['Lite', 'Base', 'Pro', 'Max', 'Max 512'];
const MODEL_LABELS = new Map([
  ['Lite', 'lite 8+128gb'],
  ['Base', 'base 8+128gb'],
  ['Pro', 'pro 12+256gb'],
  ['Max', 'max 16+1tb'],
  ['Max 512', 'max 16+512gb'],
]);

const data = await (await fetch('data.json', { cache: 'no-store' })).json();
const skuList = [...frontiers(data.drops).keys()];
const combos = new Set(skuList.map((s) => {
  const { color, model } = splitSku(s);
  return `${color}|${model}`;
}));
const colorlessModel = (m) => combos.has(`null|${m}`);
const models = [...new Set(skuList.map((s) => splitSku(s).model))].sort((a, b) => {
  const ia = MODEL_ORDER.indexOf(a);
  const ib = MODEL_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
});
const colors = COLORS.filter((c) => skuList.some((s) => splitSku(s).color === c));

let sel = readState(skuList);
let pick = sel ? splitSku(sel.sku) : { color: null, model: null };

function updateChips() {
  for (const b of $('#model-chips').children) {
    const m = b.dataset.model;
    b.setAttribute('aria-checked', String(pick.model === m));
    b.disabled = pick.color ? !combos.has(`${pick.color}|${m}`) && !colorlessModel(m) : false;
  }
  for (const b of $('#color-chips').children) {
    const c = b.dataset.color;
    b.setAttribute('aria-checked', String(pick.color === c));
    b.disabled = pick.model ? !combos.has(`${c}|${pick.model}`) : false;
  }
}

function buildChips() {
  for (const m of models) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'radio');
    b.dataset.model = m;
    b.textContent = MODEL_LABELS.get(m) ?? m.toLowerCase();
    b.addEventListener('click', () => {
      pick.model = m;
      if (colorlessModel(m) || (pick.color && !combos.has(`${pick.color}|${m}`))) pick.color = null;
      updateChips();
    });
    $('#model-chips').appendChild(b);
  }
  for (const c of colors) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'radio');
    b.dataset.color = c;
    const sw = document.createElement('span');
    sw.className = `swatch ${SWATCH.get(c) ?? ''}`;
    b.append(sw, c.toLowerCase());
    b.addEventListener('click', () => {
      pick.color = c;
      updateChips();
    });
    $('#color-chips').appendChild(b);
  }
  updateChips();
}

function renderAll() {
  renderChart(data.drops, sel);
  renderEta(data.drops, sel);
  renderLog(data.drops, sel);
  if (sel) renderSpark(data.drops, sel.sku);
  else $('#spark-section').hidden = true;
}

const orderInput = $('#order-input');
// Privacy: the field only ever holds the 4-digit block — pasting a full
// "OD2761058" is trimmed to "2761" immediately and the rest is discarded.
orderInput.addEventListener('input', () => {
  const digits = orderInput.value.replace(/\D/g, '').slice(0, 4);
  if (orderInput.value !== digits) orderInput.value = digits;
});

if (sel) orderInput.value = String(sel.block);
buildChips();
renderMeta(data);
renderAll();

$('#order-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const err = $('#form-error');
  err.hidden = true;
  const fail = (msg) => {
    err.textContent = msg;
    err.hidden = false;
  };
  const digits = orderInput.value.replace(/\D/g, '');
  const block = Number(digits);
  if (digits.length !== 4 || block < 1000) {
    return fail('enter the first 4 digits of your order number (e.g. OD2761058 → 2761)');
  }
  if (!pick.model) return fail('choose your model');
  const needsColor = !colorlessModel(pick.model);
  if (needsColor && !pick.color) return fail('choose your color');
  sel = { block, sku: needsColor ? `${pick.color} ${pick.model}` : pick.model };
  writeState(sel);
  renderAll();
});
