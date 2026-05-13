// WriteFlow Popup - popup.js
document.addEventListener('DOMContentLoaded', init);

const MAX_CHARS = 2000;
const MAX_HISTORY = 5;

function init() {
  const inputText = document.getElementById('inputText');
  const rewriteBtn = document.getElementById('rewriteBtn');
  const clearBtn = document.getElementById('clearBtn');
  const copyBtn = document.getElementById('copyBtn');
  const openOptions = document.getElementById('openOptions');
  const upgradeModal = document.getElementById('upgradeModal');
  const getProBtn = document.getElementById('getProBtn');
  const upgradeCloseBtn = document.getElementById('upgradeCloseBtn');
  const useOwnKey = document.getElementById('useOwnKey');
  const modeBtns = document.querySelectorAll('.mode-btn');

  // Check usage and pro status
  updateUsageDisplay();
  checkRewriteLimit(rewriteBtn, upgradeModal);

  // Auto-fill selected text from active tab
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0] && tabs[0].id) {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => window.getSelection().toString()
      }, results => {
        if (results && results[0] && results[0].result) {
          const selected = results[0].result.trim();
          if (selected && selected.length <= MAX_CHARS) {
            inputText.value = selected;
            inputText.dispatchEvent(new Event('input'));
          }
        }
      });
    }
    // Restore saved mode
    chrome.storage.local.get('lastMode', data => {
      if (data.lastMode) {
        modeBtns.forEach(b => b.classList.remove('active'));
        const savedBtn = document.querySelector(`.mode-btn[data-mode="${data.lastMode}"]`);
        if (savedBtn) savedBtn.classList.add('active');
      }
    });
  });

  // Check API key and enable button
  chrome.storage.local.get(['apiKey', 'history'], data => {
    if (data.history && data.history.length > 0) {
      renderHistory(data.history);
    }
  });

  inputText.addEventListener('input', () => {
    const len = inputText.value.length;
    document.getElementById('charCount').textContent = `${len} / ${MAX_CHARS}`;
    chrome.runtime.sendMessage({ action: 'getUsage' }, resp => {
      if (resp) {
        const canRewrite = resp.isPro || resp.usingBuiltIn ? resp.usage < resp.limit && !!resp.usingBuiltIn : true;
        rewriteBtn.disabled = !inputText.value.trim();
      }
    });
  });

  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Save mode to storage (Issue #3 item 6)
      chrome.runtime.sendMessage({ action: 'saveMode', mode: btn.dataset.mode });
    });
  });

  rewriteBtn.addEventListener('click', doRewrite);
  clearBtn.addEventListener('click', () => { inputText.value = ''; inputText.dispatchEvent(new Event('input')); });
  copyBtn.addEventListener('click', copyResult);
  openOptions.addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

  // Upgrade modal handlers
  getProBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'getGumroadUrl' }, resp => {
      if (resp && resp.url) {
        chrome.tabs.create({ url: resp.url });
      }
    });
  });
  upgradeCloseBtn.addEventListener('click', () => {
    upgradeModal.classList.add('hidden');
  });
  useOwnKey.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

async function checkRewriteLimit(rewriteBtn, upgradeModal) {
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'getUsage' });
    if (resp && !resp.isPro && resp.usingBuiltIn && resp.usage >= resp.limit) {
      rewriteBtn.classList.add('hidden');
      upgradeModal.classList.remove('hidden');
    }
  } catch (e) {
    // Ignore errors - button stays enabled
  }
}

async function updateUsageDisplay() {
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'getUsage' });
    if (resp && resp.usingBuiltIn && !resp.isPro) {
      document.getElementById('usageBadge').classList.remove('hidden');
      document.getElementById('usageCount').textContent = resp.usage;
      document.getElementById('usageLimit').textContent = resp.limit;
    }
  } catch (e) {
    // Ignore errors
  }
}

