// License Manager — Shared module for Gumroad license verification
// Version 1.0 — Works in Chrome extension popup/background context
// Requires chrome.storage.local (MV3 service worker compatible)

/**
 * USAGE:
 *   1. Set window.LICENSE_CONFIG before calling any method:
 *      window.LICENSE_CONFIG = { productName, productPermalink, trialLimit, accentColor, gumroadUrl };
 *   2. Call await LicenseManager.init() to load persisted state
 *   3. Call await LicenseManager.canUse() before any gated feature
 *   4. Call LicenseManager.showActivationDialog() when access is blocked
 */

const GUMROAD_VERIFY_URL = 'https://api.gumroad.com/v2/licenses/verify';
const REFUND_CHECK_DAYS = 7;

const STORAGE = {
  TRIAL_COUNT: 'lm_trial_count',
  LICENSE_KEY: 'lm_license_key',
  ACTIVATED:   'lm_activated',
  LAST_VERIFY: 'lm_last_verify',
  DEVICE_ID:   'lm_device_id'
};

const LicenseManager = (() => {
  let _config = null;
  let _status = null;  // { activated, used, limit, remaining }

  // ─── storage helpers (chrome.storage.local) ───
  async function _get(key) {
    const data = await chrome.storage.local.get(key);
    return data[key];
  }

  async function _set(obj) {
    await chrome.storage.local.set(obj);
  }

  async function _remove(keys) {
    await chrome.storage.local.remove(keys);
  }

  // ─── device fingerprint ───
  async function _deviceId() {
    let id = await _get(STORAGE.DEVICE_ID);
    if (!id) {
      const chars = 'abcdefghijklmnopqrstuvwxyz012345678'; // 36 chars
      const a = new Uint32Array(8);
      crypto.getRandomValues(a);
      id = Array.from(a).map(n => chars[n % chars.length]).join('');
      await _set({ [STORAGE.DEVICE_ID]: id });
    }
    return id;
  }

  // ─── public API ───
  return {
    /**
     * Initialize the license manager with product config.
     * Must be called once before any other method.
     */
    async init(config) {
      _config = config || window.LICENSE_CONFIG || {};
      if (!_config.productPermalink) {
        console.error('[LicenseManager] Missing productPermalink in config');
      }
      _status = {
        activated: await this.isActivated(),
        used:      await this.getTrialCount(),
        limit:     _config.trialLimit || 5,
        remaining: 0
      };
      _status.remaining = Math.max(0, _status.limit - _status.used);
      return _status;
    },

    /** Check whether the feature is accessible now */
    async canUse() {
      if (!_status) await this.init();
      if (_status.activated) return { allowed: true, reason: 'activated', ..._status };

      if (_status.used < _status.limit) {
        // Grant trial access and increment counter
        const n = await this.incrementTrial();
        _status.used = n;
        _status.remaining = Math.max(0, _status.limit - n);
        return { allowed: true, reason: 'trial', ..._status };
      }
      return { allowed: false, reason: 'trial_exhausted', ..._status };
    },

    async getTrialCount() {
      const c = await _get(STORAGE.TRIAL_COUNT);
      return c !== undefined ? parseInt(c, 10) : 0;
    },

    async incrementTrial() {
      const c = await this.getTrialCount();
      const n = c + 1;
      await _set({ [STORAGE.TRIAL_COUNT]: String(n) });
      return n;
    },

    async isActivated() {
      return (await _get(STORAGE.ACTIVATED)) === 'true';
    },

    /**
     * Verify a license key with Gumroad.
     * Returns { valid, email?, error? }
     */
    async verifyLicense(key) {
      if (!_config || !_config.productPermalink) {
        return { valid: false, error: 'License system not configured.' };
      }

      try {
        const body = `product_permalink=${encodeURIComponent(_config.productPermalink)}&license_key=${encodeURIComponent(key.trim())}`;
        const resp = await fetch(GUMROAD_VERIFY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body
        });

        const data = await resp.json();

        if (!data.success) {
          return { valid: false, error: 'Invalid license key. Please check and try again.' };
        }

        if (data.purchase && (data.purchase.refunded || data.purchase.disputed || data.purchase.chargebacked)) {
          return { valid: false, error: 'This license has been refunded or canceled.' };
        }

        // 🔴 Device limit: reject if already used on 3+ devices
        if (data.uses !== undefined && data.uses >= 3) {
          return { valid: false, error: 'This license has already been used on 3 devices. Please purchase an additional license.' };
        }

        // ✅ Increment uses to record this device
        try {
          await fetch(GUMROAD_VERIFY_URL.replace('/verify', '/increment_uses'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
          });
        } catch (e) { /* non-blocking */ }

        // Activate locally
        await _set({
          [STORAGE.LICENSE_KEY]:  key.trim(),
          [STORAGE.ACTIVATED]:    'true',
          [STORAGE.LAST_VERIFY]:  String(Date.now())
        });
        _status.activated = true;

        return { valid: true, email: data.purchase?.email };
      } catch (e) {
        return { valid: false, error: 'Network error. Please check your connection and try again.' };
      }
    },

    /** Periodic refund check (call once per session) */
    async checkRefund() {
      if (!(await this.isActivated())) return;

      const last = await _get(STORAGE.LAST_VERIFY);
      const now = Date.now();
      if (last && now - parseInt(last) < REFUND_CHECK_DAYS * 86400000) return;

      const key = await _get(STORAGE.LICENSE_KEY);
      if (!key) return;

      const result = await this.verifyLicense(key);
      if (!result.valid) {
        await this.revoke();
      }
    },

    /** Revoke activation */
    async revoke() {
      await _remove(Object.values(STORAGE));
      _status = { activated: false, used: 0, limit: _config.trialLimit || 5, remaining: _config.trialLimit || 5 };
    },

    getConfig() { return _config; },
    getStatus() { return _status; },

    // ─── Activation Dialog (English, dynamic HTML) ───
    /**
     * Show the activation overlay. Blocks interaction until activated.
     * Returns a Promise that resolves when the dialog is closed.
     */
    showActivationDialog() {
      return new Promise((resolve) => {
        const cfg = _config;
        const color = cfg.accentColor || '#7c3aed';

        // build overlay
        const overlay = document.createElement('div');
        overlay.id = 'lm-activation-overlay';
        overlay.innerHTML = `
<style>
#lm-activation-overlay {
  position: fixed; inset: 0; z-index: 99999;
  display: flex; justify-content: center; align-items: center;
  background: rgba(10,10,25,0.88);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  animation: lmFadeIn 0.25s ease;
}
@keyframes lmFadeIn { from { opacity: 0; } to { opacity: 1; } }
#lm-activation-overlay .lm-card {
  width: 360px; max-width: 92vw;
  background: #14142b; border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px; overflow: hidden;
  box-shadow: 0 24px 64px rgba(0,0,0,0.5);
}
#lm-activation-overlay .lm-header {
  background: linear-gradient(135deg, ${color}22, ${color}08);
  padding: 24px 24px 16px; text-align: center;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
#lm-activation-overlay .lm-icon {
  width: 48px; height: 48px; border-radius: 12px;
  background: linear-gradient(135deg, ${color}, ${color}cc);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 22px; margin-bottom: 12px;
}
#lm-activation-overlay .lm-title {
  font-size: 18px; font-weight: 700; color: #fff; margin-bottom: 4px;
}
#lm-activation-overlay .lm-subtitle {
  font-size: 13px; color: #888; line-height: 1.5;
}
#lm-activation-overlay .lm-body {
  padding: 20px 24px;
}
#lm-activation-overlay .lm-stat-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 0; font-size: 13px; color: #aaa;
}
#lm-activation-overlay .lm-stat-row span:last-child { color: #fff; font-weight: 600; }
#lm-activation-overlay .lm-divider {
  border: none; border-top: 1px solid rgba(255,255,255,0.04); margin: 4px 0;
}
#lm-activation-overlay .lm-input {
  width: 100%; padding: 10px 14px; margin-top: 14px;
  background: #1a1a32; border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px; color: #ddd; font-size: 13px;
  outline: none; transition: border-color 0.2s;
}
#lm-activation-overlay .lm-input:focus { border-color: ${color}aa; }
#lm-activation-overlay .lm-input::placeholder { color: #555; }
#lm-activation-overlay .lm-error {
  font-size: 12px; color: #ef4444; margin-top: 8px; display: none;
}
#lm-activation-overlay .lm-actions {
  padding: 0 24px 24px; display: flex; flex-direction: column; gap: 10px;
}
#lm-activation-overlay .lm-btn {
  width: 100%; padding: 12px; border-radius: 8px; font-size: 14px; font-weight: 600;
  border: none; cursor: pointer; transition: all 0.2s;
}
#lm-activation-overlay .lm-btn-primary {
  background: linear-gradient(135deg, ${color}, ${color}dd);
  color: #fff;
}
#lm-activation-overlay .lm-btn-primary:hover { filter: brightness(1.15); transform: translateY(-1px); }
#lm-activation-overlay .lm-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
#lm-activation-overlay .lm-btn-secondary {
  background: transparent; color: #888; border: 1px solid rgba(255,255,255,0.08);
}
#lm-activation-overlay .lm-btn-secondary:hover { color: #ccc; border-color: rgba(255,255,255,0.15); }
#lm-activation-overlay .lm-btn-outline {
  background: transparent; color: ${color}; border: 1px solid ${color}44;
}
#lm-activation-overlay .lm-btn-outline:hover { background: ${color}11; border-color: ${color}; }
#lm-activation-overlay .lm-footer {
  padding: 0 24px 20px; text-align: center;
  font-size: 11px; color: #555;
}
#lm-activation-overlay .lm-spinner {
  display: none; width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.2);
  border-top-color: #fff; border-radius: 50%; animation: lmSpin 0.6s linear infinite;
  margin-right: 8px; vertical-align: middle;
}
@keyframes lmSpin { to { transform: rotate(360deg); } }
</style>

<div class="lm-card">
  <div class="lm-header">
    <div class="lm-icon">🔑</div>
    <div class="lm-title">Activate ${cfg.productName || 'Extension'}</div>
    <div class="lm-subtitle">You've used all ${cfg.trialLimit || 5} free trials. Purchase a license to continue using this extension.</div>
  </div>
  <div class="lm-body">
    <div class="lm-stat-row"><span>Free trials used</span><span>${_status.used} / ${_status.limit}</span></div>
    <hr class="lm-divider">
    <div class="lm-stat-row"><span>License status</span><span style="color:#f59e0b">Not activated</span></div>
    <input class="lm-input" type="text" placeholder="Enter your license key" id="lm-key-input">
    <div class="lm-error" id="lm-error"></div>
  </div>
  <div class="lm-actions">
    <button class="lm-btn lm-btn-primary" id="lm-activate-btn">
      <span class="lm-spinner" id="lm-spinner"></span>Activate License
    </button>
    <button class="lm-btn lm-btn-outline" id="lm-buy-btn">Buy License →</button>
  </div>
  <div class="lm-footer">🔒 Protected by Gumroad License</div>
</div>
`;

        document.body.appendChild(overlay);

        // event bindings
        const keyInput  = overlay.querySelector('#lm-key-input');
        const activateBtn = overlay.querySelector('#lm-activate-btn');
        const buyBtn    = overlay.querySelector('#lm-buy-btn');
        const errorEl   = overlay.querySelector('#lm-error');
        const spinner   = overlay.querySelector('#lm-spinner');

        function showError(msg) {
          errorEl.textContent = msg;
          errorEl.style.display = 'block';
        }
        function hideError() {
          errorEl.style.display = 'none';
        }

        activateBtn.onclick = async () => {
          const key = keyInput.value.trim();
          if (!key) { showError('Please enter a license key.'); return; }

          activateBtn.disabled = true;
          spinner.style.display = 'inline-block';
          hideError();

          const result = await this.verifyLicense(key);

          if (result.valid) {
            overlay.remove();
            resolve(true);
          } else {
            showError(result.error);
            activateBtn.disabled = false;
            spinner.style.display = 'none';
          }
        };

        buyBtn.onclick = () => {
          chrome.tabs.create({ url: cfg.gumroadUrl || `https://${cfg.productPermalink ? cfg.productPermalink + '.' : ''}gumroad.com/l/${cfg.productPermalink}` });
        };

        keyInput.onkeydown = (e) => { if (e.key === 'Enter') activateBtn.click(); };
      });
    },

    /** Show the activation prompt inline (non-blocking, for popup footer style) */
    renderActivationFooter(container) {
      const cfg = _config;
      const color = cfg.accentColor || '#7c3aed';
      container.innerHTML = `
        <div style="padding:12px 16px;background:#16162a;border-top:1px solid rgba(255,255,255,0.04);font-size:12px;color:#888;text-align:center;line-height:1.6">
          <strong style="color:${color}">${_status.used}/${_status.limit}</strong> free trials used.
          <button id="lm-buy-footer" style="display:inline-block;color:${color};background:none;border:none;cursor:pointer;font-size:12px;text-decoration:underline;margin-left:4px">Buy License</button>
          or
          <button id="lm-activate-footer" style="display:inline-block;color:${color};background:none;border:none;cursor:pointer;font-size:12px;text-decoration:underline;margin-left:4px">Activate Key</button>
        </div>`;
      container.querySelector('#lm-buy-footer').onclick = () => {
        chrome.tabs.create({ url: cfg.gumroadUrl || '#' });
      };
      container.querySelector('#lm-activate-footer').onclick = async () => {
        await this.showActivationDialog();
        location.reload();
      };
    }
  };
})();

// Auto-init from global config if present
if (window.LICENSE_CONFIG) {
  LicenseManager.init(window.LICENSE_CONFIG);
}