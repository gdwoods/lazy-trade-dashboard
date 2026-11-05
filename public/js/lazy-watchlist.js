import { api, fmt, fmtDate } from './app.js';

let timer = null;

export async function renderLazyWatchlist(container) {
  if (timer) clearInterval(timer);

  container.innerHTML = `
    <div class="card" style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);margin-bottom:4px">Lazy Trade Scanner</div>
        <div style="font-size:1rem;font-weight:600">Short exhaustion watchlist</div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span id="lazy-updated-badge" style="display:inline-flex;align-items:center;gap:6px;background:rgba(79,142,247,0.12);border:1px solid rgba(79,142,247,0.22);color:var(--text);font-size:0.8rem;padding:6px 10px;border-radius:999px">Last updated: —</span>
        <span id="lazy-status" style="color:var(--muted);font-size:0.9rem">Loading…</span>
        <button id="lazy-refresh" class="btn btn-primary btn-sm">Refresh Data</button>
      </div>
    </div>
    <div id="lazy-content"><p class="loading">Loading…</p></div>
  `;

  container.querySelector('#lazy-refresh').addEventListener('click', async () => {
    const btn = container.querySelector('#lazy-refresh');
    const status = container.querySelector('#lazy-status');
    btn.disabled = true;
    btn.textContent = 'Refreshing…';
    if (status) status.textContent = 'Running screener…';
    try {
      await fetch('/api/lazy/refresh', { method: 'POST' }).then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Refresh failed');
      });
      await load(container);
    } catch (e) {
      if (status) status.textContent = `Refresh failed: ${e.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Refresh Data';
    }
  });

  await load(container);
  timer = setInterval(() => load(container, true), 60000);
}

async function load(container, silent = false) {
  const content = container.querySelector('#lazy-content');
  const status = container.querySelector('#lazy-status');
  const badge = container.querySelector('#lazy-updated-badge');
  const checkedAt = fmtDate(new Date().toISOString());

  if (!silent) content.innerHTML = '<p class="loading">Loading…</p>';
  if (status) status.textContent = silent ? 'Refreshing…' : 'Loading…';

  try {
    const data = await api(`/api/lazy/current?ts=${Date.now()}`);
    const generatedAt = data.generatedAt ? fmtDate(data.generatedAt) : '—';
    const counts = data.counts || {};
    const state = data.meta?.state || {};
    if (badge) badge.textContent = `Last updated: ${generatedAt}`;
    if (status) {
      status.textContent = `Ready ${counts.ready || 0} • Watch ${counts.watch || 0} • checked ${checkedAt}`;
    }
    content.innerHTML = buildView(data, state);
  } catch (e) {
    if (status) status.textContent = 'DOWN';
    content.innerHTML = `<p class="neg">${e.message}</p>`;
  }
}

function fmtDayVol(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000).toLocaleString()}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000).toLocaleString()}K`;
  return Math.round(n).toLocaleString();
}

function buildView(data, state) {
  const ready = data.ready || [];
  const watch = data.watch || [];

  const summary = `
    <div class="card" style="margin-bottom:16px;border-left:3px solid var(--accent)">
      <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center">
        <div><strong>Ready:</strong> ${ready.length}</div>
        <div><strong>Watch:</strong> ${watch.length}</div>
        <div><strong>Analyzed:</strong> ${data.counts?.totalAnalyzed ?? 0}/${data.universeSize ?? 0}</div>
        <div><strong>Last Alert Run:</strong> ${state.lastRunAt ? fmtDate(state.lastRunAt) : '—'}</div>
      </div>
    </div>
  `;

  const readyTable = `
    <div class="section-title">READY</div>
    ${buildTable(ready, true)}
  `;

  const watchTable = `
    <div class="section-title">WATCH</div>
    ${buildTable(watch, false)}
  `;

  return `${summary}${readyTable}${watchTable}`;
}

function buildTable(rows, isReady) {
  if (!rows.length) {
    return `<p class="loading" style="margin-bottom:18px">No ${isReady ? 'ready' : 'watch'} names right now.</p>`;
  }

  return `
    <div class="table-wrap" style="margin-bottom:18px">
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Status</th>
            <th>Score</th>
            <th>Price</th>
            <th>Day Vol</th>
            <th>3D %</th>
            <th>5D %</th>
            <th>4H RSI</th>
            <th>4H Cross</th>
            <th>30M Confirm</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => {
            const cross = r?.rsi4h?.barsSinceCrossDown69;
            const crossTxt = Number.isFinite(cross)
              ? `${cross} bar${cross === 1 ? '' : 's'} ago`
              : '—';
            const rollover = r?.rsi30m?.belowMA ? 'CONFIRMED' : '—';
            const firstNote = Array.isArray(r.notes) && r.notes.length ? r.notes[0] : '—';
            return `
              <tr>
                <td><strong>${r.ticker || '—'}</strong></td>
                <td>${r.status || '—'}</td>
                <td>${fmt(r.score, 1)}</td>
                <td>$${fmt(r.close, 2)}</td>
                <td>${fmtDayVol(r.dayVol)}</td>
                <td>${fmt(r?.parabolic?.chg3Pct, 1)}%</td>
                <td>${fmt(r?.parabolic?.chg5Pct, 1)}%</td>
                <td>${fmt(r?.rsi4h?.curr, 2)}</td>
                <td>${crossTxt}</td>
                <td>${rollover}</td>
                <td>${firstNote}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}
