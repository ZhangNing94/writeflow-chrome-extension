// WriteFlow Options - options.js
// API Key: base64 encoded storage

function encodeB64(str) {
  try { return btoa(str); } catch(e) { return ''; }
}

function decodeB64(str) {
  try { return atob(str); } catch(e) { return ''; }
}

document.addEventListener('DOMContentLoaded', () => {
  const showApiKeyBtn = document.getElementById('showApiKeyBtn');
  const apiKeyFields = document.getElementById('apiKeyFields');
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusMsg = document.getElementById('statusMsg');
  const apiKeyInfo = document.getElementById('apiKeyInfo');
  const licenseCode = document.getElementById('licenseCode');
  const verifyBtn = document.getElementById('verifyBtn');
  const buyBtn = document.getElementById('buyBtn');
  const licenseStatus = document.getElementById('licenseStatus');
  const proStatusText = document.getElementById('proStatusText');
  const proBadge = document.getElementById('proBadge');

  // Init: load existing settings — decode stored key (base64)
  chrome.storage.local.get(['apiKey', 'isPro'], (data) => {
    if (data.isPro) updateProUI(true);
    if (data.apiKey) {
      apiKeyFields.style.display = 'block';
      apiKeyInput.value = decodeB64(data.apiKey);
      apiKeyInfo.textContent = 'You are using your own API key. To switch back to the built-in key, remove it below.';
      showApiKeyBtn.textContent = 'Using Custom Key';
      showApiKeyBtn.style.borderColor = '#f97316';
      showApiKeyBtn.style.color = '#f97316';
    }
  });

  function updateProUI(isPro) {
    if (isPro) {
      proBadge.classList.remove('hidden');
      proStatusText.textContent = 'Pro plan active — unlimited rewrites unlocked!';
      proStatusText.style.color = '#ea580c';
      licenseCode.disabled = true;
      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Activated';
      buyBtn.classList.add('hidden');
    }
  }

  // Toggle custom API key fields
  showApiKeyBtn.addEventListener('click', () => {
    const isVisible = apiKeyFields.style.display === 'block';
    apiKeyFields.style.display = isVisible ? 'none' : 'block';
    showApiKeyBtn.textContent = isVisible ? 'Use My Own Key' : 'Hide';
  });

  // API Key save — encode as base64 before storing
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
    // Encode as base64 before storing
    chrome.storage.local.set({ apiKey: encodeB64(key) }, () => {
      showStatus(statusMsg, 'API Key saved! Using your own key (unlimited).', 'success');
      apiKeyInfo.textContent = 'You are using your own API key. To switch back to the built-in key, remove it below.';
    });
  });

  clearBtn.addEventListener('click', () => {
    chrome.storage.local.remove('apiKey', () => {
      apiKeyInput.value = '';
      showStatus(statusMsg, 'API Key removed. Switched to built-in AI (5 free trials total).', 'success');
      apiKeyInfo.textContent = 'WriteFlow comes with a built-in API key ready to use. If you have performance issues or want to use your own key, click below.';
      apiKeyFields.style.display = 'none';
      showApiKeyBtn.textContent = 'Use My Own Key';
    });
  });

  // Pro license verification
  verifyBtn.addEventListener('click', async () => {
    const code = licenseCode.value.trim();
    if (!code || code.length < 6) {
      showStatus(licenseStatus, 'Please enter a valid license key.', 'error');
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
    chrome.tabs.create({ url: window.LICENSE_CONFIG?.gumroadUrl || 'https://5330159977060.gumroad.com/l/xl?wanted=true' });
  });

  function showStatus(el, msg, type) {
    el.textContent = msg;
    el.className = `status ${type}`;
    setTimeout(() => { el.className = 'status'; }, 4000);
  }
});