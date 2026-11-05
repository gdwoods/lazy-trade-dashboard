import { api, fmtPL, fmtPct, fmt } from './app.js';

const PERIODS = [
  { value: 'week',  label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'ytd',   label: 'YTD' },
  { value: '',      label: 'All Time' },
];

async function loadDashboard(container, since) {
  container.querySelector('#dashboard-content').innerHTML = '<p style="color:var(--muted);padding:16px">Loading…</p>';
  try {
    const qs = since ? `?since=${since}` : '';
    const [overall, monthly, cumPL, lazy] = await Promise.all([
      api(`/api/stats/overall${qs}`),
      api('/api/stats/monthly'),
      api(`/api/stats/cumulative-pl${qs}`),
      api('/api/lazy/current').catch(() => null),
    ]);
    container.querySelector('#dashboard-content').innerHTML = buildDashboard(overall, monthly, cumPL, since, lazy);
  } catch (e) {
    container.querySelector('#dashboard-content').innerHTML = `<p class="neg">Error: ${e.message}</p>`;
  }
}

export async function renderDashboard(container) {
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
    <div id="dashboard-content"></div>
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
      loadDashboard(container, btn.dataset.period);
    });
  });

  // Load today's widget independently (always shows today regardless of period)
  loadTodayWidget(container);
  await loadDashboard(container, defaultPeriod);
}

async function loadTodayWidget(container) {
  const el = container.querySelector('#today-widget');
  if (!el) return;
  try {
    const d = await api('/api/stats/today');
    if (!d.trade_count) {
      el.innerHTML = '<span style="color:var(--muted);font-size:0.85rem">No trades today yet.</span>';
      return;
    }
    const plColor = d.total_net_pl >= 0 ? '#22c55e' : '#ef4444';
    const plSign = d.total_net_pl >= 0 ? '+' : '';
    el.innerHTML = `
      <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
        <div>
          <div style="font-size:1.4rem;font-weight:700;color:${plColor}">${plSign}$${Math.abs(d.total_net_pl).toFixed(2)}</div>
          <div style="color:var(--muted);font-size:0.78rem">Today's P/L</div>
        </div>
        <div style="color:var(--muted);font-size:0.85rem">${d.trade_count} trades &nbsp;·&nbsp; ${d.win_rate?.toFixed(0)}% WR</div>
        ${d.best_trade > 0 ? `<div style="color:#22c55e;font-size:0.82rem">Best: +$${d.best_trade.toFixed(2)}</div>` : ''}
        ${d.worst_trade < 0 ? `<div style="color:#ef4444;font-size:0.82rem">Worst: $${d.worst_trade.toFixed(2)}</div>` : ''}
      </div>
    `;
  } catch {}
}

