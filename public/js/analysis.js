import { api, fmtPL, fmtPct, fmt } from './app.js';

const PERIODS = [
  { value: 'week',  label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'ytd',   label: 'YTD' },
  { value: '',      label: 'All Time' },
];

async function loadAnalysis(container, since) {
  container.querySelector('#analysis-content').innerHTML = '<p style="color:var(--muted);padding:16px">Loading…</p>';
  try {
    const qs = since ? `?since=${since}` : '';
    const [holdTime, timeOfDay, dayOfWeek, repeatLosers] = await Promise.all([
      api(`/api/stats/hold-time${qs}`),
      api(`/api/stats/time-of-day${qs}`),
      api(`/api/stats/day-of-week${qs}`),
      api(`/api/stats/repeat-losers${qs}`),
    ]);
    container.querySelector('#analysis-content').innerHTML =
      buildAnalysis(holdTime, timeOfDay, dayOfWeek, repeatLosers);
  } catch (e) {
    container.querySelector('#analysis-content').innerHTML = `<p class="neg">Error: ${e.message}</p>`;
  }
}

export async function renderAnalysis(container) {
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
    <div id="analysis-content"></div>
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
      loadAnalysis(container, btn.dataset.period);
    });
  });

  await loadAnalysis(container, defaultPeriod);
}

function buildAnalysis(holdTime, timeOfDay, dayOfWeek, repeatLosers) {
  return `
    <div class="section-title">Hold Time Breakdown</div>
    ${buildHoldTable(holdTime)}

    <div class="section-title">Time of Day Heatmap</div>
    ${buildTimeHeatmap(timeOfDay)}

    <div class="section-title">Time of Day Detail</div>
    ${buildTimeTable(timeOfDay)}

    <div class="section-title">Day of Week</div>
    ${buildDayTable(dayOfWeek)}

    <div class="section-title">Repeat Losers (2+ losing trades)</div>
    ${buildRepeatLosers(repeatLosers)}
  `;
}

