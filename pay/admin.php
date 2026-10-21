<?php
// pay/admin.php — GreenHarvest Pay Owner Administration Dashboard
// ACCESS: Only authenticated users with role = 'owner' can view this page.
// Any other role gets a hard redirect. No information leakage.

require_once __DIR__ . '/../config.php';

$user = getCurrentUser();

// ─── Server-side owner check — MUST be first ─────────────────────────────────
if (!$user || $user['role'] !== 'owner') {
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