async function doRewrite() {
  const inputText = document.getElementById('inputText').value.trim();
  const activeMode = document.querySelector('.mode-btn.active').dataset.mode;
  const rewriteBtn = document.getElementById('rewriteBtn');
  const errorMsg = document.getElementById('errorMsg');
  const resultSection = document.getElementById('resultSection');
  const resultText = document.getElementById('resultText');
  const scoreBar = document.getElementById('scoreBar');
  const btnText = document.getElementById('btnText');
  const btnSpinner = document.getElementById('btnSpinner');
  const upgradeModal = document.getElementById('upgradeModal');

  errorMsg.classList.add('hidden');
  resultSection.classList.add('hidden');
  scoreBar.classList.add('hidden');
  rewriteBtn.disabled = true;
  btnText.classList.add('hidden');
  btnSpinner.classList.remove('hidden');

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'rewrite',
      text: inputText,
      mode: activeMode
    });

    if (response.error === 'FREE_LIMIT' || response.error === 'FREE_LIMIT_UPSELL') {
      rewriteBtn.classList.add('hidden');
      upgradeModal.classList.remove('hidden');
      return;
    }

    if (response.error) {
      errorMsg.textContent = response.error;
      errorMsg.classList.remove('hidden');
      return;
    }

    resultText.textContent = response.rewritten;
    resultSection.classList.remove('hidden');

    const score = calcHumanizedScore(response.rewritten);
    document.getElementById('scoreValue').textContent = `${score}%`;
    document.getElementById('scoreFill').style.width = `${score}%`;
    scoreBar.classList.remove('hidden');

    saveHistory(inputText, response.rewritten, activeMode);
    await updateUsageDisplay();
  } catch (err) {
    errorMsg.textContent = `Error: ${err.message || 'Failed to rewrite'}`;
    errorMsg.classList.remove('hidden');
  } finally {
    rewriteBtn.disabled = false;
    btnText.classList.remove('hidden');
    btnSpinner.classList.add('hidden');
    // Re-check limit after rewrite
    await checkRewriteLimit(rewriteBtn, upgradeModal);
  }
}

function calcHumanizedScore(text) {
  const words = text.toLowerCase().match(/\b\w+\b/g) || [];
  if (words.length < 10) return 85;
  const freq = {};
  words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  const repeated = Object.values(freq).filter(c => c > 2).length;
  const repetitionPenalty = Math.min(30, repeated * 5);
  const transitionWords = ['however', 'therefore', 'moreover', 'furthermore', 'meanwhile', 'additionally', 'consequently', 'nevertheless', 'thus', 'hence', 'accordingly', 'specifically'];
  const transitionCount = transitionWords.filter(tw => text.toLowerCase().includes(tw)).length;
  const transitionBonus = Math.min(15, transitionCount * 5);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim());
  const avgLen = sentences.length > 0 ? words.length / sentences.length : 0;
  const lengthBonus = avgLen > 8 && avgLen < 25 ? 10 : 0;
  return Math.min(100, Math.max(30, 70 - repetitionPenalty + transitionBonus + lengthBonus));
}

function saveHistory(original, rewritten, mode) {
  chrome.storage.local.get(['history'], (data) => {
    const history = data.history || [];
    history.unshift({
      original: original.substring(0, 80),
      rewritten: rewritten.substring(0, 80),
      mode,
      time: Date.now()
    });
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    chrome.storage.local.set({ history }, () => renderHistory(history));
  });
}

function renderHistory(history) {
  const section = document.getElementById('historySection');
  const list = document.getElementById('historyList');
  if (!history.length) return;
  section.classList.remove('hidden');
  list.innerHTML = history.map(h => {
    const time = new Date(h.time);
    const timeStr = `${time.getHours().toString().padStart(2,'0')}:${time.getMinutes().toString().padStart(2,'0')}`;
    return `<div class="history-item"><span class="mode-tag">${h.mode}</span>${h.rewritten.substring(0, 50)} - ${timeStr}</div>`;
  }).join('');
}

async function copyResult() {
  const text = document.getElementById('resultText').textContent;
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('copyBtn');
    btn.textContent = '✅ Copied';
    setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
  } catch {
    document.getElementById('errorMsg').textContent = 'Copy failed';
    document.getElementById('errorMsg').classList.remove('hidden');
  }
}