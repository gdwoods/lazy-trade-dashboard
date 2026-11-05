import { api, fmt, fmtPct, fmtPL, navigate, fmtDate } from './app.js';

let timer = null;
let lastHash = '';

export async function renderWatchlist(container) {
  if (timer) clearInterval(timer);
  container.innerHTML = `
    <div class="card" style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);margin-bottom:4px">MOMO10 Scanner</div>
        <div style="font-size:1rem;font-weight:600">Current watchlist feed</div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span id="momo10-updated-badge" style="display:inline-flex;align-items:center;gap:6px;background:rgba(79,142,247,0.12);border:1px solid rgba(79,142,247,0.22);color:var(--text);font-size:0.8rem;padding:6px 10px;border-radius:999px">Last updated: —</span>
        <span id="momo10-status" style="color:var(--muted);font-size:0.9rem">Loading…</span>
        <button id="momo10-refresh" class="btn btn-primary btn-sm">Refresh</button>
      </div>
    </div>
    <div id="watchlist-content"><p class="loading">Loading…</p></div>
  `;
  container.querySelector('#momo10-refresh').addEventListener('click', () => load(container));
  await load(container);
  timer = setInterval(() => load(container, true), 60000);
}

async function load(container, silent = false) {
  const content = container.querySelector('#watchlist-content');
  const status = container.querySelector('#momo10-status');
  const badge = container.querySelector('#momo10-updated-badge');
  const checkedAt = fmtDate(new Date().toISOString());
  if (!silent) content.innerHTML = '<p class="loading">Loading…</p>';
  if (status) status.textContent = silent ? 'Refreshing…' : 'Loading…';
  if (badge && silent) badge.textContent = `Last checked: ${checkedAt}`;
  try {
    const data = await api(`/api/momo10/current?ts=${Date.now()}`);
    const hash = JSON.stringify(data.watch || []);
    if (hash !== lastHash) lastHash = hash;
    const updated = data.updatedAt ? fmtDate(data.updatedAt) : '—';
    if (status) status.textContent = `${data.status || '—'} • checked ${checkedAt}`;
    if (badge) badge.textContent = `Last updated: ${updated}`;
    content.innerHTML = buildView(data);
  } catch (e) {
    if (status) status.textContent = 'DOWN';
    content.innerHTML = `<p class="neg">${e.message}</p>`;
  }
}

