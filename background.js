// WriteFlow Background Service Worker - background.js

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'writeflow-rewrite',
    title: 'Rewrite with WriteFlow',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'writeflow-rewrite' && info.selectionText) {
    chrome.storage.local.get('apiKey', (data) => {
      if (!data.apiKey) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showNotification',
          message: 'Please set your DeepSeek API Key in WriteFlow settings first.'
        });
        return;
      }
      chrome.tabs.sendMessage(tab.id, {
        action: 'showRewriting',
        text: info.selectionText
      });
      rewriteText(info.selectionText, 'Simple', data.apiKey)
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'rewrite') {
    chrome.storage.local.get('apiKey', async (data) => {
      if (!data.apiKey) {
        sendResponse({ error: 'API Key not set. Please open Settings.' });
        return;
      }
      try {
        const result = await rewriteText(request.text, request.mode, data.apiKey);
        sendResponse(result);
      } catch (err) {
        sendResponse({ error: err.message });
      }
    });
    return true;
  }
});

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