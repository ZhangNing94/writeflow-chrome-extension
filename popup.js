// WriteFlow Popup - popup.js
document.addEventListener('DOMContentLoaded', init);

const MAX_CHARS = 2000;
const MAX_HISTORY = 5;

async function init() {
  const inputText = document.getElementById('inputText');
  const rewriteBtn = document.getElementById('rewriteBtn');
  const clearBtn = document.getElementById('clearBtn');
  const copyBtn = document.getElementById('copyBtn');
  const replaceBtn = document.getElementById('replaceBtn');
  const openOptions = document.getElementById('openOptions');
  const upgradeModal = document.getElementById('upgradeModal');
  const getProBtn = document.getElementById('getProBtn');
  const upgradeCloseBtn = document.getElementById('upgradeCloseBtn');
  const useOwnKey = document.getElementById('useOwnKey');
  const modeBtns = document.querySelectorAll('.mode-btn');

  // Pro section refs
  const proSection = document.getElementById('proSection');
  const proFree = document.getElementById('proFree');
  const proActive = document.getElementById('proActive');
  const upgradeProPopupBtn = document.getElementById('upgradeProPopupBtn');
  const activateBtn = document.getElementById('activateBtn');
  const licenseInput = document.getElementById('licenseInput');
  const licenseMsg = document.getElementById('licenseMsg');
  const proUsageCount = document.getElementById('proUsageCount');

  // Init LicenseManager and check status
  await LicenseManager.init();
  checkProAndShowUI();

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

  // Load history
  chrome.storage.local.get(['history'], data => {
    if (data.history && data.history.length > 0) {
      renderHistory(data.history);
    }
  });

  inputText.addEventListener('input', () => {
    const len = inputText.value.length;
    document.getElementById('charCount').textContent = `${len} / ${MAX_CHARS}`;
  });

  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      chrome.runtime.sendMessage({ action: 'saveMode', mode: btn.dataset.mode });
    });
  });

  rewriteBtn.addEventListener('click', doRewrite);
  clearBtn.addEventListener('click', () => { inputText.value = ''; inputText.dispatchEvent(new Event('input')); });
  copyBtn.addEventListener('click', copyResult);
  replaceBtn.addEventListener('click', replaceResult);
  openOptions.addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

  // Pro section handlers
  upgradeProPopupBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: LICENSE_CONFIG.gumroadUrl });
  });

  activateBtn.addEventListener('click', async () => {
    const success = await LicenseManager.showActivationDialog();
    if (success) {
      await LicenseManager.init();
      checkProAndShowUI();
    }
  });

  // Upgrade modal handlers
  getProBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: LICENSE_CONFIG.gumroadUrl });
  });
  upgradeCloseBtn.addEventListener('click', () => upgradeModal.classList.add('hidden'));
  useOwnKey.addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

  // Gentle banner handlers
  const gentleBannerInit = document.getElementById('gentleBanner');
  const bannerUpgradeInit = document.getElementById('bannerUpgrade');
  const bannerDismissInit = document.getElementById('bannerDismiss');
  bannerUpgradeInit.addEventListener('click', () => {
    chrome.tabs.create({ url: LICENSE_CONFIG.gumroadUrl });
  });
  bannerDismissInit.addEventListener('click', () => gentleBannerInit.classList.add('hidden'));
}

function showLicenseMsg(el, msg, type) {
  el.textContent = msg;
  el.className = `license-msg ${type}`;
  setTimeout(() => { el.textContent = ''; el.className = 'license-msg'; }, 4000);
}

async function checkProAndShowUI() {
  const status = LicenseManager.getStatus();
  const proFree = document.getElementById('proFree');
  const proActive = document.getElementById('proActive');
  const proUsageCount = document.getElementById('proUsageCount');

  if (status && status.activated) {
    proFree.classList.add('hidden');
    proActive.classList.remove('hidden');
  } else {
    proFree.classList.remove('hidden');
    proActive.classList.add('hidden');
    if (proUsageCount) {
      const rem = status ? status.remaining : LICENSE_CONFIG.trialLimit;
      proUsageCount.textContent = Math.max(0, rem);
    }
  }

  // Update usage badge
  const usageBadge = document.getElementById('usageBadge');
  if (usageBadge && status && !status.activated) {
    usageBadge.classList.remove('hidden');
    document.getElementById('usageCount').textContent = LICENSE_CONFIG.trialLimit - Math.max(0, status.remaining);
    document.getElementById('usageLimit').textContent = LICENSE_CONFIG.trialLimit;
  }
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
    // Also update pro section usage count
    const proUsageCount = document.getElementById('proUsageCount');
    if (proUsageCount && !resp.isPro) {
      proUsageCount.textContent = resp.usage || 0;
    }
  } catch (e) {
    // Ignore errors
  }
}