function buildView(data) {
  const watch = data.watch || [];
  const delta = data.delta || {};
  const added = delta.added?.length ? `<div class="alert alert-success">Added: ${delta.added.join(', ')}</div>` : '';
  const removed = delta.removed?.length ? `<div class="alert alert-error">Removed: ${delta.removed.join(', ')}</div>` : '';
  const changed = delta.changed?.length ? `<div class="alert" style="background:rgba(79,142,247,0.08);border:1px solid rgba(79,142,247,0.22);color:var(--text)">Changed:<br>${delta.changed.map(x => `• ${x}`).join('<br>')}</div>` : '';

  if (!watch.length) {
    return `${added}${removed}${changed}<p class="loading">No watchlist data yet.</p>`;
  }

  return `
    ${added}${removed}${changed}
    <div style="margin-bottom:10px;color:var(--muted);font-size:0.85rem">GREEN rows can create a paper-trade draft (entry/stop/targets saved locally).</div>
    <div class="table-wrap" style="overflow-x:auto;max-width:100%;font-size:0.82rem;line-height:1.15">
      <table style="min-width:1220px; table-layout:fixed">
        <thead>
          <tr>
            <th style="width:34px">#</th>
            <th style="width:72px">Ticker</th>
            <th style="width:72px">Price</th>
            <th style="width:64px">Chg%</th>
            <th style="width:92px">Vol</th>
            <th style="width:56px">Status</th>
            <th style="width:160px">Reason</th>
            <th style="width:140px">Trigger</th>
            <th style="width:140px">Invalidation</th>
            <th style="width:80px">Entry</th>
            <th style="width:80px">Stop</th>
            <th style="width:80px">T1</th>
            <th style="width:80px">T2</th>
            <th style="width:72px;position:sticky;right:72px;background:var(--card);z-index:2">Buy Now</th>
            <th style="width:72px;position:sticky;right:0;background:var(--card);z-index:2">Draft</th>
          </tr>
        </thead>
        <tbody>
          ${watch.map((x, i) => {
            const price = Number(x.price || 0);
            const isGreen = x.state === 'GREEN';
            const entry = isGreen ? price : null;
            const stop = isGreen ? price * 0.97 : null;
            const t1 = isGreen ? price * 1.05 : null;
            const t2 = isGreen ? price * 1.10 : null;
            const canDraft = isGreen;
            return `
            <tr class="${x.state === 'GREEN' ? 'row-green' : x.state === 'RED' ? 'row-red' : ''}">
              <td style="padding:6px 8px">${i + 1}</td>
              <td style="padding:6px 8px;white-space:nowrap"><a href="https://www.tradingview.com/symbols/${encodeURIComponent(x.ticker)}/" target="_blank" rel="noreferrer" style="color:var(--accent);text-decoration:none;font-weight:600">${x.ticker}</a></td>
              <td style="padding:6px 8px;white-space:nowrap">$${fmt(x.price, 2)}</td>
              <td style="padding:6px 8px;white-space:nowrap" class="${(x.todaysChangePerc ?? 0) >= 0 ? 'pos' : 'neg'}">${fmtPct(x.todaysChangePerc)}</td>
              <td style="padding:6px 8px;white-space:nowrap">${Number(x.dayVol || 0).toLocaleString()}</td>
              <td style="padding:6px 8px;">
                <span title="${x.state || '—'}" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${x.state === 'GREEN' ? 'var(--green)' : x.state === 'YELLOW' ? 'var(--yellow)' : 'var(--red)'};box-shadow:0 0 0 2px rgba(255,255,255,0.04)"></span>
              </td>
              <td style="padding:6px 8px;white-space:normal;word-break:break-word;overflow-wrap:anywhere">${x.reason || '—'}</td>
              <td style="padding:6px 8px;white-space:normal;word-break:break-word;overflow-wrap:anywhere">${x.trigger || '—'}</td>
              <td style="padding:6px 8px;white-space:normal;word-break:break-word;overflow-wrap:anywhere">${x.invalidation || '—'}</td>
              <td style="padding:6px 8px;white-space:nowrap">${entry != null ? `$${fmt(entry, 2)}` : '—'}</td>
              <td style="padding:6px 8px;white-space:nowrap">${stop != null ? `$${fmt(stop, 2)}` : '—'}</td>
              <td style="padding:6px 8px;white-space:nowrap">${t1 != null ? `$${fmt(t1, 2)}` : '—'}</td>
              <td style="padding:6px 8px;white-space:nowrap">${t2 != null ? `$${fmt(t2, 2)}` : '—'}</td>
              <td class="${x.wouldBuyNow ? 'pos' : 'warn'}" style="position:sticky;right:72px;background:var(--card);z-index:1;white-space:nowrap;padding:6px 8px">${x.wouldBuyNow ? 'YES' : 'NO'}</td>
              <td style="position:sticky;right:72px;background:var(--card);z-index:1;padding:6px 8px">
                ${canDraft ? `<button class="btn btn-sm btn-primary momo10-draft-btn" data-ticker="${x.ticker}" data-entry="${entry ?? ''}" data-stop="${stop ?? ''}" data-t1="${t1 ?? ''}" data-t2="${t2 ?? ''}">Draft</button>` : '—'}
              </td>
              <td style="position:sticky;right:0;background:var(--card);z-index:1;padding:6px 8px">
                ${canDraft ? `<button class="btn btn-sm momo10-submit-btn" data-ticker="${x.ticker}" data-entry="${entry ?? ''}" data-stop="${stop ?? ''}" data-t1="${t1 ?? ''}" data-t2="${t2 ?? ''}" style="background:var(--yellow);color:#111">Submit</button>` : '—'}
              </td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div style="margin-top:12px;color:var(--muted);font-size:0.85rem">
      Source: ${data.source || '—'} • Params: ${JSON.stringify(data.params || {})}
    </div>
  `;
}

// Draft / Submit buttons for GREEN rows
window.addEventListener('click', async (e) => {
  const draftBtn = e.target.closest?.('.momo10-draft-btn');
  const submitBtn = e.target.closest?.('.momo10-submit-btn');
  const btn = draftBtn || submitBtn;
  if (!btn) return;
  const payload = {
    ticker: btn.dataset.ticker,
    entry: btn.dataset.entry ? Number(btn.dataset.entry) : null,
    stop: btn.dataset.stop ? Number(btn.dataset.stop) : null,
    target1: btn.dataset.t1 ? Number(btn.dataset.t1) : null,
    target2: btn.dataset.t2 ? Number(btn.dataset.t2) : null,
  };
  btn.disabled = true;
  btn.textContent = draftBtn ? 'Saving…' : 'Submitting…';
  try {
    const url = draftBtn ? '/api/momo10/draft' : '/api/momo10/submit';
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || (draftBtn ? 'Draft failed' : 'Submit failed'));
    btn.textContent = draftBtn ? 'Saved' : 'Submitted';
    btn.style.background = draftBtn ? 'var(--green)' : 'var(--accent)';
    btn.style.color = '#fff';
  } catch (err) {
    btn.disabled = false;
    btn.textContent = draftBtn ? 'Draft' : 'Submit';
    alert(err.message);
  }
});
