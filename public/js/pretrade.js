import { api, fmtDate } from './app.js';

export async function renderPreTrade(container) {
  container.innerHTML = buildShell();
  bindDropZones(container);
  bindForm(container);
  bindEditMode(container);
  bindDroppinessCalc(container);
  bindRepeatLoserWarning(container);
  bindQualityScore(container);
  bindViewToggle(container);
  await loadNotes(container);

  // Pre-fill symbol if navigated here with #pretrade?symbol=XXX
  const match = window.location.hash.match(/[?&]symbol=([^&]+)/);
  if (match) {
    const symbolInput = container.querySelector('[name="symbol"]');
    if (symbolInput) {
      symbolInput.value = decodeURIComponent(match[1]);
      const droppiness = container.querySelector('[name="droppiness"]');
      if (droppiness) droppiness.focus();
    }
  }

  const tradeMatch = window.location.hash.match(/[?&]tradeId=([^&]+)/);
  if (tradeMatch) {
    const tradeId = decodeURIComponent(tradeMatch[1]);
    const alertEl = container.querySelector('#form-alert');
    if (alertEl) {
      alertEl.innerHTML = `<div class="alert alert-info">Opened from trade <strong>#${tradeId}</strong>. Fill in or link the pre-trade context below.</div>`;
    }

    setTimeout(async () => {
      try {
        const notes = await api(`/api/pre-trade/for-trade/${tradeId}`);
        if (notes.length) {
          openNoteInForm(container, notes[0]);
        }
      } catch (e) {
        console.warn('Could not jump to linked note:', e);
      }
    }, 0);
  }
}

