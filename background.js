// WriteFlow Background Service Worker - background.js
// API Key: char-code encoding (consistent with popup.js)

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const FREE_LIMIT = 3;
const GUMROAD_URL = 'https://zhangning94.gumroad.com/l/writeflow-pro';

// --- Built-in API Key (base64 obfuscated) ---
const BUILT_IN_KEY_B64 = 'c2stODc4Nzc1YmQtaXdXNHI5MXhBRGk3WktZVlQ4WDFZeTRjSGY2ZE9qbA==';

// --- API Key Decoding (base64) ---
function decodeB64(str) {
  try { return atob(str); } catch(e) { return ''; }
}

async function getEffectiveApiKey() {
  return new Promise(resolve => {
    chrome.storage.local.get('apiKey', data => {
      if (data.apiKey) {
        const decoded = decodeB64(data.apiKey);
        if (decoded) { resolve(decoded); return; }
      }
      resolve(decodeB64(BUILT_IN_KEY_B64));
    });
  });
}

// Pre-generated Pro license codes (SHA-256 hashes)
const VALID_LICENSE_HASHES = [
  // TODO: Add real license hashes here
];

async function hashLicenseCode(code) {
  const encoder = new TextEncoder();
  const data = encoder.encode(code.trim().toUpperCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyLicenseCode(code) {
  const hash = await hashLicenseCode(code);
  return VALID_LICENSE_HASHES.includes(hash);
}

async function getUsageForToday() {
  return new Promise(resolve => {
    chrome.storage.local.get(['usageDate', 'usageCount'], data => {
      const today = new Date().toDateString();
      if (data.usageDate !== today) resolve(0);
      else resolve(data.usageCount || 0);
    });
  });
}

async function incrementUsage() {
  const today = new Date().toDateString();
  return new Promise(resolve => {
    chrome.storage.local.get(['usageDate', 'usageCount'], data => {
      if (data.usageDate !== today) {
        chrome.storage.local.set({ usageDate: today, usageCount: 1 });
        resolve(1);
      } else {
        const count = (data.usageCount || 0) + 1;
        chrome.storage.local.set({ usageCount: count });
        resolve(count);
      }
    });
  });
}

async function checkProStatus() {
  return new Promise(resolve => {
    chrome.storage.local.get('isPro', data => resolve(!!data.isPro));
  });
}

async function isUsingBuiltInKey() {
  return new Promise(resolve => {
    chrome.storage.local.get('apiKey', data => resolve(!data.apiKey));
  });
}

async function canRewrite() {
  const isPro = await checkProStatus();
  if (isPro) return true;
  const usingBuiltIn = await isUsingBuiltInKey();
  if (!usingBuiltIn) return true;
  const usage = await getUsageForToday();
  return usage < FREE_LIMIT;
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
          message: 'Free limit (3/day) reached. Upgrade to Pro for unlimited rewrites.'
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
      if (!data.apiKey) await incrementUsage();

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
    getUsageForToday().then(count => {
      checkProStatus().then(isPro => {
        isUsingBuiltInKey().then(usingBuiltIn => {
          sendResponse({ usage: count, limit: FREE_LIMIT, isPro, usingBuiltIn });
        });
      });
    });
    return true;
  }
  if (request.action === 'verifyLicense') {
    verifyLicenseCode(request.code).then(valid => {
      if (valid) {
        chrome.storage.local.set({ isPro: true }, () => {
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: false, error: 'Invalid license code.' });
      }
    });
    return true;
  }
  if (request.action === 'getGumroadUrl') {
    sendResponse({ url: GUMROAD_URL });
    return false;
  }
  if (request.action === 'saveMode') {
    chrome.storage.local.set({ lastMode: request.mode });
    return false;
  }
});

async function handleRewrite(request, sendResponse) {
  if (!(await canRewrite())) {
    sendResponse({ error: 'FREE_LIMIT', message: 'Free limit reached. Upgrade to Pro.' });
    return;
  }
  const apiKey = await getEffectiveApiKey();
  if (!apiKey) {
    sendResponse({ error: 'No API key available.' });
    return;
  }
  const usingBuiltIn = await isUsingBuiltInKey();
  if (usingBuiltIn) await incrementUsage();
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
