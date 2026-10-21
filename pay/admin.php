<?php
// pay/admin.php — GreenHarvest Pay Owner Administration Dashboard
// ACCESS: Only authenticated users with role = 'owner' can view this page.
// Any other role gets a hard redirect. No information leakage.

require_once __DIR__ . '/../config.php';

$user = getCurrentUser();

// ─── Server-side owner check — MUST be first ─────────────────────────────────
if (!$user || ($user['role'] !== 'owner' && $user['role'] !== 'shopkeeper')) {
    // Do not reveal this page exists to non-owners
    $scriptDir = dirname($_SERVER['SCRIPT_NAME'] ?? '');
    $baseApp = rtrim(str_replace('\\', '/', dirname($scriptDir)), '/');
    if (empty($baseApp)) $baseApp = '/';
    http_response_code(302);
    header("Location: $baseApp");
    exit;
}

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
  <title>GreenHarvest Pay — Admin Dashboard</title>
  <meta name="robots" content="noindex,nofollow">
  <link rel="icon" href="../assets/icons/favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/pay.css?v=<?= filemtime(__DIR__ . '/assets/pay.css') ?>">
</head>
<body class="pay-admin-body">

<!-- ═══════════ SIDEBAR ═══════════ -->
<aside class="pay-sidebar" id="paySidebar">
  <div class="pay-sidebar-logo">
    <div class="pay-logo-icon">💳</div>
    <div>
      <div class="pay-logo-name">GreenHarvest Pay</div>
      <div class="pay-logo-sub">Owner Dashboard</div>
    </div>
  </div>

  <nav class="pay-sidebar-nav">
    <a href="#" class="pay-nav-item active" data-section="overview" onclick="PayAdmin.showSection('overview',this)">
      <span class="pay-nav-icon">📊</span> Overview
    </a>
    <a href="#" class="pay-nav-item" data-section="transactions" onclick="PayAdmin.showSection('transactions',this)">
      <span class="pay-nav-icon">📋</span> Transactions
    </a>
    <a href="#" class="pay-nav-item" data-section="payment_links" onclick="PayAdmin.showSection('payment_links',this)">
      <span class="pay-nav-icon">🔗</span> Create Payment Link
    </a>
    <a href="#" class="pay-nav-item" data-section="qr_queue" onclick="PayAdmin.showSection('qr_queue',this)">
      <span class="pay-nav-icon">🔍</span> QR Verification
      <span class="pay-badge" id="qrQueueBadge" style="display:none;">0</span>
    </a>
    <a href="#" class="pay-nav-item" data-section="reports" onclick="PayAdmin.showSection('reports',this)">
      <span class="pay-nav-icon">📈</span> Reports
    </a>
    <a href="#" class="pay-nav-item" data-section="audit" onclick="PayAdmin.showSection('audit',this)">
      <span class="pay-nav-icon">🔐</span> Audit Log
    </a>
    <a href="#" class="pay-nav-item" data-section="settings" onclick="PayAdmin.showSection('settings',this)">
      <span class="pay-nav-icon">⚙️</span> Settings
    </a>
    <div class="pay-sidebar-divider"></div>
    <a href="../" class="pay-nav-item pay-nav-back">
      <span class="pay-nav-icon">🥬</span> GreenHarvest Shop
    </a>
  </nav>

  <div class="pay-sidebar-user">
    <div class="pay-user-avatar">👑</div>
    <div>
      <div class="pay-user-name"><?= htmlspecialchars($user['name']) ?></div>
      <div class="pay-user-role">Owner / Admin</div>
    </div>
  </div>
</aside>

<!-- ═══════════ MOBILE TOP BAR ════ -->
<div class="pay-topbar" id="payTopbar">
  <button class="pay-topbar-menu" onclick="PayAdmin.toggleSidebar()" aria-label="Toggle menu">☰</button>
  <div class="pay-topbar-title">💳 GreenHarvest Pay</div>
  <div class="pay-mode-badge" id="topbarModeBadge">SANDBOX</div>
</div>
<div class="pay-sidebar-overlay" id="paySidebarOverlay" onclick="PayAdmin.closeSidebar()"></div>

