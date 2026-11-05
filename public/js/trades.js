import { api, fmtPL, fmtDate, fmtHold, fmt, openPanel, closePanel, navigate } from './app.js';
import { setCoachContext, initModalCoach } from './coach.js';

// Image modal functions
function openImageModal(base64Image) {
  const modal = document.getElementById('image-modal');
  const img = document.getElementById('modal-image');
  img.src = `data:image/png;base64,${base64Image}`;
  modal.classList.add('open');
}

function closeImageModal() {
  const modal = document.getElementById('image-modal');
  modal.classList.remove('open');
}

// Setup modal controls
function setupModalControls() {
  const modal = document.getElementById('image-modal');
  const closeBtn = document.getElementById('modal-close');
  
  if (closeBtn) {
    closeBtn.addEventListener('click', closeImageModal);
  }
  
  // Close when clicking outside the image
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target === modal) closeImageModal();
    });
    
    // Keyboard escape to close
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal.classList.contains('open')) closeImageModal();
    });
  }
}

let state = { offset: 0, limit: 50, total: 0, symbol: '', sort: 'start_datetime', dir: 'desc' };

export async function renderTrades(container) {
  state.offset = 0;
  container.innerHTML = buildShell();
  bindControls(container);
  setupModalControls();
  await loadTrades(container);
}

function buildShell() {
  return `
    <div class="card" style="padding:14px 16px; display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom:0">
      <input id="sym-filter" type="text" placeholder="Filter by symbol…" style="width:180px" value="${state.symbol}">
      <select id="sort-select">
        <option value="start_datetime" ${state.sort==='start_datetime'?'selected':''}>Sort: Date</option>
        <option value="net_pl" ${state.sort==='net_pl'?'selected':''}>Sort: P/L</option>
        <option value="hold_minutes" ${state.sort==='hold_minutes'?'selected':''}>Sort: Hold</option>
        <option value="symbol" ${state.sort==='symbol'?'selected':''}>Sort: Symbol</option>
      </select>
      <select id="dir-select">
        <option value="desc" ${state.dir==='desc'?'selected':''}>Desc</option>
        <option value="asc" ${state.dir==='asc'?'selected':''}>Asc</option>
      </select>
      <button class="btn btn-primary btn-sm" id="filter-btn">Apply</button>
    </div>
    <div id="trades-table" style="margin-top:16px"></div>
    <div class="pagination" id="trades-pagination"></div>
  `;
}

function bindControls(container) {
  container.querySelector('#filter-btn').addEventListener('click', async () => {
    state.symbol = container.querySelector('#sym-filter').value.trim().toUpperCase();
    state.sort   = container.querySelector('#sort-select').value;
    state.dir    = container.querySelector('#dir-select').value;
    state.offset = 0;
    await loadTrades(container);
  });

  container.querySelector('#sym-filter').addEventListener('keydown', async e => {
    if (e.key === 'Enter') container.querySelector('#filter-btn').click();
  });
}

async function loadTrades(container) {
  const tableEl = container.querySelector('#trades-table');
  const pagEl   = container.querySelector('#trades-pagination');
  tableEl.innerHTML = '<p class="loading">Loading trades…</p>';
  pagEl.innerHTML   = '';

  try {
    const qs = new URLSearchParams({
      limit:  state.limit,
      offset: state.offset,
      symbol: state.symbol,
      sort:   state.sort,
      dir:    state.dir,
    });
    const data = await api(`/api/trades?${qs}`);
    state.total = data.total;
    tableEl.innerHTML = buildTable(data.trades);

    // Row clicks → detail panel
    tableEl.querySelectorAll('tr.clickable').forEach(tr => {
      tr.addEventListener('click', () => loadDetail(tr.dataset.id));
    });

    pagEl.innerHTML = buildPagination();
    pagEl.querySelector('#prev-btn')?.addEventListener('click', async () => {
      state.offset = Math.max(0, state.offset - state.limit);
      await loadTrades(container);
    });
    pagEl.querySelector('#next-btn')?.addEventListener('click', async () => {
      state.offset += state.limit;
      await loadTrades(container);
    });
  } catch (e) {
    tableEl.innerHTML = `<p class="neg">Error: ${e.message}</p>`;
  }
}

