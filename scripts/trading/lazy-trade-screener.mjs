#!/usr/bin/env node
/**
 * Lazy Trade Screener (short-side exhaustion setups)
 *
 * Strategy intent:
 * - Find names with multi-day parabolic upside
 * - Wait for 4H RSI rollover (cross back down through 69)
 * - Return ranked candidates for manual execution review
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const OUT_PATH = path.resolve(process.cwd(), 'data/trading/lazy-trade-screener-latest.json');

function loadKey(name, passPath) {
  if (process.env[name]) return process.env[name].trim();
  const r = spawnSync('pass', ['show', passPath], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return (r.stdout || '').trim().split(/\r?\n/)[0]?.trim() || null;
}

const API_KEY = loadKey('POLYGON_API_KEY', 'api/polygon');
if (!API_KEY) {
  console.error('Missing Polygon API key (env POLYGON_API_KEY or pass api/polygon)');
  process.exit(2);
}

const CFG = {
  MAX_TICKERS: Number(process.env.LAZY_MAX_TICKERS || 120),
  MIN_PRICE: Number(process.env.LAZY_MIN_PRICE || 1),
  MAX_PRICE: Number(process.env.LAZY_MAX_PRICE || 100),
  MIN_DAY_VOL: Number(process.env.LAZY_MIN_DAY_VOL || 300000),
  PARABOLIC_3D_PCT: Number(process.env.LAZY_PARABOLIC_3D_PCT || 70),
  PARABOLIC_5D_PCT: Number(process.env.LAZY_PARABOLIC_5D_PCT || 150),
  DAY1_PCT: Number(process.env.LAZY_DAY1_PCT || 60),
  RSI_LENGTH_4H: Number(process.env.LAZY_RSI_LENGTH_4H || 28),
  RSI_CROSS_LEVEL: Number(process.env.LAZY_RSI_CROSS_LEVEL || 69),
  RSI_PEAK_LEVEL: Number(process.env.LAZY_RSI_PEAK_LEVEL || 80),
  REQUIRE_30M_CROSS: /^(1|true|yes)$/i.test(String(process.env.LAZY_REQUIRE_30M_CROSS || '0')),
  MAX_BARS_SINCE_4H_CROSS_READY: Number(process.env.LAZY_MAX_BARS_SINCE_4H_CROSS_READY || 2),
  RSI_LOOKBACK_BARS: Number(process.env.LAZY_RSI_LOOKBACK_BARS || 20),
  MIN_SCORE: Number(process.env.LAZY_MIN_SCORE || 40),
  LOOKBACK_DAYS: Number(process.env.LAZY_LOOKBACK_DAYS || 18),
  SMA200_BARS: Number(process.env.LAZY_SMA200_BARS || 200),
};

const nowIso = () => new Date().toISOString();
const fmtDate = (d) => d.toISOString().slice(0, 10);

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function tickerAllowed(t) {
  // Strip most warrants/rights/units/noise symbols common in pump lists.
  if (!t) return false;
  if (t.includes('.') || t.includes('/')) return false;
  if (/(W|WS|W[A-Z]|R|RT|U)$/.test(t) && t.length > 4) return false;
  return /^[A-Z]{1,5}$/.test(t);
}

function rsiWilder(values, length = 14) {
  if (!values || values.length < length + 1) return Array(values?.length || 0).fill(null);
  const out = Array(values.length).fill(null);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= length; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / length;
  let avgLoss = loss / length;
  out[length] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = length + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (length - 1) + g) / length;
    avgLoss = (avgLoss * (length - 1) + l) / length;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function sma(values, length) {
  if (!values || values.length < length) return Array(values?.length || 0).fill(null);
  const out = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] ?? 0;
    if (i >= length) sum -= values[i - length] ?? 0;
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

function pct(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return ((a / b) - 1) * 100;
}

function floorTo4h(tsMs) {
  const four = 4 * 60 * 60 * 1000;
  return Math.floor(tsMs / four) * four;
}

function resampleTo4h(hourBars) {
  const map = new Map();
  for (const b of hourBars) {
    const bucket = floorTo4h(b.t);
    const cur = map.get(bucket);
    if (!cur) {
      map.set(bucket, { t: bucket, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0 });
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v ?? 0;
    }
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

function findDay1Index(dailyBars, day1Pct) {
  for (let i = 1; i < dailyBars.length; i++) {
    const move = pct(dailyBars[i].c, dailyBars[i - 1].c);
    if (move != null && move >= day1Pct) return i;
  }
  return -1;
}

function safeNum(n, digits = 2) {
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function upperWickPct(bar) {
  if (!bar || !Number.isFinite(bar.h) || !Number.isFinite(bar.l) || !Number.isFinite(bar.o) || !Number.isFinite(bar.c)) return null;
  const range = bar.h - bar.l;
  if (!(range > 0)) return null;
  const topBody = Math.max(bar.o, bar.c);
  const wick = Math.max(0, bar.h - topBody);
  return (wick / range) * 100;
}

function findLastCrossDown(series, level, endIdx) {
  for (let k = endIdx; k >= 1; k--) {
    const prev = series[k - 1];
    const curr = series[k];
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) continue;
    if (prev > level && curr <= level) return k;
  }
  return null;
}

function anyBarClosesAbove(bars, level, fromTs) {
  if (!Number.isFinite(level) || !Array.isArray(bars)) return false;
  return bars.some((b) => Number.isFinite(b?.t) && b.t >= fromTs && Number.isFinite(b?.c) && b.c > level);
}

function calcVolumeFadeRatio(recentDaily) {
  if (!Array.isArray(recentDaily) || recentDaily.length < 8) return null;
  let peakIdx = 0;
  for (let i = 1; i < recentDaily.length; i++) {
    if ((recentDaily[i].h ?? -Infinity) > (recentDaily[peakIdx].h ?? -Infinity)) peakIdx = i;
  }

  const pre = recentDaily.slice(Math.max(0, peakIdx - 3), peakIdx).map((b) => Number(b.v || 0)).filter((v) => v > 0);
  const post = recentDaily.slice(peakIdx + 1, Math.min(recentDaily.length, peakIdx + 4)).map((b) => Number(b.v || 0)).filter((v) => v > 0);
  if (!pre.length || !post.length) return null;
  const preAvg = pre.reduce((a, b) => a + b, 0) / pre.length;
  const postAvg = post.reduce((a, b) => a + b, 0) / post.length;
  if (!(preAvg > 0)) return null;
  return postAvg / preAvg;
}

function exhaustionQualityScore({ dist200Pct, distVwapPct, dailyUpperWick, fourHourUpperWick, volumeFadeRatio }) {
  let score = 0;
  if (Number.isFinite(dist200Pct)) score += dist200Pct >= 50 ? 6 : dist200Pct >= 25 ? 3 : 0;
  if (Number.isFinite(distVwapPct)) score += distVwapPct >= 12 ? 4 : distVwapPct >= 6 ? 2 : 0;
  if (Number.isFinite(dailyUpperWick)) score += dailyUpperWick >= 45 ? 6 : dailyUpperWick >= 30 ? 3 : 0;
  if (Number.isFinite(fourHourUpperWick)) score += fourHourUpperWick >= 45 ? 6 : fourHourUpperWick >= 30 ? 3 : 0;
  if (Number.isFinite(volumeFadeRatio)) score += volumeFadeRatio <= 0.6 ? 6 : volumeFadeRatio <= 0.8 ? 4 : volumeFadeRatio <= 1.0 ? 2 : 0;
  return score;
}

async function getRecentGroupedTopMovers(days = 10, perDay = 50) {
  const picked = [];
  let checked = 0;
  let back = 1;
  while (checked < days && back < 25) {
    const d = new Date(Date.now() - back * 24 * 60 * 60 * 1000);
    back += 1;
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue;

    const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${fmtDate(d)}?adjusted=true&apiKey=${API_KEY}`;
    try {
      const j = await getJson(url);
      const movers = (j?.results ?? [])
        .map((r) => ({ ticker: r.T, pct: pct(r.c, r.o), close: r.c, vol: r.v }))
        .filter((x) => tickerAllowed(x.ticker))
        .filter((x) => Number.isFinite(x.pct) && x.pct >= 20)
        .filter((x) => Number.isFinite(x.close) && x.close >= CFG.MIN_PRICE && x.close <= CFG.MAX_PRICE)
        .filter((x) => (x.vol ?? 0) >= Math.min(CFG.MIN_DAY_VOL, 400000))
        .sort((a, b) => b.pct - a.pct)
        .slice(0, perDay)
        .map((x) => x.ticker);
      picked.push(...movers);
      checked += 1;
    } catch {
      // skip dates with missing data
    }
  }
  return picked;
}

function parseManualTickers() {
  const fromEnv = (process.env.LAZY_TICKERS || '').split(',').map((x) => x.trim().toUpperCase());
  const fromArgs = process.argv.slice(2).flatMap((a) => a.split(',')).map((x) => x.trim().toUpperCase());
  return uniq([...fromEnv, ...fromArgs]).filter(tickerAllowed);
}

const MANUAL_TICKERS = new Set(parseManualTickers());

async function getTickerUniverse() {
  const manual = [...MANUAL_TICKERS];
  const [gainers, losers, groupedMovers] = await Promise.all([
    getJson(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/gainers?apiKey=${API_KEY}`),
    getJson(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/losers?apiKey=${API_KEY}`),
    getRecentGroupedTopMovers(10, 50),
  ]);

  const g = (gainers?.tickers ?? []).map((x) => x.ticker);
  const l = (losers?.tickers ?? []).map((x) => x.ticker);

  return uniq([...manual, ...g.slice(0, 120), ...l.slice(0, 80), ...groupedMovers])
    .filter(tickerAllowed)
    .slice(0, CFG.MAX_TICKERS);
}

async function getDailyBars(ticker, lookbackDays) {
  const to = new Date();
  const needDays = Math.max(lookbackDays, CFG.SMA200_BARS + 30);
  const from = new Date(Date.now() - needDays * 24 * 60 * 60 * 1000);
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${fmtDate(from)}/${fmtDate(to)}?adjusted=true&sort=asc&limit=50000&apiKey=${API_KEY}`;
  const j = await getJson(url);
  return j?.results ?? [];
}

async function getHourBars(ticker, lookbackDays) {
  const to = new Date();
  const from = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/hour/${fmtDate(from)}/${fmtDate(to)}?adjusted=true&sort=asc&limit=50000&apiKey=${API_KEY}`;
  const j = await getJson(url);
  return j?.results ?? [];
}

async function analyzeTicker(ticker) {
  const isManual = MANUAL_TICKERS.has(ticker);
  const manualStub = (reason, extras = {}) => ({
    ticker,
    isManual,
    status: 'BUILDING',
    score: 0,
    close: extras.close ?? null,
    dayVol: extras.dayVol ?? null,
    parabolic: {
      chg3Pct: extras.chg3Pct ?? null,
      chg5Pct: extras.chg5Pct ?? null,
      runupLast6Pct: extras.runupLast6Pct ?? null,
      daysSinceDay1: extras.daysSinceDay1 ?? null,
    },
    rsi4h: {
      length: CFG.RSI_LENGTH_4H,
      prev: null,
      curr: null,
      peakLookback: null,
      crossedDown69: false,
      crossInReadyWindow: false,
      barsSinceCrossDown69: null,
      crossDownAt: null,
      hadExhaustionPeak: false,
    },
    rsi30m: {
      length: 21,
      crossedBelowMA: false,
      curr: null,
      ma: null,
    },
    exhaustion: {
      qualityScore: 0,
      distFromSma200Pct: null,
      distFromVwapPct: null,
      dailyUpperWickPct: null,
      fourHourUpperWickPct: null,
      volumeFadeRatio: null,
    },
    notes: [
      `Manual include: ${reason}`,
      'Manual checks still required: borrow availability/fee, SSR/news catalyst, and intraday VWAP rejection entry.',
    ],
  });

  try {
    const [daily, hourly] = await Promise.all([
      getDailyBars(ticker, CFG.LOOKBACK_DAYS),
      getHourBars(ticker, CFG.LOOKBACK_DAYS),
    ]);

    const recentDaily = daily.slice(-Math.max(CFG.LOOKBACK_DAYS, 8));

    if (recentDaily.length < 7 || hourly.length < 50) {
      return isManual ? manualStub('insufficient bars for full model') : null;
    }

    const lastDay = recentDaily[recentDaily.length - 1];
    const price = lastDay?.c;
    const dayVol = lastDay?.v ?? 0;

    if (!Number.isFinite(price) || price < CFG.MIN_PRICE || price > CFG.MAX_PRICE) {
      return isManual ? manualStub('price out of configured range', { close: price, dayVol }) : null;
    }
    if (!isManual && dayVol < CFG.MIN_DAY_VOL) return null;

    const closes = recentDaily.map((b) => b.c);
    const chg3 = pct(closes.at(-1), closes.at(-4));
    const chg5 = pct(closes.at(-1), closes.at(-6));
    const highLast6 = Math.max(...recentDaily.slice(-6).map((b) => b.h));
    const lowLast6 = Math.min(...recentDaily.slice(-6).map((b) => b.l));
    const runupFromBase = pct(highLast6, lowLast6);

    const parabolic =
      (Number.isFinite(chg3) && chg3 >= CFG.PARABOLIC_3D_PCT) ||
      (Number.isFinite(chg5) && chg5 >= CFG.PARABOLIC_5D_PCT) ||
      (Number.isFinite(runupFromBase) && runupFromBase >= CFG.PARABOLIC_5D_PCT);

    if (!isManual && !parabolic) return null;

    const day1Idx = findDay1Index(recentDaily, CFG.DAY1_PCT);
    if (!isManual && day1Idx < 0) return null;
    const daysSinceDay1 = day1Idx >= 0 ? (recentDaily.length - 1) - day1Idx : null;
    if (!isManual && daysSinceDay1 < 1) return null; // require at least 24h after Day 1 move

    const bars4h = resampleTo4h(hourly);
    const closes4h = bars4h.map((b) => b.c);
    const minBarsNeeded = CFG.RSI_LENGTH_4H + 5;
    if (closes4h.length < minBarsNeeded) {
      return isManual ? manualStub('not enough 4H bars for RSI confirmation', { close: price, dayVol, chg3Pct: chg3, chg5Pct: chg5, runupLast6Pct: runupFromBase, daysSinceDay1 }) : null;
    }

    const rsi4h = rsiWilder(closes4h, CFG.RSI_LENGTH_4H);

    // Use fully completed bars only: ignore newest potentially in-progress bucket.
    const i = rsi4h.length - 2;
    const prev = rsi4h[i - 1];
    const curr = rsi4h[i];
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) {
      return isManual ? manualStub('4H RSI unavailable on latest completed candle', { close: price, dayVol, chg3Pct: chg3, chg5Pct: chg5, runupLast6Pct: runupFromBase, daysSinceDay1 }) : null;
    }

    const recentSlice = rsi4h.slice(Math.max(0, i - CFG.RSI_LOOKBACK_BARS), i + 1).filter(Number.isFinite);
    const rsiPeak = recentSlice.length ? Math.max(...recentSlice) : null;

    const crossedDown69 = prev > CFG.RSI_CROSS_LEVEL && curr <= CFG.RSI_CROSS_LEVEL;
    const lastCrossIdx = findLastCrossDown(rsi4h, CFG.RSI_CROSS_LEVEL, i);
    const barsSinceCrossDown69 = lastCrossIdx == null ? null : i - lastCrossIdx;
    const crossInReadyWindow = Number.isFinite(barsSinceCrossDown69) && barsSinceCrossDown69 >= 0 && barsSinceCrossDown69 <= CFG.MAX_BARS_SINCE_4H_CROSS_READY;
    const crossDownTs = lastCrossIdx == null ? null : (bars4h[lastCrossIdx]?.t ?? null);
    const crossBarHigh = lastCrossIdx == null ? null : (bars4h[lastCrossIdx]?.h ?? null);
    const hadExhaustionPeak = Number.isFinite(rsiPeak) && rsiPeak >= CFG.RSI_PEAK_LEVEL;

    // Optional 30m momentum rollover check.
    const bars30m = [];
    for (let k = 0; k < hourly.length; k++) {
      const hb = hourly[k];
      bars30m.push({ t: hb.t, o: hb.o, h: hb.h, l: hb.l, c: hb.c, v: hb.v });
    }
    // Approximate 30m from hourly data is weak; better to call true 30m endpoint when needed.
    // Use direct 30m endpoint for better signal.
    const to = new Date();
    const from = new Date(Date.now() - CFG.LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const url30 = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/30/minute/${fmtDate(from)}/${fmtDate(to)}?adjusted=true&sort=asc&limit=50000&apiKey=${API_KEY}`;
    const j30 = await getJson(url30);
    const b30 = j30?.results ?? [];
    const c30 = b30.map((b) => b.c);
    const r30 = rsiWilder(c30, 21);
    const r30ma = sma(r30.map((x) => (Number.isFinite(x) ? x : 0)), 9);
    const i30 = r30.length - 2;
    const r30Prev = r30[i30 - 1];
    const r30Curr = r30[i30];
    const r30maPrev = r30ma[i30 - 1];
    const r30maCurr = r30ma[i30];
    const momentumRollover30m =
      Number.isFinite(r30Prev) && Number.isFinite(r30Curr) && Number.isFinite(r30maPrev) && Number.isFinite(r30maCurr)
        ? r30Prev >= r30maPrev && r30Curr < r30maCurr
        : false;
    const momentumConfirmed30m =
      Number.isFinite(r30Curr) && Number.isFinite(r30maCurr)
        ? r30Curr < r30maCurr
        : false;

    const rsiReclaimed4h = Number.isFinite(curr) && curr > CFG.RSI_CROSS_LEVEL;
    const postCrossInvalidationTs = Number.isFinite(crossDownTs) ? crossDownTs + (4 * 60 * 60 * 1000) : Number.POSITIVE_INFINITY;
    const reclaimedCrossHigh = Number.isFinite(crossBarHigh) && anyBarClosesAbove(b30, crossBarHigh, postCrossInvalidationTs);

    const sma200Series = sma(daily.map((b) => b.c), CFG.SMA200_BARS);
    const sma200 = sma200Series.length ? sma200Series[sma200Series.length - 1] : null;
    const dist200Pct = pct(price, sma200);
    const distVwapPct = pct(price, lastDay?.vw);
    const dailyUpperWick = upperWickPct(lastDay);
    const fourHourUpperWick = upperWickPct(bars4h[i]);
    const volumeFadeRatio = calcVolumeFadeRatio(recentDaily);
    const qualityScore = exhaustionQualityScore({ dist200Pct, distVwapPct, dailyUpperWick, fourHourUpperWick, volumeFadeRatio });

    // Score model
    let score = 0;
    if (hadExhaustionPeak) score += 30;
    if (crossInReadyWindow) score += 35;
    if (momentumConfirmed30m) score += 15;
    score += Math.min(20, Math.max(0, ((chg3 ?? 0) / 10)));
    score += qualityScore;

    const setupReady = hadExhaustionPeak
      && crossInReadyWindow
      && !rsiReclaimed4h
      && !reclaimedCrossHigh
      && (!CFG.REQUIRE_30M_CROSS || momentumConfirmed30m);
    const status = setupReady ? (score >= CFG.MIN_SCORE ? 'READY' : 'WATCH') : 'BUILDING';

    return {
      ticker,
      status,
      isManual,
      score: safeNum(score, 1),
      close: safeNum(price, 4),
      dayVol,
      parabolic: {
        chg3Pct: safeNum(chg3, 1),
        chg5Pct: safeNum(chg5, 1),
        runupLast6Pct: safeNum(runupFromBase, 1),
        daysSinceDay1,
      },
      rsi4h: {
        length: CFG.RSI_LENGTH_4H,
        prev: safeNum(prev, 2),
        curr: safeNum(curr, 2),
        peakLookback: safeNum(rsiPeak, 2),
        crossedDown69,
        crossInReadyWindow,
        barsSinceCrossDown69,
        crossDownAt: crossDownTs,
        crossBarHigh: safeNum(crossBarHigh, 4),
        hadExhaustionPeak,
        reclaimedAbove69: rsiReclaimed4h,
      },
      rsi30m: {
        length: 21,
        crossedBelowMA: momentumRollover30m,
        belowMA: momentumConfirmed30m,
        curr: safeNum(r30Curr, 2),
        ma: safeNum(r30maCurr, 2),
      },
      exhaustion: {
        qualityScore,
        distFromSma200Pct: safeNum(dist200Pct, 2),
        distFromVwapPct: safeNum(distVwapPct, 2),
        dailyUpperWickPct: safeNum(dailyUpperWick, 2),
        fourHourUpperWickPct: safeNum(fourHourUpperWick, 2),
        volumeFadeRatio: safeNum(volumeFadeRatio, 3),
      },
      notes: [
        setupReady ? 'Lazy setup trigger confirmed.' : 'Lazy setup trigger not yet confirmed.',
        crossInReadyWindow ? `4H cross-down is fresh (<= ${CFG.MAX_BARS_SINCE_4H_CROSS_READY} bars).` : '4H cross-down is stale/missing.',
        rsiReclaimed4h ? 'Invalidated: latest completed 4H RSI reclaimed above the trigger level.' : '4H RSI remains below the trigger level.',
        reclaimedCrossHigh ? 'Invalidated: price closed back above the 4H trigger-bar high after the cross.' : 'Price has not reclaimed the 4H trigger-bar high.',
        CFG.REQUIRE_30M_CROSS ? (momentumConfirmed30m ? '30m momentum confirmation is active (required).' : '30m confirmation missing (required).') : (momentumConfirmed30m ? '30m momentum confirmation is active.' : '30m confirmation not active.'),
        'Manual checks still required: borrow availability/fee, SSR/news catalyst, and intraday VWAP rejection entry.',
      ],
    };
  } catch (err) {
    return { ticker, status: 'ERROR', error: String(err?.message || err) };
  }
}

async function main() {
  const started = Date.now();
  const universe = await getTickerUniverse();
  const rows = [];

  for (const t of universe) {
    const r = await analyzeTicker(t);
    if (r) rows.push(r);
  }

  const candidates = rows
    .filter((r) => r.status !== 'ERROR')
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const ready = candidates.filter((r) => r.status === 'READY');
  const watch = candidates.filter((r) => r.status === 'WATCH' || r.status === 'BUILDING');
  const errors = rows.filter((r) => r.status === 'ERROR');

  const out = {
    strategy: 'lazy-trade-short-exhaustion',
    generatedAt: nowIso(),
    runMs: Date.now() - started,
    config: CFG,
    universeSize: universe.length,
    counts: {
      totalAnalyzed: rows.length,
      ready: ready.length,
      watch: watch.length,
      errors: errors.length,
    },
    ready: ready.slice(0, 20),
    watch: watch.slice(0, 40),
    errors: errors.slice(0, 10),
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2));

  console.log(`Lazy screener complete | universe=${universe.length} analyzed=${rows.length} ready=${ready.length} watch=${watch.length}`);
  if (ready.length) {
    console.log('Top READY:', ready.slice(0, 8).map((r) => `${r.ticker}(${r.score})`).join(', '));
  }
  console.log(`Saved: ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