function buildDashboard(s, monthly, cumPL, since, lazy) {
  const winRateCls = s.win_rate >= 50 ? 'pos' : 'neg';
  const plCls = s.total_net_pl >= 0 ? 'pos' : 'neg';
  const pfCls = s.profit_factor >= 1 ? 'pos' : 'neg';

  return `
    <div class="card" style="padding:12px 16px;margin-bottom:16px;border-left:3px solid var(--accent)">
      <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);margin-bottom:6px">Today</div>
      <div id="today-widget"><span style="color:var(--muted);font-size:0.85rem">Loading…</span></div>
    </div>

    ${buildLazySnapshotCard(lazy)}

    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">Trades</div>
        <div class="value accent">${s.trade_count ?? '—'}</div>
      </div>
      <div class="stat-card">
        <div class="label">Win Rate</div>
        <div class="value ${winRateCls}">${s.win_rate != null ? s.win_rate.toFixed(1) + '%' : '—'}</div>
      </div>
      <div class="stat-card">
        <div class="label">Net P/L</div>
        <div class="value ${plCls}">${s.total_net_pl != null ? (s.total_net_pl >= 0 ? '+' : '') + '$' + Math.abs(s.total_net_pl).toFixed(2) : '—'}</div>
      </div>
      <div class="stat-card">
        <div class="label">Profit Factor</div>
        <div class="value ${pfCls}">${s.profit_factor ?? '—'}</div>
      </div>
      <div class="stat-card">
        <div class="label">Avg Winner</div>
        <div class="value pos">${s.avg_winner != null ? '+$' + s.avg_winner.toFixed(2) : '—'}</div>
      </div>
      <div class="stat-card">
        <div class="label">Avg Loser</div>
        <div class="value neg">${s.avg_loser != null ? '$' + s.avg_loser.toFixed(2) : '—'}</div>
      </div>
    </div>

    <div class="section-title">Cumulative P/L</div>
    <div class="chart-wrap">
      ${buildCumPLChart(cumPL)}
    </div>

    <div class="section-title">Monthly P/L</div>
    <div class="chart-wrap">
      ${buildMonthlyChart(monthly)}
    </div>

    <div class="section-title">Recent Months</div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Month</th>
            <th>Trades</th>
            <th>Net P/L</th>
            <th>Win Rate</th>
          </tr>
        </thead>
        <tbody>
          ${[...monthly].reverse().slice(0, 12).map(m => `
            <tr>
              <td>${m.month}</td>
              <td>${m.count}</td>
              <td>${fmtPL(m.net_pl)}</td>
              <td class="${m.win_rate >= 50 ? 'pos' : 'neg'}">${fmtPct(m.win_rate)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function buildLazySnapshotCard(lazy) {
  if (!lazy) {
    return `
      <div class="card" style="padding:12px 16px;margin-bottom:16px;border-left:3px solid var(--yellow)">
        <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);margin-bottom:6px">Lazy Trades Snapshot</div>
        <div style="color:var(--muted);font-size:0.85rem">Lazy scanner data unavailable.</div>
      </div>
    `;
  }

  const ready = lazy.ready || [];
  const watch = lazy.watch || [];
  const generatedAt = lazy.generatedAt
    ? new Date(lazy.generatedAt).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false })
    : '—';
  const topReady = ready.slice(0, 4).map((r) => r.ticker).join(', ') || 'none';
  const topWatch = watch.slice(0, 4).map((r) => r.ticker).join(', ') || 'none';

  return `
    <div class="card" style="padding:12px 16px;margin-bottom:16px;border-left:3px solid var(--accent)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted)">Lazy Trades Snapshot</div>
        <a href="#lazy-watchlist" style="color:var(--accent);font-size:0.85rem;text-decoration:none">Open full list →</a>
      </div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:8px;font-size:0.9rem">
        <div><strong>Ready:</strong> ${ready.length}</div>
        <div><strong>Watch:</strong> ${watch.length}</div>
        <div><strong>Analyzed:</strong> ${lazy.counts?.totalAnalyzed ?? 0}/${lazy.universeSize ?? 0}</div>
      </div>
      <div style="margin-top:8px;color:var(--muted);font-size:0.82rem">Updated: ${generatedAt}</div>
      <div style="margin-top:8px;font-size:0.85rem"><span style="color:var(--muted)">Top Ready:</span> ${topReady}</div>
      <div style="margin-top:4px;font-size:0.85rem"><span style="color:var(--muted)">Top Watch:</span> ${topWatch}</div>
    </div>
  `;
}

