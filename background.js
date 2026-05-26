// WriteFlow Background Service Worker
// License: Gumroad API verification + 5 free trials

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const GUMROAD_API = 'https://api.gumroad.com/v2/licenses/verify';
const FREE_TRIALS = 5;
const PRODUCT_PERMALINK = 'xl';

// --- Built-in API Key (base64 obfuscated) ---
const BUILT_IN_KEY_B64 = 'c2stODc4Nzc1YmQtaXdXNHI5MXhBRGk3WktZVlQ4WDFZeTRjSGY2ZE9qbA==';

// --- API Key Decoding (base64) ---
function decodeB64(str) {
  try { return atob(str); } catch(e) { return ''; }
}

async function getEffectiveApiKey() {
  const data = await chrome.storage.local.get('apiKey');
  if (data.apiKey) {
    const decoded = decodeB64(data.apiKey);
    if (decoded) return decoded;
  }
  return decodeB64(BUILT_IN_KEY_B64);
}

// --- License (Gumroad API + trial tracking) ---
async function isLicenseActivated() {
  const data = await chrome.storage.local.get('license_activated');
  return !!data.license_activated;
}

async function getTrialCount() {
  const data = await chrome.storage.local.get('license_trial_count');
  return data.license_trial_count || 0;
}

async function incrementLicenseTrial() {
  const data = await chrome.storage.local.get('license_trial_count');
  const count = (data.license_trial_count || 0) + 1;
  await chrome.storage.local.set({ license_trial_count: count });
  return count;
}

async function canRewrite() {
  if (await isLicenseActivated()) return true;
  const trials = await getTrialCount();
  return trials < FREE_TRIALS;
}

async function verifyLicenseCode(code) {
  try {
    const formData = new URLSearchParams();
    formData.append('product_permalink', PRODUCT_PERMALINK);
    formData.append('license_key', code.trim());
    const response = await fetch(GUMROAD_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString()
    });
    if (!response.ok) return false;
    const data = await response.json();
    if (!data.success) return false;
    // Refund detection
    if (data.purchase && data.purchase.refunded) {
      await chrome.storage.local.remove('license_activated');
      return false;
    }
    await chrome.storage.local.set({ license_activated: true });
    return true;
  } catch (e) {
    return false;
  }
}

// --- Context Menu ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'writeflow-rewrite',
    title: 'Rewrite with WriteFlow',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'writeflow-rewrite' && info.selectionText) {
    chrome.storage.local.get(['apiKey', 'lastMode'], async (data) => {
      if (!await canRewrite()) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showNotification',
          message: 'Free trial limit reached. Open the popup to activate your license.'
        });
        return;
      }
      const apiKey = await getEffectiveApiKey();
      if (!apiKey) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showNotification',
          message: 'API key not available. Please set your key in Settings.'
        });
        return;
      }
      const mode = data.lastMode || 'Simple';
      if (!data.apiKey) await incrementLicenseTrial();

      chrome.tabs.sendMessage(tab.id, {
        action: 'showRewriting',
        text: info.selectionText
      });
      rewriteText(info.selectionText, mode, apiKey)
        .then(result => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'showRewriteResult',
            rewritten: result.rewritten,
            score: result.score
          });
        })
        .catch(err => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'showRewriteResult',
            error: err.message
          });
        });
    });
  }
});

// --- Message Handlers ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'rewrite') {
    handleRewrite(request, sendResponse);
    return true;
  }
  if (request.action === 'getUsage') {
    getTrialCount().then(trials => {
      isLicenseActivated().then(activated => {
        sendResponse({ trials, limit: FREE_TRIALS, activated });
      });
    });
    return true;
  }
  if (request.action === 'verifyLicense') {
    verifyLicenseCode(request.code).then(valid => {
      if (valid) {
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Invalid license key or refund detected.' });
      }
    });
    return true;
  }
  if (request.action === 'saveMode') {
    chrome.storage.local.set({ lastMode: request.mode });
    return false;
  }
});

async function handleRewrite(request, sendResponse) {
  if (!(await canRewrite())) {
    sendResponse({ error: 'FREE_LIMIT', message: 'Free trial limit reached. Please activate your license.' });
    return;
  }
  const apiKey = await getEffectiveApiKey();
  if (!apiKey) {
    sendResponse({ error: 'No API key available.' });
    return;
  }
  const usingBuiltIn = !(await (() => chrome.storage.local.get('apiKey'))().then(d => !!d.apiKey));
  // Increment trial counter for built-in key users
  if (!(await isLicenseActivated())) await incrementLicenseTrial();
  try {
    const result = await rewriteText(request.text, request.mode, apiKey);
    sendResponse(result);
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

async function rewriteText(text, mode, apiKey) {
  const systemPrompts = {
    Formal: 'You are a professional writing assistant. Rewrite the following text in a formal, polished style suitable for business communication. Keep the original meaning but improve vocabulary, grammar, and structure. Output ONLY the rewritten text.',
    Simple: 'You are a writing assistant. Rewrite the following text to be simpler, clearer, and easier to understand. Use plain language. Keep the original meaning. Output ONLY the rewritten text.',
    Creative: 'You are a creative writing assistant. Rewrite the following text with more engaging, vivid, and creative language. Vary sentence structure and use richer vocabulary. Keep the original meaning. Output ONLY the rewritten text.',
    Academic: 'You are an academic writing assistant. Rewrite the following text in a formal academic style with precise terminology and sophisticated sentence structures. Keep the original meaning. Output ONLY the rewritten text.'
  };

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompts[mode] || systemPrompts['Simple'] },
        { role: 'user', content: text }
      ],
      temperature: 0.7,
      max_tokens: 2048
    })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('Invalid API Key. Please check your settings.');
    if (response.status === 429) throw new Error('Rate limit exceeded. Please wait and try again.');
    throw new Error(`API Error: ${errData.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const rewritten = data.choices?.[0]?.message?.content?.trim();
  if (!rewritten) throw new Error('No response from AI. Please try again.');

  const score = calcHumanizedScore(rewritten);
  return { rewritten, score };
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