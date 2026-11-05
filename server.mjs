import express from 'express';
import { execFileSync } from 'child_process';
import { readdirSync, createReadStream, statSync, writeFileSync, unlinkSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import Database from 'better-sqlite3';
import { calcDroppiness } from './droppiness.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WORKSPACE = process.env.WORKSPACE || __dirname;
const DB_PATH = process.env.DB_PATH || join(WORKSPACE, 'data/trading/cobra/cobra-trades.db');
const dbDir = join(WORKSPACE, 'data/trading/cobra');
const PORT = Number(process.env.PORT || 3456);
const MOMO10_DASH_PATH = join(WORKSPACE, 'data/momo10/dashboard.json');
const MOMO10_DRAFT_DIR = join(WORKSPACE, 'data/momo10/drafts');
const LAZY_SCREENER_PATH = join(WORKSPACE, 'data/trading/lazy-trade-screener-latest.json');
const LAZY_STATE_PATH = join(WORKSPACE, 'data/trading/lazy-trade-alert-state.json');
const LAZY_SCREENER_SCRIPT = join(WORKSPACE, 'scripts/trading/lazy-trade-screener.mjs');
const DUX_SCANNER_SCRIPT = process.env.DUX_SCANNER_SCRIPT || '';
const DUX_PYTHON = process.env.DUX_PYTHON || '';
const DUX_OUTPUT_DIR = join(WORKSPACE, 'data/trading/dux');

const OPENCLAW_GATEWAY_TOKEN = (process.env.OPENCLAW_GATEWAY_TOKEN || '').trim();

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const app = express();
app.use(express.json({ limit: '20mb' }));

// Health check endpoint (machine-readable, for programmatic monitoring)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', port: 3456 });
});

// Credentials are supplied explicitly through environment variables.
const CLAUDE_API_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const POLYGON_API_KEY = (process.env.POLYGON_API_KEY || '').trim();
const MASSIVE_API_KEY = (process.env.MASSIVE_API_KEY || POLYGON_API_KEY).trim();
const ALPACA_API_KEY = (process.env.ALPACA_API_KEY || '').trim();
const ALPACA_SECRET_KEY = (process.env.ALPACA_SECRET_KEY || '').trim();

// Load Tradier token (already loaded above as TRADIER_TOKEN)
// Reuse the existing token for market data queries

// ─── DB Helpers ───────────────────────────────────────────────────────────────

function query(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function queryOne(sql, params = []) {
  return db.prepare(sql).get(...params) || null;
}

function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeTimeframe(tf) {
  if (!tf) return tf;
  const s = String(tf).trim();
  // Already correct format (e.g. "3m", "1h", "1D")
  if (/^\d+(m|h|D|W|M)$/.test(s)) return s;
  // Bare number — TradingView shows minutes as bare numbers
  if (/^\d+$/.test(s)) {
    const n = parseInt(s);
    if (n < 60) return `${n}m`;
    if (n === 60) return '1h';
    if (n === 120) return '2h';
    if (n === 180) return '3h';
    if (n === 240) return '4h';
    if (n === 360) return '6h';
    if (n === 720) return '12h';
    return `${n}m`; // fallback
  }
  // Handle "D", "W", "M" without number
  if (s === 'D') return '1D';
  if (s === 'W') return '1W';
  if (s === 'M') return '1M';
  return s;
}

// ─── Chart Image Route ────────────────────────────────────────────────────────

app.get('/api/charts/:tradeId', (req, res) => {
  const { tradeId } = req.params;
  const imagesDir = join(dbDir, 'charts/images');
  let match = null;
  try {
    const files = readdirSync(imagesDir);
    match = files.find(f => f.startsWith(tradeId + '-') && f.endsWith('.png'));
  } catch { /* dir missing */ }
  if (!match) return res.status(404).json({ error: 'No chart found' });
  const imgPath = join(imagesDir, match);
  try {
    statSync(imgPath);
    res.setHeader('Content-Type', 'image/png');
    createReadStream(imgPath).pipe(res);
  } catch {
    res.status(404).json({ error: 'Chart file not readable' });
  }
});

// Pre-trade notes linked to a trade
app.get('/api/pre-trade/for-trade/:tradeId', (req, res) => {
  const tradeId = parseInt(req.params.tradeId);
  if (!tradeId) return res.status(400).json({ error: 'Invalid id' });
  const rows = query(`
    SELECT * FROM pre_trade_notes
    WHERE trade_id = ?
       OR related_trade_ids LIKE '%' || ? || '%'
       OR symbol = (SELECT symbol FROM trades WHERE id = ?)
    ORDER BY created_at DESC
    LIMIT 5
  `, [tradeId, tradeId, tradeId]);
  res.json(rows);
});

app.get('/api/momo10/current', (req, res) => {
  try {
    const raw = readFileSync(MOMO10_DASH_PATH, 'utf8');
    res.setHeader('Cache-Control', 'no-store');
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(404).json({ error: 'MOMO10 dashboard not available yet' });
  }
});

app.post('/api/momo10/draft', (req, res) => {
  try {
    const body = req.body || {};
    const ticker = String(body.ticker || '').trim().toUpperCase();
    if (!ticker) return res.status(400).json({ error: 'ticker required' });
    mkdirSync(MOMO10_DRAFT_DIR, { recursive: true });
    const now = new Date().toISOString();
    const draftId = `momo10-${now.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${ticker}`;
    const draft = {
      draft_id: draftId,
      created_at: now,
      ticker,
      entry: body.entry ?? null,
      stop: body.stop ?? null,
      target1: body.target1 ?? null,
      target2: body.target2 ?? null,
      source: 'momo10-watchlist',
      note: body.note || 'Auto-generated from MOMO10 watchlist',
      status: 'draft',
    };
    const file = join(MOMO10_DRAFT_DIR, `${draftId}.json`);
    writeFileSync(file, JSON.stringify(draft, null, 2));
    res.json({ ok: true, draft, file: `data/momo10/drafts/${draftId}.json` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/momo10/submit', (req, res) => {
  try {
    const body = req.body || {};
    const ticker = String(body.ticker || '').trim().toUpperCase();
    if (!ticker) return res.status(400).json({ error: 'ticker required' });
    const quantity = Number(body.quantity || 1);
    const entry = Number(body.entry || 0);
    if (!Number.isFinite(entry) || entry <= 0) return res.status(400).json({ error: 'valid entry required' });
    const thesis = String(body.note || `MOMO10 trade: ${ticker} buy-now setup`).trim();
    const args = [
      'scripts/trading/paper/submit-paper-trade-with-intent.sh',
      '--symbol', ticker,
      '--side', 'buy',
      '--quantity', String(quantity),
      '--type', 'limit',
      '--limit-price', String(entry.toFixed(2)),
      '--duration', 'day',
      '--thesis', thesis,
      '--strategy', 'momo10-paper',
      '--confirm',
    ];
    const out = execFileSync('bash', args, { cwd: WORKSPACE, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, env: { ...process.env, TRADIER_PAPER_ACCOUNT: 'VA8885219' } });
    res.json({ ok: true, output: out });
  } catch (err) {
    res.status(500).json({ error: err.message, stdout: err.stdout || '', stderr: err.stderr || '' });
  }
});

app.get('/api/lazy/current', (req, res) => {
  try {
    const screener = JSON.parse(readFileSync(LAZY_SCREENER_PATH, 'utf8'));
    const state = (() => {
      try {
        return JSON.parse(readFileSync(LAZY_STATE_PATH, 'utf8'));
      } catch {
        return null;
      }
    })();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ...screener,
      meta: {
        state,
        source: 'lazy-trade-screener',
      },
    });
  } catch (err) {
    res.status(404).json({ error: 'Lazy screener data not available yet' });
  }
});

app.post('/api/lazy/refresh', (req, res) => {
  try {
    const out = execFileSync('node', [LAZY_SCREENER_SCRIPT], {
      cwd: WORKSPACE,
      encoding: 'utf8',
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        LAZY_MAX_TICKERS: process.env.LAZY_MAX_TICKERS || '140',
        LAZY_MIN_DAY_VOL: process.env.LAZY_MIN_DAY_VOL || '300000',
      },
    });
    const screener = JSON.parse(readFileSync(LAZY_SCREENER_PATH, 'utf8'));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, output: out, generatedAt: screener.generatedAt, counts: screener.counts || null });
  } catch (err) {
    res.status(500).json({
      error: err.message,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    });
  }
});

