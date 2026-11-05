# Lazy Trade Dashboard

A self-contained Node.js/Express dashboard for trade review, pre-trade notes, and the Lazy Trade short-side exhaustion screener.

> This project is for research and manual review only. It does not provide investment advice and the included endpoints must not be treated as an automated trading system.

## Requirements

- Node.js 20+
- npm
- Polygon/Massive API key for live screener refresh (optional for the dashboard UI)
- Alpaca credentials for intraday chart data (optional)

## Quick start

```bash
git clone https://github.com/YOUR-ORG/lazy-trade-dashboard.git
cd lazy-trade-dashboard
npm install
cp .env.example .env
npm run db:init
npm start
```

Open http://localhost:3456/#lazy-watchlist.

The dashboard can load with an empty database. To use an existing Cobra database, set `DB_PATH` to its path or copy it into `data/trading/cobra/` locally (database files are intentionally ignored by git).

## Lazy screener

The screener uses Polygon-compatible aggregates and writes its result to `data/trading/lazy-trade-screener-latest.json`.

```bash
POLYGON_API_KEY=... npm run lazy:screener
```

The API endpoint `POST /api/lazy/refresh` runs the same command. Configure thresholds with the `LAZY_*` environment variables documented in `scripts/trading/lazy-trade-screener.mjs`.

## Optional integrations

- Alpaca: chart data via `ALPACA_API_KEY` and `ALPACA_SECRET_KEY`.
- Anthropic: coach chat via `ANTHROPIC_API_KEY`.
- OpenClaw-compatible gateway: screenshot extraction via `OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN`.
- Dux scanner: set `DUX_SCANNER_SCRIPT` and `DUX_PYTHON`; the endpoint remains unavailable when these are not configured.

No credentials are read from `pass`, and no secret is embedded in the source. Use environment variables or a secret manager in deployments.

## API/data notes

`schema.sql` defines the supported SQLite schema. The repository intentionally excludes personal trade history, screenshots, generated screener output, API credentials, and runtime logs. Colleagues should import their own data through the appropriate integration or local tooling.

## Development

```bash
npm run db:init
npm run dev
node --check server.mjs
node --check scripts/init-db.mjs
node --check scripts/trading/lazy-trade-screener.mjs
```

## License

MIT
