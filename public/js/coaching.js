import { api, fmtPL, fmtPct, fmtDate } from './app.js';

const PERIODS = [
  { value: 'week',  label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'ytd',   label: 'YTD' },
  { value: '',      label: 'All Time' },
];

async function loadCoaching(container, since) {
  container.querySelector('#coaching-content').innerHTML = '<p style="color:var(--muted);padding:16px">Loading…</p>';
  try {
    const qs = since ? `?since=${since}` : '';
    const [overall, holdTime, timeOfDay, dayOfWeek, repeatLosers, blowup, recent] = await Promise.all([
      api(`/api/stats/overall${qs}`),
      api(`/api/stats/hold-time${qs}`),
      api(`/api/stats/time-of-day${qs}`),
      api(`/api/stats/day-of-week${qs}`),
      api(`/api/stats/repeat-losers${qs}`),
      api(`/api/stats/blowup${qs}`),
      api(`/api/trades?limit=30&sort=start_datetime&dir=desc${since ? `&since=${since}` : ''}`),
    ]);
    container.querySelector('#coaching-content').innerHTML =
      buildCoaching(overall, holdTime, timeOfDay, dayOfWeek, repeatLosers, blowup, recent.trades);
  } catch (e) {
    container.querySelector('#coaching-content').innerHTML = `<p class="neg">Error: ${e.message}</p>`;
  }
}

export async function renderCoaching(container) {
  const defaultPeriod = 'month';
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <span style="color:var(--muted);font-size:0.85rem">Period:</span>
      ${PERIODS.map(p => `
        <button class="period-btn btn${p.value === defaultPeriod ? ' period-active' : ''}"
          data-period="${p.value}"
          style="font-size:0.8rem;padding:4px 12px${p.value === defaultPeriod ? ';background:var(--accent);color:#fff' : ''}">
          ${p.label}
        </button>`).join('')}
    </div>
    <div id="coaching-content"></div>
  `;

  container.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.period-btn').forEach(b => {
        b.classList.remove('period-active');
        b.style.background = '';
        b.style.color = '';
      });
      btn.classList.add('period-active');
      btn.style.background = 'var(--accent)';
      btn.style.color = '#fff';
      loadCoaching(container, btn.dataset.period);
    });
  });

  await loadCoaching(container, defaultPeriod);
}

function buildCoaching(overall, holdTime, timeOfDay, dayOfWeek, repeatLosers, blowup, recent) {
  const insight = buildInsight(holdTime, overall);
  const bestWorstHours = getBestWorstHours(timeOfDay);
  const bestWorstDays  = getBestWorstDays(dayOfWeek);
  const streak         = calcStreak(recent);
  const top5Losers     = repeatLosers.slice(0, 5);

  return `
    <div class="insight-card">
      <div class="insight-label">#1 Coaching Insight</div>
      <div class="insight-text">${insight}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div class="card">
        <div class="section-title" style="margin-top:0">Current Streak</div>
        ${buildStreak(streak)}
      </div>
      <div class="card">
        <div class="section-title" style="margin-top:0">Quick Stats</div>
        ${buildQuickStats(overall)}
      </div>
    </div>

    <div class="section-title">Top 5 Symbols to Avoid (Repeat Losers)</div>
    ${buildRepeatLosersCards(top5Losers)}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div class="card">
        <div class="section-title" style="margin-top:0">Best Hours to Trade</div>
        ${buildHourList(bestWorstHours.best, 'pos')}
        <div class="section-title">Worst Hours</div>
        ${buildHourList(bestWorstHours.worst, 'neg')}
      </div>
      <div class="card">
        <div class="section-title" style="margin-top:0">Best Days</div>
        ${buildDayList(bestWorstDays.best, 'pos')}
        <div class="section-title">Worst Days</div>
        ${buildDayList(bestWorstDays.worst, 'neg')}
      </div>
    </div>

    <div class="section-title">Biggest Blowups (Top 10)</div>
    ${buildBlowupTable(blowup.slice(0, 10))}
  `;
}

function buildInsight(holdTime, overall) {
  const longBucket = holdTime.find(r => r.bucket === '120+min');
  const shortBucket = holdTime.find(r => r.bucket === '0-5min') || holdTime.find(r => r.bucket === '5-30min');

  if (longBucket && longBucket.net_pl < 0) {
    const loss = Math.abs(longBucket.net_pl).toFixed(0);
    const wr   = longBucket.win_rate?.toFixed(1) ?? '?';
    return `Hold time kills your P/L. Trades held 120+ minutes account for <strong class="neg">-$${loss}</strong> in losses at only <strong class="neg">${wr}%</strong> win rate. Your edge is in fast, decisive trades. Once you're past 30 minutes, you're no longer trading — you're hoping. Exit earlier, protect your gains, and let your winners be decided in the first 30 minutes.`;
  }

  if (overall.profit_factor < 1) {
    return `Your profit factor is below 1.0, meaning you are losing more than you make. Focus on cutting losses faster — your avg loser ($${Math.abs(overall.avg_loser ?? 0).toFixed(2)}) is too large relative to your avg winner ($${(overall.avg_winner ?? 0).toFixed(2)}). Prioritize loss prevention over finding winners.`;
  }

  return `Win rate at ${overall.win_rate?.toFixed(1)}% with a profit factor of ${overall.profit_factor}. Keep focusing on trade selection quality — the data shows your edge is real, but consistency is the key to scaling it.`;
}