// ─── Dux Short-Setup Scanner ──────────────────────────────────────────────────
app.post('/api/dux/scan', (req, res) => {
  if (!MASSIVE_API_KEY) return res.status(503).json({ error: 'Massive API key is not configured.' });
  if (!existsSync(DUX_SCANNER_SCRIPT)) return res.status(503).json({ error: 'Dux scanner script is not available.' });
  if (!existsSync(DUX_PYTHON)) return res.status(503).json({ error: 'Dux scanner virtual environment is not available.' });

  const body = req.body || {};
  const tickers = Array.isArray(body.tickers)
    ? body.tickers.map((value) => String(value || '').trim().toUpperCase()).filter((value) => /^[A-Z.]{1,12}$/.test(value)).slice(0, 100)
    : [];
  const tradeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? String(body.date) : null;
  const maxCandidates = Math.max(1, Math.min(Number(body.maxCandidates) || 75, 200));

  try {
    mkdirSync(DUX_OUTPUT_DIR, { recursive: true });
    const outFile = join(DUX_OUTPUT_DIR, `dux-scan-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
    const args = [DUX_SCANNER_SCRIPT, '--json', '--out', outFile, '--max-candidates', String(maxCandidates)];
    if (tradeDate) args.push('--date', tradeDate);
    if (tickers.length) args.push('--tickers', ...tickers);

    const stdout = execFileSync(DUX_PYTHON, args, {
      cwd: dirname(DUX_SCANNER_SCRIPT),
      encoding: 'utf8',
      timeout: 300000,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, MASSIVE_API_KEY },
    });
    const jsonLine = stdout.trim().split('\n').filter(Boolean).at(-1);
    const result = JSON.parse(jsonLine || '{}');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, ...result, source: tickers.length ? 'manual-tickers' : 'snapshot', csv: existsSync(outFile) ? outFile : null });
  } catch (err) {
    res.status(500).json({
      error: err.message,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    });
  }
});

app.use(express.static(join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => { res.setHeader('Cache-Control', 'no-store'); }
}));

// ─── Stats Routes ──────────────────────────────────────────────────────────────

// Helper: resolve ?since= param to a SQL date filter clause
// Accepts: 'week' | 'month' | 'ytd' | 'YYYY-MM-DD' | '' (all time)
function sinceClause(sinceParam) {
  if (!sinceParam) return '';
  const now = new Date();
  let cutoff = null;
  if (sinceParam === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    cutoff = d.toISOString().split('T')[0];
  } else if (sinceParam === 'month') {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    cutoff = d.toISOString().split('T')[0];
  } else if (sinceParam === 'ytd') {
    cutoff = `${now.getFullYear()}-01-01`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(sinceParam)) {
    cutoff = sinceParam;
  }
  return cutoff ? `AND start_datetime >= '${cutoff}'` : '';
}

app.get('/api/stats/overall', (req, res) => {
  const sf = sinceClause(req.query.since);
  const row = queryOne(`
    SELECT
      COUNT(*) as trade_count,
      ROUND(SUM(net_pl), 2) as total_net_pl,
      ROUND(AVG(CASE WHEN net_pl > 0 THEN net_pl END), 2) as avg_winner,
      ROUND(AVG(CASE WHEN net_pl < 0 THEN net_pl END), 2) as avg_loser,
      ROUND(100.0 * SUM(CASE WHEN net_pl > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) as win_rate,
      ROUND(
        SUM(CASE WHEN net_pl > 0 THEN net_pl ELSE 0 END) /
        NULLIF(ABS(SUM(CASE WHEN net_pl < 0 THEN net_pl ELSE 0 END)), 0),
        2
      ) as profit_factor
    FROM trades WHERE open = 0 ${sf}
  `);
  res.json(row);
});

app.get('/api/stats/hold-time', (req, res) => {
  const sf = sinceClause(req.query.since);
  const rows = query(`
    SELECT
      CASE
        WHEN hold_minutes < 5 THEN '0-5min'
        WHEN hold_minutes < 30 THEN '5-30min'
        WHEN hold_minutes < 120 THEN '30-120min'
        ELSE '120+min'
      END as bucket,
      COUNT(*) as count,
      ROUND(SUM(net_pl), 2) as net_pl,
      ROUND(100.0 * SUM(CASE WHEN net_pl > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) as win_rate,
      ROUND(AVG(net_pl), 2) as avg_pl
    FROM trades WHERE open = 0 AND hold_minutes IS NOT NULL ${sf}
    GROUP BY bucket
    ORDER BY MIN(hold_minutes)
  `);
  res.json(rows);
});

app.get('/api/stats/time-of-day', (req, res) => {
  const sf = sinceClause(req.query.since);
  const rows = query(`
    SELECT
      CAST(strftime('%H', start_datetime) AS INTEGER) as entry_hour,
      COUNT(*) as count,
      ROUND(SUM(net_pl), 2) as net_pl,
      ROUND(100.0 * SUM(CASE WHEN net_pl > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) as win_rate
    FROM trades WHERE open = 0 AND start_datetime IS NOT NULL ${sf}
    GROUP BY entry_hour
    ORDER BY entry_hour
  `);
  res.json(rows);
});

app.get('/api/stats/day-of-week', (req, res) => {
  const sf = sinceClause(req.query.since);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const rows = query(`
    SELECT
      CAST(strftime('%w', start_datetime) AS INTEGER) as day_of_week,
      COUNT(*) as count,
      ROUND(SUM(net_pl), 2) as net_pl,
      ROUND(100.0 * SUM(CASE WHEN net_pl > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) as win_rate
    FROM trades WHERE open = 0 AND start_datetime IS NOT NULL ${sf}
    GROUP BY day_of_week
    ORDER BY day_of_week
  `);
  res.json(rows.map(r => ({ ...r, day_name: dayNames[r.day_of_week] })));
});

app.get('/api/stats/by-symbol', (req, res) => {
  const sf = sinceClause(req.query.since);
  const limit = parseInt(req.query.limit) || 20;
  const sort = ['net_pl', 'count', 'win_rate', 'avg_pl', 'worst_trade', 'best_trade'].includes(req.query.sort)
    ? req.query.sort : 'net_pl';
  const rows = query(`
    SELECT
      symbol,
      COUNT(*) as count,
      ROUND(SUM(net_pl), 2) as net_pl,
      ROUND(100.0 * SUM(CASE WHEN net_pl > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) as win_rate,
      ROUND(AVG(net_pl), 2) as avg_pl,
      ROUND(MIN(net_pl), 2) as worst_trade,
      ROUND(MAX(net_pl), 2) as best_trade
    FROM trades WHERE open = 0 ${sf}
    GROUP BY symbol
    ORDER BY ${sort} ASC
    LIMIT ${limit}
  `);
  res.json(rows);
});

app.get('/api/stats/monthly', (req, res) => {
  const sf = sinceClause(req.query.since);
  const rows = query(`
    SELECT
      strftime('%Y-%m', start_datetime) as month,
      COUNT(*) as count,
      ROUND(SUM(net_pl), 2) as net_pl,
      ROUND(100.0 * SUM(CASE WHEN net_pl > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) as win_rate
    FROM trades WHERE open = 0 AND start_datetime IS NOT NULL ${sf}
    GROUP BY month
    ORDER BY month
  `);
  res.json(rows);
});

app.get('/api/stats/blowup', (req, res) => {
  const sf = sinceClause(req.query.since);
  const rows = query(`
    SELECT id, symbol, ROUND(net_pl, 2) as net_pl, hold_minutes, start_datetime
    FROM trades WHERE open = 0 ${sf}
    ORDER BY net_pl ASC
    LIMIT 20
  `);
  res.json(rows);
});

app.get('/api/stats/repeat-losers', (req, res) => {
  const sf = sinceClause(req.query.since);
  const rows = query(`
    SELECT
      symbol,
      COUNT(*) as loss_count,
      ROUND(SUM(net_pl), 2) as total_loss,
      ROUND(AVG(net_pl), 2) as avg_loss,
      ROUND(MIN(net_pl), 2) as worst_loss
    FROM trades WHERE open = 0 AND net_pl < 0 ${sf}
    GROUP BY symbol
    HAVING loss_count >= 2
    ORDER BY total_loss ASC
    LIMIT 20
  `);
  res.json(rows);
});

app.get('/api/stats/cumulative-pl', (req, res) => {
  const sf = sinceClause(req.query.since);
  const rows = query(`
    SELECT date(start_datetime) as trade_date,
           ROUND(SUM(net_pl), 2) as daily_pl
    FROM trades WHERE open = 0 AND start_datetime IS NOT NULL ${sf}
    GROUP BY trade_date
    ORDER BY trade_date ASC
  `);
  // Build running cumulative
  let cum = 0;
  const result = rows.map(r => {
    cum = Math.round((cum + r.daily_pl) * 100) / 100;
    return { date: r.trade_date, daily_pl: r.daily_pl, cumulative_pl: cum };
  });
  res.json(result);
});

// ─── Trades Routes ─────────────────────────────────────────────────────────────

app.get('/api/trades', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const symbol = req.query.symbol ? req.query.symbol.toUpperCase() : '';
  const validSorts = ['start_datetime', 'net_pl', 'hold_minutes', 'symbol'];
  const sort = validSorts.includes(req.query.sort) ? req.query.sort : 'start_datetime';
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';

  const whereSymbol = symbol ? `AND symbol = ?` : '';
  const params = symbol ? [symbol, limit, offset] : [limit, offset];

  const rows = db.prepare(`
    SELECT t.id, t.symbol, t.net_pl, t.hold_minutes, t.start_datetime, t.end_datetime,
           t.entry_price, t.exit_price, t.volume, t.side,
           CASE WHEN t.net_pl > 0 THEN 1 ELSE 0 END as is_win,
           EXISTS(
             SELECT 1
             FROM pre_trade_notes p
             WHERE p.trade_id = t.id
                OR p.related_trade_ids LIKE '%"' || t.id || '"%'
                OR p.related_trade_ids LIKE '%[' || t.id || ',%'
                OR p.related_trade_ids LIKE '%,' || t.id || ']%'
                OR p.related_trade_ids LIKE '%,' || t.id || ',%'
                OR UPPER(TRIM(p.symbol)) = UPPER(TRIM(t.symbol))
             LIMIT 1
           ) as has_pre_trade
    FROM trades t
    WHERE t.open = 0 ${whereSymbol}
    ORDER BY t.${sort} ${dir}
    LIMIT ? OFFSET ?
  `).all(...params);

  const countRow = db.prepare(`
    SELECT COUNT(*) as total FROM trades WHERE open = 0 ${whereSymbol}
  `).get(...(symbol ? [symbol] : []));

  res.json({ trades: rows, total: countRow.total, limit, offset });
});

app.get('/api/trades/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });

  const trade = queryOne(`SELECT * FROM trades WHERE id = ?`, [id]);
  if (!trade) return res.status(404).json({ error: 'Not found' });

  let executions = query(`SELECT * FROM executions WHERE trade_id = ? ORDER BY sequence, timestamp`, [id]);

  // Some imported trades have exec_count summary but missing execution rows.
  // Provide synthesized entry/exit rows so UI still shows actionable execution context.
  if ((!executions || executions.length === 0) && (trade.exec_count || 0) > 0) {
    const approxQty = Number(trade.volume || 0) > 0 ? Math.round(Number(trade.volume || 0) / 2) : null;
    executions = [
      {
        execution_id: `synthetic-${id}-entry`,
        trade_id: id,
        symbol: trade.symbol,
        timestamp: trade.start_datetime,
        quantity: approxQty,
        price: trade.entry_price,
        side: 'entry',
        broker_side: trade.side === 'long' ? 'buy' : 'sell',
        commission: null,
        trans_fee: null,
        ecn_fee: null,
        sequence: 1,
        imported_at: trade.imported_at,
        synthetic: 1,
      },
      {
        execution_id: `synthetic-${id}-exit`,
        trade_id: id,
        symbol: trade.symbol,
        timestamp: trade.end_datetime,
        quantity: approxQty,
        price: trade.exit_price,
        side: 'exit',
        broker_side: trade.side === 'long' ? 'sell' : 'cover',
        commission: null,
        trans_fee: null,
        ecn_fee: null,
        sequence: 2,
        imported_at: trade.imported_at,
        synthetic: 1,
      },
    ].filter(r => r.timestamp && Number.isFinite(Number(r.price)));
  }
  const fundamentals = queryOne(`SELECT * FROM trade_fundamentals WHERE trade_id = ?`, [id]);
  const preNote = fundamentals?.linked_pre_trade_id
    ? queryOne(`SELECT * FROM pre_trade_notes WHERE id = ?`, [fundamentals.linked_pre_trade_id])
    : null;

  const runningPl = buildRunningPl(executions, trade.side);
  res.json({ ...trade, executions, fundamentals, pre_trade_note: preNote, running_pl: runningPl });
});

function buildRunningPl(executions, tradeSide) {
  const isLong = String(tradeSide || '').toLowerCase().includes('long');
  let cum = 0;
  return (executions || []).map((e) => {
    const qty = Math.abs(Number(e.quantity || 0));
    const price = Number(e.price || 0);
    if (!qty || !price) return null;
    const classification = classifyExecution(e, isLong);
    let delta = 0;
    if (classification === 'opening') {
      delta = isLong ? -qty * price : qty * price;
    } else if (classification === 'closing') {
      delta = isLong ? qty * price : -qty * price;
    }
    cum += delta;
    return {
      timestamp: e.timestamp,
      value: Math.round(cum * 100) / 100,
      side: e.side || e.broker_side || null,
      price,
      quantity: qty,
    };
  }).filter(Boolean);
}

function isOpeningLabel(sideText, isLong) {
  const s = String(sideText || '').toLowerCase();
  if (isLong) return s.includes('buy') || s.includes('entry') || s.includes('open');
  return s.includes('sell') || s.includes('short') || s.includes('entry') || s.includes('open');
}

function isClosingLabel(sideText, isLong) {
  const s = String(sideText || '').toLowerCase();
  if (isLong) return s.includes('sell') || s.includes('exit') || s.includes('close');
  return s.includes('buy') || s.includes('cover') || s.includes('exit') || s.includes('close');
}

function classifyExecution(exec, isLong) {
  const sideText = String(exec?.side || exec?.broker_side || '').toLowerCase();
  const signedQty = Number(exec?.quantity || 0);
  const positionHint = Number(exec?.position ?? exec?.position_after ?? exec?.running_position ?? NaN);

  const isBuy = sideText.includes('buy') || sideText.includes('cover');
  const isSell = sideText.includes('sell') || sideText.includes('short');
  const openingLabel = isLong
    ? sideText.includes('buy') || sideText.includes('entry') || sideText.includes('open')
    : sideText.includes('sell') || sideText.includes('short') || sideText.includes('entry') || sideText.includes('open');
  const closingLabel = isLong
    ? sideText.includes('sell') || sideText.includes('exit') || sideText.includes('close')
    : sideText.includes('buy') || sideText.includes('cover') || sideText.includes('exit') || sideText.includes('close');

  if (openingLabel && !closingLabel) return 'opening';
  if (closingLabel && !openingLabel) return 'closing';

  if (isLong) {
    if (isBuy && !isSell) return 'opening';
    if (isSell && !isBuy) return 'closing';
  } else {
    if (isSell && !isBuy) return 'opening';
    if (isBuy && !isSell) return 'closing';
  }

  if (Number.isFinite(positionHint)) {
    if (isLong) return positionHint >= 0 ? 'opening' : 'closing';
    return positionHint <= 0 ? 'opening' : 'closing';
  }

  if (Number.isFinite(signedQty) && signedQty !== 0) {
    if (isLong) return signedQty > 0 ? 'opening' : 'closing';
    return signedQty < 0 ? 'opening' : 'closing';
  }

  return 'opening';
}

// ─── Pre-Trade Routes ──────────────────────────────────────────────────────────

app.get('/api/pre-trade', (req, res) => {
  res.json(query(`SELECT * FROM pre_trade_notes ORDER BY created_at DESC LIMIT 50`));
});

const PRE_TRADE_FIELDS = [
  'symbol', 'created_at', 'trade_id', 'gemini_output', 'droppiness',
  'float_shares', 'mkt_cap', 'dt_overall_risk', 'dt_offering_ability',
  'dt_overhead_supply', 'dt_historical', 'dt_cash_need', 'askedgar_risk',
  'askedgar_dilution_pct', 'cash_runway_months', 'warrant_risk', 'short_bias',
  'thesis', 'confidence', 'invalidation', 'notes',
  'company_name', 'sector', 'industry', 'exchange', 'ev', 'os_shares',
  'net_cash_per_share', 'inst_own_pct', 'si_pct', 'cash_burn_quarterly',
  'current_cash', 'chart_image', 'dt_image', 'rsi_at_entry', 'macd_status', 'timeframe',
  'entry_price', 'key_support', 'key_resistance'
];

function preTradeValues(b, includeCreatedAt = false) {
  const n = v => (v === '' || v === undefined) ? null : v;
  return {
    symbol: (b.symbol || '').toUpperCase(),
    created_at: includeCreatedAt ? new Date().toISOString() : undefined,
    trade_id: n(b.trade_id),
    gemini_output: n(b.gemini_output),
    droppiness: n(b.droppiness),
    float_shares: n(b.float_shares),
    mkt_cap: n(b.mkt_cap),
    dt_overall_risk: n(b.dt_overall_risk),
    dt_offering_ability: n(b.dt_offering_ability),
    dt_overhead_supply: n(b.dt_overhead_supply),
    dt_historical: n(b.dt_historical),
    dt_cash_need: n(b.dt_cash_need),
    askedgar_risk: n(b.askedgar_risk),
    askedgar_dilution_pct: n(b.askedgar_dilution_pct),
    cash_runway_months: n(b.cash_runway_months),
    warrant_risk: n(b.warrant_risk),
    short_bias: n(b.short_bias),
    thesis: n(b.thesis),
    confidence: n(b.confidence),
    invalidation: n(b.invalidation),
    notes: n(b.notes),
    company_name: n(b.company_name),
    sector: n(b.sector),
    industry: n(b.industry),
    exchange: n(b.exchange),
    ev: n(b.ev),
    os_shares: n(b.os_shares),
    net_cash_per_share: n(b.net_cash_per_share),
    inst_own_pct: n(b.inst_own_pct),
    si_pct: n(b.si_pct),
    cash_burn_quarterly: n(b.cash_burn_quarterly),
    current_cash: n(b.current_cash),
    chart_image: n(b.chart_image),
    dt_image: n(b.dt_image),
    rsi_at_entry: n(b.rsi_at_entry),
    macd_status: n(b.macd_status),
    timeframe: n(b.timeframe),
    entry_price: n(b.entry_price),
    key_support: n(b.key_support),
    key_resistance: n(b.key_resistance),
    related_trade_ids: n(b.related_trade_ids),
  };
}

app.post('/api/pre-trade', (req, res) => {
  const vals = preTradeValues(req.body, true);
  const fields = Object.keys(vals);
  const placeholders = fields.map(f => `@${f}`).join(', ');
  const stmt = db.prepare(`INSERT INTO pre_trade_notes (${fields.join(', ')}) VALUES (${placeholders})`);
  const info = stmt.run(vals);
  const inserted = queryOne(`SELECT * FROM pre_trade_notes WHERE id = ?`, [info.lastInsertRowid]);
  res.status(201).json(inserted);
});

app.put('/api/pre-trade/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });

  const vals = preTradeValues(req.body, false);
  // Remove created_at (not in vals when includeCreatedAt=false, but be explicit)
  delete vals.created_at;
  const setClauses = Object.keys(vals).map(f => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE pre_trade_notes SET ${setClauses} WHERE id = @id`).run({ ...vals, id });
  res.json(queryOne(`SELECT * FROM pre_trade_notes WHERE id = ?`, [id]));
});

app.delete('/api/pre-trade/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  db.prepare(`DELETE FROM pre_trade_notes WHERE id = ?`).run(id);
  res.json({ success: true });
});

app.put('/api/pre-trade/:id/link/:tradeId', (req, res) => {
  const id = parseInt(req.params.id);
  const tradeId = parseInt(req.params.tradeId);
  if (!id || !tradeId) return res.status(400).json({ error: 'Invalid ids' });
  db.prepare(`UPDATE pre_trade_notes SET trade_id = ? WHERE id = ?`).run(tradeId, id);
  res.json({ success: true });
});

// ─── Droppiness ───────────────────────────────────────────────────────────────

app.get('/api/droppiness/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase().replace(/[^A-Z]/g, '');
  if (!ticker) return res.status(400).json({ ok: false, error: 'Invalid ticker' });
  try {
    console.log(`droppiness: calculating for ${ticker}...`);
    const result = await calcDroppiness(ticker);
    console.log(`droppiness: ${ticker} = ${result.score} (${result.spikeCount} spikes)`);
    res.json({ ok: true, ticker, ...result });
  } catch (err) {
    console.error(`droppiness error for ${ticker}:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Screenshot Extraction ─────────────────────────────────────────────────────

const DT_PROMPT = `Extract ALL visible data from this DilutionTracker screenshot. Return ONLY a valid JSON object with these exact keys (use null for any missing values):
{
  "symbol": null, "company_name": null, "sector": null, "industry": null, "country": null, "exchange": null,
  "mkt_cap": null, "ev": null, "float_shares": null, "os_shares": null,
  "net_cash_per_share": null, "inst_own_pct": null, "si_pct": null,
  "dt_overall_risk": null, "dt_offering_ability": null, "dt_overhead_supply": null,
  "dt_historical": null, "dt_cash_need": null,
  "cash_runway_months": null, "cash_burn_quarterly": null, "current_cash": null,
  "droppiness": null
}
For numeric fields extract numbers only — no $ M B % symbols. M = multiply by 1000000, B = multiply by 1000000000.
Risk fields should be "Low", "Medium", or "High".
Return ONLY the JSON object, no markdown, no explanation.`;

const TV_PROMPT = `Extract ALL visible trading data from this TradingView chart screenshot. Return ONLY a valid JSON object:
{
  "symbol": null, "timeframe": null, "rsi_at_entry": null, "macd_status": null,
  "entry_price": null, "key_support": null, "key_resistance": null, "notes": null
}
Rules:
- symbol: the SHORT ticker/symbol code shown in the top-left toolbar (e.g. "ROMA", "NVDA", "AAPL"). This is the all-caps short code, NOT the company name. Look for the ticker in the chart header bar — it appears before the "·" separator (e.g. "ROMA · 3 · NASDAQ" → "ROMA"). Strip exchange prefix if present (e.g. "NASDAQ:NVDA" → "NVDA"). Never abbreviate the company name — only use the actual ticker shown.
- timeframe: Find the interval indicator in the TradingView toolbar — it appears as a small number or letter near the top of the chart (e.g. "3", "5", "15", "D"). TradingView shows minutes as bare numbers: "1"=1m, "2"=2m, "3"=3m, "5"=5m, "10"=10m, "15"=15m, "30"=30m, "45"=45m, "60"=1h, "120"=2h, "240"=4h. Letters: "D"=1D, "W"=1W, "M"=1M. CRITICAL: if you are not 100% certain of the exact value shown, return null — do NOT guess or default to "1m".
- rsi_at_entry: if an RSI panel is visible, read the RSI value at the time of the FIRST trade entry marker on the chart (look for the earliest "Shorted" or "short" annotation). Do NOT read the current/last RSI value at the right edge of the chart — that reflects now, not entry. If you cannot identify an entry marker or RSI panel, return null.
- macd_status: if a MACD panel is visible, determine if MACD line is above signal line (Bullish), below (Bearish), or flat/crossing (Neutral). If no MACD panel, return null.
- entry_price: current price or last candle close shown on the right axis or price label. Number only.
- key_support: nearest visible support level below current price. Number only.
- key_resistance: nearest visible resistance level above current price. Number only.
- notes: any other notable observations (trend, pattern, volume spike, etc.). Plain text, 1-2 sentences max.
Return ONLY the JSON object, no markdown, no explanation.`;

app.post('/api/extract-screenshot', async (req, res) => {
  const { image, type } = req.body;
  if (!image || !type) return res.status(400).json({ ok: false, error: 'Missing image or type' });

  const tmpImg = `/tmp/extract-${Date.now()}.png`;
  try {
    writeFileSync(tmpImg, Buffer.from(image, 'base64'));

    const prompt = type === 'dilutiontracker' ? DT_PROMPT : TV_PROMPT;

    // Detect MIME type from magic bytes
    const headerBytes = Buffer.from(image.slice(0, 16), 'base64');
    let mediaType = 'image/png';
    if (headerBytes[0] === 0xFF && headerBytes[1] === 0xD8) mediaType = 'image/jpeg';
    else if (headerBytes[0] === 0x47 && headerBytes[1] === 0x49 && headerBytes[2] === 0x46) mediaType = 'image/gif';
    else if (headerBytes[8] === 0x57 && headerBytes[9] === 0x45 && headerBytes[10] === 0x42) mediaType = 'image/webp';
    console.log(`extract-screenshot: type=${type} mediaType=${mediaType} imageLen=${image.length}`);

    const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
    const gatewayToken = OPENCLAW_GATEWAY_TOKEN;
    if (!gatewayToken) throw new Error('No OpenClaw gateway token available — check ~/.openclaw/openclaw.json or OPENCLAW_GATEWAY_TOKEN');

    let apiResp = await fetch(`${gatewayUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({
        model: 'openclaw/default',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${image}` } }
          ]
        }],
        temperature: 0,
        max_tokens: 512,
      }),
    });

    let rawText = await apiResp.text();
    let apiJson;
    try { apiJson = JSON.parse(rawText); } catch { apiJson = { raw: rawText }; }
    if (!apiResp.ok || apiJson.error) {
      const msg = apiJson?.error?.message || apiJson?.error?.type || rawText || `HTTP ${apiResp.status}`;
      console.warn(`[extract-screenshot] OpenClaw gateway failure status=${apiResp.status} body=${rawText.slice(0, 1000)}`);
      if (/missing scope: operator\.write/i.test(msg) && CLAUDE_API_KEY) {
        console.warn('[extract-screenshot] falling back to Anthropic direct because gateway token lacks operator.write');
        apiResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 512,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
                { type: 'text', text: prompt }
              ]
            }]
          }),
        });
        rawText = await apiResp.text();
        try { apiJson = JSON.parse(rawText); } catch { apiJson = { raw: rawText }; }
      }
      if (!apiResp.ok || apiJson.error) {
        if (/unauthorized|forbidden|token/i.test(msg)) {
          throw new Error('OpenClaw gateway token invalid or expired');
        }
        throw new Error(`OpenClaw gateway request failed (HTTP ${apiResp.status}): ${msg}`);
      }
    }
    const text = apiJson.choices?.[0]?.message?.content || apiJson.content?.[0]?.text || '';
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    const parsed = JSON.parse(cleaned);

    // Server-side normalization for TV extractions
    console.log(`extract raw:`, JSON.stringify(parsed));
    if (type === 'tradingview' && parsed.timeframe) {
      const before = parsed.timeframe;
      parsed.timeframe = normalizeTimeframe(parsed.timeframe);
      console.log(`timeframe: ${before} → ${parsed.timeframe}`);
    }
    // entry_price from TV chart is the last visible price, not the user's fill — always discard it
    if (type === 'tradingview') delete parsed.entry_price;

    try { unlinkSync(tmpImg); } catch { /* ignore */ }
    res.json({ ok: true, extracted: parsed, type });
  } catch (err) {
    try { unlinkSync(tmpImg); } catch { /* ignore */ }
    console.warn('[extract-screenshot] failed:', err?.stack || err?.message || String(err));
    res.status(500).json({ ok: false, error: err?.message || String(err), stack: err?.stack || null });
  }
});

// ─── Coach Chat ───────────────────────────────────────────────────────────────

app.post('/api/coach/chat', async (req, res) => {
  const { message, model = 'haiku', context = {}, conversationHistory = [] } = req.body;
  
  if (!message || !CLAUDE_API_KEY) {
    return res.status(400).json({ error: 'Missing message or API key' });
  }

  // Map haiku -> actual model
  const modelMap = {
    haiku: 'claude-haiku-4-5',
    sonnet: 'claude-sonnet-4-20250514',
    'gpt-4': 'claude-sonnet-4-20250514' // fallback to sonnet for now
  };
  
  const selectedModel = modelMap[model] || modelMap.haiku;

  // Fetch recent trades for context (last 7 days)
  let recentTrades = [];
  try {
    const sql = `
      SELECT id, symbol, entry_price, exit_price, net_pl, hold_minutes, start_datetime
      FROM trades
      WHERE datetime(start_datetime) >= datetime('now', '-7 days')
      ORDER BY start_datetime DESC
      LIMIT 20
    `;
    recentTrades = db.prepare(sql).all() || [];
    console.log(`[coach] fetched ${recentTrades.length} trades from last 7 days`);
  } catch (e) {
    console.error('[coach] error fetching trades:', e.message);
  }

  // Build system prompt
  const tradesSummary = recentTrades.length > 0 ? `
RECENT TRADES (Last 7 days):
${recentTrades.map((t, i) => {
  const isWin = t.net_pl >= 0;
  return `${i + 1}. ${t.symbol} - $${t.entry_price.toFixed(2)} → $${t.exit_price.toFixed(2)} | ${isWin ? 'WIN' : 'LOSS'} $${Math.abs(t.net_pl).toFixed(2)} | ${t.hold_minutes}min`;
}).join('\n')}

Weekly P/L: $${recentTrades.reduce((sum, t) => sum + t.net_pl, 0).toFixed(2)}
Win Rate: ${(recentTrades.filter(t => t.net_pl >= 0).length / recentTrades.length * 100).toFixed(1)}%
` : 'No recent trades found.';

  const systemPrompt = `You are an experienced trading coach helping a trader analyze their trades and improve their strategy.

You have access to:
- Recent trade history (last 7 days)
- Current trade details (entry, exit, duration, P/L)
- Pre-trade thesis and setup notes
- Trade history patterns and performance metrics
- Technical analysis (RSI, MACD, levels)
- DilutionTracker and TradingView screenshots

Your role:
- Identify patterns in winners vs losers
- Help validate or challenge setup criteria
- Discuss risk management and position sizing
- Ask probing questions about trade decisions
- Provide outside context (market conditions, catalyst events)
- Be honest about what worked and what didn't

Style:
- Direct and analytical, not promotional
- Use specific numbers and patterns from actual trades
- Point to evidence (thesis match, technical setup accuracy, risk/reward)
- No trading signals or predictions — focus on process and learning

${tradesSummary}

${context.currentTrade ? `
CURRENTLY VIEWING:
Symbol: ${context.currentTrade.symbol}
Entry: $${context.currentTrade.entry_price?.toFixed(2)} | Exit: $${context.currentTrade.exit_price?.toFixed(2)}
Hold: ${Math.round(context.currentTrade.hold_minutes)} min | Result: ${context.currentTrade.net_pl >= 0 ? 'WIN' : 'LOSS'} ($${Math.abs(context.currentTrade.net_pl).toFixed(2)})
` : ''}`;

  try {
    // Build messages array with conversation history
    const messages = [
      ...conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      { role: 'user', content: message }
    ];

    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: selectedModel,
        max_tokens: 1024,
        system: systemPrompt,
        messages
      }),
    });

    const apiJson = await apiResp.json();
    if (apiJson.error) throw new Error(apiJson.error.message || JSON.stringify(apiJson.error));
    
    const reply = apiJson.content?.[0]?.text || '';
    res.json({ ok: true, reply });
  } catch (err) {
    console.error('Coach chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Chart Data (1m bars from Alpaca) ──────────────────────

app.get('/api/chart-data/:symbol/:tradeDate/:tradeId', async (req, res) => {
  const { symbol, tradeDate, tradeId } = req.params;
  console.log(`[chart-data] symbol=${symbol}, tradeDate=${tradeDate}, tradeId=${tradeId}`);

  if (!ALPACA_API_KEY || !ALPACA_SECRET_KEY) {
    return res.status(500).json({ error: 'Alpaca API credentials not configured' });
  }

  try {
    // Primary source: Alpaca 1-minute bars for full intraday context
    let bars = [];
    let source = 'none';

    // Full market session in ET (04:00-20:00)
    const month = Number(tradeDate.slice(5, 7));
    const etOffset = (month >= 3 && month <= 11) ? '-04:00' : '-05:00';
    const startIso = new Date(`${tradeDate}T04:00:00${etOffset}`).toISOString();
    const endIso = new Date(`${tradeDate}T20:00:00${etOffset}`).toISOString();

    try {
      const alpacaUrl = new URL('https://data.alpaca.markets/v2/stocks/bars');
      alpacaUrl.searchParams.set('symbols', symbol.toUpperCase());
      alpacaUrl.searchParams.set('timeframe', '1Min');
      alpacaUrl.searchParams.set('start', startIso);
      alpacaUrl.searchParams.set('end', endIso);
      alpacaUrl.searchParams.set('limit', '10000');
      alpacaUrl.searchParams.set('adjustment', 'raw');

      const alpacaResp = await fetch(alpacaUrl.toString(), {
        headers: {
          'APCA-API-KEY-ID': ALPACA_API_KEY,
          'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
        },
      });

      if (alpacaResp.ok) {
        const alpacaData = await alpacaResp.json();
        const rows = alpacaData?.bars?.[symbol.toUpperCase()] || [];
        bars = rows.map((b) => ({
          timestamp: b.t,
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: b.v,
        }));
        if (bars.length > 0) source = 'alpaca';
      } else {
        const errText = await alpacaResp.text();
        console.warn('Alpaca bars error:', alpacaResp.status, errText.slice(0, 200));
      }
    } catch (e) {
      console.warn('Alpaca bars fetch error:', e.message);
    }

    // Fallback 1: build bars from execution data for this specific trade
    if (bars.length === 0) {
      try {
        const executions = db
          .prepare(`
            SELECT timestamp, side, quantity, price
            FROM executions
            WHERE trade_id = ? AND symbol = ?
            ORDER BY timestamp ASC
          `)
          .all(tradeId, symbol);

        if (executions && executions.length > 0) {
          const barMap = new Map();
          executions.forEach(exec => {
            const execTime = new Date(exec.timestamp);
            execTime.setSeconds(0, 0);
            const barKey = execTime.toISOString();
            const price = parseFloat(exec.price);
            const qty = parseInt(exec.quantity);

            if (!barMap.has(barKey)) {
              barMap.set(barKey, {
                timestamp: barKey,
                open: price,
                high: price,
                low: price,
                close: price,
                volume: qty,
              });
            } else {
              const bar = barMap.get(barKey);
              bar.high = Math.max(bar.high, price);
              bar.low = Math.min(bar.low, price);
              bar.close = price;
              bar.volume += qty;
            }
          });

          bars = Array.from(barMap.values()).sort((a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
          if (bars.length > 0) source = 'executions';
        }
      } catch (e) {
        console.warn('Execution data error:', e.message);
      }
    }

    // Fallback 2: Polygon daily
    if (bars.length === 0 && POLYGON_API_KEY) {
      try {
        const polygonUrl = `https://api.polygon.io/v1/open-close/${symbol.toUpperCase()}/${tradeDate}?adjusted=true&apiKey=${POLYGON_API_KEY}`;
        const polygonResp = await fetch(polygonUrl);
        const dailyData = polygonResp.ok ? await polygonResp.json() : null;

        if (dailyData && dailyData.from) {
          bars = [{
            timestamp: `${tradeDate}T13:30:00Z`,
            open: dailyData.open,
            high: dailyData.high,
            low: dailyData.low,
            close: dailyData.close,
            volume: dailyData.volume,
          }];
          source = 'polygon-daily';
        }
      } catch (e) {
        console.warn('Polygon fallback error:', e.message);
      }
    }

    // Compute SMA(200) from 5-minute bars (for overlay on 1-minute chart)
    let sma200_5m = [];
    try {
      const tradeEnd = new Date(`${tradeDate}T20:00:00${etOffset}`); // full day end 20:00 ET
      const tradeStart = new Date(tradeEnd.getTime() - (14 * 24 * 60 * 60 * 1000)); // enough sessions for 200x5m

      const fiveUrl = new URL('https://data.alpaca.markets/v2/stocks/bars');
      fiveUrl.searchParams.set('symbols', symbol.toUpperCase());
      fiveUrl.searchParams.set('timeframe', '5Min');
      fiveUrl.searchParams.set('start', tradeStart.toISOString());
      fiveUrl.searchParams.set('end', tradeEnd.toISOString());
      fiveUrl.searchParams.set('limit', '10000');
      fiveUrl.searchParams.set('adjustment', 'raw');

      const fiveResp = await fetch(fiveUrl.toString(), {
        headers: {
          'APCA-API-KEY-ID': ALPACA_API_KEY,
          'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
        },
      });

      if (fiveResp.ok) {
        const fiveData = await fiveResp.json();
        const fiveBars = (fiveData?.bars?.[symbol.toUpperCase()] || []).sort((a, b) => new Date(a.t) - new Date(b.t));
        const closes = fiveBars.map(b => Number(b.c));
        for (let i = 199; i < fiveBars.length; i++) {
          let sum = 0;
          for (let j = i - 199; j <= i; j++) sum += closes[j];
          sma200_5m.push({
            timestamp: fiveBars[i].t,
            value: sum / 200,
          });
        }
      }
    } catch (e) {
      console.warn('SMA200(5m) calc error:', e.message);
    }

    // Get the trade record to extract entry/exit times
    const tradeRecord = queryOne(`
      SELECT id, start_datetime, end_datetime, entry_price, exit_price, side, volume
      FROM trades
      WHERE id = ?
      LIMIT 1
    `, [tradeId]);

    // Build markers from entry/exit times (with Eastern time formatted labels)
    const markers = [];
    const formatEasternTime = (isoStr) => {
      const dt = new Date(isoStr);
      return dt.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    };
    
    if (tradeRecord) {
      const tradeType = tradeRecord.side?.toLowerCase() === 'long' ? 'long' : 'short';

      // Share size labels for entry/exit markers
      const qtyRows = query(`
        SELECT side, SUM(ABS(COALESCE(quantity,0))) as qty
        FROM executions
        WHERE trade_id = ?
        GROUP BY side
      `, [tradeId]);
      const qtyBySide = Object.fromEntries((qtyRows || []).map(r => [String(r.side).toLowerCase(), Number(r.qty || 0)]));
      let entryQty = qtyBySide.entry || qtyBySide.open || qtyBySide.sell || 0;
      let exitQty = qtyBySide.exit || qtyBySide.cover || qtyBySide.close || qtyBySide.buy || 0;
      if ((!entryQty || !exitQty) && Number(tradeRecord.volume || 0) > 0) {
        const approx = Math.round(Number(tradeRecord.volume) / 2);
        if (!entryQty) entryQty = approx;
        if (!exitQty) exitQty = approx;
      }

      markers.push({
        timestamp: tradeRecord.start_datetime,
        side: 'entry',
        price: tradeRecord.entry_price,
        qty: entryQty,
        timeLabel: formatEasternTime(tradeRecord.start_datetime),
        tradeType,
      });
      if (tradeRecord.end_datetime) {
        markers.push({
          timestamp: tradeRecord.end_datetime,
          side: 'exit',
          price: tradeRecord.exit_price,
          qty: exitQty,
          timeLabel: formatEasternTime(tradeRecord.end_datetime),
          tradeType,
        });
      }
    }

    // Minute-by-minute running P/L series using signed cash + position MTM
    let running_pl_minute = [];
    try {
      if (tradeRecord && bars.length > 0) {
        const entryTime = tradeRecord.start_datetime ? new Date(tradeRecord.start_datetime).getTime() : null;
        const exitTime = tradeRecord.end_datetime ? new Date(tradeRecord.end_datetime).getTime() : null;
        const normalizeTime = (iso) => {
          const dt = new Date(iso);
          const utcTime = dt.getTime();
          const month = dt.getUTCMonth();
          const isDST = month >= 2 && month <= 10;
          const offset = isDST ? 4 * 60 * 60 * 1000 : 5 * 60 * 60 * 1000;
          return Math.floor((utcTime - offset) / 1000);
        };

        // Execution-derived signed cashflow and share position
        const execRows = query(`
          SELECT timestamp, side, quantity, price
          FROM executions
          WHERE trade_id = ? AND symbol = ?
          ORDER BY sequence ASC, timestamp ASC, execution_id ASC
        `, [tradeId, symbol]);

        let execs = (execRows || []).map(r => ({
          timestamp: r.timestamp,
          side: String(r.side || '').toLowerCase(),
          qty: Math.abs(Number(r.quantity || 0)),
          price: Number(r.price || 0),
        })).filter(r => r.timestamp && Number.isFinite(r.qty) && r.qty > 0 && Number.isFinite(r.price) && r.price > 0);

        // Fallback when execution detail rows are missing: synthesize a usable MTM path
        // from trade-level entry/exit data so the chart is approximate but not nonsense.
        if (execs.length === 0 && tradeRecord.start_datetime && tradeRecord.end_datetime) {
          const approxQty = Math.max(1, Math.round(Number(tradeRecord.volume || 0) / 2));
          const looksLong = String(tradeRecord.side || '').toLowerCase() === 'long';
          if (approxQty > 0 && Number.isFinite(Number(tradeRecord.entry_price || 0))) {
            execs.push({
              timestamp: tradeRecord.start_datetime,
              side: looksLong ? 'buy' : 'short',
              qty: approxQty,
              price: Number(tradeRecord.entry_price),
            });
          }
          if (approxQty > 0 && Number.isFinite(Number(tradeRecord.exit_price || 0))) {
            execs.push({
              timestamp: tradeRecord.end_datetime,
              side: looksLong ? 'sell' : 'cover',
              qty: approxQty,
              price: Number(tradeRecord.exit_price),
            });
          }
        }

        let cash = 0;
        let position = 0; // positive = long shares, negative = short shares
        let nextExecIndex = 0;

        const signedQty = (exec) => {
          const opening = isOpeningLabel(exec.side, String(tradeRecord.side || '').toLowerCase() === 'long');
          const closing = isClosingLabel(exec.side, String(tradeRecord.side || '').toLowerCase() === 'long');
          const looksLong = String(tradeRecord.side || '').toLowerCase() === 'long';
          if (looksLong) {
            if (opening) return exec.qty;
            if (closing) return -exec.qty;
          } else {
            if (opening) return -exec.qty; // opening short is negative shares
            if (closing) return exec.qty;  // cover reduces short -> back toward zero
          }
          return 0;
        };

        const signedCashDelta = (exec) => {
          const opening = isOpeningLabel(exec.side, String(tradeRecord.side || '').toLowerCase() === 'long');
          const closing = isClosingLabel(exec.side, String(tradeRecord.side || '').toLowerCase() === 'long');
          const looksLong = String(tradeRecord.side || '').toLowerCase() === 'long';
          if (looksLong) {
            if (opening) return -(exec.qty * exec.price);
            if (closing) return exec.qty * exec.price;
          } else {
            if (opening) return exec.qty * exec.price;
            if (closing) return -(exec.qty * exec.price);
          }
          return 0;
        };

        running_pl_minute = bars.map((b) => {
          const barMs = new Date(b.timestamp).getTime();
          const barTime = normalizeTime(b.timestamp);

          while (nextExecIndex < execs.length) {
            const exMs = new Date(execs[nextExecIndex].timestamp).getTime();
            if (entryTime && exMs < entryTime) {
              nextExecIndex += 1;
              continue;
            }
            if (exMs <= barMs) {
              cash += signedCashDelta(execs[nextExecIndex]);
              position += signedQty(execs[nextExecIndex]);
              nextExecIndex += 1;
            } else {
              break;
            }
          }

          const mark = Number(b.close || b.c || b.close_price || 0);
          if (!Number.isFinite(mark) || !mark) return null;

          // While the trade is open: cash + MTM on open position.
          // After the exit time: stay flat at realized P/L.
          const effectiveMark = (exitTime && barMs > exitTime && Number.isFinite(Number(tradeRecord.exit_price || 0)))
            ? Number(tradeRecord.exit_price)
            : mark;
          const pnl = Math.round((cash + position * effectiveMark) * 100) / 100;
          return { timestamp: b.timestamp, value: pnl, time: barTime };
        }).filter(Boolean);
      }
    } catch (e) {
      console.warn('running_pl_minute error:', e.message);
    }

    res.json({
      bars,
      markers,
      running_pl_minute,
      source,
      session: {
        start: startIso,
        end: endIso,
      },
      indicators: {
        sma200_5m,
      },
    });
  } catch (err) {
    console.error('Chart data error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Cobra Trading Coach running at http://localhost:${PORT}`);
  console.log(`DB: ${DB_PATH}`);
});
