/**
 * GreenHarvest Pay — Customer Checkout Widget
 * Seamlessly integrates GreenHarvest Pay into the checkout flow.
 *
 * FEATURES:
 *  - Dynamic base path detection (works in localhost subdirectory or root domain)
 *  - Secure public settings query (never exposes private API keys)
 *  - Idempotent payment attempts linked to real customer orders
 *  - Clear Sandbox testing mode with 4 simulation states (paid, failed, pending, cancelled)
 *  - Authorized live payment provider support (Razorpay / Cashfree) with HMAC verification
 *  - Direct UPI QR verification with customer UTR submission
 *  - Responsive mobile, tablet, laptop, and desktop UI
 */

'use strict';

const GHPay = (function () {

  // ── Dynamic API URL & Base Path Resolution ─────────────────────────────────
  const API_URL = (function () {
    // 1. Check document.currentScript (standard modern browsers)
    if (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) {
      try {
        return new URL('../api.php', document.currentScript.src).href;
      } catch (e) {}
    }
    // 2. Scan script tags for pay-checkout.js
    if (typeof document !== 'undefined') {
      const scripts = document.getElementsByTagName('script');
      for (let i = 0; i < scripts.length; i++) {
        const src = scripts[i].src || scripts[i].getAttribute('src') || '';
        if (src.indexOf('pay/assets/pay-checkout.js') !== -1) {
          try {
            return new URL('../api.php', scripts[i].src).href;
          } catch (e) {}
        }
      }
    }
    // 3. Fallback relative to origin / pathname
    try {
      const origin = window.location.origin;
      const path = window.location.pathname.replace(/\/[^\/]*$/, '');
      return origin + (path ? path : '') + '/pay/api.php';
    } catch (e) {
      return 'pay/api.php';
    }
  })();

  const BASE_URL = (function () {
    try {
      return API_URL.replace(/\/pay\/api\.php.*$/, '');
    } catch (e) {
      return '';
    }
  })();
  const BASE_PATH = BASE_URL;

  let _csrfToken = null;
  let _cachedSettings = null;

  function _timeoutSignal(ms = 45000) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms);
    }
    const ctrl = new AbortController();
    setTimeout(() => {
      try { ctrl.abort(); } catch (e) {}
    }, ms);
    return ctrl.signal;
  }

  // ── Fetch CSRF token once per session ──────────────────────────────────────

  async function ensureCsrf() {
    if (_csrfToken) return _csrfToken;
    try {
      const r = await fetch(API_URL + '?action=get_csrf_token', {
        credentials: 'same-origin',
        signal: _timeoutSignal(30000)
      });
      if (r.ok) {
        const d = await r.json();
        _csrfToken = d.csrf_token || '';
      }
    } catch (e) {
      console.warn('[GHPay] get_csrf_token error:', e);
      _csrfToken = '';
    }
    return _csrfToken;
  }

  // ── API helpers ────────────────────────────────────────────────────────────

  async function payPost(action, data = {}) {
    let csrf = '';
    try {
      csrf = await ensureCsrf();
    } catch (e) {
      console.warn('[GHPay] ensureCsrf notice:', e);
    }

    const form = new FormData();
    form.append('action', action);
    if (csrf) form.append('_csrf', csrf);
    for (const [k, v] of Object.entries(data)) form.append(k, v);

    try {
      const r = await fetch(API_URL, {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
        signal: _timeoutSignal(45000)
      });

      const text = await r.text();
      let d = null;
      try {
        d = JSON.parse(text);
      } catch (jsonErr) {
        // Robust JSON extraction: if PHP emitted notices, warnings, or HTML before/after the JSON
        const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (match) {
          try {
            d = JSON.parse(match[0]);
          } catch (e) {}
        }
      }

      if (!d) {
        console.error('[GHPay] Non-JSON response for action:', action, 'status:', r.status, text.slice(0, 300));
        const stripped = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return {
          success: false,
          error: (stripped.length > 5 && stripped.length < 150)
            ? stripped
            : (r.ok ? 'Server returned an invalid response. Please try again.' : `Server returned HTTP ${r.status}. Please try again.`)
        };
      }

      if (!r.ok && (!d || !d.error)) {
        return { success: false, error: `Request failed with HTTP status ${r.status}.` };
      }

      return d;
    } catch (e) {
      console.error('[GHPay] payPost error for action:', action, e);
      if (e.name === 'AbortError') {
        return { success: false, error: 'Request timed out. Please check your connection and retry.' };
      }
      return { success: false, error: 'Network error. Please check your connection.' };
    }
  }

  async function payGet(action, params = {}) {
    const url = API_URL + '?' + new URLSearchParams({ action, ...params }).toString();
    try {
      const r = await fetch(url, {
        credentials: 'same-origin',
        signal: _timeoutSignal(30000)
      });
      const text = await r.text();
      try {
        return JSON.parse(text);
      } catch (jsonErr) {
        const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (match) {
          try { return JSON.parse(match[0]); } catch (e) {}
        }
        console.error('[GHPay] Non-JSON GET response for action:', action, 'status:', r.status, text.slice(0, 300));
        return { success: false, error: `Server HTTP ${r.status}` };
      }
    } catch (e) {
      console.error('[GHPay] payGet error for action:', action, e);
      return { success: false, error: 'Network error.' };
    }
  }

  // ── Generate idempotency key ───────────────────────────────────────────────

  function genIdempotencyKey(orderId) {
    const stored = sessionStorage.getItem('ghpay_ikey_' + orderId);
    if (stored) return stored;
    const key = 'GHI-' + orderId + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('ghpay_ikey_' + orderId, key);
    return key;
  }

  // ── Load pay settings (Public safe endpoint) ───────────────────────────────

  async function loadPaySettings(force = false) {
    if (_cachedSettings && !force) return _cachedSettings;
    try {
      const r = await fetch(API_URL + '?action=get_public_settings', {
        credentials: 'same-origin',
        signal: _timeoutSignal(30000)
      });
      if (r.ok) {
        const d = await r.json();
        if (d && d.success) {
          _cachedSettings = d;
          if (d.csrf_token) _csrfToken = d.csrf_token;
          return d;
        }
      }
    } catch (e) {
      console.warn('[GHPay] loadPaySettings notice:', e);
    }
    _cachedSettings = {
      success: true,
      enabled: true,
      mode: 'sandbox',
      is_sandbox: true,
      enabled_methods: 'qr_upi,cod,sandbox',
      live_provider: 'none',
      has_live_keys: false,
      upi_id: ''
    };
    return _cachedSettings;
  }

  // ── Map payment_method to GHPay method ─────────────────────────────────────

  function mapMethod(method, isSandbox, settings) {
    const m = (method || '').toLowerCase().trim();
    if (m === 'cashfree' || m === 'cf') {
      return 'cashfree';
    }
    if (m === 'razorpay' || m === 'rzp') {
      return 'razorpay';
    }
    if (m === 'card' || m === 'live_card') {
      return (settings && settings.live_provider === 'cashfree') ? 'cashfree' : 'razorpay';
    }
    if (m === 'greenharvestpay' || m === 'greenharvest' || m === 'ghpay') {
      if (settings && (settings.live_provider === 'cashfree' || settings.has_cashfree_keys)) {
        return 'cashfree';
      }
      if (settings && (settings.has_razorpay_keys || settings.has_live_keys || (settings.live_key_id && settings.live_key_id.startsWith('rzp_')))) {
        return 'razorpay';
      }
      return isSandbox ? 'sandbox' : 'qr_upi';
    }
    switch (m) {
      case 'scanpay':
      case 'gpay':
      case 'upi':
      case 'scan & pay':
        return 'qr_upi';
      case 'cod':
      case 'cash on delivery':
        return 'cod';
      case 'sandbox':
        return 'sandbox';
      default:
        if (settings && (settings.has_razorpay_keys || settings.has_live_keys || (settings.live_key_id && settings.live_key_id.startsWith('rzp_')))) {
          return 'razorpay';
        }
        return isSandbox ? 'sandbox' : 'qr_upi';
    }
  }

  // ── Main entry: open GreenHarvest Pay for an order ─────────────────────────

  async function openForOrder(orderId, orderNumber, totalAmount, paymentMethod) {
    const settings = await loadPaySettings();

    // Check if gateway is disabled
    if (settings.enabled === false) {
      _showDisabledState();
      return;
    }

    const isSandbox = (settings.mode || 'sandbox') === 'sandbox';
    let ghMethod = mapMethod(paymentMethod, isSandbox, settings);

    renderCheckoutSheet(orderId, orderNumber, totalAmount, ghMethod, settings, isSandbox);
  }

  // ── Render the GHPay checkout sheet inside the modal ───────────────────────

  function renderCheckoutSheet(orderId, orderNumber, amount, initialMethod, settings, isSandbox) {
    const upiId    = settings.upi_id || '';
    const qrPath   = settings.qr_image_path || '';
    const modeTag  = isSandbox
      ? '<span class="ghpay-mode-tag ghpay-mode-sandbox">🧪 Sandbox (Test Mode)</span>'
      : '<span class="ghpay-mode-tag ghpay-mode-live">🔒 256-Bit Secure Live</span>';

    // Build QR image URL
    let qrImgSrc = '';
    if (qrPath) {
      qrImgSrc = (qrPath.startsWith('http') || qrPath.startsWith('data:'))
        ? qrPath
        : ((BASE_PATH ? BASE_PATH : '') + '/' + qrPath.replace(/^\//, ''));
    } else if (upiId) {
      qrImgSrc = `https://api.qrserver.com/v1/create-qr-code/?size=175x175&data=upi://pay?pa=${encodeURIComponent(upiId)}%26pn=GreenHarvest%26am=${parseFloat(amount).toFixed(2)}%26cu=INR`;
    }

    const enabledMethods = (settings.enabled_methods || 'qr_upi,cod,sandbox').split(',').map(m => m.trim());
    const methodsHtml = buildMethodsHtml(enabledMethods, initialMethod, isSandbox, settings);

    const html = `
      <div class="ghpay-checkout-wrap" id="ghpayWrap">
        <div class="ghpay-header">
          <div class="ghpay-logo-icon">🌿</div>
          <div class="ghpay-brand">
            <div class="ghpay-brand-name">GreenHarvest Pay</div>
            <div class="ghpay-brand-sub">Order ${escSafe(orderNumber)}</div>
          </div>
          ${modeTag}
        </div>

        <div class="ghpay-amount-box">
          <div>
            <div class="ghpay-amount-label">Final Payable Amount</div>
            <div style="font-size:12px;color:#64748b;margin-top:2px;">Fresh Vegetables Order ${escSafe(orderNumber)}</div>
          </div>
          <div class="ghpay-amount-value">₹${parseFloat(amount).toFixed(2)}</div>
        </div>

        <div id="ghpayMethodsWrap">
          <div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Select Payment Option</div>
          <div class="ghpay-methods" id="ghpayMethods">
            ${methodsHtml}
          </div>
        </div>

        <!-- Dynamic payment content area -->
        <div id="ghpayContent"></div>

        <div id="ghpayActionWrap" style="margin-top:14px;">
          <button class="ghpay-pay-btn" id="ghpayPayBtn" onclick="GHPay._submit()">
            🌿 Confirm &amp; Pay ₹${parseFloat(amount).toFixed(2)}
          </button>
          <div class="ghpay-secure-note" style="margin-top:8px;text-align:center;font-size:11.5px;color:#64748b;">
            🔒 Verified by GreenHarvest Pay · Server-Side Verification
          </div>
        </div>
      </div>
    `;

    // Show in existing modal
    const modalBody = document.getElementById('modalBody');
    const modalCard = document.getElementById('modalCard');
    const modalOverlay = document.getElementById('modalOverlay');
    if (modalBody) {
      modalBody.innerHTML = html;
      if (modalCard) modalCard.style.maxWidth = '520px';
      if (modalOverlay) modalOverlay.classList.add('show');
    }

    // Store state
    window._ghpayState = {
      orderId,
      orderNumber,
      amount,
      isSandbox,
      currentMethod: initialMethod,
      upiId,
      qrImgSrc,
      enabledMethods,
      liveProvider: settings.live_provider || 'none',
      hasLiveKeys: !!settings.has_live_keys
    };

    // Render initial content
    _renderMethodContent(initialMethod, upiId, qrImgSrc, amount, isSandbox, settings);

    // Wire method selector radio buttons
    document.querySelectorAll('input[name="ghpayMethod"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const m = radio.value;
        window._ghpayState.currentMethod = m;
        document.querySelectorAll('.ghpay-method-opt').forEach(o => o.classList.remove('selected'));
        const opt = radio.closest('.ghpay-method-opt');
        if (opt) opt.classList.add('selected');
        _renderMethodContent(m, upiId, qrImgSrc, amount, isSandbox, settings);
      });
    });
  }

  function buildMethodsHtml(enabledMethods, initialMethod, isSandbox, settings) {
    const methodDefs = [];
    const isRzpReady = !!(
      settings?.has_razorpay_keys ||
      (settings?.live_key_id && settings.live_key_id.startsWith('rzp_')) ||
      (settings?.live_provider === 'razorpay')
    );
    const isCfReady = !!(
      settings?.has_cashfree_keys ||
      settings?.has_live_keys ||
      (settings?.live_provider === 'cashfree')
    );
    const isTestMode = !!(
      settings?.is_test_key ||
      (settings?.live_key_id && settings.live_key_id.startsWith('rzp_test_'))
    );

    if (isCfReady) {
      methodDefs.push({
        key: 'cashfree',
        icon: '⚡',
        label: isTestMode ? 'Cashfree (Sandbox Test Mode)' : 'Cashfree Secure Checkout',
        sub: isTestMode ? 'UPI, Credit/Debit Cards, Netbanking (Cashfree Sandbox)' : 'Pay securely via UPI, Cards & Netbanking'
      });
    }

    if (isRzpReady && !isCfReady) {
      methodDefs.push({
        key: 'razorpay',
        icon: '💳',
        label: isTestMode ? 'Razorpay (Test Mode)' : 'Razorpay Secure Checkout',
        sub: isTestMode ? 'UPI, Credit/Debit Cards, Netbanking (Test Mode)' : 'Pay securely via UPI, Cards & Netbanking'
      });
    }

    methodDefs.push({
      key: 'qr_upi',
      icon: '📱',
      label: 'Scan & Pay (UPI QR)',
      sub: 'Scan QR with GPay / PhonePe / Paytm / Any UPI app'
    });

    if (isSandbox) {
      methodDefs.push({
        key: 'sandbox',
        icon: '🧪',
        label: 'Sandbox Simulator',
        sub: 'Simulate instant test payment (Success, Failed, Pending, Cancel)'
      });
    }

    methodDefs.push({
      key: 'cod',
      icon: '💵',
      label: 'Cash on Delivery',
      sub: 'Pay with cash upon arrival at your door'
    });

    // Pick matching or fallback
    let matched = false;
    const items = methodDefs.map(m => {
      const isSel = (m.key === initialMethod || (initialMethod === 'live_upi' && m.key === 'razorpay'));
      if (isSel) matched = true;
      return `
        <label class="ghpay-method-opt ${isSel ? 'selected' : ''}">
          <input type="radio" name="ghpayMethod" value="${m.key}" ${isSel ? 'checked' : ''}>
          <div class="ghpay-method-icon">${m.icon}</div>
          <div style="flex:1;">
            <div class="ghpay-method-label">${m.label}</div>
            <div class="ghpay-method-sub">${m.sub}</div>
          </div>
        </label>
      `;
    });

    // If none matched, check first by default
    if (!matched && methodDefs.length > 0) {
      initialMethod = methodDefs[0].key;
      return buildMethodsHtml(enabledMethods, initialMethod, isSandbox, settings);
    }

    return items.join('');
  }

  function _renderMethodContent(method, upiId, qrImgSrc, amount, isSandbox, settings) {
    const container = document.getElementById('ghpayContent');
    const payBtn    = document.getElementById('ghpayPayBtn');
    if (!container) return;

    switch (method) {
      case 'sandbox':
        container.innerHTML = `
          <div class="ghpay-sandbox-panel" style="background:#eff6ff;border:1.5px solid #93c5fd;border-radius:12px;padding:14px;margin-top:10px;">
            <div class="ghpay-sandbox-title" style="font-weight:800;color:#1e40af;font-size:13.5px;margin-bottom:4px;">
              🧪 GreenHarvest Pay — Sandbox Simulator
            </div>
            <p style="font-size:12px;color:#3b82f6;margin:0 0 12px 0;">
              This test order uses no real money. Click a simulation outcome below to verify server-side state transitions:
            </p>
            <div class="ghpay-sandbox-buttons" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <button type="button" class="ghpay-sim-btn ghpay-sim-success" style="background:#10b981;color:#fff;border:none;padding:10px;border-radius:8px;font-weight:700;cursor:pointer;" onclick="GHPay._sandboxSimulate('paid')">
                ✅ Simulate Success
              </button>
              <button type="button" class="ghpay-sim-btn ghpay-sim-fail" style="background:#ef4444;color:#fff;border:none;padding:10px;border-radius:8px;font-weight:700;cursor:pointer;" onclick="GHPay._sandboxSimulate('failed')">
                ❌ Simulate Failed
              </button>
              <button type="button" class="ghpay-sim-btn ghpay-sim-pending" style="background:#f59e0b;color:#fff;border:none;padding:10px;border-radius:8px;font-weight:700;cursor:pointer;" onclick="GHPay._sandboxSimulate('pending')">
                ⏳ Simulate Pending
              </button>
              <button type="button" class="ghpay-sim-btn ghpay-sim-cancel" style="background:#64748b;color:#fff;border:none;padding:10px;border-radius:8px;font-weight:700;cursor:pointer;" onclick="GHPay._sandboxSimulate('cancelled')">
                🚫 Cancel Payment
              </button>
            </div>
          </div>
        `;
        if (payBtn) payBtn.style.display = 'none';
        break;

      case 'qr_upi':
        container.innerHTML = `
          <div class="ghpay-qr-section" style="background:#fafafa;border:1px solid #e2e8f0;border-radius:12px;padding:16px;text-align:center;margin-top:10px;">
            <h4 style="margin:0 0 4px 0;color:#0f172a;font-size:14px;">📷 Official GreenHarvest UPI QR</h4>
            <p style="font-size:12px;color:#64748b;margin:0 0 12px 0;">Scan with GPay, PhonePe, Paytm, or any UPI app</p>
            ${qrImgSrc
              ? `<img class="ghpay-qr-img" src="${escSafe(qrImgSrc)}" alt="UPI QR Code" style="max-width:240px;max-height:240px;width:auto;height:auto;border-radius:10px;border:1px solid #cbd5e1;padding:6px;background:#fff;margin:0 auto 10px auto;display:block;object-fit:contain;">`
              : `<div style="padding:20px;color:#64748b;font-size:12px;border:1px dashed #cbd5e1;border-radius:8px;margin-bottom:10px;">Official QR Code active for: <strong>${escSafe(upiId || 'GreenHarvest UPI')}</strong></div>`
            }
            ${upiId ? `<div class="ghpay-upi-id" style="font-weight:800;color:#047857;font-size:13.5px;margin-bottom:4px;">${escSafe(upiId)}</div>` : ''}
            <div class="ghpay-upi-amount" style="font-size:13px;color:#475569;margin-bottom:12px;">Amount to transfer: <strong>₹${parseFloat(amount).toFixed(2)}</strong></div>

            <div class="ghpay-utr-input-wrap" style="text-align:left;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-top:8px;">
              <label style="display:block;font-size:12px;font-weight:700;color:#334155;margin-bottom:4px;">
                UPI Transaction / Reference ID (UTR) <span style="color:#ef4444">*</span>
              </label>
              <input class="ghpay-utr-input" id="ghpayUtrInput" placeholder="e.g. 417123456789 (12-digit UTR)" autocomplete="off" style="width:100%;padding:9px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;box-sizing:border-box;">
              <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Enter the transaction reference from your UPI app after completing transfer.</div>
            </div>
          </div>
        `;
        if (payBtn) {
          payBtn.style.display = 'block';
          payBtn.innerHTML = `📱 Submit Payment Details`;
          payBtn.disabled = false;
        }
        break;

      case 'cod':
        container.innerHTML = `
          <div class="ghpay-cod-note" style="background:#fefce8;border:1.5px solid #fef08a;border-radius:12px;padding:14px;color:#854d0e;font-size:13px;line-height:1.5;margin-top:10px;">
            💵 <strong>Cash on Delivery Confirmed.</strong><br>
            Please keep <strong>₹${parseFloat(amount).toFixed(2)}</strong> ready in cash when our delivery rider arrives with your fresh vegetables.
          </div>
        `;
        if (payBtn) {
          payBtn.style.display = 'block';
          payBtn.innerHTML = `✅ Confirm Cash on Delivery`;
          payBtn.disabled = false;
        }
        break;

      case 'cashfree':
      case 'razorpay':
      case 'live_upi':
      case 'live_card':
      case 'live_netbanking':
        const prov = (settings.live_provider || 'razorpay').toLowerCase();
        const provLabel = prov === 'cashfree' ? 'Cashfree' : 'Razorpay';
        const isRzp = (prov === 'razorpay') || (settings.live_key_id && settings.live_key_id.startsWith('rzp_')) || settings.has_razorpay_keys;
        const isTestMode = !!(settings.is_test_key || (settings.live_key_id && settings.live_key_id.startsWith('rzp_test_')));
        const isProviderReady = !!(
          settings.has_live_keys ||
          settings.has_razorpay_keys ||
          (settings.live_key_id && settings.live_key_id.startsWith('rzp_')) ||
          (prov === 'cashfree' ? settings.has_cashfree_keys : settings.has_razorpay_keys)
        );

        if (isProviderReady) {
          const bannerTitle = (prov === 'cashfree')
            ? (isTestMode ? '🧪 Cashfree (Sandbox Test Mode)' : '⚡ Cashfree Secure Checkout')
            : (isRzp
                ? (isTestMode ? '🧪 Razorpay (Test Mode)' : '💳 Razorpay Standard Checkout')
                : `⚡ Instant Gateway Ready (${provLabel})`);
          const bannerDesc = (prov === 'cashfree')
            ? (isTestMode
                ? 'Cashfree Sandbox Mode is active. Complete test payments using UPI, Cards, or Netbanking.'
                : 'Click below to pay securely via Cashfree checkout (UPI, Cards, Netbanking).')
            : (isRzp
                ? (isTestMode
                    ? 'Razorpay Test Mode is active. You can complete test payments using test UPI IDs, Cards, or Netbanking without real money.'
                    : 'Click below to pay securely via Razorpay standard checkout (UPI, Cards, Netbanking).')
                : `Click below to pay securely via ${provLabel} checkout (UPI, Cards, Netbanking).`);
          const btnText = (prov === 'cashfree')
            ? `⚡ Pay ₹${parseFloat(amount).toFixed(2)} with Cashfree`
            : (isRzp
                ? `💳 Pay ₹${parseFloat(amount).toFixed(2)} with Razorpay` + (isTestMode ? ' (Test Mode)' : '')
                : `💳 Pay ₹${parseFloat(amount).toFixed(2)} Securely`);

          container.innerHTML = `
            <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:14px;font-size:13px;color:#166534;margin-top:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <strong>${bannerTitle}</strong>
                ${isTestMode ? '<span style="background:#dbeafe;color:#1e40af;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:4px;border:1px solid #93c5fd;">TEST MODE</span>' : '<span style="background:#dcfce7;color:#15803d;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:4px;border:1px solid #86efac;">SECURE</span>'}
              </div>
              <div style="font-size:12px;color:#15803d;line-height:1.4;">${bannerDesc}</div>
            </div>
          `;
          if (payBtn) {
            payBtn.style.display = 'block';
            payBtn.innerHTML = btnText;
            payBtn.disabled = false;
          }
        } else {
          container.innerHTML = `
            <div style="background:#fef9c3;border:1px solid #fde047;border-radius:12px;padding:14px;font-size:13px;color:#713f12;line-height:1.6;margin-top:10px;">
              ⚡ <strong>Payment Gateway Notice (${provLabel}):</strong><br>
              The store administrator has not yet configured production credentials for ${provLabel}.<br>
              <div style="margin-top:6px;font-size:12px;">
                💡 <em>Tip: Switch to <strong>Scan &amp; Pay (UPI QR)</strong> or <strong>Cash on Delivery</strong> above to complete your fresh vegetable order immediately.</em>
              </div>
            </div>
          `;
          if (payBtn) payBtn.style.display = 'none';
        }
        break;

      default:
        container.innerHTML = '';
        if (payBtn) payBtn.style.display = 'block';
    }
  }

  // ── Submit payment ────────────────────────────────────────────────────────

  async function _submit() {
    const s = window._ghpayState;
    if (!s) return;

    const btn = document.getElementById('ghpayPayBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }

    const idempotencyKey = genIdempotencyKey(s.orderId);

    // Step 1: Initiate payment attempt (server-side, validates server amount)
    const initiateRes = await payPost('initiate_payment', {
      order_id:        s.orderId,
      method:          s.currentMethod,
      idempotency_key: idempotencyKey
    });

    if (!initiateRes.success) {
      _showError(initiateRes.error || 'Payment initiation failed.');
      if (btn) { btn.disabled = false; btn.textContent = `Confirm & Pay ₹${parseFloat(s.amount).toFixed(2)}`; }
      return;
    }

    const paymentRef = initiateRes.payment_ref;
    const attemptId  = initiateRes.attempt_id;
    window._ghpayState.paymentRef = paymentRef;
    window._ghpayState.attemptId  = attemptId;

    // Step 2: Handle by method
    switch (s.currentMethod) {
      case 'qr_upi': {
        const utr = document.getElementById('ghpayUtrInput')?.value?.trim() || '';
        if (!utr || utr.length < 6) {
          _showError('Please enter your 12-digit UTR / Transaction Reference ID (min 6 characters).');
          if (btn) { btn.disabled = false; btn.textContent = '📱 Submit Payment Details'; }
          return;
        }

        const subRes = await payPost('submit_qr_payment', {
          payment_ref: paymentRef,
          utr_reference: utr
        });

        if (subRes.success) {
          _showPending(paymentRef, 'Your UPI payment reference was submitted and is pending verification.');
        } else {
          _showError(subRes.error || 'Submission failed. Please try again.');
          if (btn) { btn.disabled = false; btn.textContent = '📱 Submit Payment Details'; }
        }
        break;
      }

      case 'cod':
        _showSuccess(paymentRef, 'Cash on Delivery confirmed! Please keep ₹' + parseFloat(s.amount).toFixed(2) + ' ready upon delivery.');
        break;

      case 'razorpay':
      case 'live_upi':
      case 'live_card':
      case 'live_netbanking':
        if (initiateRes.provider === 'cashfree' || initiateRes.payment_session_id) {
          _openCashfree(initiateRes, s, paymentRef);
        } else if (initiateRes.provider === 'razorpay' || initiateRes.key_id) {
          const rzpKey = initiateRes.key_id || _cachedSettings?.live_key_id;
          if (rzpKey) initiateRes.key_id = rzpKey;
          _openRazorpay(initiateRes, s, paymentRef);
        } else {
          _showError('Live payment provider credentials are not configured. Please choose UPI QR or COD.');
          if (btn) { btn.disabled = false; btn.textContent = 'Try Another Method'; }
        }
        break;

      default:
        _showError('Unsupported payment method.');
        if (btn) { btn.disabled = false; btn.textContent = 'Pay'; }
    }
  }

  // ── Sandbox simulation ────────────────────────────────────────────────────

  async function _sandboxSimulate(outcome) {
    const s = window._ghpayState;
    if (!s) return;

    // Visual feedback: briefly disable simulation buttons during request
    const simBtns = document.querySelectorAll('.ghpay-sim-btn');
    simBtns.forEach(btn => {
      btn.disabled = true;
      btn.style.opacity = '0.6';
      btn.style.pointerEvents = 'none';
    });

    const resetBtns = () => {
      simBtns.forEach(btn => {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
      });
    };

    // Remove any previous error banner
    const prevErr = document.getElementById('ghpayError');
    if (prevErr) prevErr.remove();

    // Initiate attempt first if not yet initiated
    if (!s.paymentRef) {
      const idempotencyKey = genIdempotencyKey(s.orderId);
      const r = await payPost('initiate_payment', {
        order_id: s.orderId,
        method: 'sandbox',
        idempotency_key: idempotencyKey
      });
      if (!r || !r.success) {
        resetBtns();
        _showError(r?.error || 'Failed to initiate sandbox payment.');
        return;
      }
      s.paymentRef = r.payment_ref;
      s.attemptId  = r.attempt_id;
      window._ghpayState = s;
    }

    const res = await payPost('sandbox_simulate', {
      payment_ref: s.paymentRef,
      outcome
    });

    if (!res || !res.success) {
      resetBtns();
      _showError(res?.error || 'Failed to simulate payment outcome.');
      return;
    }

    if (outcome === 'paid') {
      _showSuccess(s.paymentRef, 'Payment verified successfully via GreenHarvest Pay Sandbox!');
    } else if (outcome === 'failed') {
      _showStatus('❌', 'Payment Failed', 'The simulated payment failed. You can retry anytime.', s.paymentRef, '#ef4444', true);
    } else if (outcome === 'pending') {
      _showPending(s.paymentRef, 'Simulated as PENDING. Store manager can review and confirm.');
    } else {
      _showStatus('🚫', 'Payment Cancelled', 'Payment attempt was cancelled.', s.paymentRef, '#64748b', true);
    }
  }

  // ── Razorpay live checkout ────────────────────────────────────────────────

  async function _ensureRazorpay() {
    if (typeof window !== 'undefined' && window.Razorpay) return true;
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }

  async function _openRazorpay(providerData, state, paymentRef) {
    if (!window.Razorpay) {
      const ok = await _ensureRazorpay();
      if (!ok || !window.Razorpay) {
        _showError('Razorpay checkout SDK could not be loaded. Please check your internet connection and try again.');
        return;
      }
    }

    const options = {
      key:         providerData.key_id,
      amount:      providerData.amount_paise,
      currency:    providerData.currency || 'INR',
      name:        'GreenHarvest',
      description: 'Vegetable Order ' + state.orderNumber,
      order_id:    providerData.provider_order_id,
      notes:       { payment_ref: paymentRef },
      handler: async function (response) {
        const verifyRes = await payPost('initiate_payment_live_callback', {
          payment_ref:         paymentRef,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_order_id:   response.razorpay_order_id,
          razorpay_signature:  response.razorpay_signature
        });

        if (verifyRes.success && verifyRes.verified_status === 'paid') {
          _showSuccess(paymentRef, 'Payment verified and confirmed!');
        } else {
          _showPending(paymentRef, 'Payment received. Awaiting server confirmation.');
        }
      },
      modal: {
        ondismiss: function () {
          const btn = document.getElementById('ghpayPayBtn');
          if (btn) { btn.disabled = false; btn.textContent = 'Retry Payment'; }
        }
      },
      theme: { color: '#10b981' }
    };

    new window.Razorpay(options).open();
  }

  // ── Cashfree live checkout ────────────────────────────────────────────────

  async function _ensureCashfree() {
    if (typeof window !== 'undefined' && window.Cashfree) return true;
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }

  async function _openCashfree(providerData, state, paymentRef) {
    if (!window.Cashfree) {
      const ok = await _ensureCashfree();
      if (!ok || !window.Cashfree) {
        _showError('Cashfree checkout SDK could not be loaded. Please check your internet connection.');
        const btn = document.getElementById('ghpayPayBtn');
        if (btn) { btn.disabled = false; btn.textContent = 'Retry Payment'; }
        return;
      }
    }

    try {
      const isSandboxEnv = (providerData.cf_environment === 'sandbox' || state.isSandbox);
      const cashfree = window.Cashfree({
        mode: isSandboxEnv ? 'sandbox' : 'production'
      });

      const checkoutOptions = {
        paymentSessionId: providerData.payment_session_id,
        redirectTarget: '_modal'
      };

      cashfree.checkout(checkoutOptions).then(async function (result) {
        if (result.error) {
          console.warn('[GHPay] Cashfree checkout error:', result.error);
          _showError(result.error.message || 'Payment attempt was cancelled or failed.');
          const btn = document.getElementById('ghpayPayBtn');
          if (btn) { btn.disabled = false; btn.textContent = 'Retry Payment'; }
          return;
        }

        // Verify status server-side
        const orderId = providerData.provider_order_id;
        const verifyRes = await payPost('initiate_payment_live_callback', {
          payment_ref:       paymentRef,
          cashfree_order_id: orderId
        });

        if (verifyRes.success && verifyRes.verified_status === 'paid') {
          _showSuccess(paymentRef, 'Payment verified and confirmed via Cashfree!');
        } else {
          _showPending(paymentRef, 'Payment received. Awaiting server confirmation.');
        }
      });
    } catch (err) {
      console.error('[GHPay] Cashfree initialization exception:', err);
      _showError('Could not initialize Cashfree checkout. Please try again or use UPI QR.');
      const btn = document.getElementById('ghpayPayBtn');
      if (btn) { btn.disabled = false; btn.textContent = 'Retry Payment'; }
    }
  }

  // ── Status screens ────────────────────────────────────────────────────────

  function _showSuccess(paymentRef, message) {
    const container = document.getElementById('ghpayWrap');
    if (container) {
      container.innerHTML = `
        <div class="ghpay-status-wrap" style="text-align:center;padding:24px 12px;">
          <div class="ghpay-status-icon" style="font-size:48px;margin-bottom:12px;">✅</div>
          <div class="ghpay-status-title" style="color:#15803d;font-size:22px;font-weight:900;margin-bottom:6px;">Payment Confirmed!</div>
          <div class="ghpay-status-sub" style="font-size:13.5px;color:#475569;margin-bottom:14px;line-height:1.5;">${escSafe(message)}</div>
          <div class="ghpay-ref-box" style="background:#f1f5f9;border:1px dashed #cbd5e1;padding:8px 14px;border-radius:8px;font-family:monospace;font-size:13px;display:inline-block;margin-bottom:18px;color:#334155;">
            Ref: <strong>${escSafe(paymentRef)}</strong>
          </div>
          <br>
          <button class="ghpay-pay-btn" style="background:linear-gradient(135deg,#10b981,#059669);width:100%;max-width:320px;margin:0 auto;display:block;padding:12px 20px;color:#fff;border:none;border-radius:10px;font-weight:800;font-size:15px;cursor:pointer;" onclick="GHPay._closeAndRefresh()">
            📦 View My Orders &amp; Receipt
          </button>
        </div>
      `;
    }
    if (window.confetti) {
      try {
        window.confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 }, colors: ['#10b981', '#86efac', '#f59e0b'] });
      } catch (e) {}
    }
  }

  function _showPending(paymentRef, message) {
    const container = document.getElementById('ghpayWrap');
    if (container) {
      container.innerHTML = `
        <div class="ghpay-status-wrap" style="text-align:center;padding:24px 12px;">
          <div class="ghpay-status-icon" style="font-size:48px;margin-bottom:12px;">⏳</div>
          <div class="ghpay-status-title" style="color:#d97706;font-size:22px;font-weight:900;margin-bottom:6px;">Payment Awaiting Verification</div>
          <div class="ghpay-status-sub" style="font-size:13.5px;color:#475569;margin-bottom:14px;line-height:1.5;">${escSafe(message)}</div>
          <div class="ghpay-ref-box" style="background:#fef3c7;border:1px dashed #fcd34d;padding:8px 14px;border-radius:8px;font-family:monospace;font-size:13px;display:inline-block;margin-bottom:18px;color:#92400e;">
            Ref: <strong>${escSafe(paymentRef)}</strong>
          </div>
          <br>
          <button class="ghpay-pay-btn" style="background:linear-gradient(135deg,#f59e0b,#d97706);width:100%;max-width:320px;margin:0 auto;display:block;padding:12px 20px;color:#fff;border:none;border-radius:10px;font-weight:800;font-size:15px;cursor:pointer;" onclick="GHPay._closeAndRefresh()">
            📦 View My Orders
          </button>
        </div>
      `;
    }
  }

  function _showStatus(icon, title, message, paymentRef, color, allowRetry = false) {
    const container = document.getElementById('ghpayWrap');
    if (container) {
      container.innerHTML = `
        <div class="ghpay-status-wrap" style="text-align:center;padding:24px 12px;">
          <div class="ghpay-status-icon" style="font-size:48px;margin-bottom:12px;">${icon}</div>
          <div class="ghpay-status-title" style="color:${color};font-size:22px;font-weight:900;margin-bottom:6px;">${escSafe(title)}</div>
          <div class="ghpay-status-sub" style="font-size:13.5px;color:#475569;margin-bottom:14px;line-height:1.5;">${escSafe(message)}</div>
          ${paymentRef ? `<div class="ghpay-ref-box" style="background:#f1f5f9;border:1px dashed #cbd5e1;padding:8px 14px;border-radius:8px;font-family:monospace;font-size:13px;display:inline-block;margin-bottom:18px;color:#334155;">Ref: <strong>${escSafe(paymentRef)}</strong></div><br>` : ''}
          ${allowRetry ? `
            <button class="ghpay-pay-btn" style="background:#10b981;color:#fff;border:none;border-radius:10px;padding:11px 20px;font-weight:700;font-size:14px;cursor:pointer;margin-right:8px;" onclick="GHPay.openForOrder(${window._ghpayState.orderId}, '${window._ghpayState.orderNumber}', ${window._ghpayState.amount}, 'GreenHarvestPay')">
              🔄 Try Again
            </button>
          ` : ''}
          <button class="ghpay-pay-btn" style="background:#64748b;color:#fff;border:none;border-radius:10px;padding:11px 20px;font-weight:700;font-size:14px;cursor:pointer;" onclick="GHPay._closeAndRefresh()">
            Close
          </button>
        </div>
      `;
    }
  }

  function _showDisabledState() {
    const modalBody = document.getElementById('modalBody');
    const modalOverlay = document.getElementById('modalOverlay');
    if (modalBody) {
      modalBody.innerHTML = `
        <div style="text-align:center;padding:24px 12px;">
          <div style="font-size:42px;margin-bottom:12px;">🌿</div>
          <h3 style="margin-bottom:8px;color:#0f172a;">GreenHarvest Pay Unavailable</h3>
          <p style="font-size:13px;color:#64748b;margin-bottom:18px;">
            GreenHarvest Pay is currently undergoing routine maintenance. Please select UPI QR or Cash on Delivery to complete your order.
          </p>
          <button onclick="document.getElementById('modalOverlay').classList.remove('show')" style="background:#10b981;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-weight:700;cursor:pointer;">
            Return to Checkout
          </button>
        </div>
      `;
      if (modalOverlay) modalOverlay.classList.add('show');
    }
  }

  function _showError(message) {
    const existing = document.getElementById('ghpayError');
    if (existing) existing.remove();

    const errDiv = document.createElement('div');
    errDiv.id = 'ghpayError';
    errDiv.style.cssText = 'background:#fef2f2;border:1.5px solid #fca5a5;border-radius:10px;padding:11px 14px;color:#dc2626;font-size:13px;margin:10px 0;font-weight:700;line-height:1.4;box-shadow:0 2px 8px rgba(220,38,38,0.08);';
    errDiv.textContent = '⚠️ ' + message;

    const content = document.getElementById('ghpayContent');
    const payBtn = document.getElementById('ghpayPayBtn');
    if (content) {
      content.insertAdjacentElement('afterbegin', errDiv);
    } else if (payBtn) {
      payBtn.insertAdjacentElement('beforebegin', errDiv);
    } else {
      const wrap = document.getElementById('ghpayWrap');
      if (wrap) wrap.appendChild(errDiv);
    }
  }

  function _closeAndRefresh() {
    const overlay = document.getElementById('modalOverlay');
    if (overlay) overlay.classList.remove('show');
    if (window.App && typeof App.renderCustomerOrdersView === 'function') {
      App.renderCustomerOrdersView();
    }
  }

  function escSafe(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  // ── Inject checkout CSS dynamically ───────────────────────────────────────

  function injectCheckoutCss() {
    if (document.getElementById('ghpay-checkout-css')) return;
    const link = document.createElement('link');
    link.id   = 'ghpay-checkout-css';
    link.rel  = 'stylesheet';
    link.href = (BASE_PATH ? BASE_PATH : '') + '/pay/assets/pay-checkout.css';
    document.head.appendChild(link);
  }

  // ── Initialization ────────────────────────────────────────────────────────

  async function init() {
    injectCheckoutCss();
    await loadPaySettings();
  }

  // Auto-init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    init,
    loadPaySettings,
    openForOrder,
    _submit,
    _sandboxSimulate,
    _closeAndRefresh
  };

})();

// Export globally
window.GHPay = GHPay;
