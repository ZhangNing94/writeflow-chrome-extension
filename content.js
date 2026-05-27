// WriteFlow Content Script - content.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'showNotification':
      showNotification(request.message);
      break;
    case 'showRewriting':
      showFloatingUI('rewriting', request.text);
      break;
    case 'showRewriteResult':
      if (request.error) {
        updateFloatingUI('error', request.error);
      } else {
        updateFloatingUI('result', request.rewritten, request.score);
      }
      break;
  }
});

let floatingEl = null;
let selectedText = '';

function showFloatingUI(state, text) {
  removeFloatingUI();
  selectedText = text || '';
  floatingEl = document.createElement('div');
  floatingEl.id = 'writeflow-floating';
  floatingEl.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 999999;
    background: #fff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.15);
    padding: 16px; max-width: 400px; min-width: 280px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px; color: #334155; border: 1px solid #e2e8f0;
  `;
  if (state === 'rewriting') {
    floatingEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="color:#f97316;font-weight:600;">WriteFlow</span>
        <span style="color:#64748b;font-size:12px;">Rewriting...</span>
      </div>
      <div style="color:#94a3b8;font-size:12px;">${text.substring(0, 100)}${text.length > 100 ? '...' : ''}</div>
    `;
  }
  document.body.appendChild(floatingEl);
}

function updateFloatingUI(state, content, score) {
  if (!floatingEl) return;
  if (state === 'error') {
    floatingEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <span style="color:#dc2626;font-weight:600;">Error</span>
      </div>
      <div style="font-size:12px;color:#dc2626;">${escapeHtml(content)}</div>
    `;
  } else {
    floatingEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="color:#f97316;font-weight:600;">Rewritten</span>
        ${score !== undefined ? `<span style="font-size:11px;color:#f97316;font-weight:600;">Score: ${score}%</span>` : ''}
      </div>
      <div style="font-size:13px;line-height:1.5;color:#334155;white-space:pre-wrap;margin-bottom:8px;">${escapeHtml(content)}</div>
      <div style="display:flex;gap:6px;justify-content:flex-end;">
        <button id="wf-copy-btn" style="padding:4px 10px;font-size:11px;border:1px solid #e2e8f0;border-radius:4px;background:#fff;color:#475569;cursor:pointer;">Copy</button>
        <button id="wf-replace-btn" style="padding:4px 10px;font-size:11px;border:1px solid #f97316;border-radius:4px;background:#f97316;color:#fff;cursor:pointer;">Replace</button>
        <button id="wf-close-btn" style="padding:4px 10px;font-size:11px;border:1px solid #e2e8f0;border-radius:4px;background:#fff;color:#475569;cursor:pointer;">Close</button>
      </div>
    `;
    document.getElementById('wf-copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(content).then(() => {
        document.getElementById('wf-copy-btn').textContent = 'Copied';
      });
    });
    document.getElementById('wf-replace-btn').addEventListener('click', () => {
      replaceSelection(content);
    });
    document.getElementById('wf-close-btn').addEventListener('click', removeFloatingUI);
  }
  // No auto-close - user manually clicks Close
}

function replaceSelection(text) {
  try {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
      activeEl.focus();
      document.execCommand('insertText', false, text);
    } else {
      // Try to find a selection and replace it
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        sel.removeAllRanges();
      }
    }
    document.getElementById('wf-replace-btn').textContent = 'Replaced';
    setTimeout(() => {
      const btn = document.getElementById('wf-replace-btn');
      if (btn) btn.textContent = 'Replace';
    }, 2000);
  } catch (e) {
    // Fallback: copy to clipboard
    navigator.clipboard.writeText(text);
    const btn = document.getElementById('wf-replace-btn');
    if (btn) btn.textContent = 'Copied (replace failed)';
  }
}

function removeFloatingUI() {
  if (floatingEl) { floatingEl.remove(); floatingEl = null; }
}

function showNotification(message) {
  const el = document.createElement('div');
  el.style.cssText = `
    position: fixed; top: 20px; right: 20px; z-index: 999999; background: #fef3c7;
    border: 1px solid #f59e0b; border-radius: 8px; padding: 10px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px; color: #92400e; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 320px;
  `;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