async function doRewrite() {
  const inputText = document.getElementById('inputText').value.trim();

  // License check
  const ls = LicenseManager.getStatus();
  if (ls && !ls.activated && ls.remaining <= 0) {
    await LicenseManager.showActivationDialog();
    return;
  }
  const activeMode = document.querySelector('.mode-btn.active').dataset.mode;
  const rewriteBtn = document.getElementById('rewriteBtn');
  const errorMsg = document.getElementById('errorMsg');
  const resultSection = document.getElementById('resultSection');
  const resultText = document.getElementById('resultText');
  const scoreBar = document.getElementById('scoreBar');
  const btnText = document.getElementById('btnText');
  const btnSpinner = document.getElementById('btnSpinner');
  const gentleBanner = document.getElementById('gentleBanner');
  const bannerText = document.getElementById('bannerText');
  const upgradeModal = document.getElementById('upgradeModal');

  errorMsg.classList.add('hidden');
  resultSection.classList.add('hidden');
  scoreBar.classList.add('hidden');
  rewriteBtn.disabled = true;
  btnText.classList.add('hidden');
  btnSpinner.classList.remove('hidden');

  // Progress text - start with Rewriting
  btnText.textContent = 'Rewriting';
  btnText.classList.remove('hidden');
  btnSpinner.classList.add('hidden');

  // After 5 seconds, show "Almost done..."
  const progressTimeout = setTimeout(() => {
    const currentBtnText = document.getElementById('btnText');
    if (!currentBtnText.classList.contains('hidden') || resultSection.classList.contains('hidden')) {
      currentBtnText.textContent = 'Almost done...';
    }
  }, 5000);

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'rewrite',
      text: inputText,
      mode: activeMode
    });

    if (response.error === 'FREE_LIMIT' || response.error === 'FREE_LIMIT_UPSELL') {
      // Gentle banner instead of blocking modal (Issue #6)
      gentleBanner.classList.remove('hidden');
      bannerText.textContent = `You have used ${LICENSE_CONFIG.trialLimit}/${LICENSE_CONFIG.trialLimit} free rewrites. Want more?`;
      return;
    }

    if (response.error) {
      errorMsg.textContent = response.error;
      errorMsg.classList.remove('hidden');
      return;
    }

    resultText.textContent = response.rewritten;
    resultSection.classList.remove('hidden');

    // Increment trial count via LicenseManager (single writer for popup path)
    const ls2 = LicenseManager.getStatus();
    if (ls2 && !ls2.activated) await LicenseManager.incrementTrial();

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
    btnText.textContent = 'Rewrite';
    btnText.classList.remove('hidden');
    btnSpinner.classList.add('hidden');
    clearTimeout(progressTimeout);
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

async function replaceResult() {
  const newText = document.getElementById('resultText').textContent;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0] && tabs[0].id) {
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: (text) => {
          const sel = window.getSelection();
          if (sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode(text));
          }
        },
        args: [newText]
      });
      const btn = document.getElementById('replaceBtn');
      btn.textContent = 'Replaced';
      setTimeout(() => { btn.textContent = 'Replace'; }, 2000);
    }
  } catch (e) {
    document.getElementById('errorMsg').textContent = 'Replace failed: ' + e.message;
    document.getElementById('errorMsg').classList.remove('hidden');
  }
}

async function copyResult() {
  const text = document.getElementById('resultText').textContent;
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('copyBtn');
    btn.textContent = '�?Copied';
    setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
  } catch {
    document.getElementById('errorMsg').textContent = 'Copy failed';
    document.getElementById('errorMsg').classList.remove('hidden');
  }
}