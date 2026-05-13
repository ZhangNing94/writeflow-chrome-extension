// WriteFlow Options - options.js

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusMsg = document.getElementById('statusMsg');

  chrome.storage.local.get('apiKey', (data) => {
    if (data.apiKey) {
      apiKeyInput.value = data.apiKey;
    }
  });

  saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showStatus('Please enter an API Key.', 'error');
      return;
    }
    if (!key.startsWith('sk-')) {
      showStatus('Invalid key format. DeepSeek API keys start with "sk-".', 'error');
      return;
    }
    chrome.storage.local.set({ apiKey: key }, () => {
      showStatus('✅ API Key saved successfully! WriteFlow is ready to use.', 'success');
    });
  });

  clearBtn.addEventListener('click', () => {
    chrome.storage.local.remove('apiKey', () => {
      apiKeyInput.value = '';
      showStatus('API Key removed.', 'success');
    });
  });

  function showStatus(msg, type) {
    statusMsg.textContent = msg;
    statusMsg.className = `status ${type}`;
    setTimeout(() => { statusMsg.className = 'status'; }, 4000);
  }
});