import { api } from './app.js';

let coachState = {
  messages: [],
  currentTrade: null,
  model: 'haiku',
  conversationHistory: []
};

export function initSidebarCoach() {
  const modelSelect = document.getElementById('coach-model-select');
  const input = document.getElementById('coach-input-sidebar');
  const sendBtn = document.getElementById('coach-send-sidebar');

  if (!modelSelect || !input || !sendBtn) return;

  modelSelect.value = coachState.model;
  modelSelect.addEventListener('change', e => {
    coachState.model = e.target.value;
  });

  sendBtn.addEventListener('click', () => sendCoachMessage(input, sendBtn));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendCoachMessage(input, sendBtn);
    }
  });

  renderCoachMessages();
}

async function sendCoachMessage(input, sendBtn) {
  const message = input.value.trim();
  if (!message) return;

  coachState.messages.push({ role: 'user', content: message });
  input.value = '';
  input.rows = 2;

  renderCoachMessages();
  scrollCoachMessagesToBottom();

  sendBtn.disabled = true;

  try {
    const context = {
      currentTrade: coachState.currentTrade
    };

    const response = await api('/api/coach/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        model: coachState.model,
        context,
        conversationHistory: coachState.conversationHistory
      })
    });

    coachState.messages.push({ role: 'assistant', content: response.reply });
    coachState.conversationHistory.push(
      { role: 'user', content: message },
      { role: 'assistant', content: response.reply }
    );

    renderCoachMessages();
    scrollCoachMessagesToBottom();
  } catch (e) {
    coachState.messages.push({ role: 'error', content: `Error: ${e.message}` });
    renderCoachMessages();
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

function renderCoachMessages() {
  const container = document.getElementById('coach-messages-sidebar');
  if (!container) return;

  container.innerHTML = coachState.messages.map(msg => {
    return `<div class="coach-msg ${msg.role}">${escapeHtml(msg.content)}</div>`;
  }).join('');
}

function scrollCoachMessagesToBottom() {
  const container = document.getElementById('coach-messages-sidebar');
  if (container) {
    setTimeout(() => {
      container.scrollTop = container.scrollHeight;
    }, 0);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function setCoachContext(trade) {
  coachState.currentTrade = trade;
  // Optionally show a subtle indicator
  const coachLabel = document.querySelector('#sidebar-coach > div:first-child');
  if (coachLabel && trade) {
    coachLabel.textContent = `💬 Coach · ${trade.symbol}`;
  }
}

export function clearCoachChat() {
  coachState.messages = [];
  coachState.conversationHistory = [];
  coachState.currentTrade = null;
  const coachLabel = document.querySelector('#sidebar-coach > div:first-child');
  if (coachLabel) {
    coachLabel.textContent = '💬 Coach';
  }
}

// ── Modal Coach Panel ──
export function initModalCoach() {
  const modelSelect = document.getElementById('modal-coach-model-select');
  const input = document.getElementById('modal-coach-input');
  const sendBtn = document.getElementById('modal-coach-send');

  if (!modelSelect || !input || !sendBtn) return;

  modelSelect.value = coachState.model;
  modelSelect.addEventListener('change', e => {
    coachState.model = e.target.value;
  });

  sendBtn.addEventListener('click', () => sendModalCoachMessage(input, sendBtn));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      sendModalCoachMessage(input, sendBtn);
    }
  });

  renderModalCoachMessages();
}

async function sendModalCoachMessage(input, sendBtn) {
  const message = input.value.trim();
  if (!message) return;

  coachState.messages.push({ role: 'user', content: message });
  input.value = '';

  renderModalCoachMessages();
  scrollModalCoachMessagesToBottom();

  sendBtn.disabled = true;

  try {
    const context = {
      currentTrade: coachState.currentTrade
    };

    const response = await api('/api/coach/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        model: coachState.model,
        context,
        conversationHistory: coachState.conversationHistory
      })
    });

    coachState.messages.push({ role: 'assistant', content: response.reply });
    coachState.conversationHistory.push(
      { role: 'user', content: message },
      { role: 'assistant', content: response.reply }
    );

    renderModalCoachMessages();
    scrollModalCoachMessagesToBottom();
  } catch (e) {
    coachState.messages.push({ role: 'error', content: `Error: ${e.message}` });
    renderModalCoachMessages();
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

function renderModalCoachMessages() {
  const container = document.getElementById('modal-coach-messages');
  if (!container) return;

  container.innerHTML = coachState.messages.map(msg => {
    return `<div class="coach-msg ${msg.role}">${escapeHtml(msg.content)}</div>`;
  }).join('');
}

function scrollModalCoachMessagesToBottom() {
  const container = document.getElementById('modal-coach-messages');
  if (container) {
    setTimeout(() => {
      container.scrollTop = container.scrollHeight;
    }, 0);
  }
}