function getBestWorstHours(rows) {
  if (!rows.length) return { best: [], worst: [] };
  const sorted = [...rows].sort((a, b) => b.net_pl - a.net_pl);
  return { best: sorted.slice(0, 3), worst: sorted.slice(-3).reverse() };
}

function getBestWorstDays(rows) {
  if (!rows.length) return { best: [], worst: [] };
  const sorted = [...rows].sort((a, b) => b.net_pl - a.net_pl);
  return { best: sorted.slice(0, 2), worst: sorted.slice(-2).reverse() };
}

function calcStreak(trades) {
  if (!trades.length) return { type: 'none', count: 0 };
  let count = 0;
  const first = trades[0].net_pl >= 0 ? 'win' : 'loss';
  for (const t of trades) {
    const isWin = t.net_pl >= 0;
    if ((first === 'win') === isWin) count++;
    else break;
  }
  return { type: first, count };
}

function buildStreak(streak) {
  if (streak.type === 'none') return '<p style="color:var(--muted)">No recent trades</p>';
  const cls   = streak.type === 'win' ? 'pos' : 'neg';
  const label = streak.type === 'win' ? 'Win' : 'Loss';
  const icon  = streak.type === 'win' ? '🟢' : '🔴';
  return `
    <p style="font-size:2rem;font-weight:700" class="${cls}">${icon} ${streak.count}-${label} Streak</p>
    <p style="color:var(--muted);font-size:0.85rem;margin-top:4px">Based on last 30 closed trades</p>
  `;
}

function buildQuickStats(s) {
  return `
    <div style="display:flex;flex-direction:column;gap:8px;font-size:0.9rem">
      <div style="display:flex;justify-content:space-between">
        <span style="color:var(--muted)">Win Rate</span>
        <span class="${s.win_rate >= 50 ? 'pos' : 'neg'}">${s.win_rate?.toFixed(1)}%</span>
      </div>
      <div style="display:flex;justify-content:space-between">
        <span style="color:var(--muted)">Profit Factor</span>
        <span class="${s.profit_factor >= 1 ? 'pos' : 'neg'}">${s.profit_factor ?? '—'}</span>
      </div>
      <div style="display:flex;justify-content:space-between">
        <span style="color:var(--muted)">Avg Winner</span>
        <span class="pos">+$${s.avg_winner?.toFixed(2) ?? '—'}</span>
      </div>
      <div style="display:flex;justify-content:space-between">
        <span style="color:var(--muted)">Avg Loser</span>
        <span class="neg">$${s.avg_loser?.toFixed(2) ?? '—'}</span>
      </div>
    </div>
  `;
}

function buildRepeatLosersCards(losers) {
  if (!losers.length) return '<p class="loading">No repeat losers found.</p>';
  return `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">
      ${losers.map((l, i) => `
        <div class="stat-card" style="flex:1;min-width:130px;border-color:rgba(239,68,68,0.3)">
          <div class="label">#${i+1} Avoid</div>
          <div class="value neg" style="font-size:1.2rem">${l.symbol}</div>
          <div style="color:var(--muted);font-size:0.75rem;margin-top:6px">${l.loss_count} losses · ${fmtPL(l.total_loss)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function buildHourList(hours, cls) {
  if (!hours.length) return '<p style="color:var(--muted);font-size:0.85rem">No data</p>';
  return hours.map(h => {
    const hour = h.entry_hour;
    const ampm = hour < 12 ? `${hour === 0 ? 12 : hour}am` : `${hour === 12 ? 12 : hour - 12}pm`;
    return `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.85rem">
      <span>${ampm}</span>
      <span class="${cls}">${h.net_pl >= 0 ? '+' : ''}$${h.net_pl?.toFixed(2)} (${h.win_rate?.toFixed(0)}% WR)</span>
    </div>`;
  }).join('');
}

function buildDayList(days, cls) {
  if (!days.length) return '<p style="color:var(--muted);font-size:0.85rem">No data</p>';
  return days.map(d => `
    <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.85rem">
      <span>${d.day_name}</span>
      <span class="${cls}">${d.net_pl >= 0 ? '+' : ''}$${d.net_pl?.toFixed(2)} (${d.win_rate?.toFixed(0)}% WR)</span>
    </div>
  `).join('');
}

function buildBlowupTable(trades) {
  if (!trades.length) return '<p class="loading">No data</p>';
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Date</th><th>Symbol</th><th>Net P/L</th><th>Hold</th></tr>
        </thead>
        <tbody>
          ${trades.map(t => {
            const mins = t.hold_minutes;
            const hold = mins == null ? '—' : mins < 60 ? `${mins}m` : `${Math.floor(mins/60)}h ${mins%60}m`;
            return `
              <tr>
                <td style="font-size:0.8rem">${t.start_datetime?.substring(0,10) || '—'}</td>
                <td><strong>${t.symbol}</strong></td>
                <td class="neg">-$${Math.abs(t.net_pl).toFixed(2)}</td>
                <td>${hold}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}
