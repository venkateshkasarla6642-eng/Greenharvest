<?php
// pay/link.php — GreenHarvest Pay Customer Payment Page
// Standalone, secure public payment page for payment links.
// Server-authoritative: amount, title, and status are loaded strictly from the database.

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/lib/PaymentService.php';

$db = getDB();
$payService = new PaymentService($db);

$token = preg_replace('/[^a-zA-Z0-9_\-]/', '', $_GET['token'] ?? '');
$link = null;
if (!empty($token)) {
    $link = $payService->getPaymentLinkByToken($token);
}

$settings = $payService->getPublicSettings();
$isSandbox = ($settings['mode'] ?? 'sandbox') === 'sandbox';

$csrfToken = $_SESSION['pay_csrf_token'] ?? (function() {
    $_SESSION['pay_csrf_token'] = bin2hex(random_bytes(32));
    return $_SESSION['pay_csrf_token'];
})();
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title><?= $link ? htmlspecialchars($link['title']) . ' — GreenHarvest Pay' : 'GreenHarvest Pay — Secure Payment' ?></title>
  <link rel="icon" href="../assets/icons/favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js"></script>
  <?php if (!empty($settings['has_live_keys']) && ($settings['live_provider'] ?? '') === 'razorpay'): ?>
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <?php endif; ?>
  <style>
    :root {
      --gh-bg: #f8fafc;
      --gh-surface: #ffffff;
      --gh-primary: #10b981;
      --gh-primary-dk: #059669;
      --gh-primary-light: #ecfdf5;
      --gh-text: #0f172a;
      --gh-muted: #64748b;
      --gh-border: #e2e8f0;
      --gh-radius: 16px;
      --gh-shadow: 0 10px 30px rgba(0,0,0,0.08);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background: var(--gh-bg);
      color: var(--gh-text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px 14px;
    }
    .gh-card {
      background: var(--gh-surface);
      border: 1px solid var(--gh-border);
      border-radius: var(--gh-radius);
      box-shadow: var(--gh-shadow);
      width: 100%;
      max-width: 480px;
      overflow: hidden;
      animation: ghFadeIn 0.3s ease;
    }
    @keyframes ghFadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .gh-header {
      background: linear-gradient(135deg, #064e3b, #047857);
      color: #fff;
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .gh-logo-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .gh-logo-icon {
      font-size: 26px;
      background: rgba(255,255,255,0.18);
      width: 44px; height: 44px;
      border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
    }
    .gh-brand-name {
      font-size: 16px;
      font-weight: 800;
      letter-spacing: -0.2px;
    }
    .gh-brand-sub {
      font-size: 11.5px;
      opacity: 0.85;
      font-weight: 500;
    }
    .gh-mode-badge {
      font-size: 11px;
      font-weight: 800;
      padding: 4px 10px;
      border-radius: 100px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .gh-mode-sandbox { background: #fef08a; color: #854d0e; }
    .gh-mode-live    { background: #bbf7d0; color: #166534; }

    .gh-body { padding: 24px 20px; }

    .gh-amount-hero {
      text-align: center;
      background: var(--gh-primary-light);
      border: 1.5px dashed #a7f3d0;
      border-radius: 14px;
      padding: 18px 14px;
      margin-bottom: 20px;
    }
    .gh-amount-label {
      font-size: 12px;
      font-weight: 700;
      color: #065f46;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      margin-bottom: 4px;
    }
    .gh-amount-val {
      font-size: 36px;
      font-weight: 900;
      color: #047857;
      letter-spacing: -0.5px;
    }

    .gh-meta-box {
      border: 1px solid var(--gh-border);
      border-radius: 12px;
      padding: 14px 16px;
      margin-bottom: 20px;
      background: #fafafa;
    }
    .gh-meta-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;
      font-size: 13px;
      border-bottom: 1px dashed var(--gh-border);
    }
    .gh-meta-row:last-child { border-bottom: none; }
    .gh-meta-label { color: var(--gh-muted); font-weight: 500; }
    .gh-meta-value { color: var(--gh-text); font-weight: 700; text-align: right; }

    .gh-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      padding: 14px 20px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 800;
      border: none;
      cursor: pointer;
      transition: all 0.15s ease;
      color: #fff;
      text-decoration: none;
    }
    .gh-btn-primary {
      background: linear-gradient(135deg, #10b981, #059669);
      box-shadow: 0 4px 14px rgba(16,185,129,0.35);
    }
    .gh-btn-primary:hover {
      background: linear-gradient(135deg, #059669, #047857);
      transform: translateY(-1px);
    }
    .gh-btn-primary:active { transform: translateY(0); }

    .gh-sim-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 12px;
    }
    .gh-sim-btn {
      padding: 11px 12px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      border: none;
      cursor: pointer;
      color: #fff;
      transition: opacity 0.15s;
    }
    .gh-sim-btn:hover { opacity: 0.9; }

    .gh-error-banner {
      background: #fef2f2;
      border: 1px solid #fca5a5;
      color: #dc2626;
      border-radius: 10px;
      padding: 12px 14px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 16px;
      display: none;
    }

    .gh-footer {
      text-align: center;
      margin-top: 20px;
      font-size: 12px;
      color: var(--gh-muted);
    }
    .gh-footer a { color: var(--gh-primary-dk); text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>

<div class="gh-card">
  <!-- Header -->
  <div class="gh-header">
    <div class="gh-logo-group">
      <div class="gh-logo-icon">🌿</div>
      <div>
        <div class="gh-brand-name">GreenHarvest Pay</div>
        <div class="gh-brand-sub">Verified Payment Request</div>
      </div>
    </div>
    <div class="gh-mode-badge <?= $isSandbox ? 'gh-mode-sandbox' : 'gh-mode-live' ?>">
      <?= $isSandbox ? '🧪 Sandbox' : '🔒 Secure' ?>
    </div>
  </div>

  <div class="gh-body" id="ghBody">
    <?php if (!$link): ?>
      <!-- NOT FOUND -->
      <div style="text-align:center;padding:24px 10px;">
        <div style="font-size:48px;margin-bottom:12px;">🔍</div>
        <h2 style="font-size:20px;font-weight:800;color:#0f172a;margin-bottom:8px;">Payment Link Not Found</h2>
        <p style="font-size:13.5px;color:#64748b;line-height:1.6;margin-bottom:20px;">
          This payment link may be invalid, expired, or removed. Please check the URL or contact GreenHarvest for assistance.
        </p>
        <a href="../" class="gh-btn gh-btn-primary">Visit GreenHarvest Store</a>
      </div>

    <?php elseif ($link['status'] === 'paid'): ?>
      <!-- ALREADY PAID -->
      <div style="text-align:center;padding:20px 8px;">
        <div style="font-size:52px;margin-bottom:12px;">✅</div>
        <h2 style="font-size:22px;font-weight:900;color:#15803d;margin-bottom:6px;">Payment Confirmed!</h2>
        <p style="font-size:13.5px;color:#475569;margin-bottom:18px;">
          This payment request has already been successfully verified and completed.
        </p>
        <div class="gh-meta-box" style="text-align:left;">
          <div class="gh-meta-row">
            <span class="gh-meta-label">Purpose</span>
            <span class="gh-meta-value"><?= htmlspecialchars($link['title']) ?></span>
          </div>
          <div class="gh-meta-row">
            <span class="gh-meta-label">Amount Paid</span>
            <span class="gh-meta-value" style="color:#047857;font-size:16px;"><?= htmlspecialchars($link['formatted_amount']) ?></span>
          </div>
          <?php if (!empty($link['paid_at'])): ?>
            <div class="gh-meta-row">
              <span class="gh-meta-label">Paid On</span>
              <span class="gh-meta-value"><?= htmlspecialchars(date('d M Y, h:i A', strtotime($link['paid_at']))) ?></span>
            </div>
          <?php endif; ?>
          <?php if (!empty($link['transaction_ref'])): ?>
            <div class="gh-meta-row">
              <span class="gh-meta-label">Reference</span>
              <span class="gh-meta-value"><code><?= htmlspecialchars($link['transaction_ref']) ?></code></span>
            </div>
          <?php endif; ?>
        </div>
        <button type="button" onclick="window.print()" class="gh-btn gh-btn-primary" style="margin-bottom:10px;">
          🖨️ Print / Save Receipt
        </button>
        <a href="../" style="display:inline-block;font-size:13px;color:#047857;text-decoration:none;font-weight:700;margin-top:6px;">
          Return to Store →
        </a>
      </div>

    <?php elseif ($link['status'] === 'cancelled'): ?>
      <!-- CANCELLED -->
      <div style="text-align:center;padding:24px 10px;">
        <div style="font-size:48px;margin-bottom:12px;">🚫</div>
        <h2 style="font-size:20px;font-weight:800;color:#64748b;margin-bottom:8px;">Payment Link Cancelled</h2>
        <p style="font-size:13.5px;color:#64748b;line-height:1.6;margin-bottom:20px;">
          This payment request was cancelled by the store administrator. Please request an updated link.
        </p>
        <a href="../" class="gh-btn gh-btn-primary">Return to GreenHarvest</a>
      </div>

    <?php elseif ($link['status'] === 'expired' || !empty($link['is_expired'])): ?>
      <!-- EXPIRED -->
      <div style="text-align:center;padding:24px 10px;">
        <div style="font-size:48px;margin-bottom:12px;">⏰</div>
        <h2 style="font-size:20px;font-weight:800;color:#dc2626;margin-bottom:8px;">Payment Link Expired</h2>
        <p style="font-size:13.5px;color:#64748b;line-height:1.6;margin-bottom:20px;">
          This payment request has passed its scheduled expiration time. Please contact the store owner to issue a fresh payment link.
        </p>
        <a href="../" class="gh-btn gh-btn-primary">Return to GreenHarvest</a>
      </div>

    <?php else: ?>
      <!-- ACTIVE UNPAID PAYMENT REQUEST -->
      <div id="paymentContent">
        <!-- Error Banner -->
        <div id="ghErrorBanner" class="gh-error-banner"></div>

        <!-- Amount Box -->
        <div class="gh-amount-hero">
          <div class="gh-amount-label">Payable Amount</div>
          <div class="gh-amount-val"><?= htmlspecialchars($link['formatted_amount']) ?></div>
        </div>

        <!-- Meta Details -->
        <div class="gh-meta-box">
          <div class="gh-meta-row">
            <span class="gh-meta-label">Purpose</span>
            <span class="gh-meta-value"><?= htmlspecialchars($link['title']) ?></span>
          </div>
          <?php if (!empty($link['order_ref'])): ?>
            <div class="gh-meta-row">
              <span class="gh-meta-label">Order Ref</span>
              <span class="gh-meta-value"><code><?= htmlspecialchars($link['order_ref']) ?></code></span>
            </div>
          <?php endif; ?>
          <?php if (!empty($link['customer_name'])): ?>
            <div class="gh-meta-row">
              <span class="gh-meta-label">Customer</span>
              <span class="gh-meta-value"><?= htmlspecialchars($link['customer_name']) ?></span>
            </div>
          <?php endif; ?>
          <?php if (!empty($link['description'])): ?>
            <div style="padding-top:8px;font-size:12.5px;color:#475569;line-height:1.5;">
              <strong>Note:</strong> <?= nl2br(htmlspecialchars($link['description'])) ?>
            </div>
          <?php endif; ?>
        </div>

        <!-- Payment Options by Gateway Mode -->
        <?php if ($isSandbox): ?>
          <!-- SANDBOX SIMULATOR -->
          <div style="background:#eff6ff;border:1.5px solid #93c5fd;border-radius:12px;padding:16px;margin-bottom:14px;">
            <div style="font-weight:800;color:#1e40af;font-size:13.5px;margin-bottom:4px;">
              🧪 GreenHarvest Pay — Sandbox Simulator
            </div>
            <p style="font-size:12px;color:#3b82f6;margin-bottom:12px;">
              No real money is charged. Choose an outcome below to test the complete server-side payment lifecycle:
            </p>
            <div class="gh-sim-grid">
              <button type="button" class="gh-sim-btn" style="background:#10b981;" onclick="executePayment('sandbox', 'paid')">
                ✅ Simulate Success
              </button>
              <button type="button" class="gh-sim-btn" style="background:#ef4444;" onclick="executePayment('sandbox', 'failed')">
                ❌ Simulate Failed
              </button>
              <button type="button" class="gh-sim-btn" style="background:#f59e0b;" onclick="executePayment('sandbox', 'pending')">
                ⏳ Simulate Pending
              </button>
              <button type="button" class="gh-sim-btn" style="background:#64748b;" onclick="executePayment('sandbox', 'cancelled')">
                🚫 Cancel
              </button>
            </div>
          </div>
        <?php endif; ?>

        <!-- UPI QR PAYMENT (Available in both test and live) -->
        <?php if (!empty($settings['upi_id']) || !empty($settings['qr_image_path'])): ?>
          <div style="background:#fafafa;border:1px solid #e2e8f0;border-radius:12px;padding:16px;text-align:center;margin-bottom:14px;">
            <div style="font-size:13.5px;font-weight:700;color:#0f172a;margin-bottom:4px;">📷 Scan &amp; Pay via UPI QR</div>
            <div style="font-size:12px;color:#64748b;margin-bottom:12px;">GPay, PhonePe, Paytm, BHIM, or any UPI app</div>

            <?php
              $upiId = $settings['upi_id'] ?? '';
              $qrImg = $settings['qr_image_path'] ?? '';
              $amtFloat = floatval($link['amount']);
              $qrSrc = '';
              if (!empty($qrImg)) {
                  $qrSrc = (str_starts_with($qrImg, 'http')) ? $qrImg : ('../' . ltrim($qrImg, '/'));
              } elseif (!empty($upiId)) {
                  $qrSrc = "https://api.qrserver.com/v1/create-qr-code/?size=170x170&data=" . urlencode("upi://pay?pa=$upiId&pn=GreenHarvest&am=" . number_format($amtFloat, 2, '.', '') . "&cu=INR");
              }
            ?>
            <?php if ($qrSrc): ?>
              <img src="<?= htmlspecialchars($qrSrc) ?>" alt="UPI QR" style="width:160px;height:160px;border-radius:8px;border:1px solid #cbd5e1;padding:6px;background:#fff;margin:0 auto 10px auto;display:block;">
            <?php endif; ?>
            <?php if ($upiId): ?>
              <div style="font-weight:800;color:#047857;font-size:14px;margin-bottom:10px;">UPI: <?= htmlspecialchars($upiId) ?></div>
            <?php endif; ?>

            <div style="text-align:left;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-top:10px;">
              <label style="display:block;font-size:12px;font-weight:700;color:#334155;margin-bottom:4px;">
                UPI Transaction / Reference ID (UTR) <span style="color:#ef4444">*</span>
              </label>
              <input type="text" id="linkUtrInput" placeholder="e.g. 417123456789 (12-digit UTR)" style="width:100%;padding:9px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;">
              <button type="button" class="gh-btn gh-btn-primary" onclick="executePayment('qr_upi')" style="margin-top:10px;padding:11px;">
                📱 Submit UPI Payment Details
              </button>
            </div>
          </div>
        <?php endif; ?>

        <!-- RAZORPAY LIVE GATEWAY -->
        <?php if (!$isSandbox && !empty($settings['has_live_keys']) && ($settings['live_provider'] ?? '') === 'razorpay'): ?>
          <button type="button" class="gh-btn gh-btn-primary" onclick="executeRazorpayLive()" style="margin-top:10px;">
            💳 Pay <?= htmlspecialchars($link['formatted_amount']) ?> Securely via Razorpay
          </button>
        <?php endif; ?>

        <!-- COD CONFIRMATION -->
        <button type="button" class="gh-btn" style="background:#475569;margin-top:10px;" onclick="executePayment('cod')">
          💵 Confirm Cash on Delivery
        </button>

      </div>
    <?php endif; ?>
  </div>
</div>

<div class="gh-footer">
  🔒 256-Bit Encrypted Payment · Powered by <a href="../">GreenHarvest</a>
</div>

<script>
  const LINK_TOKEN = <?= json_encode($token) ?>;
  const LINK_DATA = <?= json_encode($link) ?>;
  const CSRF_TOKEN = <?= json_encode($csrfToken) ?>;

  function showError(msg) {
    const el = document.getElementById('ghErrorBanner');
    if (el) {
      el.textContent = '⚠️ ' + msg;
      el.style.display = 'block';
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      alert(msg);
    }
  }

  function hideError() {
    const el = document.getElementById('ghErrorBanner');
    if (el) el.style.display = 'none';
  }

  async function executePayment(method, outcome = 'paid') {
    hideError();
    const utr = document.getElementById('linkUtrInput')?.value?.trim() || '';

    if (method === 'qr_upi') {
      if (!utr || utr.length < 6) {
        showError('Please enter your 12-digit UPI UTR reference ID.');
        return;
      }
    }

    const form = new FormData();
    form.append('action', 'pay_payment_link');
    form.append('token', LINK_TOKEN);
    form.append('method', method);
    form.append('outcome', outcome);
    form.append('utr_reference', utr);
    form.append('_csrf', CSRF_TOKEN);

    // Disable buttons
    document.querySelectorAll('button').forEach(b => { b.disabled = true; b.style.opacity = '0.6'; });

    try {
      const res = await fetch('api.php', {
        method: 'POST',
        body: form,
        credentials: 'same-origin'
      }).then(r => r.json());

      document.querySelectorAll('button').forEach(b => { b.disabled = false; b.style.opacity = '1'; });

      if (res && res.success) {
        if (method === 'sandbox' && outcome === 'failed') {
          showError('Simulated payment failure. You can retry anytime.');
        } else if (method === 'sandbox' && outcome === 'cancelled') {
          showError('Payment attempt was cancelled.');
        } else if (res.status === 'pending' || outcome === 'pending') {
          renderSuccessScreen('⏳ Awaiting Verification', 'Your payment reference has been submitted and is pending verification by the store.', res.transaction_ref);
        } else {
          // Success
          if (window.confetti) {
            try { window.confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } }); } catch(e){}
          }
          renderSuccessScreen('✅ Payment Completed!', 'Your payment was successfully received and verified.', res.transaction_ref);
        }
      } else {
        showError(res?.error || 'Payment failed. Please try again.');
      }
    } catch (e) {
      document.querySelectorAll('button').forEach(b => { b.disabled = false; b.style.opacity = '1'; });
      showError('Network error. Please check your connection and retry.');
    }
  }

  function renderSuccessScreen(title, message, txRef) {
    const body = document.getElementById('ghBody');
    if (!body) return;
    body.innerHTML = `
      <div style="text-align:center;padding:24px 8px;">
        <div style="font-size:52px;margin-bottom:12px;">✅</div>
        <h2 style="font-size:22px;font-weight:900;color:#15803d;margin-bottom:6px;">${title}</h2>
        <p style="font-size:13.5px;color:#475569;margin-bottom:18px;">${message}</p>
        <div class="gh-meta-box" style="text-align:left;">
          <div class="gh-meta-row">
            <span class="gh-meta-label">Purpose</span>
            <span class="gh-meta-value">${LINK_DATA ? LINK_DATA.title : 'Payment Request'}</span>
          </div>
          <div class="gh-meta-row">
            <span class="gh-meta-label">Amount</span>
            <span class="gh-meta-value" style="color:#047857;font-size:16px;">${LINK_DATA ? LINK_DATA.formatted_amount : '₹0.00'}</span>
          </div>
          <div class="gh-meta-row">
            <span class="gh-meta-label">Reference</span>
            <span class="gh-meta-value"><code>${txRef || LINK_TOKEN}</code></span>
          </div>
        </div>
        <button type="button" onclick="window.print()" class="gh-btn gh-btn-primary" style="margin-bottom:10px;">
          🖨️ Print / Save Receipt
        </button>
        <a href="../" style="display:inline-block;font-size:13px;color:#047857;text-decoration:none;font-weight:700;margin-top:6px;">
          Return to GreenHarvest Store →
        </a>
      </div>
    `;
  }
</script>

</body>
</html>
