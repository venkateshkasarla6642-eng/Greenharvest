/**
 * GreenHarvest Pay — Customer Checkout Widget
 * Loaded after app.js on the main index.php page.
 *
 * HOW IT INTEGRATES:
 *  - Hooks into the existing order confirmation flow.
 *  - After place_order succeeds, opens the GHPay payment sheet.
 *  - Calls /pay/api.php to initiate and track the payment attempt.
 *  - Updates the order confirmation modal with live payment status.
 *  - Never trusts client-calculated amounts — server provides them.
 */

'use strict';

const GHPay = (function () {

  const API_URL = '/pay/api.php';
  let _csrfToken = null;

  // ── Fetch CSRF token once per session ──────────────────────────────────────

  async function ensureCsrf() {
    if (_csrfToken) return _csrfToken;
    try {
      const r = await fetch(API_URL + '?action=get_csrf_token', { credentials: 'same-origin' });
      const d = await r.json();
      _csrfToken = d.csrf_token || '';
    } catch (e) {
      _csrfToken = '';
    }
    return _csrfToken;
  }

  // ── API helpers ────────────────────────────────────────────────────────────

  async function payPost(action, data = {}) {
    const csrf = await ensureCsrf();
    const form = new FormData();
    form.append('action', action);
    form.append('_csrf', csrf);
    for (const [k, v] of Object.entries(data)) form.append(k, v);

    try {
      const r = await fetch(API_URL, { method: 'POST', body: form, credentials: 'same-origin' });
      return await r.json();
    } catch (e) {
      return { error: 'Network error. Please check your connection.' };
    }
  }

  async function payGet(action, params = {}) {
    const url = API_URL + '?' + new URLSearchParams({ action, ...params }).toString();
    try {
      const r = await fetch(url, { credentials: 'same-origin' });
      return await r.json();
    } catch (e) {
      return { error: 'Network error.' };
    }
  }

  // ── Generate idempotency key ───────────────────────────────────────────────

  function genIdempotencyKey(orderId) {
    // Unique per order + session, prevents double-submit on retry
    const stored = sessionStorage.getItem('ghpay_ikey_' + orderId);
    if (stored) return stored;
    const key = 'GHI-' + orderId + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('ghpay_ikey_' + orderId, key);
    return key;
  }

  // ── Load pay settings (UPI ID, QR path, mode) ─────────────────────────────

  async function loadPaySettings() {
    try {
      const r = await fetch('/pay/api.php?action=owner_get_settings', { credentials: 'same-origin' });
      const d = await r.json();
      return d.settings || {};
    } catch (e) {
      return {};
    }
  }

  // ── Main entry: open GreenHarvest Pay for a confirmed order ───────────────

  async function openForOrder(orderId, orderNumber, totalAmount, paymentMethod) {
    // Determine GHPay method from existing checkout selection
    let ghMethod = mapMethod(paymentMethod);

    // Fetch settings to check enabled methods, mode, QR info
    const settings = await loadPaySettings();
    const isSandbox = (settings.mode || 'sandbox') === 'sandbox';

    // Render GHPay sheet in the existing modal
    renderCheckoutSheet(orderId, orderNumber, totalAmount, ghMethod, settings, isSandbox);
  }

  // ── Map existing payment_method to GHPay method ────────────────────────────

  function mapMethod(method) {
    switch ((method || '').toLowerCase()) {
      case 'scanpay':
      case 'gpay':
      case 'upi':
      case 'scan & pay':
        return 'qr_upi';
      case 'cod':
      case 'cash on delivery':
        return 'cod';
      case 'card':
        return 'live_card';
      case 'sandbox':
        return 'sandbox';
      default:
        return 'qr_upi';
    }
  }

  // ── Render the GHPay checkout sheet inside the existing modal ─────────────

  function renderCheckoutSheet(orderId, orderNumber, amount, initialMethod, settings, isSandbox) {
    const upiId    = settings.upi_id    || settings.shop_upi_id || '';
    const qrPath   = settings.qr_image_path || '';
    const modeTag  = isSandbox
      ? '<span class="ghpay-mode-tag ghpay-mode-sandbox">🧪 Test Mode</span>'
      : '<span class="ghpay-mode-tag ghpay-mode-live">🔴 Live</span>';

    // Build QR image URL
    let qrImgSrc = '';
    if (qrPath) {
      qrImgSrc = '/' + qrPath;
    } else if (upiId) {
      qrImgSrc = `https://api.qrserver.com/v1/create-qr-code/?size=175x175&data=upi://pay?pa=${encodeURIComponent(upiId)}%26pn=GreenHarvest%26am=${parseFloat(amount).toFixed(2)}%26cu=INR`;
    }

    const enabledMethods = (settings.enabled_methods || 'qr_upi,cod').split(',').map(m => m.trim());
    const methodsHtml = buildMethodsHtml(enabledMethods, initialMethod, isSandbox);

    const html = `
      <div class="ghpay-checkout-wrap" id="ghpayWrap">
        <div class="ghpay-header">
          <div class="ghpay-logo-icon">💳</div>
          <div class="ghpay-brand">
            <div class="ghpay-brand-name">GreenHarvest Pay</div>
            <div class="ghpay-brand-sub">Order ${escSafe(orderNumber)}</div>
          </div>
          ${modeTag}
        </div>

        <div class="ghpay-amount-box">
          <div>
            <div class="ghpay-amount-label">Amount to Pay</div>
            <div style="font-size:12px;color:#64748b;">Order ${escSafe(orderNumber)}</div>
          </div>
          <div class="ghpay-amount-value">₹${parseFloat(amount).toFixed(2)}</div>
        </div>

        <div id="ghpayMethodsWrap">
          <div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Choose Payment Method</div>
          <div class="ghpay-methods" id="ghpayMethods">
            ${methodsHtml}
          </div>
        </div>

        <!-- Dynamic payment content area -->
        <div id="ghpayContent"></div>

        <div id="ghpayActionWrap">
          <button class="ghpay-pay-btn" id="ghpayPayBtn" onclick="GHPay._submit()">
            💳 Pay ₹${parseFloat(amount).toFixed(2)}
          </button>
          <div class="ghpay-secure-note">🔒 Secured by GreenHarvest Pay · 256-bit SSL</div>
        </div>
      </div>
    `;

    // Show in existing modal
    const modalBody = document.getElementById('modalBody');
    const modalCard = document.getElementById('modalCard');
    const modalOverlay = document.getElementById('modalOverlay');
    if (modalBody) {
      modalBody.innerHTML = html;
      if (modalCard) modalCard.style.maxWidth = '480px';
      if (modalOverlay) modalOverlay.classList.add('show');
    }

    // Store state for submit
    window._ghpayState = {
      orderId, orderNumber, amount, isSandbox,
      currentMethod: initialMethod,
      upiId, qrImgSrc,
      enabledMethods
    };

    // Render initial content
    _renderMethodContent(initialMethod, upiId, qrImgSrc, amount, isSandbox);

    // Wire method selector
    document.querySelectorAll('input[name="ghpayMethod"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const m = radio.value;
        window._ghpayState.currentMethod = m;
        document.querySelectorAll('.ghpay-method-opt').forEach(o => o.classList.remove('selected'));
        radio.closest('.ghpay-method-opt').classList.add('selected');
        _renderMethodContent(m, upiId, qrImgSrc, amount, isSandbox);
      });
    });
  }

  function buildMethodsHtml(enabledMethods, initialMethod, isSandbox) {
    const methodDefs = [
      { key: 'qr_upi',        icon: '📱', label: 'Scan & Pay (UPI QR)', sub: 'GPay · PhonePe · Paytm · Any UPI' },
      { key: 'cod',           icon: '💵', label: 'Cash on Delivery',    sub: 'Pay when order arrives' },
      { key: 'live_upi',      icon: '⚡', label: 'UPI (Direct)',        sub: 'Enter UPI ID to pay instantly' },
      { key: 'live_card',     icon: '💳', label: 'Card Payment',        sub: 'Visa · Mastercard · RuPay' },
      { key: 'sandbox',       icon: '🧪', label: 'Sandbox (Test)',      sub: 'Simulated payment — no real money' },
    ];

    return methodDefs
      .filter(m => enabledMethods.includes(m.key) || (m.key === 'sandbox' && isSandbox))
      .map(m => `
        <label class="ghpay-method-opt ${m.key === initialMethod ? 'selected' : ''}">
          <input type="radio" name="ghpayMethod" value="${m.key}" ${m.key === initialMethod ? 'checked' : ''}>
          <div class="ghpay-method-icon">${m.icon}</div>
          <div>
            <div class="ghpay-method-label">${m.label}</div>
            <div class="ghpay-method-sub">${m.sub}</div>
          </div>
        </label>
      `).join('');
  }

  function _renderMethodContent(method, upiId, qrImgSrc, amount, isSandbox) {
    const container = document.getElementById('ghpayContent');
    const payBtn    = document.getElementById('ghpayPayBtn');
    if (!container) return;

    switch (method) {
      case 'qr_upi':
        container.innerHTML = `
          <div class="ghpay-qr-section">
            <h4>📷 Official UPI QR Code</h4>
            <p style="font-size:12px;color:#64748b;margin-bottom:6px;">Scan with GPay · PhonePe · Paytm · Any UPI app</p>
            ${qrImgSrc ? `<img class="ghpay-qr-img" src="${escSafe(qrImgSrc)}" alt="GreenHarvest UPI QR Code">` : '<div style="padding:30px;color:#64748b;font-size:13px;">QR image not configured by admin.</div>'}
            <div class="ghpay-upi-id">${escSafe(upiId) || 'UPI ID not set'}</div>
            <div class="ghpay-upi-amount">Amount: <strong>₹${parseFloat(amount).toFixed(2)}</strong></div>

            <div class="ghpay-utr-input-wrap">
              <label>UTR / Transaction Reference ID <span style="color:#ef4444">*</span></label>
              <input class="ghpay-utr-input" id="ghpayUtrInput" placeholder="e.g. 417123456789012" autocomplete="off">
              <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Enter the 12-digit UTR from your UPI app after payment.</div>
            </div>

            <div class="ghpay-screenshot-wrap">
              <label>Payment Screenshot (Optional)</label>
              <input type="file" id="ghpayScreenshot" accept="image/jpeg,image/png,image/webp">
              <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Max 5 MB · JPEG / PNG / WebP</div>
            </div>
          </div>
        `;
        if (payBtn) {
          payBtn.innerHTML = `📱 Submit Payment Details`;
          payBtn.disabled = false;
        }
        break;

      case 'cod':
        container.innerHTML = `
          <div class="ghpay-cod-note">
            💵 <strong>Cash on Delivery selected.</strong><br>
            Pay ₹${parseFloat(amount).toFixed(2)} in cash when the delivery arrives at your door.
            No advance payment required.
          </div>
        `;
        if (payBtn) {
          payBtn.innerHTML = `✅ Confirm COD Order`;
          payBtn.disabled = false;
        }
        break;

      case 'sandbox':
        container.innerHTML = `
          <div class="ghpay-sandbox-panel">
            <div class="ghpay-sandbox-title">🧪 Sandbox Simulator — No Real Money</div>
            <div style="font-size:12px;color:#0369a1;margin-bottom:10px;">Click a button below to simulate a payment outcome.</div>
            <div class="ghpay-sandbox-buttons">
              <button class="ghpay-sim-btn ghpay-sim-success" onclick="GHPay._sandboxSimulate('paid')">✅ Success</button>
              <button class="ghpay-sim-btn ghpay-sim-fail"    onclick="GHPay._sandboxSimulate('failed')">❌ Failed</button>
              <button class="ghpay-sim-btn ghpay-sim-pending" onclick="GHPay._sandboxSimulate('pending')">⏳ Pending</button>
              <button class="ghpay-sim-btn ghpay-sim-cancel"  onclick="GHPay._sandboxSimulate('cancelled')">🚫 Cancel</button>
            </div>
          </div>
        `;
        if (payBtn) payBtn.style.display = 'none';
        break;

      case 'live_upi':
      case 'live_card':
      case 'live_netbanking':
        container.innerHTML = `
          <div style="background:#fef9c3;border:1px solid #fde047;border-radius:10px;padding:14px;font-size:13px;color:#713f12;margin-bottom:14px;line-height:1.6;">
            ⚡ <strong>Live payment provider required.</strong><br>
            Please ask the admin to configure a live payment provider (Razorpay / Cashfree) in GreenHarvest Pay settings
            before enabling this method.
          </div>
        `;
        if (payBtn) {
          payBtn.innerHTML = `💳 Initiate Live Payment`;
          payBtn.disabled = false;
        }
        break;

      default:
        container.innerHTML = '';
    }
  }

  // ── Submit payment ────────────────────────────────────────────────────────

  async function _submit() {
    const s = window._ghpayState;
    if (!s) return;

    const btn = document.getElementById('ghpayPayBtn');
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }

    const idempotencyKey = genIdempotencyKey(s.orderId);

    // Step 1: Initiate payment attempt (server-side, gets server amount)
    const initiateRes = await payPost('initiate_payment', {
      order_id:        s.orderId,
      method:          s.currentMethod,
      idempotency_key: idempotencyKey
    });

    if (!initiateRes.success) {
      _showError(initiateRes.error || 'Payment initiation failed.');
      if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
      return;
    }

    const paymentRef = initiateRes.payment_ref;
    const attemptId  = initiateRes.attempt_id;

    window._ghpayState.paymentRef = paymentRef;
    window._ghpayState.attemptId  = attemptId;

    // Step 2: Handle by method
    switch (s.currentMethod) {

      case 'qr_upi': {
        // Submit QR details (UTR + screenshot)
        const utr        = document.getElementById('ghpayUtrInput')?.value?.trim() || '';
        const screenshot = document.getElementById('ghpayScreenshot')?.files?.[0] || null;

        if (!utr || utr.length < 6) {
          _showError('Please enter your UTR / Transaction reference ID (min 6 characters).');
          if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
          return;
        }

        const csrf   = await ensureCsrf();
        const form   = new FormData();
        form.append('action', 'submit_qr_payment');
        form.append('_csrf', csrf);
        form.append('payment_ref', paymentRef);
        form.append('utr_reference', utr);
        if (screenshot) form.append('screenshot', screenshot);

        const subRes = await fetch(API_URL, { method: 'POST', body: form, credentials: 'same-origin' }).then(r => r.json());

        if (subRes.success) {
          _showPending(paymentRef, 'Your payment details are submitted and awaiting admin verification.');
        } else {
          _showError(subRes.error || 'Submission failed. Please try again.');
          if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
        }
        break;
      }

      case 'cod':
        // COD — just confirm (payment status stays Pending until delivery)
        _showSuccess(paymentRef, 'Your COD order is confirmed! Pay ₹' + parseFloat(s.amount).toFixed(2) + ' on delivery.');
        break;

      case 'live_upi':
      case 'live_card':
      case 'live_netbanking':
        // Live provider: initiate returns provider data
        if (initiateRes.provider === 'razorpay' && initiateRes.key_id) {
          _openRazorpay(initiateRes, s, paymentRef);
        } else {
          _showError('Live payment provider not configured. Please contact the admin.');
          if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
        }
        break;

      default:
        _showError('Unsupported payment method.');
        if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    }
  }

  // ── Sandbox simulation ────────────────────────────────────────────────────

  async function _sandboxSimulate(outcome) {
    const s = window._ghpayState;
    if (!s) return;

    // If no payment ref yet, initiate first
    if (!s.paymentRef) {
      const idempotencyKey = genIdempotencyKey(s.orderId);
      const r = await payPost('initiate_payment', {
        order_id: s.orderId, method: 'sandbox', idempotency_key: idempotencyKey
      });
      if (!r.success) { _showError(r.error); return; }
      s.paymentRef = r.payment_ref;
      s.attemptId  = r.attempt_id;
      window._ghpayState = s;
    }

    const res = await payPost('sandbox_simulate', {
      payment_ref: s.paymentRef,
      outcome
    });

    if (outcome === 'paid') {
      _showSuccess(s.paymentRef, '✅ Sandbox payment simulated as SUCCESS!');
    } else if (outcome === 'failed') {
      _showStatus('❌', 'Payment Simulation: Failed', 'The sandbox payment was simulated as failed.', s.paymentRef, '#ef4444');
    } else if (outcome === 'pending') {
      _showPending(s.paymentRef, 'Simulated as PENDING. Admin can approve from the dashboard.');
    } else {
      _showStatus('🚫', 'Payment Cancelled', 'Sandbox payment was cancelled.', s.paymentRef, '#94a3b8');
    }
  }

  // ── Razorpay live checkout ────────────────────────────────────────────────

  function _openRazorpay(providerData, state, paymentRef) {
    if (!window.Razorpay) {
      _showError('Razorpay checkout library not loaded. Please refresh and try again.');
      return;
    }

    const options = {
      key:        providerData.key_id,
      amount:     providerData.amount_paise,
      currency:   providerData.currency || 'INR',
      name:       'GreenHarvest Pay',
      description:'Order ' + state.orderNumber,
      order_id:   providerData.provider_order_id,
      notes:      { payment_ref: paymentRef },
      handler: async function (response) {
        // Client received success — NOW verify server-side before trusting it
        const verifyRes = await payPost('initiate_payment_live_callback', {
          payment_ref:          paymentRef,
          razorpay_payment_id:  response.razorpay_payment_id,
          razorpay_order_id:    response.razorpay_order_id,
          razorpay_signature:   response.razorpay_signature
        });

        if (verifyRes.success && verifyRes.verified_status === 'paid') {
          _showSuccess(paymentRef, '✅ Payment verified and confirmed!');
        } else {
          _showPending(paymentRef, 'Payment received but verification pending. Please contact support if this persists.');
        }
      },
      modal: {
        ondismiss: function() {
          const payBtn = document.getElementById('ghpayPayBtn');
          if (payBtn) { payBtn.disabled = false; payBtn.classList.remove('loading'); }
        }
      },
      theme: { color: '#10b981' }
    };

    new window.Razorpay(options).open();
  }

  // ── Status screens ────────────────────────────────────────────────────────

  function _showSuccess(paymentRef, message) {
    const container = document.getElementById('ghpayWrap');
    if (container) container.innerHTML = `
      <div class="ghpay-status-wrap">
        <div class="ghpay-status-icon">✅</div>
        <div class="ghpay-status-title" style="color:#15803d;">Payment Confirmed!</div>
        <div class="ghpay-status-sub">${escSafe(message)}</div>
        <div class="ghpay-ref-box">Ref: ${escSafe(paymentRef)}</div>
        <button class="ghpay-pay-btn" style="background:linear-gradient(135deg,#10b981,#059669);" onclick="GHPay._closeAndRefresh()">
          ✓ View My Orders
        </button>
      </div>
    `;
    if (window.confetti) window.confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 }, colors: ['#10b981','#86efac','#f59e0b'] });
  }

  function _showPending(paymentRef, message) {
    const container = document.getElementById('ghpayWrap');
    if (container) container.innerHTML = `
      <div class="ghpay-status-wrap">
        <div class="ghpay-status-icon">⏳</div>
        <div class="ghpay-status-title" style="color:#92400e;">Payment Pending</div>
        <div class="ghpay-status-sub">${escSafe(message)}</div>
        <div class="ghpay-ref-box">Ref: ${escSafe(paymentRef)}</div>
        <button class="ghpay-pay-btn" style="background:linear-gradient(135deg,#f59e0b,#d97706);" onclick="GHPay._closeAndRefresh()">
          📦 View My Orders
        </button>
      </div>
    `;
  }

  function _showStatus(icon, title, message, paymentRef, color) {
    const container = document.getElementById('ghpayWrap');
    if (container) container.innerHTML = `
      <div class="ghpay-status-wrap">
        <div class="ghpay-status-icon">${icon}</div>
        <div class="ghpay-status-title" style="color:${color};">${escSafe(title)}</div>
        <div class="ghpay-status-sub">${escSafe(message)}</div>
        ${paymentRef ? `<div class="ghpay-ref-box">Ref: ${escSafe(paymentRef)}</div>` : ''}
        <button class="ghpay-pay-btn" onclick="GHPay._closeAndRefresh()">Close</button>
      </div>
    `;
  }

  function _showError(message) {
    // Show inline without replacing the whole form
    const existing = document.getElementById('ghpayError');
    if (existing) existing.remove();

    const errDiv = document.createElement('div');
    errDiv.id = 'ghpayError';
    errDiv.style.cssText = 'background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:10px 14px;color:#dc2626;font-size:13px;margin-bottom:12px;font-weight:600;';
    errDiv.textContent = '⚠️ ' + message;

    const payBtn = document.getElementById('ghpayPayBtn');
    if (payBtn) {
      payBtn.insertAdjacentElement('beforebegin', errDiv);
    } else {
      const wrap = document.getElementById('ghpayWrap');
      if (wrap) wrap.appendChild(errDiv);
    }
  }

  function _closeAndRefresh() {
    const overlay = document.getElementById('modalOverlay');
    if (overlay) overlay.classList.remove('show');
    // Refresh order list
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

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    openForOrder,
    _submit,
    _sandboxSimulate,
    _closeAndRefresh
  };

})();

// ── Inject checkout CSS ────────────────────────────────────────────────────────

(function injectCheckoutCss() {
  if (document.getElementById('ghpay-checkout-css')) return;
  const link = document.createElement('link');
  link.id   = 'ghpay-checkout-css';
  link.rel  = 'stylesheet';
  link.href = '/pay/assets/pay-checkout.css';
  document.head.appendChild(link);
})();
