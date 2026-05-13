// WriteFlow Options - options.js

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusMsg = document.getElementById('statusMsg');
  const licenseCode = document.getElementById('licenseCode');
  const verifyBtn = document.getElementById('verifyBtn');
  const buyBtn = document.getElementById('buyBtn');
  const licenseStatus = document.getElementById('licenseStatus');
  const proStatusText = document.getElementById('proStatusText');
  const proBadge = document.getElementById('proBadge');
  const proSection = document.getElementById('proSection');

  // Init: load existing settings
  chrome.storage.local.get(['apiKey', 'isPro'], (data) => {
    if (data.apiKey) apiKeyInput.value = data.apiKey;
    if (data.isPro) updateProUI(true);
  });

  function updateProUI(isPro) {
    if (isPro) {
      proBadge.classList.remove('hidden');
      proStatusText.textContent = 'Pro plan active — unlimited rewrites unlocked!';
      proStatusText.style.color = '#059669';
      licenseCode.disabled = true;
      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Activated';
      buyBtn.classList.add('hidden');
    }
  }

  // API Key save/clear
  saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showStatus(statusMsg, 'Please enter an API Key.', 'error');
      return;
    }
    if (!key.startsWith('sk-')) {
      showStatus(statusMsg, 'Invalid key format. DeepSeek API keys start with "sk-".', 'error');
      return;
    }
    chrome.storage.local.set({ apiKey: key }, () => {
      showStatus(statusMsg, 'API Key saved! Using your own key (unlimited).', 'success');
    });
  });

  clearBtn.addEventListener('click', () => {
    chrome.storage.local.remove('apiKey', () => {
      apiKeyInput.value = '';
      showStatus(statusMsg, 'API Key removed. Switched to built-in AI (3/day limit).', 'success');
    });
  });

  // Pro license verification
  verifyBtn.addEventListener('click', async () => {
    const code = licenseCode.value.trim();
    if (!code || code.length < 6) {
      showStatus(licenseStatus, 'Please enter a valid 6-digit license code.', 'error');
      return;
    }
    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Verifying...';

    try {
      const resp = await chrome.runtime.sendMessage({ action: 'verifyLicense', code });
      if (resp && resp.success) {
        showStatus(licenseStatus, 'Pro activated! Unlimited rewrites unlocked.', 'success');
        updateProUI(true);
      } else {
        showStatus(licenseStatus, resp.error || 'Invalid license code. Please try again.', 'error');
      }
    } catch (e) {
      showStatus(licenseStatus, `Error: ${e.message}`, 'error');
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Activate Pro';
    }
  });

  buyBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://zhangning94.gumroad.com/l/writeflow-pro' });
  });

  function showStatus(el, msg, type) {
    el.textContent = msg;
    el.className = `status ${type}`;
    setTimeout(() => { el.className = 'status'; }, 4000);
  }
});