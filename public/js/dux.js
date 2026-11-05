const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const money = (value) => Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : '—';
const pct = (value) => Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : '—';
const shares = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : '—';

function renderRows(matches) {
  if (!matches?.length) return '<tr><td colspan="9" style="color:var(--muted);text-align:center;padding:24px;">No qualified Dux setup matches. This is expected on most sessions.</td></tr>';
  return matches.map((match) => `
    <tr>
      <td><strong>${escapeHtml(match.ticker)}</strong><br><span style="font-size:.75rem;color:var(--muted)">${escapeHtml(match.name || '')}</span></td>
      <td><span class="warn">${escapeHtml(match.setup || '—')}</span></td>
      <td>${money(match.current_price)}</td>
      <td>${pct(match.gap_pct)}</td>
      <td>${pct(match.intraday_push_pct ?? match.cumulative_gain_pct)}</td>
      <td>${money(match.resistance_price ?? match.consolidation_high)}</td>
      <td>${money(match.stop_above)}</td>
      <td>${shares(match.float_shares)}</td>
      <td>${Number.isFinite(Number(match.market_cap)) ? `$${(Number(match.market_cap) / 1e6).toFixed(1)}M` : '—'}</td>
    </tr>`).join('');
}

export async function renderDux(container) {
  container.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:12px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;margin-bottom:16px;">
        <div>
          <h2 style="font-size:1.05rem;margin-bottom:6px;">Dux Short-Setup Scanner</h2>
          <p style="color:var(--muted);font-size:.9rem;max-width:780px;line-height:1.45;">Candidate screener for Gap Up Short, Bounce Short, and First Red Day. Results are for manual chart review only — this tab never sends an order.</p>
        </div>
        <button id="dux-run" class="btn btn-primary">Run scan</button>
      </div>
      <div class="form-grid">
        <div class="form-group full">
          <label for="dux-tickers">Tickers (optional)</label>
          <input id="dux-tickers" placeholder="e.g. GME, AMC, TSLA — leave blank to scan the Massive snapshot universe" autocomplete="off">
        </div>
        <div class="form-group"><label for="dux-date">Trade date</label><input id="dux-date" type="date"></div>
        <div class="form-group"><label for="dux-max">Snapshot candidates</label><input id="dux-max" type="number" min="1" max="200" value="75"></div>
      </div>
      <div id="dux-status" style="margin-top:14px;color:var(--muted);font-size:.9rem;">Ready. Intraday Gap Up results are meaningful only after the 10:00–11:00 AM ET confirmation window.</div>
    </div>
    <div class="stat-grid" id="dux-stats" style="display:none;"></div>
    <div class="card">
      <div class="section-title">Matches</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Ticker</th><th>Setup</th><th>Price</th><th>Gap</th><th>Push / Run</th><th>Resistance / High</th><th>Stop</th><th>Float</th><th>Market cap</th></tr></thead>
        <tbody id="dux-results"><tr><td colspan="9" style="color:var(--muted);text-align:center;padding:24px;">Run a scan to populate candidates.</td></tr></tbody>
      </table></div>
    </div>
    <div class="alert" style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);color:var(--text);"><strong class="warn">Risk control:</strong> This tool detects patterns; it does not validate borrow availability, halts, dilution, liquidity, news, or actual risk per share. Review every candidate manually before considering a paper or live trade.</div>`;

  const run = async () => {
    const button = document.getElementById('dux-run');
    const status = document.getElementById('dux-status');
    const tickerText = document.getElementById('dux-tickers').value;
    const tickers = tickerText.split(/[\s,]+/).map((ticker) => ticker.trim().toUpperCase()).filter(Boolean);
    const date = document.getElementById('dux-date').value || null;
    const maxCandidates = Number(document.getElementById('dux-max').value) || 75;

    button.disabled = true;
    status.textContent = tickers.length ? `Scanning ${tickers.length} ticker(s)…` : `Scanning up to ${maxCandidates} Massive snapshot candidates…`;
    try {
      const response = await fetch('/api/dux/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers, date, maxCandidates }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Dux scan failed');

      const matches = result.matches || [];
      document.getElementById('dux-results').innerHTML = renderRows(matches);
      document.getElementById('dux-stats').style.display = 'grid';
      document.getElementById('dux-stats').innerHTML = `
        <div class="stat-card"><div class="label">Scanned</div><div class="value accent">${Number(result.counts?.scanned || 0).toLocaleString()}</div></div>
        <div class="stat-card"><div class="label">Matches</div><div class="value ${matches.length ? 'warn' : 'neutral'}">${matches.length}</div></div>
        <div class="stat-card"><div class="label">Source</div><div class="value neutral" style="font-size:1rem">${result.source === 'manual-tickers' ? 'Manual list' : 'Massive snapshot'}</div></div>
        <div class="stat-card"><div class="label">Scan date</div><div class="value neutral" style="font-size:1rem">${escapeHtml(result.tradeDate || 'Today')}</div></div>`;
      status.textContent = `Completed ${result.generatedAt ? new Date(result.generatedAt).toLocaleString() : ''}. ${matches.length} setup match(es) found.`;
    } catch (error) {
      status.innerHTML = `<span class="neg">Scan failed: ${escapeHtml(error.message)}</span>`;
    } finally {
      button.disabled = false;
    }
  };
  document.getElementById('dux-run').addEventListener('click', run);
}