function buildShell() {
  return `
    <div class="card">
      <h3 style="margin-bottom:16px;font-size:1rem">New Pre-Trade Note</h3>
      <div id="form-alert"></div>

      <!-- Drop zones -->
      <div style="display:flex;gap:16px;margin-bottom:24px">
        <div class="drop-zone" id="dz-dt" data-type="dilutiontracker" tabindex="0">
          <div style="font-size:2rem;margin-bottom:8px">📊</div>
          <div class="dz-label">DilutionTracker Screenshot</div>
          <div style="font-size:0.75rem;color:var(--muted);margin-top:4px">Drop, click, or paste (⌘V)</div>
        </div>
        <div class="drop-zone" id="dz-tv" data-type="tradingview" tabindex="0">
          <div style="font-size:2rem;margin-bottom:8px">📈</div>
          <div class="dz-label">TradingView Chart</div>
          <div style="font-size:0.75rem;color:var(--muted);margin-top:4px">Drop, click, or paste (⌘V)</div>
        </div>
      </div>

      <form id="pretrade-form">

        <!-- Section 1: Symbol & Company -->
        <div class="form-section">
          <div class="section-title">Symbol & Company</div>
          <div class="form-grid">
            <div class="form-group">
              <label>Symbol</label>
              <input name="symbol" id="symbol" type="text" placeholder="AAPL" required>
            </div>
            <div class="form-group">
              <label>Company Name</label>
              <input name="company_name" id="company_name" type="text" placeholder="Apple Inc.">
            </div>
            <div class="form-group">
              <label>Exchange</label>
              <input name="exchange" id="exchange" type="text" placeholder="NASDAQ">
            </div>
            <div class="form-group">
              <label>Sector</label>
              <input name="sector" id="sector" type="text" placeholder="Technology">
            </div>
            <div class="form-group">
              <label>Industry</label>
              <input name="industry" id="industry" type="text" placeholder="Consumer Electronics">
            </div>
          </div>
        </div>

        <!-- Section 2: DT Risk Scores -->
        <div class="form-section">
          <div class="section-title">DT Risk Scores</div>
          <div class="form-grid">
            <div class="form-group">
              <label>Overall Risk</label>
              <select name="dt_overall_risk" id="dt_overall_risk">
                <option value="">— select —</option>
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
              </select>
            </div>
            <div class="form-group">
              <label>Offering Ability</label>
              <select name="dt_offering_ability" id="dt_offering_ability">
                <option value="">— select —</option>
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
              </select>
            </div>
            <div class="form-group">
              <label>Overhead Supply</label>
              <select name="dt_overhead_supply" id="dt_overhead_supply">
                <option value="">— select —</option>
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
              </select>
            </div>
            <div class="form-group">
              <label>Historical</label>
              <select name="dt_historical" id="dt_historical">
                <option value="">— select —</option>
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
              </select>
            </div>
            <div class="form-group">
              <label>Cash Need</label>
              <select name="dt_cash_need" id="dt_cash_need">
                <option value="">— select —</option>
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Section 3: Fundamentals -->
        <div class="form-section">
          <div class="section-title">Fundamentals</div>
          <div class="form-grid">
            <div class="form-group">
              <label>Market Cap</label>
              <input name="mkt_cap" id="mkt_cap" type="number" step="any" placeholder="0">
            </div>
            <div class="form-group">
              <label>Float Shares</label>
              <input name="float_shares" id="float_shares" type="number" step="any" placeholder="0">
            </div>
            <div class="form-group">
              <label>OS Shares</label>
              <input name="os_shares" id="os_shares" type="number" step="any" placeholder="0">
            </div>
            <div class="form-group">
              <label>EV</label>
              <input name="ev" id="ev" type="number" step="any" placeholder="0">
            </div>
            <div class="form-group">
              <label>Net Cash/Share</label>
              <input name="net_cash_per_share" id="net_cash_per_share" type="number" step="any" placeholder="0">
            </div>
            <div class="form-group">
              <label>SI %</label>
              <input name="si_pct" id="si_pct" type="number" step="any" placeholder="0">
            </div>
            <div class="form-group">
              <label>Inst. Own %</label>
              <input name="inst_own_pct" id="inst_own_pct" type="number" step="any" placeholder="0">
            </div>
            <div class="form-group">
              <label>Cash Runway (months)</label>
              <input name="cash_runway_months" id="cash_runway_months" type="number" step="any" placeholder="0">
            </div>
            <div class="form-group">
              <label>Cash Burn (quarterly)</label>
              <input name="cash_burn_quarterly" id="cash_burn_quarterly" type="number" step="any" placeholder="0">
            </div>
            <div class="form-group">
              <label>Current Cash</label>
              <input name="current_cash" id="current_cash" type="number" step="any" placeholder="0">
            </div>
            <div class="form-group">
              <label>Droppiness (0-100)</label>
              <div style="display:flex;gap:8px;align-items:center">
                <input name="droppiness" id="droppiness" type="number" min="0" max="100" placeholder="75" style="flex:1">
                <button type="button" id="calc-droppiness" class="btn" style="white-space:nowrap;padding:6px 10px;font-size:0.8rem">⚡ Calc</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Section 4: Chart Analysis -->
        <div class="form-section">
          <div class="section-title">Chart Analysis</div>
          <div class="form-grid">
            <div class="form-group">
              <label>Timeframe</label>
              <select name="timeframe" id="timeframe">
                <option value="">— select —</option>
                <option>1m</option>
                <option>2m</option>
                <option>3m</option>
                <option>5m</option>
                <option>10m</option>
                <option>15m</option>
                <option>30m</option>
                <option>45m</option>
                <option>1h</option>
                <option>2h</option>
                <option>3h</option>
                <option>4h</option>
                <option>6h</option>
                <option>12h</option>
                <option>1D</option>
                <option>3D</option>
                <option>1W</option>
                <option>1M</option>
              </select>
            </div>
            <div class="form-group">
              <label>RSI at Entry</label>
              <input name="rsi_at_entry" id="rsi_at_entry" type="number" step="any" placeholder="0">
            </div>
            <div class="form-group">
              <label>MACD Status</label>
              <select name="macd_status" id="macd_status">
                <option value="">— select —</option>
                <option>Bullish</option>
                <option>Bearish</option>
                <option>Neutral</option>
              </select>
            </div>
            <div class="form-group">
              <label>Entry Price</label>
              <input name="entry_price" id="entry_price" type="number" step="any" placeholder="0.00">
            </div>
            <div class="form-group">
              <label>Key Support</label>
              <input name="key_support" id="key_support" type="number" step="any" placeholder="0.00">
            </div>
            <div class="form-group">
              <label>Key Resistance</label>
              <input name="key_resistance" id="key_resistance" type="number" step="any" placeholder="0.00">
            </div>
          </div>
        </div>

        <!-- Section 5: Trade Setup -->
        <div class="form-section">
          <div class="section-title">Trade Setup</div>
          <div class="form-grid">
            <div class="form-group">
              <label>Short Bias</label>
              <select name="short_bias" id="short_bias">
                <option value="">— select —</option>
                <option>Strong</option>
                <option>Moderate</option>
                <option>Avoid</option>
              </select>
            </div>
            <div class="form-group">
              <label>Confidence (1-5)</label>
              <input name="confidence" id="confidence" type="number" min="1" max="5" placeholder="3">
            </div>
            <div class="form-group" style="grid-column:1/-1">
              <label>Thesis</label>
              <textarea name="thesis" id="thesis" placeholder="Why are you taking this trade?"></textarea>
            </div>
            <div class="form-group" style="grid-column:1/-1">
              <label>Catalyst</label>
              <select name="catalyst" id="catalyst">
                <option value="">— Select catalyst —</option>
                <option value="Halt">Halt / Resume</option>
                <option value="Spike">Spike / Gap up</option>
                <option value="PR">Press Release / News</option>
                <option value="Offering">Offering / Dilution</option>
                <option value="Earnings">Earnings</option>
                <option value="FDA">FDA / Clinical</option>
                <option value="Short Squeeze">Short Squeeze</option>
                <option value="Momentum">Momentum / Sympathy</option>
                <option value="Technical">Technical breakout</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div class="form-group" style="grid-column:1/-1">
              <label>Invalidation</label>
              <input name="invalidation" id="invalidation" type="text" placeholder="What would make you skip or exit?">
            </div>
            <div class="form-group" style="grid-column:1/-1">
              <label>Notes</label>
              <textarea name="notes" id="notes" placeholder="Additional observations…"></textarea>
            </div>
            <div class="form-group" style="grid-column:1/-1">
              <div id="repeat-loser-warning" style="display:none;padding:10px 14px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);border-radius:6px;color:#ef4444;font-size:0.85rem"></div>
            </div>
          </div>
        </div>

        <!-- Section 5b: Trade Links -->
        <div class="form-section">
          <div class="section-title">Trade Links</div>
          <div class="form-grid">
            <div class="form-group">
              <label>Primary Trade ID</label>
              <input name="trade_id" id="trade_id" type="number" placeholder="Tradervue trade ID">
            </div>
            <div class="form-group">
              <label>Related Trade IDs</label>
              <input name="related_trade_ids" id="related_trade_ids" type="text" placeholder="e.g. 107007904,107007905">
            </div>
          </div>
        </div>

        <!-- Section 6: AI Analysis -->
        <div class="form-section">
          <div class="section-title">AI Analysis</div>
          <div class="form-grid">
            <div class="form-group" style="grid-column:1/-1">
              <label>Gemini / AI Output</label>
              <textarea name="gemini_output" id="gemini_output" style="min-height:120px" placeholder="Paste AI analysis here…"></textarea>
            </div>
          </div>
        </div>

        <div style="margin-top:16px">
          <button type="submit" class="btn btn-primary">Save Pre-Trade Note</button>
        </div>
      </form>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
      <div class="section-title" style="margin-bottom:0">Recent Pre-Trade Notes</div>
      <div style="display:flex;gap:6px">
        <button class="btn view-toggle-btn" data-view="table" style="font-size:0.75rem;padding:3px 10px;background:var(--accent);color:#fff">Table</button>
        <button class="btn view-toggle-btn" data-view="journal" style="font-size:0.75rem;padding:3px 10px">Journal</button>
      </div>
    </div>
    <div id="notes-table"><p class="loading">Loading…</p></div>
  `;
}

