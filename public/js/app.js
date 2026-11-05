import { renderDashboard } from './dashboard.js?v=lazy-widget-1';
import { renderAnalysis } from './analysis.js?v=pretrade-fix-4';
import { renderTrades } from './trades.js?v=pretrade-fix-4';
import { renderPreTrade } from './pretrade.js?v=pretrade-fix-4';
import { renderCoaching } from './coaching.js?v=pretrade-fix-4';
import { renderWatchlist } from './watchlist.js?v=pretrade-fix-4';
import { renderLazyWatchlist } from './lazy-watchlist.js?v=lazy-watchlist-1';
import { renderDux } from './dux.js?v=dux-1';
import { initSidebarCoach } from './coach.js?v=pretrade-fix-4';

const pages = {
  dashboard: { title: 'Dashboard', render: renderDashboard },
  trades:    { title: 'Trades',    render: renderTrades },
  analysis:  { title: 'Analysis',  render: renderAnalysis },
  pretrade:  { title: 'Pre-Trade', render: renderPreTrade },
  coaching:  { title: 'Coaching',  render: renderCoaching },
  watchlist: { title: 'Watchlist', render: renderWatchlist },
  'lazy-watchlist': { title: 'Lazy Trades', render: renderLazyWatchlist },
  dux: { title: 'Dux Scanner', render: renderDux },
};

function getPage() {
  const raw = location.hash.replace('#', '') || 'dashboard';
  const hash = raw.split('?')[0];
  return pages[hash] ? hash : 'dashboard';
}

export function navigate(page) {
  const cfg = pages[page];
  if (!cfg) return;

  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.dataset.page === page);
  });

  document.getElementById('page-title').textContent = cfg.title;
  const content = document.getElementById('content');
  content.innerHTML = '<p class="loading">Loading...</p>';

  // Close panel if open
  document.getElementById('trade-panel').classList.remove('open');

  cfg.render(content);
}

export async function api(path, options = {}) {
  const res = await fetch(path, { cache: 'no-store', ...options });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export function fmt(val, decimals = 2) {
  if (val == null) return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n.toFixed(decimals);
}

export function fmtPL(val) {
  if (val == null) return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  const cls = n >= 0 ? 'pos' : 'neg';
  return `<span class="${cls}">$${Math.abs(n).toFixed(2)}</span>`;
}

export function fmtPct(val) {
  if (val == null) return '—';
  return parseFloat(val).toFixed(1) + '%';
}

export function fmtDate(str) {
  if (!str) return '—';
  try {
    return new Date(str).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).replace(',', '');
  } catch {
    return str.replace('T', ' ').substring(0, 16);
  }
}

export function fmtHold(mins) {
  if (mins == null) return '—';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins/60)}h ${mins%60}m`;
}

// Panel helpers
export function openPanel(html) {
  document.getElementById('panel-content').innerHTML = html;
  document.getElementById('trade-panel').classList.add('open');
}

export function closePanel() {
  document.getElementById('trade-panel').classList.remove('open');
}

// Close modal when clicking outside or pressing Escape
document.getElementById('panel-close').addEventListener('click', closePanel);
document.getElementById('trade-panel').addEventListener('click', e => {
  if (e.target === document.getElementById('trade-panel')) closePanel();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('trade-panel').classList.contains('open')) {
    closePanel();
  }
});

// Initialize sidebar coach
initSidebarCoach();

// Nav clicks
document.querySelectorAll('.nav-link').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const page = a.dataset.page;
    history.pushState(null, '', `#${page}`);
    navigate(page);
  });
});

window.addEventListener('popstate', () => navigate(getPage()));

// Init
navigate(getPage());