function buildTable(trades) {
  if (!trades.length) return '<p class="loading">No trades found.</p>';
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Symbol</th>
            <th>Pre-Trade</th>
            <th>Net P/L</th>
            <th>Hold</th>
            <th>Side</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          ${trades.map(t => `
            <tr class="clickable" data-id="${t.id}">
              <td>${fmtDate(t.start_datetime)}</td>
              <td><strong>${t.symbol}</strong></td>
              <td style="text-align:center;">
                ${t.has_pre_trade
                  ? '<span title="Pre-Trade note linked" style="display:inline-block;width:11px;height:11px;border-radius:999px;background:#22c55e;border:1px solid #16a34a;box-shadow:0 0 0 2px rgba(34,197,94,0.18)"></span>'
                  : '<span title="No Pre-Trade note linked" style="display:inline-block;width:11px;height:11px;border-radius:999px;background:#9ca3af;border:1px solid #6b7280;opacity:0.75"></span>'}
              </td>
              <td>${fmtPL(t.net_pl)}</td>
              <td>${fmtHold(t.hold_minutes)}</td>
              <td>${t.side || '—'}</td>
              <td class="${t.is_win ? 'pos' : 'neg'}">${t.is_win ? 'WIN' : 'LOSS'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function buildPagination() {
  const page = Math.floor(state.offset / state.limit) + 1;
  const totalPages = Math.ceil(state.total / state.limit);
  return `
    <button id="prev-btn" ${state.offset === 0 ? 'disabled' : ''}>&larr; Prev</button>
    <span class="page-info">Page ${page} of ${totalPages} &nbsp;(${state.total} trades)</span>
    <button id="next-btn" ${state.offset + state.limit >= state.total ? 'disabled' : ''}>Next &rarr;</button>
  `;
}

async function loadDetail(id) {
  try {
    // Show loading state
    document.getElementById('trade-panel').classList.add('open');
    document.getElementById('panel-left').innerHTML = '<p class="loading">Loading trade…</p>';
    document.getElementById('panel-right').innerHTML = '<p class="loading">Loading…</p>';

    const t = await api(`/api/trades/${id}`);
    // Update sidebar coach with trade context
    setCoachContext(t);
    
    // Build modal header metadata
    document.getElementById('modal-title').textContent = `Trade #${t.id}`;
    document.getElementById('modal-symbol').textContent = t.symbol;
    document.getElementById('modal-date').textContent = fmtDate(t.start_datetime);
    const plText = t.net_pl >= 0 ? '+' : '';
    const plClass = t.net_pl >= 0 ? 'pos' : 'neg';
    document.getElementById('modal-pl').innerHTML = `<span class="${plClass}">${plText}$${fmt(t.net_pl)}</span>`;
    
    // Build left panel (metadata, executions, pre-trade notes)
    document.getElementById('panel-left').innerHTML = buildDetailPanelLeft(t);
    
    // Build right panel (chart, pre-trade note comparison)
    document.getElementById('panel-right').innerHTML = buildDetailPanelRight(t);

    // Initialize modal coach panel after DOM nodes exist
    initModalCoach();

    const openPreTradeBtn = document.getElementById(`open-pretrade-btn-${t.id}`);
    if (openPreTradeBtn) {
      openPreTradeBtn.onclick = () => {
        closePanel();
        history.pushState(null, '', `#pretrade?symbol=${encodeURIComponent(t.symbol)}&tradeId=${encodeURIComponent(t.id)}`);
        navigate('pretrade');
      };
    }

    // Deferred async sections
    setTimeout(async () => {
      // Render chart with Lightweight Charts
      const chartContainerId = `chart-container-${t.id}`;
      const chartEl = document.getElementById(chartContainerId);
      if (chartEl) {
        try {
          const tradeDate = t.start_datetime.split('T')[0]; // YYYY-MM-DD
          const chartUrl = `/api/chart-data/${t.symbol}/${tradeDate}/${t.id}`;
          console.log(`[Cobra] Fetching chart from: ${chartUrl}`);
          const r = await fetch(chartUrl);
          if (r.ok) {
            const data = await r.json();
            const bars = data.bars || [];
            const markers = data.markers || [];
            const indicators = data.indicators || {};
            const session = data.session || null;
            const runningPl = Array.isArray(data.running_pl_minute) && data.running_pl_minute.length
              ? data.running_pl_minute
              : buildRunningPlSeries({
                  executions: t.executions || [],
                  trade: t,
                  bars,
                });

            // Always try to render the chart if we have bars
            if (bars.length > 0) {
              // cache for pop-out modal
              chartCache.set(String(t.id), { bars, markers, indicators, session });
              runningPlCache.set(String(t.id), { runningPl, trade: t });

              // Clear loading text and render chart with small delay
              chartEl.innerHTML = '';
              setTimeout(() => {
                renderLightweightChart(chartContainerId, bars, markers, { indicators, session });
              }, 50);

              const plContainer = document.getElementById(`running-pl-container-${t.id}`);
              if (plContainer) {
                plContainer.innerHTML = '';
                setTimeout(() => {
                  renderRunningPlChart(`running-pl-container-${t.id}`, runningPl, { session });
                }, 50);
              }

              const popBtn = document.getElementById(`chart-pop-btn-${t.id}`);
              if (popBtn) {
                popBtn.onclick = () => openChartPopModal(t.id);
              }

              const runningPopBtn = document.getElementById(`running-pl-pop-btn-${t.id}`);
              if (runningPopBtn) {
                runningPopBtn.onclick = () => openRunningPlPopModal(t.id);
              }
            } else {
              chartEl.innerHTML = `<p style="color:var(--muted);font-size:0.85rem;text-align:center;padding:20px">No chart data available</p>`;
            }
          } else {
            chartEl.innerHTML = `<p style="color:var(--muted);font-size:0.85rem;text-align:center;padding:20px">No chart data available</p>`;
          }
        } catch (e) {
          console.error('[Cobra] Chart fetch error:', e);
          chartEl.innerHTML = `<p style="color:red;font-size:0.85rem;text-align:center;padding:20px">⚠️ Error: ${e.message}</p>`;
        }
      }

      // Load pre-trade notes
      const ptEl = document.getElementById(`pretrade-container-${t.id}`);
      if (ptEl) {
        try {
          const r = await fetch(`/api/pre-trade/for-trade/${t.id}`);
          const notes = r.ok ? await r.json() : [];
          if (notes.length) {
            const mainNote = notes[0];
            ptEl.innerHTML = notes.map(n => buildPlanVsReality(n, t)).join('');
            
            // Append pre-trade screenshots if they exist
            if (mainNote.dt_image || mainNote.chart_image) {
              const imagesHtml = `
                <div style="margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:16px">
                  ${mainNote.dt_image ? `
                    <div>
                      <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted);margin-bottom:8px">DilutionTracker</div>
                      <img class="screenshot-thumb" src="data:image/png;base64,${mainNote.dt_image}" style="width:100%;border-radius:8px;border:1px solid var(--border)" alt="DT Screenshot" data-fullsize="${mainNote.dt_image}">
                    </div>
                  ` : ''}
                  ${mainNote.chart_image ? `
                    <div>
                      <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted);margin-bottom:8px">TradingView Chart</div>
                      <img class="screenshot-thumb" src="data:image/png;base64,${mainNote.chart_image}" style="width:100%;border-radius:8px;border:1px solid var(--border)" alt="TV Screenshot" data-fullsize="${mainNote.chart_image}">
                    </div>
                  ` : ''}
                </div>
              `;
              ptEl.innerHTML += imagesHtml;
              
              // Bind click handlers to thumbnails
              setTimeout(() => {
                ptEl.querySelectorAll('.screenshot-thumb').forEach(img => {
                  img.addEventListener('click', () => {
                    const base64 = img.dataset.fullsize;
                    openImageModal(base64);
                  });
                });
              }, 0);
            }
          } else {
            ptEl.innerHTML = `<p style="color:var(--muted);font-size:0.85rem">No pre-trade notes linked. <a href="#" class="link-pretrade" data-tradeid="${t.id}" data-symbol="${t.symbol}">Add one →</a></p>`;
            ptEl.querySelector('.link-pretrade')?.addEventListener('click', e => {
              e.preventDefault();
              closePanel();
              history.pushState(null, '', `#pretrade?symbol=${t.symbol}`);
              navigate('pretrade');
            });
          }
        } catch {
          ptEl.innerHTML = `<p style="color:var(--muted);font-size:0.85rem">Could not load pre-trade notes</p>`;
        }
      }
    }, 0);
  } catch (e) {
    document.getElementById('panel-left').innerHTML = `<p class="neg">Error: ${e.message}</p>`;
  }
}