function buildCumPLChart(data) {
  if (!data.length) return '<p class="loading">No data</p>';

  const W = 800;
  const H = 180;
  const PAD = { top: 16, right: 16, bottom: 24, left: 56 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const vals = data.map(d => d.cumulative_pl);
  const minV = Math.min(...vals, 0);
  const maxV = Math.max(...vals, 0);
  const range = maxV - minV || 1;

  const xScale = i => PAD.left + (i / Math.max(data.length - 1, 1)) * innerW;
  const yScale = v => PAD.top + innerH - ((v - minV) / range) * innerH;

  // Build polyline points
  const points = data.map((d, i) => `${xScale(i)},${yScale(d.cumulative_pl)}`).join(' ');

  // Zero line Y
  const zeroY = yScale(0);

  // Fill area: split into green (above zero) and red (below zero)
  // Use a single fill path with clipping for simplicity
  const fillPoints = [
    `${xScale(0)},${zeroY}`,
    ...data.map((d, i) => `${xScale(i)},${yScale(d.cumulative_pl)}`),
    `${xScale(data.length - 1)},${zeroY}`
  ].join(' ');

  // Y axis labels
  const yTicks = [minV, 0, maxV].filter((v, i, a) => a.indexOf(v) === i);
  const yLabels = yTicks.map(v => {
    const y = yScale(v);
    const label = v === 0 ? '0' : (v >= 0 ? '+$' : '-$') + Math.abs(v).toFixed(0);
    return `<text x="${PAD.left - 4}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="10">${label}</text>`;
  });

  // X axis date labels — show ~5 evenly spaced
  const xStep = Math.max(1, Math.floor(data.length / 5));
  const xLabels = data
    .filter((_, i) => i % xStep === 0 || i === data.length - 1)
    .map((d, _, arr) => {
      const i = data.indexOf(d);
      return `<text x="${xScale(i)}" y="${H - 4}" text-anchor="middle" fill="#64748b" font-size="10">${d.date.slice(5)}</text>`;
    });

  // Final P/L annotation
  const lastVal = vals[vals.length - 1];
  const lastX = xScale(data.length - 1);
  const lastY = yScale(lastVal);
  const lastLabel = (lastVal >= 0 ? '+$' : '-$') + Math.abs(lastVal).toFixed(0);
  const lastCls = lastVal >= 0 ? '#22c55e' : '#ef4444';

  const lineColor = lastVal >= 0 ? '#22c55e' : '#ef4444';
  const fillColor = lastVal >= 0 ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)';

  return `
    <svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="display:block">
      <polygon points="${fillPoints}" fill="${fillColor}" />
      <polyline points="${points}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <line x1="${PAD.left}" y1="${zeroY}" x2="${W - PAD.right}" y2="${zeroY}" stroke="#2a2d3a" stroke-width="1" stroke-dasharray="3,3"/>
      ${yLabels.join('')}
      ${xLabels.join('')}
      <circle cx="${lastX}" cy="${lastY}" r="4" fill="${lastCls}"/>
      <text x="${lastX - 6}" y="${lastY - 8}" text-anchor="end" fill="${lastCls}" font-size="11" font-weight="600">${lastLabel}</text>
    </svg>
  `;
}

function buildMonthlyChart(monthly) {
  if (!monthly.length) return '<p class="loading">No data</p>';

  const vals = monthly.map(m => m.net_pl);
  const max = Math.max(...vals.map(Math.abs), 1);
  const BAR_W = 32;
  const GAP = 6;
  const CHART_H = 180;
  const ZERO_Y = CHART_H / 2;

  const totalW = monthly.length * (BAR_W + GAP);
  const svgW = Math.max(totalW, 400);

  const bars = monthly.map((m, i) => {
    const x = i * (BAR_W + GAP);
    const pct = m.net_pl / max;
    const barH = Math.max(Math.abs(pct) * (CHART_H / 2 - 10), 2);
    const y = m.net_pl >= 0 ? ZERO_Y - barH : ZERO_Y;
    const color = m.net_pl >= 0 ? '#22c55e' : '#ef4444';
    const label = m.month.substring(5);
    return `
      <g>
        <rect x="${x}" y="${y}" width="${BAR_W}" height="${barH}" fill="${color}" rx="3" opacity="0.85">
          <title>${m.month}: ${m.net_pl >= 0 ? '+' : ''}$${m.net_pl.toFixed(2)}</title>
        </rect>
        <text x="${x + BAR_W/2}" y="${CHART_H + 14}" text-anchor="middle" fill="#64748b" font-size="10">${label}</text>
      </g>
    `;
  });

  const zeroLine = `<line x1="0" y1="${ZERO_Y}" x2="${svgW}" y2="${ZERO_Y}" stroke="#2a2d3a" stroke-width="1"/>`;

  return `
    <svg width="100%" viewBox="0 0 ${svgW} ${CHART_H + 24}" preserveAspectRatio="xMidYMid meet" style="display:block">
      ${zeroLine}
      ${bars.join('')}
    </svg>
  `;
}
