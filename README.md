# ayn-thor-tracker

Unofficial shipment tracker for the [AYN Thor](https://www.ayntec.com/products/ayn-thor) gaming handheld. AYN publishes shipped order-number ranges per model on their [shipment dashboard](https://www.ayntec.com/pages/shipment-dashboard); this scrapes that page, keeps an append-only history, and renders each model's shipping *frontier* on the shared order-number line — with a marker for your own order and an ETA estimate.

**Live:** https://thor.rlew.io

Enter your order number (only the first 4 digits are kept — one "block" = 100 orders, matching the `xx`-masked ranges AYN publishes) and pick your model. Your view is bookmarkable: `?block=2761&sku=rainbow-pro`.

Not affiliated with AYN. Estimates only — extrapolated from published ranges.

## How it works

- A scheduled GitHub Action (`update.yml`, twice daily) fetches the dashboard, parses the dated drops, merges them into `public/data.json`, commits, and deploys to Cloudflare Workers (static assets).
- **The repo is the canonical history.** The live page trims its own older entries (observed 2026-08: everything before 2026-07-03 disappeared), so history is merge-only — a fetch can add drops but never remove them. `public/data.json` ships with seed data that is no longer recoverable from the page.
- The site is dependency-free vanilla JS + hand-rolled SVG, styled after the shout.sh design system (monochrome terminal).

### Parsing

The page is a flat list of paragraphs: a `YYYY/M/D` date heading, then lines like `AYN Thor White Max（512）: 2580xx--2627xx`. Text is normalised first (full-width punctuation, `&nbsp;`, whitespace), then matched; unknown model names are treated as new SKUs, not errors. See `scripts/parse.mjs` and the quirks covered in `tests/parse.test.mjs`.

### Metrics

- **Frontier** = running max `to` per SKU. Order numbers are one global sequence swept per-SKU, so frontier movement is the throughput — never sum range widths across SKUs.
- **Rates** = frontier gain per day, both overall and "active" (excluding whole-line gaps > 4 days — AYN paused entirely 2026-07-18 → 2026-08-06).
- **ETA** = remaining blocks / rate, shown as an optimistic→conservative window.

## Development

```sh
npm test        # parser tests (node --test)
npm run fetch   # one live fetch+merge into public/data.json
npm run serve   # serve public/ on :8787
```

## Deploy setup (once)

Repo secrets:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Workers deploy (edit permission) |
| `CLOUDFLARE_ACCOUNT_ID` | Workers deploy |
| `HUBBUB_ALERT_KEY` | hubbub bearer key; `POST /v1/notify` on fetch/parse failure (optional) |

`wrangler.jsonc` binds the custom domain `thor.rlew.io` (zone must be on the same Cloudflare account). Without the CF secrets, the workflows still fetch and commit data — deploy steps are skipped.

## Politeness

One GET per scheduled run, identified User-Agent, no crawling. The page updates at most once a day; the cron runs twice daily only to tolerate a missed run.