function bindDropZones(container) {
  const zones = [
    { dzId: 'dz-dt', hiddenField: 'dt_image' },
    { dzId: 'dz-tv', hiddenField: 'chart_image' },
  ];

  // Track last-active zone (default DT)
  let lastZone = container.querySelector('#dz-dt');
  lastZone.classList.add('paste-target'); // show default target on load

  for (const { dzId } of zones) {
    const dz = container.querySelector(`#${dzId}`);
    const type = dz.dataset.type;

    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('dragover');
      lastZone = dz;
      const file = e.dataTransfer.files[0];
      if (file) processFile(file, dz, container, type);
    });

    // Click → open file picker; clipboard paste remains available via Cmd+V / Ctrl+V
    dz.addEventListener('click', () => {
      lastZone = dz;
      const tmp = document.createElement('input');
      tmp.type = 'file';
      tmp.accept = 'image/*';
      tmp.style.cssText = 'position:fixed;top:-999px;left:-999px;opacity:0;pointer-events:none';
      document.body.appendChild(tmp);
      tmp.addEventListener('change', () => {
        const file = tmp.files[0];
        if (file) processFile(file, dz, container, type);
        document.body.removeChild(tmp);
      });
      tmp.click();
    });

    // Focus/hover tracking — so Cmd+V knows which zone to target
    dz.addEventListener('mouseenter', () => {
      lastZone = dz;
      // Highlight active zone
      for (const z of container.querySelectorAll('.drop-zone')) z.classList.remove('paste-target');
      dz.classList.add('paste-target');
    });
    dz.addEventListener('focus', () => {
      lastZone = dz;
      for (const z of container.querySelectorAll('.drop-zone')) z.classList.remove('paste-target');
      dz.classList.add('paste-target');
    });

    // Paste on the zone itself (when focused)
    dz.addEventListener('paste', e => {
      const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
      if (item) {
        e.preventDefault();
        lastZone = dz;
        const file = item.getAsFile();
        if (file) processFile(file, dz, container, type);
      }
    });
  }

  // Global paste handler — fires on Cmd+V anywhere on the page
  // Always routes to lastZone (whichever was last hovered/clicked/focused)
  // Only skips if active element is a text input AND the clipboard has no image
  const globalPasteHandler = e => {
    // Only handle if pre-trade tab is still mounted
    if (!container.isConnected) return;

    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (!item) return; // no image in clipboard — let normal text paste happen

    // We have an image — always capture it for the drop zone (even if an input is focused)
    e.preventDefault();
    const file = item.getAsFile();
    if (file) {
      const type = lastZone.dataset.type;
      processFile(file, lastZone, container, type);
    }
  };

  document.addEventListener('paste', globalPasteHandler);

  // Clean up listener when container is removed from DOM (prevents stacking on tab switches)
  const observer = new MutationObserver(() => {
    if (!container.isConnected) {
      document.removeEventListener('paste', globalPasteHandler);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function processFile(file, dz, container, type) {
  const label = dz.querySelector('.dz-label');
  dz.classList.add('loading');
  label.textContent = 'Extracting…';

  // Flash the zone so user knows which one received the paste
  dz.classList.add('dragover');
  setTimeout(() => dz.classList.remove('dragover'), 400);

  const reader = new FileReader();
  reader.onload = async e => {
    const base64 = e.target.result.split(',')[1];
    const dataUrl = e.target.result;

    const hiddenField = type === 'dilutiontracker' ? 'dt_image' : 'chart_image';
    let hidden = container.querySelector(`input[name="${hiddenField}"]`);
    if (!hidden) {
      hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = hiddenField;
      container.querySelector('#pretrade-form').appendChild(hidden);
    }
    hidden.value = base64;

    try {
      const res = await fetch('/api/extract-screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, type }),
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(text.slice(0, 300) || `Extraction failed (HTTP ${res.status})`);
      }

      if (!data.ok) {
        const details = data.stack ? `\n${data.stack.split('\n')[0]}` : '';
        throw new Error((data.error || `Extraction failed (HTTP ${res.status})`) + details);
      }

      const extracted = { ...data.extracted };
      if (container.querySelector('[name="symbol"]')?.value?.trim()) delete extracted.symbol;
      if (container.querySelector('[name="entry_price"]')?.value?.trim()) delete extracted.entry_price;
      autoFill(container, extracted);

      const existing = dz.querySelector('.dz-preview');
      if (existing) existing.remove();
      const img = document.createElement('img');
      img.className = 'dz-preview';
      img.src = dataUrl;
      img.style.cssText = 'max-height:60px;margin-top:8px;border-radius:4px;display:block;margin-left:auto;margin-right:auto';
      dz.appendChild(img);

      dz.classList.remove('loading');
      dz.classList.add('done');
      label.textContent = '✅ Extracted';
    } catch (err) {
      console.error('Extraction error:', err);
      dz.classList.remove('loading');
      label.textContent = '❌ Failed — ' + (err?.message || String(err));
    }
  };
  reader.readAsDataURL(file);
}

function autoFill(container, extracted) {
  for (const [key, value] of Object.entries(extracted)) {
    if (value === null || value === undefined) continue;

    const el = container.querySelector(`[name="${key}"], #${key}`);
    if (!el) continue;

    if (el.tagName === 'SELECT') {
      const opt = [...el.options].find(o => o.value === String(value));
      if (opt) el.value = opt.value;
    } else if (el.type === 'number') {
      el.value = parseFloat(value) || '';
    } else {
      el.value = value;
    }

    el.classList.add('autofilled');
    setTimeout(() => el.classList.remove('autofilled'), 2000);
  }
}

function bindEditMode(container) {
  // Delegated click on edit buttons in the notes table
  const notesEl = container.querySelector('#notes-table');
  notesEl.addEventListener('click', async e => {
    // Delete handler
    const delBtn = e.target.closest('.delete-note-btn');
    if (delBtn) {
      const id = parseInt(delBtn.dataset.id);
      const symbol = delBtn.dataset.symbol;
      if (!confirm(`Delete pre-trade note for ${symbol}? This cannot be undone.`)) return;
      await fetch(`/api/pre-trade/${id}`, { method: 'DELETE' });
      await loadNotes(container);
      return;
    }

    const btn = e.target.closest('.edit-note-btn');
    if (!btn) return;
    const id = parseInt(btn.dataset.id);
    if (!id) return;

    const notes = await api('/api/pre-trade');
    const note = notes.find(n => n.id === id);
    if (!note) return;

    openNoteInForm(container, note);
  });
}

function openNoteInForm(container, note) {
  const form = container.querySelector('#pretrade-form');
  if (!form || !note) return;

  for (const [key, value] of Object.entries(note)) {
    const el = form.querySelector(`[name="${key}"]`);
    if (!el || value === null || value === undefined) continue;
    if (el.tagName === 'SELECT') {
      const opt = [...el.options].find(o => o.value === String(value));
      if (opt) el.value = opt.value;
    } else {
      el.value = value;
    }
  }

  // Restore image previews from the hidden base64 fields in the form
  if (note.dt_image) {
    const dtZone = container.querySelector('#dz-dt');
    let existing = dtZone.querySelector('.dz-preview');
    if (existing) existing.remove();
    const dtImg = document.createElement('img');
    dtImg.className = 'dz-preview';
    dtImg.src = `data:image/png;base64,${note.dt_image}`;
    dtImg.style.cssText = 'max-height:60px;margin-top:8px;border-radius:4px;display:block;margin-left:auto;margin-right:auto';
    dtZone.appendChild(dtImg);
    dtZone.classList.add('done');
    const dtLabel = dtZone.querySelector('.dz-label');
    if (dtLabel) dtLabel.textContent = '✅ Extracted';
  }
  if (note.chart_image) {
    const tvZone = container.querySelector('#dz-tv');
    let existing = tvZone.querySelector('.dz-preview');
    if (existing) existing.remove();
    const tvImg = document.createElement('img');
    tvImg.className = 'dz-preview';
    tvImg.src = `data:image/png;base64,${note.chart_image}`;
    tvImg.style.cssText = 'max-height:60px;margin-top:8px;border-radius:4px;display:block;margin-left:auto;margin-right:auto';
    tvZone.appendChild(tvImg);
    tvZone.classList.add('done');
    const tvLabel = tvZone.querySelector('.dz-label');
    if (tvLabel) tvLabel.textContent = '✅ Extracted';
  }

  form.dataset.editId = note.id;
  const submitBtn = form.querySelector('[type="submit"]');
  submitBtn.textContent = 'Update Pre-Trade Note';
  submitBtn.classList.add('btn-warning');

  if (!form.querySelector('.cancel-edit-btn')) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn cancel-edit-btn';
    cancel.textContent = 'Cancel';
    cancel.style.marginLeft = '8px';
    cancel.addEventListener('click', () => resetForm(container));
    submitBtn.insertAdjacentElement('afterend', cancel);
  }

  const alertEl = container.querySelector('#form-alert');
  alertEl.innerHTML = `<div class="alert" style="background:var(--warn-bg,#332700);color:var(--warn,#f5a623);border:1px solid var(--warn,#f5a623)">Editing note #${note.id} for <strong>${note.symbol}</strong></div>`;

  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetForm(container) {
  const form = container.querySelector('#pretrade-form');
  form.reset();
  delete form.dataset.editId;
  const submitBtn = form.querySelector('[type="submit"]');
  submitBtn.textContent = 'Save Pre-Trade Note';
  submitBtn.classList.remove('btn-warning');
  const cancel = form.querySelector('.cancel-edit-btn');
  if (cancel) cancel.remove();
  // Clear hidden image fields
  for (const name of ['dt_image', 'chart_image']) {
    const h = container.querySelector(`input[name="${name}"]`);
    if (h) h.value = '';
  }
  // Reset drop zones
  for (const dz of container.querySelectorAll('.drop-zone')) {
    dz.classList.remove('done', 'loading');
    const label = dz.querySelector('.dz-label');
    if (label) label.textContent = dz.dataset.type === 'dilutiontracker' ? 'DilutionTracker Screenshot' : 'TradingView Chart';
    const preview = dz.querySelector('.dz-preview');
    if (preview) preview.remove();
  }
  container.querySelector('#form-alert').innerHTML = '';
}

function bindRepeatLoserWarning(container) {
  const symbolEl = container.querySelector('[name="symbol"]');
  const warnEl = container.querySelector('#repeat-loser-warning');
  if (!symbolEl || !warnEl) return;
  let lastChecked = '';
  symbolEl.addEventListener('blur', async () => {
    const sym = symbolEl.value.trim().toUpperCase();
    if (!sym || sym === lastChecked) return;
    lastChecked = sym;
    try {
      const d = await fetch(`/api/stats/repeat-losers-check/${sym}`).then(r => r.json());
      if (d.loss_count >= 2) {
        warnEl.style.display = 'block';
        warnEl.innerHTML = `⚠️ <strong>${sym}</strong> has ${d.loss_count} losing trades on record — total loss <strong>$${Math.abs(d.total_loss).toFixed(2)}</strong>, avg <strong>$${Math.abs(d.avg_loss).toFixed(2)}</strong>. Proceed with extra caution.`;
      } else {
        warnEl.style.display = 'none';
      }
    } catch {}
  });
}

function bindQualityScore(container) {
  const SCORED_FIELDS = ['thesis', 'short_bias', 'confidence', 'invalidation', 'droppiness',
    'rsi_at_entry', 'macd_status', 'key_support', 'key_resistance', 'catalyst'];
  const WEIGHTS = { thesis: 20, short_bias: 10, confidence: 10, invalidation: 15,
    droppiness: 10, rsi_at_entry: 8, macd_status: 7, key_support: 8, key_resistance: 7, catalyst: 5 };

  // Find or create the score badge
  const submitBtn = container.querySelector('[type="submit"]');
  if (!submitBtn) return;
  let badge = container.querySelector('#quality-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'quality-badge';
    badge.style.cssText = 'margin-left:12px;font-size:0.8rem;padding:3px 10px;border-radius:12px;font-weight:600;vertical-align:middle';
    submitBtn.parentNode.insertBefore(badge, submitBtn.nextSibling);
  }

  function updateScore() {
    let score = 0;
    for (const field of SCORED_FIELDS) {
      const el = container.querySelector(`[name="${field}"]`);
      const val = el?.value?.trim();
      if (val) score += WEIGHTS[field] || 0;
    }
    const color = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444';
    badge.style.background = color + '22';
    badge.style.color = color;
    badge.style.border = `1px solid ${color}44`;
    badge.textContent = `Setup: ${score}/100`;
  }

  for (const field of SCORED_FIELDS) {
    const el = container.querySelector(`[name="${field}"]`);
    el?.addEventListener('input', updateScore);
    el?.addEventListener('change', updateScore);
  }
  updateScore();
}

function bindDroppinessCalc(container) {
  const btn = container.querySelector('#calc-droppiness');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const symbol = container.querySelector('[name="symbol"]')?.value?.trim().toUpperCase();
    if (!symbol) {
      alert('Enter a symbol first.');
      return;
    }
    btn.textContent = '⏳';
    btn.disabled = true;
    try {
      const res = await fetch(`/api/droppiness/${symbol}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      const el = container.querySelector('[name="droppiness"]');
      el.value = data.score;
      el.classList.add('autofilled');
      setTimeout(() => el.classList.remove('autofilled'), 2000);
      btn.textContent = `✅ ${data.score}`;
      btn.title = `${data.spikeCount} spikes analyzed`;
    } catch (err) {
      btn.textContent = '❌';
      console.error('Droppiness error:', err);
    } finally {
      setTimeout(() => { btn.textContent = '⚡ Calc'; btn.disabled = false; }, 3000);
    }
  });
}

function bindGeminiPaste(container) {
  const ta = container.querySelector('[name="gemini_output"]');
  if (!ta) return;

  ta.addEventListener('paste', e => {
    const html = e.clipboardData?.getData('text/html');
    if (!html) return; // no HTML, let browser handle plain text normally

    e.preventDefault();

    // Convert HTML to plain text preserving paragraph/line breaks
    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    // Replace block-level elements with newlines before extracting text
    for (const el of tmp.querySelectorAll('p, div, br, li, h1, h2, h3, h4, h5, h6, tr')) {
      if (el.tagName === 'BR') {
        el.replaceWith('\n');
      } else {
        // Prepend newline before block, append after
        el.prepend('\n');
        el.append('\n');
      }
    }

    // Get plain text, then clean up excessive blank lines (max 2 in a row)
    let text = tmp.innerText || tmp.textContent || '';
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    // Insert at cursor position
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const current = ta.value;
    ta.value = current.slice(0, start) + text + current.slice(end);
    ta.selectionStart = ta.selectionEnd = start + text.length;
    ta.dispatchEvent(new Event('input'));
  });
}

function bindForm(container) {
  bindGeminiPaste(container);
  const form = container.querySelector('#pretrade-form');
  const alertEl = container.querySelector('#form-alert');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    alertEl.innerHTML = '';
    const data = Object.fromEntries(new FormData(form));

    // Convert numeric fields
    const numericFields = [
      'droppiness', 'confidence', 'mkt_cap', 'float_shares', 'os_shares', 'ev',
      'net_cash_per_share', 'si_pct', 'inst_own_pct', 'cash_runway_months',
      'cash_burn_quarterly', 'current_cash', 'rsi_at_entry',
      'entry_price', 'key_support', 'key_resistance'
    ];
    for (const f of numericFields) {
      if (data[f]) data[f] = parseFloat(data[f]);
      else data[f] = null;
    }
    // Zero out empty strings for selects/text
    for (const k of Object.keys(data)) {
      if (data[k] === '') data[k] = null;
    }

    try {
      const editId = form.dataset.editId;
      const isEdit = !!editId;

      await fetch(isEdit ? `/api/pre-trade/${editId}` : '/api/pre-trade', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });

      alertEl.innerHTML = `<div class="alert alert-success">${isEdit ? 'Updated' : 'Saved'} pre-trade note for <strong>${(data.symbol || '').toUpperCase()}</strong>.</div>`;
      resetForm(container);
      await loadNotes(container);
      setTimeout(() => { alertEl.innerHTML = ''; }, 3000);
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">Error: ${err.message}</div>`;
    }
  });
}

let _notesViewMode = 'table';

async function loadNotes(container) {
  const el = container.querySelector('#notes-table');
  try {
    const notes = await api('/api/pre-trade');
    el.innerHTML = _notesViewMode === 'journal' ? buildNotesJournal(notes) : buildNotesTable(notes.slice(0, 20));
  } catch (e) {
    el.innerHTML = `<p class="neg">Error: ${e.message}</p>`;
  }
}

function bindViewToggle(container) {
  container.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      _notesViewMode = btn.dataset.view;
      container.querySelectorAll('.view-toggle-btn').forEach(b => {
        b.style.background = '';
        b.style.color = '';
      });
      btn.style.background = 'var(--accent)';
      btn.style.color = '#fff';
      await loadNotes(container);
    });
  });
}