function buildHoldTable(rows) {
  if (!rows.length) return '<p class="loading">No data</p>';
  const order = ['0-5min', '5-30min', '30-120min', '120+min'];
  const sorted = order.map(b => rows.find(r => r.bucket === b)).filter(Boolean);

  return `
    <div class="table-wrap card" style="padding:0">
      <table>
        <thead>
          <tr>
            <th>Bucket</th>
            <th>Trades</th>
            <th>Net P/L</th>
            <th>Win Rate</th>
            <th>Avg P/L</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(r => {
            const rowCls = r.bucket === '120+min' ? 'row-red' : '';
            return `
              <tr class="${rowCls}">
                <td>${r.bucket}</td>
                <td>${r.count}</td>
                <td>${fmtPL(r.net_pl)}</td>
                <td class="${r.win_rate >= 50 ? 'pos' : 'neg'}">${fmtPct(r.win_rate)}</td>
                <td>${fmtPL(r.avg_pl)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function buildTimeHeatmap(rows) {
  if (!rows.length) return '<p class="loading">No data</p>';

  // Market hours 6am–6pm ET (stored in UTC, so offset ~4h — treat as-is for now)
  const hourMap = new Map(rows.map(r => [r.entry_hour, r]));
  const hours = Array.from({ length: 13 }, (_, i) => i + 6); // 6am–6pm
  const maxAbs = Math.max(...rows.map(r => Math.abs(r.net_pl)), 1);

  const cells = hours.map(h => {
    const r = hourMap.get(h);
    const intensity = r ? Math.min(Math.abs(r.net_pl) / maxAbs, 1) : 0;
    const isPos = r && r.net_pl >= 0;
    const bg = r
      ? isPos
        ? `rgba(34,197,94,${0.15 + intensity * 0.65})`
        : `rgba(239,68,68,${0.15 + intensity * 0.65})`
      : 'var(--surface2)';
    const label = h < 12 ? `${h}am` : h === 12 ? '12p' : `${h-12}pm`;
    const tooltip = r ? `${label}: ${r.count} trades, ${r.net_pl >= 0 ? '+' : ''}$${r.net_pl.toFixed(0)}, ${r.win_rate?.toFixed(0)}% WR` : label;

    return `
      <div title="${tooltip}" style="background:${bg};border-radius:6px;padding:10px 4px;text-align:center;cursor:default;min-width:52px">
        <div style="font-size:0.7rem;color:var(--muted);margin-bottom:2px">${label}</div>
        ${r ? `<div style="font-size:0.78rem;font-weight:600;color:${isPos ? '#22c55e' : '#ef4444'}">${r.net_pl >= 0 ? '+' : ''}$${Math.abs(r.net_pl) >= 1000 ? (r.net_pl/1000).toFixed(1)+'k' : r.net_pl.toFixed(0)}</div>` : '<div style="font-size:0.78rem;color:var(--muted)">—</div>'}
        ${r ? `<div style="font-size:0.68rem;color:var(--muted)">${r.count}t</div>` : ''}
      </div>
    `;
  });

  return `
    <div class="card" style="padding:12px 14px">
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${cells.join('')}
      </div>
      <div style="margin-top:8px;font-size:0.72rem;color:var(--muted)">Color intensity = P/L magnitude. Green = net positive, Red = net negative for that hour.</div>
    </div>
  `;
}

function buildTimeTable(rows) {
  if (!rows.length) return '<p class="loading">No data</p>';

  // Sort by net_pl to find best/worst
  const sorted = [...rows].sort((a, b) => a.net_pl - b.net_pl);
  const worst3 = new Set(sorted.slice(0, 3).map(r => r.entry_hour));
  const best3  = new Set(sorted.slice(-3).map(r => r.entry_hour));

  return `
    <div class="table-wrap card" style="padding:0">
      <table>
        <thead>
          <tr>
            <th>Hour (EST)</th>
            <th>Trades</th>
            <th>Net P/L</th>
            <th>Win Rate</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const rowCls = worst3.has(r.entry_hour) ? 'row-red' : best3.has(r.entry_hour) ? 'row-green' : '';
            const hour = r.entry_hour;
            const ampm = hour < 12 ? `${hour === 0 ? 12 : hour}am` : `${hour === 12 ? 12 : hour - 12}pm`;
            return `
              <tr class="${rowCls}">
                <td>${ampm}</td>
                <td>${r.count}</td>
                <td>${fmtPL(r.net_pl)}</td>
                <td class="${r.win_rate >= 50 ? 'pos' : 'neg'}">${fmtPct(r.win_rate)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function buildDayTable(rows) {
  if (!rows.length) return '<p class="loading">No data</p>';

  return `
    <div class="table-wrap card" style="padding:0">
      <table>
        <thead>
          <tr>
            <th>Day</th>
            <th>Trades</th>
            <th>Net P/L</th>
            <th>Win Rate</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const rowCls = r.net_pl < 0 ? 'row-red' : '';
            return `
              <tr class="${rowCls}">
                <td>${r.day_name}</td>
                <td>${r.count}</td>
                <td>${fmtPL(r.net_pl)}</td>
                <td class="${r.win_rate >= 50 ? 'pos' : 'neg'}">${fmtPct(r.win_rate)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function buildRepeatLosers(rows) {
  if (!rows.length) return '<p class="loading">No repeat losers found</p>';
  const top10 = rows.slice(0, 10);

  return `
    <div class="table-wrap card" style="padding:0">
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Loss Count</th>
            <th>Total Loss</th>
            <th>Avg Loss</th>
            <th>Worst</th>
          </tr>
        </thead>
        <tbody>
          ${top10.map(r => `
            <tr>
              <td><strong>${r.symbol}</strong></td>
              <td class="neg">${r.loss_count}</td>
              <td>${fmtPL(r.total_loss)}</td>
              <td>${fmtPL(r.avg_loss)}</td>
              <td>${fmtPL(r.worst_loss)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}