function buildPlanVsReality(n, t) {
  const plCls = t.net_pl >= 0 ? 'pos' : 'neg';
  const plSign = t.net_pl >= 0 ? '+' : '';
  const biasMatch = n.short_bias && t.side
    ? (n.short_bias === 'Strong' || n.short_bias === 'Weak') && t.side.toLowerCase().includes('short')
      ? '✅' : '⚠️'
    : '';

  // Conviction vs outcome
  const confStars = n.confidence ? '★'.repeat(n.confidence) + '☆'.repeat(5 - n.confidence) : null;
  const outcome = t.net_pl >= 0 ? '✅ Winner' : '❌ Loser';
  const outcomeColor = t.net_pl >= 0 ? 'var(--pos)' : 'var(--neg)';

  // Key level accuracy
  const entryVsSupport = (n.key_support && t.entry_price)
    ? Math.abs(t.entry_price - n.key_support) < 0.05
      ? '✅ Near key support'
      : t.entry_price > n.key_support
        ? `↑ $${(t.entry_price - n.key_support).toFixed(2)} above support`
        : `↓ $${(n.key_support - t.entry_price).toFixed(2)} below support`
    : null;

  const rows = [
    ['Thesis', n.thesis || '—', null],
    ['Short Bias', n.short_bias ? `${n.short_bias} ${biasMatch}` : '—', null],
    ['Confidence', confStars || '—', null],
    ['Droppiness', n.droppiness != null ? n.droppiness : '—', null],
    ['Planned Entry', n.entry_price != null ? `$${fmt(n.entry_price)}` : '—',
      t.entry_price != null ? `Actual: $${fmt(t.entry_price)}` : null],
    ['Key Support', n.key_support != null ? `$${fmt(n.key_support)}` : '—',
      entryVsSupport],
    ['Key Resistance', n.key_resistance != null ? `$${fmt(n.key_resistance)}` : '—', null],
    ['Invalidation', n.invalidation || '—', null],
    ['RSI at Entry', n.rsi_at_entry != null ? n.rsi_at_entry : '—', null],
    ['MACD', n.macd_signal || '—', null],
  ].filter(([, v]) => v && v !== '—');

  return `
    <div class="card" style="padding:14px 16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <span style="font-weight:600;font-size:0.9rem">📋 Plan vs. Reality</span>
        <span style="font-size:1rem;font-weight:700;color:${outcomeColor}">${outcome} &nbsp;${plSign}$${fmt(Math.abs(t.net_pl))} &nbsp;<span style="font-size:0.8rem;color:var(--muted)">${fmtHold(t.hold_minutes)}</span></span>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;font-size:0.82rem;margin-bottom:12px">
        ${rows.map(([label, plan, actual]) => `
          <div>
            <div style="color:var(--muted);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em">${label}</div>
            <div style="color:var(--text)">${plan}</div>
            ${actual ? `<div style="color:var(--muted);font-size:0.78rem">${actual}</div>` : ''}
          </div>
        `).join('')}
      </div>

      ${n.thesis ? `
        <div style="border-top:1px solid var(--border);padding-top:10px;margin-top:4px">
          <div style="color:var(--muted);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Full Thesis</div>
          <div style="font-size:0.83rem;color:var(--text);line-height:1.5">${n.thesis}</div>
        </div>
      ` : ''}

      ${n.invalidation ? `
        <div style="border-top:1px solid var(--border);padding-top:10px;margin-top:8px">
          <div style="color:var(--muted);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Invalidation Level</div>
          <div style="font-size:0.83rem;color:var(--warn)">${n.invalidation}</div>
        </div>
      ` : ''}

      <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:8px;display:flex;gap:16px;font-size:0.78rem;color:var(--muted)">
        <span>Note: ${fmtDate(n.created_at)}</span>
        ${n.timeframe ? `<span>TF: ${n.timeframe}</span>` : ''}
      </div>
    </div>
  `;
}