function buildNotesJournal(notes) {
  if (!notes.length) return '<p class="loading">No pre-trade notes yet.</p>';
  const biasColor = { Strong: '#22c55e', Moderate: '#f59e0b', Avoid: '#ef4444' };
  const qualColor = s => s >= 70 ? '#22c55e' : s >= 40 ? '#f59e0b' : '#ef4444';

  return notes.map(n => {
    const hasOutcome = n.actual_net_pl != null;
    const win = hasOutcome && n.actual_net_pl >= 0;
    const outcomeBadge = hasOutcome
      ? `<span style="font-weight:700;color:${win ? '#22c55e' : '#ef4444'};font-size:0.95rem">${win ? '✅' : '❌'} ${win ? '+' : ''}$${Math.abs(n.actual_net_pl).toFixed(2)}</span>`
      : `<span style="color:var(--muted);font-size:0.82rem">No outcome linked</span>`;

    const qual = n.setup_quality_score;
    const qualBadge = qual != null
      ? `<span style="font-size:0.75rem;padding:2px 8px;border-radius:10px;background:${qualColor(qual)}22;color:${qualColor(qual)};border:1px solid ${qualColor(qual)}44;font-weight:600">Setup ${qual}/100</span>`
      : '';

    return `
      <div class="card" style="padding:14px 16px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <strong style="font-size:1rem">${n.symbol}</strong>
            ${n.catalyst ? `<span style="font-size:0.75rem;padding:2px 8px;border-radius:10px;background:var(--surface2);color:var(--muted)">${n.catalyst}</span>` : ''}
            ${n.short_bias ? `<span style="font-size:0.78rem;font-weight:600;color:${biasColor[n.short_bias] || 'var(--muted)'}">${n.short_bias} short</span>` : ''}
            ${n.confidence ? `<span style="color:var(--muted);font-size:0.82rem">${'★'.repeat(n.confidence)}${'☆'.repeat(5-n.confidence)}</span>` : ''}
            ${qualBadge}
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            ${outcomeBadge}
            <span style="color:var(--muted);font-size:0.78rem">${fmtDate(n.created_at)}</span>
          </div>
        </div>

        ${n.thesis ? `<p style="font-size:0.85rem;color:var(--text);line-height:1.5;margin-bottom:8px">${n.thesis}</p>` : ''}

        <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:0.8rem;color:var(--muted);margin-bottom:8px">
          ${n.droppiness != null ? `<span>Drop: <strong>${n.droppiness}</strong></span>` : ''}
          ${n.dt_overall_risk ? `<span>DT: <strong>${n.dt_overall_risk}</strong></span>` : ''}
          ${n.key_support ? `<span>Sup: <strong>$${n.key_support}</strong></span>` : ''}
          ${n.key_resistance ? `<span>Res: <strong>$${n.key_resistance}</strong></span>` : ''}
          ${n.rsi_at_entry != null ? `<span>RSI: <strong>${n.rsi_at_entry}</strong></span>` : ''}
          ${n.timeframe ? `<span>TF: <strong>${n.timeframe}</strong></span>` : ''}
          ${hasOutcome && n.actual_hold_minutes ? `<span>Hold: <strong>${n.actual_hold_minutes < 60 ? n.actual_hold_minutes + 'm' : Math.floor(n.actual_hold_minutes/60) + 'h ' + (n.actual_hold_minutes % 60) + 'm'}</strong></span>` : ''}
        </div>

        ${n.invalidation ? `<div style="font-size:0.8rem;color:#f59e0b">⚡ Invalidation: ${n.invalidation}</div>` : ''}

        <div style="margin-top:10px;display:flex;gap:8px">
          <button class="btn edit-note-btn" data-id="${n.id}" style="padding:2px 8px;font-size:0.75rem">✏️ Edit</button>
          <button class="btn delete-note-btn" data-id="${n.id}" data-symbol="${n.symbol}" style="padding:2px 8px;font-size:0.75rem;background:transparent;border-color:#ef4444;color:#ef4444">🗑 Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function buildNotesTable(notes) {
  if (!notes.length) return '<p class="loading">No pre-trade notes yet.</p>';

  const biasColor = { Strong: 'pos', Moderate: 'warn', Avoid: 'neg' };
  const riskColor = { Low: 'pos', Medium: 'warn', High: 'neg' };

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Symbol</th>
            <th>DT Risk</th>
            <th>Droppiness</th>
            <th>Short Bias</th>
            <th>Confidence</th>
            <th>Thesis</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${notes.map(n => `
            <tr>
              <td style="font-size:0.8rem;white-space:nowrap">${fmtDate(n.created_at)}</td>
              <td><strong>${n.symbol}</strong></td>
              <td class="${riskColor[n.dt_overall_risk] || ''}">${n.dt_overall_risk || '—'}</td>
              <td>${n.droppiness ?? '—'}</td>
              <td class="${biasColor[n.short_bias] || ''}">${n.short_bias || '—'}</td>
              <td>${n.confidence ? '★'.repeat(n.confidence) + '☆'.repeat(5 - n.confidence) : '—'}</td>
              <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(n.thesis || '—').substring(0, 60)}${n.thesis && n.thesis.length > 60 ? '…' : ''}</td>
              <td style="white-space:nowrap">
                <button class="btn edit-note-btn" data-id="${n.id}" style="padding:2px 8px;font-size:0.75rem">✏️ Edit</button>
                <button class="btn delete-note-btn" data-id="${n.id}" data-symbol="${n.symbol}" style="padding:2px 8px;font-size:0.75rem;margin-left:4px;background:transparent;border-color:#ef4444;color:#ef4444">🗑</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}
