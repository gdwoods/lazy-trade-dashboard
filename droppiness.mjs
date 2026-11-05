/**
 * Droppiness score calculator
 * Recency-weighted, prior-smoothed estimate of how often >20% 8h spikes retrace.
 * Score: 0–100. Higher = spikier stock that tends to fade (good for shorts).
 *
 * Logic ported from pump-scorecard app/api/scan/[ticker]/route.ts
 */

import { execFileSync } from 'child_process';

const POLYGON_BASE = 'https://api.polygon.io';
const DAYS = 547;       // ~18 months
const MAX_PAGES = 10;
const BARS_PER_PAGE = 50000;
const BUCKET_MINUTES = 480; // 8 hours

function getApiKey() {
  return execFileSync('pass', ['show', 'api/polygon'], { encoding: 'utf8', timeout: 10000 })
    .trim().split('\n')[0].trim();
}

async function fetchMinuteBars(ticker, apiKey) {
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - DAYS);

  const from = fromDate.toISOString().split('T')[0];
  const to = toDate.toISOString().split('T')[0];

  let allBars = [];
  let nextUrl = `${POLYGON_BASE}/v2/aggs/ticker/${ticker}/range/1/minute/${from}/${to}?adjusted=true&sort=asc&limit=${BARS_PER_PAGE}&apiKey=${apiKey}`;

  for (let page = 0; page < MAX_PAGES && nextUrl; page++) {
    const resp = await fetch(nextUrl);
    const data = await resp.json();
    if (data.status === 'ERROR' || data.error) throw new Error(data.error || data.message || 'Polygon error');
    if (data.results) allBars = allBars.concat(data.results);
    nextUrl = data.next_url ? `${data.next_url}&apiKey=${apiKey}` : null;
    if (!data.next_url) break;
  }

  return allBars;
}

function toBuckets(bars) {
  if (!bars.length) return [];

  // Group 1-min bars into 8-hour buckets by timestamp
  const bucketSize = BUCKET_MINUTES * 60 * 1000;
  const bucketMap = new Map();

  for (const bar of bars) {
    const key = Math.floor(bar.t / bucketSize) * bucketSize;
    if (!bucketMap.has(key)) {
      bucketMap.set(key, { t: key, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
    } else {
      const b = bucketMap.get(key);
      b.h = Math.max(b.h, bar.h);
      b.l = Math.min(b.l, bar.l);
      b.c = bar.c; // last close
      b.v += bar.v;
    }
  }

  return [...bucketMap.values()].sort((a, b) => a.t - b.t);
}

function computeDroppiness(buckets) {
  const now = Date.now();
  let spikes = [];

  for (let i = 1; i < buckets.length; i++) {
    const prev = buckets[i - 1];
    const curr = buckets[i];
    const next = buckets[i + 1] || null;

    // Spike detection: larger of between-bucket or intra-bucket move
    const betweenSpike = prev.c > 0 ? (curr.h - prev.c) / prev.c : 0;
    const intraSpike = curr.o > 0 ? (curr.h - curr.o) / curr.o : 0;
    const spikePct = Math.max(betweenSpike, intraSpike);

    if (spikePct <= 0.20) continue; // not a spike

    // Retraced?
    const sameBucket = curr.h > 0 ? (curr.h - curr.c) / curr.h > 0.10 : false;
    const nextBucket = next ? next.c < curr.c * 0.90 : false;
    const retraced = sameBucket || nextBucket;

    const ageDays = (now - curr.t) / (1000 * 60 * 60 * 24);
    const weight = Math.exp(-ageDays / 365);

    spikes.push({ date: new Date(curr.t).toISOString().split('T')[0], spikePct, retraced, weight, ageDays });
  }

  if (spikes.length === 0) {
    return { score: 50, spikeCount: 0, detail: [] };
  }

  const PRIOR_STRENGTH = 3;
  const PRIOR_MEAN = 0.5;

  const nEff = spikes.reduce((s, sp) => s + sp.weight, 0);
  const weightedRetraced = spikes.reduce((s, sp) => s + sp.weight * (sp.retraced ? 1 : 0), 0);
  const pHat = nEff > 0 ? weightedRetraced / nEff : PRIOR_MEAN;
  const pAdj = (nEff * pHat + PRIOR_STRENGTH * PRIOR_MEAN) / (nEff + PRIOR_STRENGTH);

  let score = Math.round(Math.min(Math.max(pAdj, 0), 1) * 100);

  // Sparse-spike cap
  if (spikes.length < 2) score = Math.min(score, 85);

  return {
    score,
    spikeCount: spikes.length,
    detail: spikes.map(s => ({ date: s.date, spikePct: Math.round(s.spikePct * 1000) / 10, retraced: s.retraced }))
  };
}

/**
 * Main entry point.
 * @param {string} ticker
 * @returns {Promise<{score: number, spikeCount: number, detail: Array}>}
 */
export async function calcDroppiness(ticker) {
  const apiKey = getApiKey();
  const bars = await fetchMinuteBars(ticker.toUpperCase(), apiKey);
  const buckets = toBuckets(bars);
  return computeDroppiness(buckets);
}