function buildDetailPanelLeft(t) {
  const execs = t.executions || [];
  const execSummary = summarizeExecutions(execs, t.side);
  return `
    <div class="detail-section">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px">
        <h3 style="margin:0">Trade Metrics</h3>
        <button id="open-pretrade-btn-${t.id}" class="btn btn-sm" style="background:var(--bg);border:1px solid var(--border);color:var(--text)">📝 Open Pre-Trade</button>
      </div>
      <div class="detail-kv">
        <div class="kv"><div class="k">Net P/L</div><div class="v ${t.net_pl >= 0 ? 'pos' : 'neg'}">${t.net_pl >= 0 ? '+' : ''}$${fmt(t.net_pl)}</div></div>
        <div class="kv"><div class="k">Gross P/L</div><div class="v">${t.gross_pl >= 0 ? '+' : ''}$${fmt(t.gross_pl)}</div></div>
        <div class="kv"><div class="k">Hold Time</div><div class="v">${fmtHold(t.hold_minutes)}</div></div>
        <div class="kv"><div class="k">Side</div><div class="v">${t.side || '—'}</div></div>
        <div class="kv"><div class="k">Entry Price</div><div class="v">$${fmt(execSummary.entryAvg ?? t.entry_price)}</div></div>
        <div class="kv"><div class="k">Exit Price</div><div class="v">$${fmt(execSummary.exitAvg ?? t.exit_price)}</div></div>
        <div class="kv"><div class="k">Entry Qty</div><div class="v">${execSummary.entryQty?.toLocaleString() ?? '—'}</div></div>
        <div class="kv"><div class="k">Exit Qty</div><div class="v">${execSummary.exitQty?.toLocaleString() ?? '—'}</div></div>
        <div class="kv"><div class="k">Commission</div><div class="v neg">$${fmt(t.commission)}</div></div>
      </div>
    </div>

    <div class="detail-section" style="margin-top:-2px">
      <div id="modal-coach-panel">
        <div id="modal-coach-header">💬 Coach Assistant</div>
        <div id="modal-coach-messages"></div>
        <div id="modal-coach-input-area">
          <select id="modal-coach-model-select" class="coach-model-select" style="width: 100%;">
            <option value="haiku">Haiku (Fast)</option>
            <option value="sonnet" selected>Sonnet (Balanced)</option>
            <option value="gpt-4">GPT-4 (Smart)</option>
          </select>
          <textarea id="modal-coach-input" placeholder="Ask about this trade..."></textarea>
          <button id="modal-coach-send" type="button">Send</button>
        </div>
      </div>
    </div>

    ${t.notes_excerpt ? `
    <div class="detail-section">
      <h3>Trade Notes</h3>
      <div class="card" style="padding:12px;font-size:0.85rem;color:var(--text);line-height:1.5">${t.notes_excerpt}</div>
    </div>
    ` : ''}

    <div class="detail-section">
      <h3>Executions (${execs.length})</h3>
      ${execs.length ? `
        <div class="table-wrap" style="font-size:0.8rem;overflow-x:auto">
          <table style="width:100%">
            <thead>
              <tr><th style="text-align:left">Time</th><th style="text-align:left">Side</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Comm</th></tr>
            </thead>
            <tbody>
              ${execSummary.rows.map(e => `
                <tr>
                  <td>${fmtDate(e.timestamp)}</td>
                  <td class="${e.side === 'buy' ? 'pos' : 'neg'}" style="font-weight:600">${e.side}</td>
                  <td style="text-align:right">${e.quantity}</td>
                  <td style="text-align:right">$${fmt(e.price, 4)}</td>
                  <td style="text-align:right;color:var(--red)">$${fmt(e.commission)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<p style="color:var(--muted);font-size:0.85rem">No executions found.</p>'}
    </div>
  `;
}

function summarizeExecutions(executions, tradeSide) {
  const rows = Array.isArray(executions) ? executions : [];
  const side = String(tradeSide || '').toLowerCase();
  const isLong = side === 'long';
  let entryQty = 0, entryNotional = 0, exitQty = 0, exitNotional = 0;

  for (const e of rows) {
    const qty = Math.abs(Number(e.quantity || 0));
    const price = Number(e.price || 0);
    if (!qty || !price) continue;
    const classification = classifyExecution(e, isLong);
    const opening = classification === 'opening';
    const closing = classification === 'closing';

    if (opening) {
      entryQty += qty;
      entryNotional += qty * price;
    } else if (closing) {
      exitQty += qty;
      exitNotional += qty * price;
    }
  }

  return {
    rows,
    entryQty: entryQty || null,
    exitQty: exitQty || null,
    entryAvg: entryQty ? entryNotional / entryQty : null,
    exitAvg: exitQty ? exitNotional / exitQty : null,
  };
}

function classifyExecution(exec, isLong) {
  const sideText = String(exec?.side || exec?.broker_side || '').toLowerCase();
  const signedQty = Number(exec?.quantity || 0);
  const normalizedQty = Math.abs(signedQty);
  const positionHint = Number(exec?.position ?? exec?.position_after ?? exec?.running_position ?? NaN);

  const isBuy = sideText.includes('buy') || sideText.includes('cover');
  const isSell = sideText.includes('sell') || sideText.includes('short');
  const openingLabel = isLong
    ? (sideText.includes('buy') || sideText.includes('entry') || sideText.includes('open'))
    : (sideText.includes('sell') || sideText.includes('short') || sideText.includes('entry') || sideText.includes('open'));
  const closingLabel = isLong
    ? (sideText.includes('sell') || sideText.includes('exit') || sideText.includes('close'))
    : (sideText.includes('buy') || sideText.includes('cover') || sideText.includes('exit') || sideText.includes('close'));

  if (openingLabel && !closingLabel) return 'opening';
  if (closingLabel && !openingLabel) return 'closing';

  if (isLong) {
    if (isBuy && !isSell) return 'opening';
    if (isSell && !isBuy) return 'closing';
  } else {
    if (isSell && !isBuy) return 'opening';
    if (isBuy && !isSell) return 'closing';
  }

  // Fallback: infer from signed quantity/position if the text label is ambiguous.
  if (Number.isFinite(positionHint)) {
    if (isLong) return positionHint >= 0 ? 'opening' : 'closing';
    return positionHint <= 0 ? 'opening' : 'closing';
  }

  if (Number.isFinite(signedQty) && signedQty !== 0) {
    if (isLong) return signedQty > 0 ? 'opening' : 'closing';
    return signedQty < 0 ? 'opening' : 'closing';
  }

  // Last resort: keep the first fill as opening, later fills as closing if unlabeled.
  return normalizedQty ? 'opening' : 'unknown';
}

function groupExecutionMarkers(executions, tradeSide) {
  const rows = Array.isArray(executions) ? executions : [];
  const isLong = String(tradeSide || '').toLowerCase() === 'long';
  const sorted = rows
    .map(e => ({
      timestamp: e.timestamp,
      qty: Math.abs(Number(e.quantity ?? e.qty ?? 0)),
      price: Number(e.price || 0),
      brokerSide: String(e.broker_side || e.side || '').toLowerCase(),
      side: String(e.side || '').toLowerCase(),
      classification: classifyExecution(e, isLong),
    }))
    .filter(e => e.timestamp && e.qty > 0 && e.price > 0)
    .sort((a, b) => parseTradeTimestamp(a.timestamp) - parseTradeTimestamp(b.timestamp));

  const groups = [];
  const windowMs = 5000;
  for (const ex of sorted) {
    const ts = Math.floor(Date.parse(String(ex.timestamp).replace(' ','T')) / 1000);
    const last = groups[groups.length - 1];
    if (last && (ts - last.ts) * 1000 <= windowMs && last.brokerSide === ex.brokerSide) {
      last.qty += ex.qty;
      last.priceSum += ex.price * ex.qty;
      last.timestamp = ex.timestamp;
      last.ts = ts;
      continue;
    }
    groups.push({
      ts,
      timestamp: ex.timestamp,
      qty: ex.qty,
      priceSum: ex.price * ex.qty,
      brokerSide: ex.brokerSide,
      isBuy: ex.brokerSide.includes('buy') || (isLong ? ex.classification === 'closing' : ex.classification === 'closing'),
      label: ex.brokerSide.includes('buy') ? 'BUY' : 'SELL',
      symbol: ex.brokerSide.includes('buy') ? '▲' : '▼',
    });
  }

  return groups.map(g => ({
    timestamp: g.timestamp,
    qty: g.qty,
    price: g.priceSum / g.qty,
    isBuy: g.isBuy,
    label: g.label,
    symbol: g.symbol,
    color: g.isBuy ? '#22c55e' : '#ef4444',
    ts: g.ts,
  }));
}

function formatEtLabel(utcSeconds) {
  return new Date(utcSeconds * 1000).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function parseTradeTimestamp(ts) {
  if (!ts) return NaN;
  if (typeof ts === 'number') return ts;
  const str = String(ts).trim();
  const normalized = str.includes('T') ? str : str.replace(' ', 'T');
  const parsed = Date.parse(normalized);
  if (Number.isFinite(parsed)) return parsed;
  return Date.parse(`${normalized}Z`);
}


function buildDetailPanelRight(t) {
  return `
    <div style="overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding-right:8px">
      <div class="detail-section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;flex-wrap:wrap">
          <h3 style="margin:0">Intraday Chart (1-Minute Bars)</h3>
          <button id="chart-pop-btn-${t.id}" class="btn btn-sm" style="background:var(--bg);border:1px solid var(--border);color:var(--text)">🔍 Pop Out</button>
        </div>
        <div id="chart-container-${t.id}" style="width:100%;height:220px;background:var(--bg);border:1px solid var(--border);border-radius:8px"></div>
        <div style="height:10px"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;flex-wrap:wrap">
          <h4 style="margin:0;font-size:0.85rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em">Minute-by-Minute P/L</h4>
          <button id="running-pl-pop-btn-${t.id}" class="btn btn-sm" style="background:var(--bg);border:1px solid var(--border);color:var(--text)">🔍 Pop Out</button>
        </div>
        <div id="running-pl-container-${t.id}" style="width:100%;height:190px;background:var(--bg);border:1px solid var(--border);border-radius:8px"></div>
      </div>

      <div class="detail-section">
        <h3>Pre-Trade Notes</h3>
        <div id="pretrade-container-${t.id}">Loading…</div>
      </div>
    </div>
  `;
}

// Chart cache for pop-out modal
const chartCache = new Map();
const runningPlCache = new Map();

// Render TradingView Lightweight Charts
function renderLightweightChart(containerId, bars, markers, opts = {}) {
  const container = document.getElementById(containerId);
  if (!container || !window.LightweightCharts) return;

  try {
    const { createChart, ColorType } = window.LightweightCharts;
    
    // Ensure bars and markers are arrays
    const barsArray = Array.isArray(bars) ? bars : [];
    const markersArray = Array.isArray(markers) ? markers : [];
    
    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#0f1117' },
        textColor: '#e2e8f0',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(0,0,0,0)' },
        horzLines: { color: 'rgba(0,0,0,0)' },
      },
      width: container.offsetWidth,
      height: opts.height || container.offsetHeight,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        tickMarkFormatter: (time) => {
          const dt = new Date(time * 1000);
          const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(dt.getUTCDate()).padStart(2, '0');
          const hh = String(dt.getUTCHours()).padStart(2, '0');
          const min = String(dt.getUTCMinutes()).padStart(2, '0');
          return `${mm}/${dd} ${hh}:${min}`;
        },
      },
      rightPriceScale: {
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    // Add candles (convert to LWC format: epoch seconds, adjusted to Eastern time)
    let candles = [];
    if (barsArray.length > 0) {
      candles = barsArray.map(b => {
        if (!b.timestamp || !b.open) {
          console.warn('Invalid bar data:', b);
          return null;
        }
        // Get UTC time, then adjust for Eastern timezone (UTC-4 during DST, UTC-5 in EST)
        const utcDate = new Date(b.timestamp);
        const utcTime = utcDate.getTime();
        const month = utcDate.getUTCMonth();
        const isDST = month >= 2 && month <= 10;
        const offset = isDST ? 4 * 60 * 60 * 1000 : 5 * 60 * 60 * 1000;
        const easternTime = Math.floor((utcTime - offset) / 1000);
        return {
          time: easternTime,
          open: parseFloat(b.open),
          high: parseFloat(b.high),
          low: parseFloat(b.low),
          close: parseFloat(b.close),
          volume: parseFloat(b.volume || 0),
        };
      }).filter(c => c !== null);

      if (candles.length > 0) {
        candlestickSeries.setData(candles.map(({ volume, ...rest }) => rest));
      }
    }

    // VWAP (intraday cumulative) — subtle purple
    if (candles.length > 0) {
      const vwapSeries = chart.addLineSeries({
        color: 'rgba(147, 51, 234, 0.65)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      let cumPV = 0;
      let cumV = 0;
      const vwapData = candles.map(c => {
        const typical = (c.high + c.low + c.close) / 3;
        const v = Number(c.volume || 0);
        cumPV += typical * v;
        cumV += v;
        return { time: c.time, value: cumV > 0 ? (cumPV / cumV) : c.close };
      });
      vwapSeries.setData(vwapData);
    }

    // SMA(200) built from 5-minute bars — subtle solid brown
    const sma5m = Array.isArray(opts?.indicators?.sma200_5m) ? opts.indicators.sma200_5m : [];
    if (sma5m.length > 0) {
      const smaSeries = chart.addLineSeries({
        color: 'rgba(120, 72, 39, 0.60)',
        lineWidth: 1,
        lineStyle: 0,
        priceLineVisible: false,
        lastValueVisible: true,
      });

      const smaData = sma5m.map(p => {
        const utcDate = new Date(p.timestamp);
        const utcTime = utcDate.getTime();
        const month = utcDate.getUTCMonth();
        const isDST = month >= 2 && month <= 10;
        const offset = isDST ? 4 * 60 * 60 * 1000 : 5 * 60 * 60 * 1000;
        return { time: Math.floor((utcTime - offset) / 1000), value: Number(p.value) };
      }).filter(p => Number.isFinite(p.value));

      if (smaData.length) smaSeries.setData(smaData);
    }

    // Force visible range to full session (04:00-20:00 ET) even if no premarket candles
    if (opts?.session?.start && opts?.session?.end) {
      const toEasternEpoch = (iso) => {
        const utcDate = new Date(iso);
        const utcTime = utcDate.getTime();
        const month = utcDate.getUTCMonth();
        const isDST = month >= 2 && month <= 10;
        const offset = isDST ? 4 * 60 * 60 * 1000 : 5 * 60 * 60 * 1000;
        return Math.floor((utcTime - offset) / 1000);
      };
      const from = toEasternEpoch(opts.session.start);
      const to = toEasternEpoch(opts.session.end);
      chart.timeScale().setVisibleRange({ from, to });
    }

    // Add markers for entry/exit from trade record
    if (markersArray && markersArray.length > 0) {
      try {
        const chartMarkers = markersArray.map(m => {
          // Convert UTC to Eastern time (same as candles)
          const utcDate = new Date(m.timestamp);
          const utcTime = utcDate.getTime();
          const month = utcDate.getUTCMonth();
          const isDST = month >= 2 && month <= 10;
          const offset = isDST ? 4 * 60 * 60 * 1000 : 5 * 60 * 60 * 1000;
          const time = Math.floor((utcTime - offset) / 1000);
          const isEntry = m.side === 'entry';
          const isShort = m.tradeType === 'short';
          const timeStr = m.timeLabel || 'N/A';
          
          // Shorts: entry = down (selling), exit = up (covering)
          // Longs: entry = up (buying), exit = down (selling)
          let shape, arrowEmoji;
          if (isShort) {
            shape = isEntry ? 'arrowDown' : 'arrowUp';
            arrowEmoji = isEntry ? '⬇️' : '⬆️';
          } else {
            shape = isEntry ? 'arrowUp' : 'arrowDown';
            arrowEmoji = isEntry ? '⬆️' : '⬇️';
          }
          
          const qtyLabel = m.qty ? ` ${Number(m.qty).toLocaleString()}sh` : '';
          return {
            time,
            position: isEntry ? 'aboveBar' : 'belowBar',
            color: isEntry ? '#22c55e' : '#ef4444',
            shape: shape,
            text: `${arrowEmoji} ${isEntry ? 'ENTRY' : 'EXIT'}${qtyLabel} ${timeStr} $${parseFloat(m.price).toFixed(2)}`,
          };
        });
        if (chartMarkers && chartMarkers.length > 0) {
          candlestickSeries.setMarkers(chartMarkers);
        }
      } catch (markerErr) {
        console.warn('Marker rendering error:', markerErr);
      }
    }

    // Fit unless fixed session range requested
    if (!opts?.session?.start || !opts?.session?.end) {
      chart.timeScale().fitContent();
    }
    
    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ 
        width: container.offsetWidth, 
        height: container.offsetHeight 
      });
      if (!opts?.session?.start || !opts?.session?.end) {
        chart.timeScale().fitContent();
      }
    });
    resizeObserver.observe(container);

    // Enable interactions
    chart.subscribeCrosshairMove(() => {});
  } catch (e) {
    console.error('Chart render error:', e);
    container.innerHTML = `<p style="color:var(--muted);font-size:0.85rem">Chart error: ${e.message}</p>`;
  }
}