<!-- ═══════════ MAIN CONTENT ═══════ -->
<main class="pay-main" id="payMain">

  <!-- ── Overview Section ── -->
  <section id="sec-overview" class="pay-section active">
    <div class="pay-section-header">
      <h1 class="pay-section-title">Payment Overview</h1>
      <div class="pay-mode-pill" id="modePill">
        <span class="pay-mode-dot"></span>
        <span id="modePillText">Sandbox Mode</span>
      </div>
    </div>

    <!-- Stat Cards -->
    <div class="pay-stats-grid" id="statsGrid">
      <div class="pay-stat-card pay-stat-paid">
        <div class="pay-stat-icon">✅</div>
        <div class="pay-stat-value" id="statPaidTotal">₹0.00</div>
        <div class="pay-stat-label">Total Verified Payments</div>
        <div class="pay-stat-count" id="statPaidCount">0 transactions</div>
      </div>
      <div class="pay-stat-card pay-stat-pending">
        <div class="pay-stat-icon">⏳</div>
        <div class="pay-stat-value" id="statPendingCount">0</div>
        <div class="pay-stat-label">Pending Verification</div>
        <div class="pay-stat-count" id="statPendingQr">0 QR awaiting review</div>
      </div>
      <div class="pay-stat-card pay-stat-failed">
        <div class="pay-stat-icon">❌</div>
        <div class="pay-stat-value" id="statFailedCount">0</div>
        <div class="pay-stat-label">Failed Payments</div>
        <div class="pay-stat-count" id="statRefundCount">0 refunded</div>
      </div>
      <div class="pay-stat-card pay-stat-today">
        <div class="pay-stat-icon">📅</div>
        <div class="pay-stat-value" id="statTodayPaid">₹0.00</div>
        <div class="pay-stat-label">Today's Verified Revenue</div>
        <div class="pay-stat-count" id="statTotalOrders">0 total orders</div>
      </div>
    </div>

    <!-- Provider status -->
    <div class="pay-card" style="margin-top:24px;">
      <div class="pay-card-header">
        <h3 class="pay-card-title">⚡ Provider Status</h3>
        <button class="pay-btn pay-btn-sm pay-btn-outline" onclick="PayAdmin.loadDashboard()">🔄 Refresh</button>
      </div>
      <div id="providerStatus" class="pay-provider-status">
        <div class="pay-spinner"></div>
      </div>
    </div>

    <!-- Recent transactions preview -->
    <div class="pay-card" style="margin-top:24px;">
      <div class="pay-card-header">
        <h3 class="pay-card-title">📋 Recent Transactions</h3>
        <button class="pay-btn pay-btn-sm pay-btn-primary" onclick="PayAdmin.showSection('transactions',null)">View All →</button>
      </div>
      <div id="recentTransactions" class="pay-table-wrap">
        <div class="pay-empty">Loading...</div>
      </div>
    </div>
  </section>

  <!-- ── Transactions Section ── -->
  <section id="sec-transactions" class="pay-section">
    <div class="pay-section-header">
      <h1 class="pay-section-title">Transactions</h1>
      <button class="pay-btn pay-btn-outline" onclick="PayAdmin.exportCsv()">⬇ Export CSV</button>
    </div>

    <!-- Filters -->
    <div class="pay-filters">
      <input type="text" id="txSearch" placeholder="Search ref / order / customer…" class="pay-input" oninput="PayAdmin.filterTransactions()">
      <select id="txStatus" class="pay-select" onchange="PayAdmin.filterTransactions()">
        <option value="all">All Status</option>
        <option value="paid">Paid</option>
        <option value="pending">Pending</option>
        <option value="failed">Failed</option>
        <option value="cancelled">Cancelled</option>
        <option value="refunded">Refunded</option>
        <option value="expired">Expired</option>
      </select>
      <select id="txMethod" class="pay-select" onchange="PayAdmin.filterTransactions()">
        <option value="all">All Methods</option>
        <option value="qr_upi">QR/UPI</option>
        <option value="cod">COD</option>
        <option value="sandbox">Sandbox</option>
        <option value="live_upi">Live UPI</option>
        <option value="live_card">Card</option>
      </select>
      <select id="txSandbox" class="pay-select" onchange="PayAdmin.filterTransactions()">
        <option value="">All (Live+Test)</option>
        <option value="1">Test/Sandbox Only</option>
        <option value="0">Live Only</option>
      </select>
      <input type="date" id="txDateFrom" class="pay-input" onchange="PayAdmin.filterTransactions()">
      <input type="date" id="txDateTo" class="pay-input" onchange="PayAdmin.filterTransactions()">
    </div>

    <div id="txTable" class="pay-table-wrap">
      <div class="pay-empty">Loading transactions…</div>
    </div>
    <div class="pay-pagination" id="txPagination"></div>
  </section>

  <!-- ── Create Payment Link Section ── -->
  <section id="sec-payment_links" class="pay-section">
    <div class="pay-section-header">
      <div>
        <h1 class="pay-section-title">Create Payment Link</h1>
        <p class="pay-desc" style="margin-top:4px;">Generate secure, shareable payment links to collect payments via UPI, QR, or Gateway across WhatsApp, Telegram, SMS, or Email.</p>
      </div>
      <button class="pay-btn pay-btn-outline" onclick="PayAdmin.loadPaymentLinks()">🔄 Refresh Links</button>
    </div>

    <!-- Summary Stats -->
    <div class="pay-stats-grid" style="margin-bottom:24px;">
      <div class="pay-stat-card pay-stat-paid">
        <div class="pay-stat-icon">💰</div>
        <div class="pay-stat-value" id="plStatPaidTotal">₹0.00</div>
        <div class="pay-stat-label">Collected via Links</div>
        <div class="pay-stat-count" id="plStatPaidCount">0 paid links</div>
      </div>
      <div class="pay-stat-card pay-stat-pending">
        <div class="pay-stat-icon">⏳</div>
        <div class="pay-stat-value" id="plStatUnpaidCount">0</div>
        <div class="pay-stat-label">Active Unpaid Links</div>
        <div class="pay-stat-count" id="plStatPendingReview">0 pending review</div>
      </div>
      <div class="pay-stat-card pay-stat-today">
        <div class="pay-stat-icon">🔗</div>
        <div class="pay-stat-value" id="plStatTotalCount">0</div>
        <div class="pay-stat-label">Total Links Created</div>
        <div class="pay-stat-count" id="plStatExpiredCount">0 expired / cancelled</div>
      </div>
    </div>

    <!-- Main Creation Grid -->
    <div class="pay-link-create-grid">
      <!-- Creation Form Card -->
      <div class="pay-card">
        <div class="pay-card-header">
          <h3 class="pay-card-title">➕ New Payment Request</h3>
        </div>
        <form id="createPaymentLinkForm" onsubmit="PayAdmin.submitCreatePaymentLink(event)">
          <div class="pay-form-group">
            <label class="pay-label">Payment Purpose / Title <span style="color:var(--pay-red);">*</span></label>
            <input type="text" name="title" id="plInputTitle" class="pay-input" placeholder="e.g. Fresh Vegetable Delivery - Order #104" required style="width:100%;">
          </div>

          <div class="pay-form-group">
            <label class="pay-label">Amount in INR (₹) <span style="color:var(--pay-red);">*</span></label>
            <div style="position:relative;">
              <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-weight:700;color:var(--pay-primary);font-size:15px;">₹</span>
              <input type="number" name="amount" id="plInputAmount" class="pay-input" placeholder="0.00" step="0.01" min="1" max="100000" required style="width:100%;padding-left:28px;font-size:16px;font-weight:700;">
            </div>
            <div style="font-size:11px;color:var(--pay-text-muted);margin-top:4px;">Min ₹1.00 · Max ₹1,00,000.00</div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;">
            <div class="pay-form-group" style="border-right:1px solid var(--pay-border);">
              <label class="pay-label">Customer Name (Optional)</label>
              <input type="text" name="customer_name" id="plInputCustName" class="pay-input" placeholder="e.g. Ramesh Kumar" style="width:100%;">
            </div>
            <div class="pay-form-group">
              <label class="pay-label">Customer Phone (Optional)</label>
              <input type="tel" name="customer_phone" id="plInputCustPhone" class="pay-input" placeholder="e.g. 9876543210" style="width:100%;">
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;">
            <div class="pay-form-group" style="border-right:1px solid var(--pay-border);">
              <label class="pay-label">Customer Email (Optional)</label>
              <input type="email" name="customer_email" id="plInputCustEmail" class="pay-input" placeholder="e.g. customer@gmail.com" style="width:100%;">
            </div>
            <div class="pay-form-group">
              <label class="pay-label">Order / Invoice Ref (Optional)</label>
              <input type="text" name="order_ref" id="plInputOrderRef" class="pay-input" placeholder="e.g. ORD-104 or INV-2026" style="width:100%;">
            </div>
          </div>

          <div class="pay-form-group">
            <label class="pay-label">Link Expiration</label>
            <select name="expires_in" id="plInputExpiresIn" class="pay-select" style="width:100%;">
              <option value="">Never Expires (Always Active)</option>
              <option value="1h">Expires in 1 Hour</option>
              <option value="6h">Expires in 6 Hours</option>
              <option value="24h" selected>Expires in 24 Hours (Recommended)</option>
              <option value="3d">Expires in 3 Days</option>
              <option value="7d">Expires in 7 Days</option>
              <option value="30d">Expires in 30 Days</option>
            </select>
          </div>

          <div class="pay-form-group">
            <label class="pay-label">Payment Description / Notes (Optional)</label>
            <textarea name="description" id="plInputDescription" class="pay-input" rows="2" placeholder="e.g. Fresh farm vegetables basket (2kg Potato, 1kg Tomato, Onion)" style="width:100%;resize:vertical;"></textarea>
          </div>

          <div class="pay-form-actions">
            <button type="submit" id="plSubmitBtn" class="pay-btn pay-btn-primary" style="width:100%;padding:12px;font-size:14px;font-weight:700;">
              🚀 Create Payment Link
            </button>
          </div>
        </form>
      </div>

      <!-- Share / Success Card -->
      <div class="pay-card" id="plSuccessPanel" style="display:none;">
        <div class="pay-card-header" style="background:linear-gradient(135deg,rgba(16,185,129,0.12),rgba(99,102,241,0.08));">
          <h3 class="pay-card-title" style="color:var(--pay-primary);">🎉 Payment Link Ready!</h3>
          <span class="pay-badge" style="background:var(--pay-primary);font-size:11px;padding:3px 8px;">Active</span>
        </div>
        <div style="padding:20px;">
          <div style="background:var(--pay-surface2);border:1px solid var(--pay-border2);border-radius:12px;padding:16px;margin-bottom:16px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <span id="plResultTitle" style="font-size:14px;font-weight:700;color:var(--pay-text);">Payment Request</span>
              <span id="plResultAmount" style="font-size:20px;font-weight:900;color:var(--pay-primary);">₹0.00</span>
            </div>
            <div id="plResultSub" style="font-size:12px;color:var(--pay-text-muted);">Customer: Ramesh · Ref: ORD-104</div>
          </div>

          <!-- Public URL Box with Copy Button -->
          <label class="pay-label">Shareable Payment Link URL</label>
          <div style="display:flex;gap:8px;margin-bottom:16px;">
            <input type="text" id="plResultUrl" class="pay-input" readonly style="flex:1;background:var(--pay-bg);font-family:monospace;font-size:12.5px;color:var(--pay-primary);">
            <button type="button" class="pay-btn pay-btn-primary" onclick="PayAdmin.copyGeneratedLink()" id="plCopyBtn">
              📋 Copy
            </button>
          </div>

          <!-- Native Mobile Web Share -->
          <button type="button" class="pay-btn pay-btn-outline" onclick="PayAdmin.shareNativeLink()" style="width:100%;margin-bottom:16px;padding:10px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px;">
            📱 Share via Phone Apps (Native Share)
          </button>

          <!-- Quick Share Buttons to Supported Apps -->
          <label class="pay-label">Quick Share to Customer Apps</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
            <button type="button" class="pay-share-btn pay-share-whatsapp" onclick="PayAdmin.shareToWhatsApp()">
              💬 WhatsApp
            </button>
            <button type="button" class="pay-share-btn pay-share-telegram" onclick="PayAdmin.shareToTelegram()">
              ✈️ Telegram
            </button>
            <button type="button" class="pay-share-btn pay-share-sms" onclick="PayAdmin.shareToSMS()">
              ✉️ SMS
            </button>
            <button type="button" class="pay-share-btn pay-share-gmail" onclick="PayAdmin.shareToEmail()">
              📧 Gmail / Email
            </button>
          </div>

          <div style="display:flex;gap:8px;">
            <button type="button" class="pay-btn pay-btn-sm pay-btn-outline" onclick="PayAdmin.copyPaymentDetailsText()" style="flex:1;">
              📄 Copy Full Details
            </button>
            <a id="plResultOpenLink" href="#" target="_blank" class="pay-btn pay-btn-sm pay-btn-outline" style="text-decoration:none;display:flex;align-items:center;justify-content:center;">
              👁️ Open Page ↗
            </a>
          </div>
        </div>
      </div>
    </div>

    <!-- Payment Links History Table -->
    <div class="pay-card" style="margin-top:24px;">
      <div class="pay-card-header">
        <h3 class="pay-card-title">📋 Payment Links History</h3>
        <button class="pay-btn pay-btn-sm pay-btn-outline" onclick="PayAdmin.loadPaymentLinks()">🔄 Refresh</button>
      </div>

      <!-- Filters -->
      <div class="pay-filters" style="padding:16px 20px 0 20px;">
        <input type="text" id="plFilterSearch" placeholder="Search title, customer, ref, or token…" class="pay-input" oninput="PayAdmin.filterPaymentLinks()" style="flex:1;min-width:220px;">
        <select id="plFilterStatus" class="pay-select" onchange="PayAdmin.filterPaymentLinks()">
          <option value="all">All Status</option>
          <option value="unpaid">Unpaid (Active)</option>
          <option value="paid">Paid &amp; Verified</option>
          <option value="pending">Pending Verification</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div id="paymentLinksTable" class="pay-table-wrap">
        <div class="pay-empty">Loading payment links…</div>
      </div>
      <div class="pay-pagination" id="paymentLinksPagination"></div>
    </div>
  </section>

  <!-- ── QR Verification Queue ── -->
  <section id="sec-qr_queue" class="pay-section">
    <div class="pay-section-header">
      <h1 class="pay-section-title">QR Payment Verification Queue</h1>
      <button class="pay-btn pay-btn-outline" onclick="PayAdmin.loadQrQueue()">🔄 Refresh</button>
    </div>
    <p class="pay-desc">Review and approve customer UPI payment submissions. Never mark a payment as approved unless you have independently verified the UTR reference in your bank statement or UPI app.</p>
    <div id="qrQueueList" class="pay-qr-queue">
      <div class="pay-empty">Loading queue…</div>
    </div>
  </section>

  <!-- ── Reports Section ── -->
  <section id="sec-reports" class="pay-section">
    <div class="pay-section-header">
      <h1 class="pay-section-title">Payment Reports</h1>
    </div>
    <div class="pay-reports-grid" id="reportsGrid">
      <div class="pay-spinner"></div>
    </div>
  </section>

  <!-- ── Audit Log Section ── -->
  <section id="sec-audit" class="pay-section">
    <div class="pay-section-header">
      <h1 class="pay-section-title">Audit Log</h1>
    </div>
    <div id="auditList" class="pay-audit-list">
      <div class="pay-empty">Loading audit log…</div>
    </div>
    <div class="pay-pagination" id="auditPagination"></div>
  </section>

  <!-- ── Settings Section ── -->
  <section id="sec-settings" class="pay-section">
    <div class="pay-section-header">
      <h1 class="pay-section-title">GreenHarvest Pay Settings</h1>
    </div>

    <div class="pay-card">
      <div class="pay-card-header">
        <h3 class="pay-card-title">💡 Mode & Provider</h3>
      </div>
      <form id="settingsForm" onsubmit="PayAdmin.saveSettings(event)">
        <input type="hidden" name="_csrf" id="settingsCsrf" value="<?= htmlspecialchars($csrfToken) ?>">

        <div class="pay-form-group">
          <label class="pay-label">Payment Mode</label>
          <div class="pay-mode-toggle">
            <label class="pay-mode-opt">
              <input type="radio" name="mode" value="sandbox" id="modeSandbox" checked>
              <span class="pay-mode-card pay-mode-sandbox">
                🧪 Sandbox (Testing)<br>
                <small>No real money. Safe for development.</small>
              </span>
            </label>
            <label class="pay-mode-opt">
              <input type="radio" name="mode" value="live" id="modeLive">
              <span class="pay-mode-card pay-mode-live">
                🔴 Live (Production)<br>
                <small>Real payments. Requires valid merchant credentials.</small>
              </span>
            </label>
          </div>
        </div>

        <div class="pay-form-group">
          <label class="pay-label">Enabled Payment Methods</label>
          <div class="pay-checkboxes">
            <label><input type="checkbox" name="method_qr_upi" value="1"> QR / UPI (Manual Verification)</label>
            <label><input type="checkbox" name="method_cod" value="1"> Cash on Delivery (COD)</label>
            <label><input type="checkbox" name="method_sandbox" value="1"> Sandbox (Testing Only)</label>
            <label><input type="checkbox" name="method_live_upi" value="1"> Live UPI (Provider Required)</label>
            <label><input type="checkbox" name="method_live_card" value="1"> Card Payments (Provider Required)</label>
          </div>
        </div>

        <div class="pay-form-group">
          <label class="pay-label">Live Payment Provider</label>
          <select name="live_provider" id="liveProvider" class="pay-select" onchange="PayAdmin.toggleProviderFields()">
            <option value="none">None (Sandbox / QR only)</option>
            <option value="razorpay">Razorpay</option>
            <option value="cashfree">Cashfree</option>
            <option value="phonepe">PhonePe (Coming soon)</option>
          </select>
        </div>

        <div id="liveProviderFields" style="display:none;">
          <div class="pay-alert pay-alert-warning">
            ⚠️ Credentials reference the <strong>name</strong> of the environment variable on Render, not the value itself.
            Never enter actual API keys in this form — they are read from Render env vars at runtime.
          </div>
          <div class="pay-form-group">
            <label class="pay-label">Key ID — Render env var name</label>
            <input type="text" name="provider_key_env" id="providerKeyEnv" class="pay-input" placeholder="e.g. GH_LIVE_KEY_ID">
          </div>
          <div class="pay-form-group">
            <label class="pay-label">Key Secret — Render env var name</label>
            <input type="text" name="provider_secret_env" id="providerSecretEnv" class="pay-input" placeholder="e.g. GH_LIVE_KEY_SECRET">
          </div>
          <div class="pay-form-group">
            <label class="pay-label">Webhook Secret — Render env var name</label>
            <input type="text" name="webhook_secret_env" id="webhookSecretEnv" class="pay-input" placeholder="e.g. GH_WEBHOOK_SECRET">
          </div>
        </div>

        <div class="pay-form-group">
          <label class="pay-label">UPI ID (for QR display)</label>
          <input type="text" name="upi_id" id="settingsUpiId" class="pay-input" placeholder="yourname@upi">
        </div>

        <div class="pay-form-group">
          <label class="pay-label">Upload QR Code Image</label>
          <div class="pay-qr-preview-wrap">
            <img id="qrPreviewImg" src="" alt="QR Code" style="display:none;max-width:180px;border-radius:12px;border:2px solid var(--pay-border);">
            <div id="qrPreviewNone" class="pay-qr-placeholder">No QR uploaded</div>
          </div>
          <input type="file" id="qrImageInput" accept="image/jpeg,image/png,image/webp" class="pay-input" style="margin-top:8px;">
          <button type="button" class="pay-btn pay-btn-outline pay-btn-sm" onclick="PayAdmin.uploadQr()" style="margin-top:8px;">Upload QR Image</button>
        </div>

        <div class="pay-form-group">
          <label class="pay-checkbox-label">
            <input type="checkbox" name="manual_verify_enabled" id="manualVerify" value="1" checked>
            Enable manual QR/UPI verification queue
          </label>
        </div>

        <div class="pay-form-group" id="sandboxAutoField">
          <label class="pay-checkbox-label">
            <input type="checkbox" name="sandbox_auto_approve" id="sandboxAuto" value="1">
            Auto-approve sandbox payments (for testing only — never enable in live mode)
          </label>
        </div>

        <div class="pay-form-actions">
          <button type="submit" class="pay-btn pay-btn-primary">💾 Save Settings</button>
        </div>
      </form>
    </div>

    <!-- Webhook config info -->
    <div class="pay-card" style="margin-top:24px;">
      <div class="pay-card-header"><h3 class="pay-card-title">🔗 Webhook Configuration</h3></div>
      <div class="pay-webhook-info">
        <p>Configure this URL in your payment provider dashboard:</p>
        <div class="pay-code-block" id="webhookUrl">Loading…</div>
        <p style="margin-top:12px;font-size:13px;color:var(--pay-text-muted);">
          Your webhook secret must be set as the <code>GH_WEBHOOK_SECRET</code> environment variable on Render.
          Never paste the actual secret value here.
        </p>
      </div>
    </div>
  </section>

</main>

<!-- ═══════════ ACTION MODAL ═══════ -->
<div class="pay-modal-overlay" id="payModal" onclick="if(event.target===this)PayAdmin.closeModal()">
  <div class="pay-modal-card" id="payModalCard">
    <button class="pay-modal-close" onclick="PayAdmin.closeModal()">✕</button>
    <div id="payModalBody"></div>
  </div>
</div>

<!-- ═══════════ TOAST ══════════════ -->
<div class="pay-toast" id="payToast"></div>

<!-- Hidden CSRF for JS -->
<script>window.GH_CSRF = "<?= htmlspecialchars($csrfToken) ?>";</script>
<script>window.GH_OWNER = <?= json_encode(['name' => $user['name'], 'id' => $user['id']]) ?>;</script>

<script src="assets/pay.js?v=<?= filemtime(__DIR__ . '/assets/pay.js') ?>"></script>

</body>
</html>