function renderRunningPlChart(containerId, points, opts = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  try {
    const toEpoch = (p) => {
      if (Number.isFinite(Number(p?.time))) return Number(p.time);
      if (!p?.timestamp) return null;
      return Math.floor(new Date(p.timestamp).getTime() / 1000);
    };

    const rawData = Array.isArray(points) ? points.map(p => {
      const time = toEpoch(p);
      const value = Number(p?.value ?? 0);
      if (!Number.isFinite(time) || !Number.isFinite(value)) return null;
      return { time, value: Math.round(value * 100) / 100 };
    }).filter(Boolean) : [];

    if (!rawData.length) {
      container.innerHTML = `<p style="color:var(--muted);font-size:0.85rem">No running P/L data available.</p>`;
      return;
    }

    const w = container.offsetWidth || 520;
    const h = opts.height || container.offsetHeight || 150;
    const padL = 54;
    const padR = 18;
    const padT = 16;
    const padB = 24;
    const minVal = Math.min(...rawData.map(d => d.value));
    const maxVal = Math.max(...rawData.map(d => d.value));
    const span = Math.max(maxVal - minVal, 1);
    const posColor = '#22c55e';
    const negColor = '#ef4444';

    const trade = opts.trade || null;
    const tradeType = String(trade?.side || '').toLowerCase();
    const execMarkers = groupExecutionMarkers(trade?.executions || [], tradeType);
    const executionTimeline = rawData;

    const xMin = executionTimeline[0].time;
    const xMax = executionTimeline[executionTimeline.length - 1].time;
    const xSpan = Math.max(xMax - xMin, 1);
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const sx = (t) => padL + ((t - xMin) / xSpan) * innerW;
    const sy = (v) => padT + ((maxVal - v) / span) * innerH;
    const fmt = (v) => `$${(Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2))}`;

    const linePoints = executionTimeline.map(p => `${sx(p.time)},${sy(p.value)}`).join(' ');
    const fillPoints = `${padL},${sy(0)} ${linePoints} ${w - padR},${sy(0)}`;
    const zeroY = sy(0);
    const last = executionTimeline[executionTimeline.length - 1];
    const lastY = sy(last.value);

    const yTicks = [];
    const tickCount = 5;
    for (let i = 0; i < tickCount; i += 1) {
      const value = maxVal - (span * i) / (tickCount - 1);
      yTicks.push({ value, y: sy(value) });
    }

    const xTicks = [];
    const xTickCount = Math.min(5, rawData.length);
    for (let i = 0; i < xTickCount; i += 1) {
      const idx = Math.round((rawData.length - 1) * (i / Math.max(xTickCount - 1, 1)));
      const p = rawData[idx];
      if (p) xTicks.push(p);
    }
    const fmtHour = (ts) => new Date(ts * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });

    const markerDefs = (trade?.executions || [])
      .map((e, idx) => {
        const parsed = Date.parse(String(e.timestamp).replace(' ','T'));
        if (!Number.isFinite(parsed)) return null;
        const d = new Date(parsed);
        const month = d.getUTCMonth() + 1;
        const isDst = month >= 3 && month <= 11;
        const offset = isDst ? 4 * 60 * 60 * 1000 : 5 * 60 * 60 * 1000;
        const localTs = (parsed - offset) / 1000;
        const brokerSide = String(e.broker_side || e.side || '').toLowerCase();
        const sideLabel = brokerSide.includes('cover') || brokerSide.includes('buy') ? 'BUY' : 'SELL';
        const isBuy = sideLabel === 'BUY';
        const qty = Math.abs(Number(e.quantity ?? e.qty ?? 0));
        const execKind = idx === 0 ? 'ENTRY' : 'EXIT';
        return {
          ts: localTs,
          ms: parsed,
          qty,
          timestamp: e.timestamp,
          label: execKind,
          sideLabel,
          symbol: isBuy ? '▲' : '▼',
          color: isBuy ? '#22c55e' : '#ef4444',
        };
      })
      .filter(Boolean)
      .sort((a,b)=>a.ms-b.ms);

    const yAtTime = (ts) => {
      if (!Number.isFinite(ts)) return null;
      if (ts <= rawData[0].time) return rawData[0].value;
      if (ts >= rawData[rawData.length - 1].time) return rawData[rawData.length - 1].value;
      for (let i = 1; i < rawData.length; i += 1) {
        const a = rawData[i - 1];
        const b = rawData[i];
        if (ts >= a.time && ts <= b.time) {
          const ratio = (ts - a.time) / Math.max(b.time - a.time, 1);
          return a.value + (b.value - a.value) * ratio;
        }
      }
      return rawData[rawData.length - 1].value;
    };
    const markerHtml = markerDefs.map(m => {
      const qty = Number.isFinite(m.qty) ? m.qty.toLocaleString('en-US') : '';
      const execTime = new Date(m.ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      return `
      <div style="position:absolute;left:${sx(m.ts)}px;top:${sy(yAtTime(m.ts) ?? 0)}px;transform:translate(-50%,-50%);display:flex;align-items:center;gap:4px;pointer-events:none">
        <div style="width:10px;height:10px;border-radius:999px;background:${m.color};box-shadow:0 0 0 2px rgba(15,17,23,0.9)"></div>
        <div style="background:rgba(15,17,23,0.92);border:1px solid rgba(255,255,255,0.10);color:#e5e7eb;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;white-space:nowrap;line-height:1.2">${m.label} ${m.sideLabel}<br>${qty} sh @ ${execTime}</div>
      </div>`;
    }).join('');

    const segments = [];
    for (let i = 1; i < rawData.length; i += 1) {
      const a = rawData[i - 1];
      const b = rawData[i];
      const aPos = a.value >= 0;
      const bPos = b.value >= 0;
      if (aPos === bPos) {
        segments.push({ color: aPos ? posColor : negColor, points: `${sx(a.time)},${sy(a.value)} ${sx(b.time)},${sy(b.value)}` });
      } else {
        const delta = b.value - a.value;
        const ratio = delta === 0 ? 0 : (0 - a.value) / delta;
        const crossTime = a.time + (b.time - a.time) * ratio;
        const crossPoint = `${sx(crossTime)},${sy(0)}`;
        segments.push({ color: aPos ? posColor : negColor, points: `${sx(a.time)},${sy(a.value)} ${crossPoint}` });
        segments.push({ color: bPos ? posColor : negColor, points: `${crossPoint} ${sx(b.time)},${sy(b.value)}` });
      }
    }

    container.innerHTML = `
      <div style="position:relative;width:100%;height:100%;background:#0b1220;border-radius:8px;overflow:hidden">
        <svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" preserveAspectRatio="none" style="display:block">
          <defs>
            <linearGradient id="plGrad-${containerId}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="rgba(96,165,250,0.32)" />
              <stop offset="100%" stop-color="rgba(96,165,250,0.04)" />
            </linearGradient>
          </defs>
          ${yTicks.map(t => `
            <g>
              <line x1="${padL}" y1="${t.y}" x2="${w - padR}" y2="${t.y}" stroke="rgba(148,163,184,0.14)" stroke-width="1" />
              <text x="${padL - 10}" y="${t.y + 4}" text-anchor="end" fill="#cbd5e1" font-size="11">${fmt(t.value)}</text>
            </g>
          `).join('')}
          <line x1="${padL}" y1="${zeroY}" x2="${w - padR}" y2="${zeroY}" stroke="rgba(226,232,240,0.45)" stroke-width="1.2" />
          <polygon points="${fillPoints}" fill="url(#plGrad-${containerId})" />
          ${segments.map(s => `<polyline points="${s.points}" fill="none" stroke="${s.color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />`).join('')}
          <text x="${padL}" y="${h - 7}" fill="#94a3b8" font-size="10">${xTicks[0] ? fmtHour(xTicks[0].time) : ''}</text>
          <text x="${w / 2}" y="${h - 7}" text-anchor="middle" fill="#94a3b8" font-size="10">Minute-by-minute running P/L</text>
          <text x="${w - padR}" y="${h - 7}" text-anchor="end" fill="#94a3b8" font-size="10">${xTicks[xTicks.length - 1] ? fmtHour(xTicks[xTicks.length - 1].time) : ''}</text>
        </svg>
        ${markerHtml}
        <div style="position:absolute;right:12px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:flex-end;gap:6px;pointer-events:none">
          <div style="background:${last.value >= 0 ? 'rgba(34,197,94,0.95)' : 'rgba(239,68,68,0.95)'};color:#fff;border-radius:4px;padding:2px 6px;font-size:12px;font-weight:700">${fmt(last.value)}</div>
          <div style="color:#cbd5e1;font-size:11px">high ${fmt(maxVal)}</div>
          <div style="color:#cbd5e1;font-size:11px">low ${fmt(minVal)}</div>
        </div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<p style="color:var(--muted);font-size:0.85rem">Running P/L chart error: ${e.message}</p>`;
  }
}

function buildRunningPlSeries({ executions, trade, bars }) {
  const execsRaw = Array.isArray(executions) ? executions : [];
  const barsArray = Array.isArray(bars) ? bars : [];
  const side = String(trade?.side || '').toLowerCase();
  const isLong = side === 'long';
  const entryTime = trade?.start_datetime ? new Date(trade.start_datetime).getTime() : null;
  const exitTime = trade?.end_datetime ? new Date(trade.end_datetime).getTime() : null;

  let execs = execsRaw.map(e => ({
    timestamp: e.timestamp,
    qty: Math.abs(Number(e.quantity || 0)),
    price: Number(e.price || 0),
    classification: classifyExecution(e, isLong),
  })).filter(e => e.timestamp && e.qty > 0 && e.price > 0);

  // Synthetic fallback for trades with summary rows but missing actual execution detail.
  if (execs.length === 0 && trade?.start_datetime && trade?.end_datetime) {
    const approxQty = Math.max(1, Math.round(Number(trade?.volume || 0) / 2));
    const entryPrice = Number(trade?.entry_price || 0);
    const exitPrice = Number(trade?.exit_price || 0);
    if (approxQty > 0 && entryPrice > 0) {
      execs.push({ timestamp: trade.start_datetime, qty: approxQty, price: entryPrice, classification: 'opening' });
    }
    if (approxQty > 0 && exitPrice > 0) {
      execs.push({ timestamp: trade.end_datetime, qty: approxQty, price: exitPrice, classification: 'closing' });
    }
  }

  execs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (!barsArray.length) {
    let cash = 0;
    let position = 0;
    return execs.map(e => {
      if (e.classification === 'opening') {
        if (isLong) { cash -= e.qty * e.price; position += e.qty; }
        else { cash += e.qty * e.price; position -= e.qty; }
      } else if (e.classification === 'closing') {
        if (isLong) { cash += e.qty * e.price; position -= e.qty; }
        else { cash -= e.qty * e.price; position += e.qty; }
      }
      return { timestamp: e.timestamp, value: Math.round(cash * 100) / 100, position };
    });
  }

  let cash = 0;
  let position = 0;
  let nextExecIndex = 0;
  const points = [];

  for (const b of barsArray) {
    const barMs = new Date(b.timestamp).getTime();

    while (nextExecIndex < execs.length) {
      const exMs = new Date(execs[nextExecIndex].timestamp).getTime();
      if (entryTime && exMs < entryTime) {
        nextExecIndex += 1;
        continue;
      }
      if (exMs <= barMs) {
        const e = execs[nextExecIndex];
        if (e.classification === 'opening') {
          if (isLong) { cash -= e.qty * e.price; position += e.qty; }
          else { cash += e.qty * e.price; position -= e.qty; }
        } else if (e.classification === 'closing') {
          if (isLong) { cash += e.qty * e.price; position -= e.qty; }
          else { cash -= e.qty * e.price; position += e.qty; }
        }
        nextExecIndex += 1;
      } else {
        break;
      }
    }

    const mark = Number(b.close || b.c || b.close_price || 0);
    if (!Number.isFinite(mark) || mark <= 0) continue;
    const effectiveMark = (exitTime && barMs > exitTime && Number.isFinite(Number(trade?.exit_price || 0)))
      ? Number(trade.exit_price)
      : mark;
    const pnl = Math.round((cash + position * effectiveMark) * 100) / 100;
    points.push({ timestamp: b.timestamp, value: pnl });
  }

  return points;
}

function openChartPopModal(tradeId) {
  const modal = document.getElementById('chart-pop-modal');
  const bigContainer = document.getElementById('chart-pop-container');
  if (!modal || !bigContainer) return;

  const cached = chartCache.get(String(tradeId));
  if (!cached) return;

  bigContainer.innerHTML = '';
  modal.classList.add('open');
  setTimeout(() => {
    renderLightweightChart('chart-pop-container', cached.bars, cached.markers, { height: 620, indicators: cached.indicators || {}, session: cached.session || null });
  }, 30);
}

function closeChartPopModal() {
  const modal = document.getElementById('chart-pop-modal');
  if (modal) modal.classList.remove('open');
}

function openRunningPlPopModal(tradeId) {
  const modal = document.getElementById('running-pl-pop-modal');
  const bigContainer = document.getElementById('running-pl-pop-container');
  if (!modal || !bigContainer) return;

  const cached = runningPlCache.get(String(tradeId));
  if (!cached) return;

  bigContainer.innerHTML = '';
  modal.classList.add('open');
  setTimeout(() => {
    renderRunningPlChart('running-pl-pop-container', cached.runningPl, { height: 620, trade: cached.trade });
  }, 30);
}

function closeRunningPlPopModal() {
  const modal = document.getElementById('running-pl-pop-modal');
  if (modal) modal.classList.remove('open');
}

document.addEventListener('click', (e) => {
  if (e.target?.id === 'chart-pop-close') closeChartPopModal();
  if (e.target?.id === 'chart-pop-modal') closeChartPopModal();
  if (e.target?.id === 'running-pl-pop-close') closeRunningPlPopModal();
  if (e.target?.id === 'running-pl-pop-modal') closeRunningPlPopModal();
});
