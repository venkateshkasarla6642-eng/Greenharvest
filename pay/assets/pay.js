/* =====================================================================
   GreenHarvest Pay — Admin Dashboard JavaScript
   All API calls go through /pay/api.php
   CSRF token always included in POST requests
   ===================================================================== */

'use strict';

const PayAdmin = (function() {

  let currentPage = { transactions: 1, audit: 1 };
  const API = '/pay/api.php';
  const CSRF = window.GH_CSRF || '';

  // ─── Utility ────────────────────────────────────────────────────────────

  function api(params, method = 'GET') {
    const url = API + (method === 'GET' ? '?' + new URLSearchParams(params).toString() : '');
    const opts = { credentials: 'same-origin' };

    if (method === 'POST') {
      const body = new URLSearchParams(params);
      body.set('_csrf', CSRF);
      opts.method  = 'POST';
      opts.body    = body;
    }

    return fetch(url, opts).then(r => r.json()).catch(e => ({ error: e.message }));
  }

  function apiPost(action, data = {}) {
    return api({ action, ...data }, 'POST');
  }

  function apiGet(action, data = {}) {
    return api({ action, ...data }, 'GET');
  }

  function toast(msg, type = '') {
    const el = document.getElementById('payToast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'pay-toast show' + (type ? ' ' + type : '');
    setTimeout(() => el.classList.remove('show'), 3500);
  }

  function fmtCurrency(v) {
    return '₹' + parseFloat(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(str) {
    if (!str) return '—';
    return new Date(str).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function statusBadge(s, isSandbox) {
    const sandboxTag = isSandbox ? '<span class="pay-status pay-status-sandbox" style="margin-left:4px;">TEST</span>' : '';
    return `<span class="pay-status pay-status-${esc(s)}">${esc(s)}</span>${sandboxTag}`;
  }

  function methodBadge(m) {
    const icons = { qr_upi: '📱', cod: '💵', sandbox: '🧪', live_upi: '⚡', live_card: '💳', live_netbanking: '🏦' };
    return `<span style="font-size:13px;">${icons[m] || '💳'} ${esc(m)}</span>`;
  }

  // ─── Sidebar / Navigation ────────────────────────────────────────────────

  function showSection(name, el) {
    document.querySelectorAll('.pay-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.pay-nav-item').forEach(n => n.classList.remove('active'));

    const sec = document.getElementById('sec-' + name);
    if (sec) sec.classList.add('active');
    if (el) el.classList.add('active');

    // Lazy-load section data
    switch(name) {
      case 'overview':     loadDashboard();      break;
      case 'transactions': loadTransactions();   break;
      case 'qr_queue':     loadQrQueue();        break;
      case 'reports':      loadReports();        break;
      case 'audit':        loadAudit();          break;
      case 'settings':     loadSettings();       break;
    }
  }

  function toggleSidebar() {
    document.getElementById('paySidebar').classList.toggle('open');
    document.getElementById('paySidebarOverlay').classList.toggle('open');
  }

  function closeSidebar() {
    document.getElementById('paySidebar').classList.remove('open');
    document.getElementById('paySidebarOverlay').classList.remove('open');
  }

  // ─── Dashboard ───────────────────────────────────────────────────────────

  async function loadDashboard() {
    const res = await apiGet('owner_dashboard');
    if (res.error) { toast('Failed to load dashboard: ' + res.error, 'error'); return; }

    const ps = res.pay_stats || {};
    const os = res.order_stats || {};
    const byStatus = ps.by_status || {};
    const paid = byStatus.paid || { count: 0, total: 0 };
    const pending = byStatus.pending || { count: 0, total: 0 };
    const failed = byStatus.failed || { count: 0 };
    const refunded = byStatus.refunded || { count: 0 };

    setText('statPaidTotal',    fmtCurrency(paid.total));
    setText('statPaidCount',    paid.count + ' transactions');
    setText('statPendingCount', pending.count);
    setText('statPendingQr',    (ps.pending_qr_queue || 0) + ' QR awaiting review');
    setText('statFailedCount',  failed.count);
    setText('statRefundCount',  refunded.count + ' refunded');
    setText('statTodayPaid',    fmtCurrency(ps.today_paid || 0));
    setText('statTotalOrders',  (os.total_orders || 0) + ' total orders');

    // Mode pill
    const isLive = ps.mode === 'live';
    const pill = document.getElementById('modePill');
    if (pill) {
      pill.className = 'pay-mode-pill' + (isLive ? ' live-mode' : '');
      setText('modePillText', isLive ? '🔴 Live Mode' : '🧪 Sandbox Mode');
    }

    // Update topbar badge
    const tbBadge = document.getElementById('topbarModeBadge');
    if (tbBadge) {
      tbBadge.textContent = isLive ? 'LIVE' : 'SANDBOX';
      tbBadge.className   = 'pay-mode-badge' + (isLive ? ' live-mode' : '');
    }

    // QR queue badge
    const qrBadge = document.getElementById('qrQueueBadge');
    if (qrBadge && ps.pending_qr_queue > 0) {
      qrBadge.textContent = ps.pending_qr_queue;
      qrBadge.style.display = '';
    }

    // Provider status
    const prov = document.getElementById('providerStatus');
    if (prov) {
      prov.innerHTML = `
        <div class="pay-provider-stat">
          <div class="pay-provider-stat-label">Current Mode</div>
          <div class="pay-provider-stat-value">${isLive ? '🔴 Live' : '🧪 Sandbox'}</div>
        </div>
        <div class="pay-provider-stat">
          <div class="pay-provider-stat-label">Live Provider</div>
          <div class="pay-provider-stat-value">${esc(ps.live_provider || 'None')}</div>
        </div>
        <div class="pay-provider-stat">
          <div class="pay-provider-stat-label">Provider Config</div>
          <div class="pay-provider-stat-value">${ps.live_configured ? '✅ Configured' : '⚠️ Not Configured'}</div>
        </div>
        <div class="pay-provider-stat">
          <div class="pay-provider-stat-label">Total Live Revenue</div>
          <div class="pay-provider-stat-value">${fmtCurrency(os.total_paid || 0)}</div>
        </div>
      `;
    }

    // Recent transactions
    loadRecentTransactions();
  }

  async function loadRecentTransactions() {
    const res = await apiGet('owner_transactions', { page: 1 });
    const container = document.getElementById('recentTransactions');
    if (!container) return;

    if (res.error || !Array.isArray(res.transactions) || res.transactions.length === 0) {
      container.innerHTML = '<div class="pay-empty">No transactions yet.</div>';
      return;
    }

    const rows = res.transactions.slice(0, 5);
    container.innerHTML = renderTransactionTable(rows);
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ─── Transactions ────────────────────────────────────────────────────────

  let filterDebounce = null;

  function filterTransactions() {
    clearTimeout(filterDebounce);
    filterDebounce = setTimeout(() => {
      currentPage.transactions = 1;
      loadTransactions();
    }, 350);
  }

  async function loadTransactions(page = null) {
    if (page !== null) currentPage.transactions = page;

    const filters = {
      action:     'owner_transactions',
      status:     document.getElementById('txStatus')?.value   || 'all',
      method:     document.getElementById('txMethod')?.value   || 'all',
      search:     document.getElementById('txSearch')?.value   || '',
      date_from:  document.getElementById('txDateFrom')?.value || '',
      date_to:    document.getElementById('txDateTo')?.value   || '',
      is_sandbox: document.getElementById('txSandbox')?.value  || '',
      page:       currentPage.transactions
    };

    const el = document.getElementById('txTable');
    if (el) el.innerHTML = '<div class="pay-empty"><div class="pay-spinner"></div></div>';

    const res = await apiGet('owner_transactions', filters);
    if (!el) return;

    if (res.error) {
      el.innerHTML = '<div class="pay-empty">Error loading transactions.</div>';
      return;
    }

    if (!Array.isArray(res.transactions) || res.transactions.length === 0) {
      el.innerHTML = '<div class="pay-empty">No transactions found.</div>';
      document.getElementById('txPagination').innerHTML = '';
      return;
    }

    el.innerHTML = renderTransactionTable(res.transactions);

    // Pagination
    const pg = document.getElementById('txPagination');
    if (pg) {
      const hasPrev = currentPage.transactions > 1;
      const hasNext = res.transactions.length >= 25;
      pg.innerHTML = `
        ${hasPrev ? `<button onclick="PayAdmin.loadTransactions(${currentPage.transactions - 1})">← Prev</button>` : ''}
        <button class="active">Page ${currentPage.transactions}</button>
        ${hasNext ? `<button onclick="PayAdmin.loadTransactions(${currentPage.transactions + 1})">Next →</button>` : ''}
      `;
    }
  }

  function renderTransactionTable(rows) {
    return `
      <table class="pay-table">
        <thead><tr>
          <th>Payment Ref</th>
          <th>Order</th>
          <th>Customer</th>
          <th>Amount</th>
          <th>Method</th>
          <th>Status</th>
          <th>Date</th>
          <th>Actions</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><code style="font-size:11px;color:#6366f1;">${esc(r.payment_ref)}</code></td>
              <td>${esc(r.order_number)}</td>
              <td>${esc(r.customer_name)}<br><small style="color:var(--pay-text-muted);">${esc(r.customer_phone)}</small></td>
              <td><strong>${fmtCurrency(r.amount)}</strong></td>
              <td>${methodBadge(r.method)}</td>
              <td>${statusBadge(r.status, r.is_sandbox == 1)}</td>
              <td style="font-size:12px;white-space:nowrap;">${fmtDate(r.created_at)}</td>
              <td>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                  ${r.status === 'pending' ? `<button class="pay-btn pay-btn-sm pay-btn-success" onclick="PayAdmin.openVerify(${r.id})">✅ Verify</button>` : ''}
                  ${r.status === 'paid' ? `<button class="pay-btn pay-btn-sm pay-btn-outline" onclick="PayAdmin.openRefund(${r.id}, '${esc(r.payment_ref)}')">↩ Refund</button>` : ''}
                  ${r.is_sandbox == 1 && ['initiated','pending'].includes(r.status) ? `<button class="pay-btn pay-btn-sm pay-btn-outline" onclick="PayAdmin.openSandboxSim(${r.id}, '${esc(r.payment_ref)}')">🧪 Simulate</button>` : ''}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // ─── QR Queue ────────────────────────────────────────────────────────────

  async function loadQrQueue() {
    const el = document.getElementById('qrQueueList');
    if (el) el.innerHTML = '<div class="pay-empty"><div class="pay-spinner"></div></div>';

    const res = await apiGet('owner_qr_queue');
    if (!el) return;

    const qrBadge = document.getElementById('qrQueueBadge');
    if (qrBadge) {
      qrBadge.textContent = res.count || 0;
      qrBadge.style.display = res.count > 0 ? '' : 'none';
    }

    if (res.error || !Array.isArray(res.queue) || res.queue.length === 0) {
      el.innerHTML = '<div class="pay-empty">✅ No pending QR verifications. Queue is empty.</div>';
      return;
    }

    el.innerHTML = res.queue.map(q => `
      <div class="pay-qr-item">
        <div>
          <div class="pay-qr-item-header">
            <span class="pay-status pay-status-pending">⏳ Pending</span>
            <span style="font-size:12px;color:var(--pay-text-muted);">Submitted ${fmtDate(q.created_at)}</span>
          </div>
          <div class="pay-qr-item-meta">
            <div>📦 Order: <strong>${esc(q.order_number)}</strong></div>
            <div>💰 Amount: <strong>${fmtCurrency(q.amount)}</strong></div>
            <div>👤 Customer: <strong>${esc(q.customer_name)}</strong> — ${esc(q.customer_phone)}</div>
            <div>🔑 UTR Ref: <strong>${esc(q.utr_reference)}</strong></div>
            <div>📋 Payment Ref: <code style="font-size:11px;">${esc(q.payment_ref)}</code></div>
            ${q.screenshot_path ? `<div style="margin-top:8px;"><a href="/${esc(q.screenshot_path)}" target="_blank" class="pay-btn pay-btn-sm pay-btn-outline">🖼 View Screenshot</a></div>` : '<div>📸 No screenshot uploaded</div>'}
          </div>
        </div>
        <div class="pay-qr-item-actions">
          <button class="pay-btn pay-btn-sm pay-btn-success" onclick="PayAdmin.verifyQr(${q.id}, 'approved')">✅ Approve</button>
          <button class="pay-btn pay-btn-sm pay-btn-danger"  onclick="PayAdmin.verifyQr(${q.id}, 'rejected')">❌ Reject</button>
        </div>
      </div>
    `).join('');
  }

  async function verifyQr(submissionId, decision) {
    let reason = '';
    if (decision === 'rejected') {
      reason = window.prompt('Rejection reason (shown to customer):') || '';
      if (!reason && !confirm('Reject without providing a reason?')) return;
    } else {
      if (!confirm('Approve this QR payment? This will mark the order as PAID. Confirm you have verified the UTR in your bank statement or UPI app.')) return;
    }

    const res = await apiPost('owner_verify_qr', {
      submission_id: submissionId,
      decision,
      reason
    });

    if (res.success) {
      toast(`Payment ${decision} successfully!`, 'success');
      loadQrQueue();
      loadDashboard();
    } else {
      toast(res.error || 'Operation failed.', 'error');
    }
  }

  // ─── Verify / Refund / Simulate Modals ──────────────────────────────────

  function openVerify(attemptId) {
    openModal(`
      <h3 style="margin-bottom:16px;font-weight:800;">✅ Manually Verify Payment</h3>
      <p style="color:var(--pay-text-muted);font-size:13px;margin-bottom:16px;">
        Set the outcome for payment attempt #${attemptId}. For live payments, verification should happen via the webhook or QR queue.
      </p>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button class="pay-btn pay-btn-success" onclick="PayAdmin.doVerify(${attemptId},'paid')">✅ Mark as Paid</button>
        <button class="pay-btn pay-btn-danger"  onclick="PayAdmin.doVerify(${attemptId},'failed')">❌ Mark as Failed</button>
        <button class="pay-btn pay-btn-outline" onclick="PayAdmin.doVerify(${attemptId},'pending')">⏳ Set Pending</button>
      </div>
    `);
  }

  async function doVerify(attemptId, outcome) {
    closeModal();
    const res = await apiPost('owner_verify_payment', { attempt_id: attemptId, outcome });
    if (res.success) {
      toast(`Payment marked as ${outcome}!`, 'success');
      loadTransactions();
      loadDashboard();
    } else {
      toast(res.error || 'Verification failed.', 'error');
    }
  }

  function openRefund(attemptId, payRef) {
    openModal(`
      <h3 style="margin-bottom:16px;font-weight:800;">↩ Refund Payment</h3>
      <p style="color:var(--pay-text-muted);font-size:13px;margin-bottom:16px;">
        Issue a refund for <code style="color:#6366f1;">${esc(payRef)}</code>.<br>
        For live payments, this triggers the provider refund API.<br>
        For sandbox/QR payments, the status is updated in the database only.
      </p>
      <div class="pay-form-group" style="padding:0 0 16px;">
        <label class="pay-label">Reason for Refund</label>
        <input type="text" id="refundReason" class="pay-input" placeholder="Customer requested refund…" style="width:100%;">
      </div>
      <div style="display:flex;gap:10px;">
        <button class="pay-btn pay-btn-danger" onclick="PayAdmin.doRefund(${attemptId})">↩ Issue Refund</button>
        <button class="pay-btn pay-btn-outline" onclick="PayAdmin.closeModal()">Cancel</button>
      </div>
    `);
  }

  async function doRefund(attemptId) {
    const reason = document.getElementById('refundReason')?.value || '';
    closeModal();
    const res = await apiPost('owner_refund', { attempt_id: attemptId, reason });
    if (res.success) {
      toast('Refund issued!', 'success');
      loadTransactions();
      loadDashboard();
    } else {
      toast(res.error || 'Refund failed.', 'error');
    }
  }

  function openSandboxSim(attemptId, payRef) {
    openModal(`
      <h3 style="margin-bottom:16px;font-weight:800;">🧪 Simulate Sandbox Payment</h3>
      <p style="color:var(--pay-text-muted);font-size:13px;margin-bottom:16px;">
        Simulate a payment outcome for <code style="color:#6366f1;">${esc(payRef)}</code>.<br>
        This only affects sandbox/test transactions.
      </p>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button class="pay-btn pay-btn-success" onclick="PayAdmin.doSandboxSim('${esc(payRef)}','paid')">✅ Simulate Success</button>
        <button class="pay-btn pay-btn-danger"  onclick="PayAdmin.doSandboxSim('${esc(payRef)}','failed')">❌ Simulate Failure</button>
        <button class="pay-btn pay-btn-outline" onclick="PayAdmin.doSandboxSim('${esc(payRef)}','pending')">⏳ Simulate Pending</button>
        <button class="pay-btn pay-btn-outline" onclick="PayAdmin.doSandboxSim('${esc(payRef)}','cancelled')">🚫 Simulate Cancel</button>
      </div>
    `);
  }

  async function doSandboxSim(payRef, outcome) {
    closeModal();
    const res = await apiPost('sandbox_simulate', { payment_ref: payRef, outcome });
    if (res.success) {
      toast('Simulated: ' + outcome, 'success');
      loadTransactions();
      loadDashboard();
    } else {
      toast(res.error || 'Simulation failed.', 'error');
    }
  }

  // ─── Reports ─────────────────────────────────────────────────────────────

  async function loadReports() {
    const el = document.getElementById('reportsGrid');
    if (!el) return;
    el.innerHTML = '<div class="pay-spinner"></div>';

    // Fetch dashboard stats for report numbers
    const res = await apiGet('owner_dashboard');
    if (res.error) {
      el.innerHTML = '<div class="pay-empty">Failed to load reports.</div>';
      return;
    }

    const os = res.order_stats || {};
    const ps = res.pay_stats?.by_status || {};

    el.innerHTML = `
      <div class="pay-card">
        <div class="pay-card-header"><h3 class="pay-card-title">💰 Payment Summary</h3></div>
        <div style="padding:16px 20px;display:flex;flex-direction:column;gap:10px;font-size:14px;">
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--pay-text-muted);">Total Verified Paid</span><strong style="color:#10b981;">${fmtCurrency(os.total_paid)}</strong></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--pay-text-muted);">Paid Transactions</span><strong>${os.paid_count || 0}</strong></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--pay-text-muted);">Pending Transactions</span><strong style="color:#f59e0b;">${os.pending_count || 0}</strong></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--pay-text-muted);">Failed Transactions</span><strong style="color:#ef4444;">${os.failed_count || 0}</strong></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--pay-text-muted);">Refunded Transactions</span><strong style="color:#818cf8;">${os.refunded_count || 0}</strong></div>
          <div style="display:flex;justify-content:space-between;border-top:1px solid var(--pay-border);padding-top:10px;"><span style="color:var(--pay-text-muted);">Total Orders</span><strong>${os.total_orders || 0}</strong></div>
        </div>
      </div>
      <div class="pay-card">
        <div class="pay-card-header"><h3 class="pay-card-title">📊 Payment Attempts (GHPay)</h3></div>
        <div style="padding:16px 20px;display:flex;flex-direction:column;gap:10px;font-size:14px;">
          ${Object.entries(ps).map(([s, d]) => `
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span>${statusBadge(s, false)}</span>
              <span><strong>${d.count}</strong> — ${fmtCurrency(d.total)}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="pay-card" style="grid-column:1/-1;">
        <div class="pay-card-header">
          <h3 class="pay-card-title">⬇ CSV Export</h3>
        </div>
        <div style="padding:16px 20px;display:flex;flex-wrap:wrap;gap:10px;">
          <button class="pay-btn pay-btn-primary" onclick="PayAdmin.exportCsv()">⬇ All Transactions</button>
          <button class="pay-btn pay-btn-outline" onclick="PayAdmin.exportCsv('paid')">⬇ Paid Only</button>
          <button class="pay-btn pay-btn-outline" onclick="PayAdmin.exportCsv('pending')">⬇ Pending Only</button>
        </div>
        <p style="padding:0 20px 16px;font-size:12px;color:var(--pay-text-muted);">CSV exports do not include API keys, webhook secrets, or customer passwords.</p>
      </div>
    `;
  }

  // ─── Audit Log ───────────────────────────────────────────────────────────

  async function loadAudit(page = 1) {
    currentPage.audit = page;
    const el = document.getElementById('auditList');
    if (el) el.innerHTML = '<div class="pay-spinner"></div>';

    const res = await apiGet('owner_audit_log', { page });
    if (!el) return;

    if (res.error || !Array.isArray(res.logs) || res.logs.length === 0) {
      el.innerHTML = '<div class="pay-empty">No audit events yet.</div>';
      return;
    }

    const actionIcons = {
      payment_initiated: '🚀', payment_verified: '✅', payment_refunded: '↩',
      qr_payment_submitted: '📱', qr_submission_verified: '🔍',
      settings_updated: '⚙️', qr_image_uploaded: '🖼',
      webhook_processed: '🔗', webhook_rejected: '⛔'
    };

    el.innerHTML = res.logs.map(l => `
      <div class="pay-audit-item">
        <div class="pay-audit-icon">${actionIcons[l.action] || '📋'}</div>
        <div style="flex:1;">
          <div class="pay-audit-action">${esc(l.action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}</div>
          <div class="pay-audit-meta">
            ${l.user_name ? `By: <strong>${esc(l.user_name)}</strong> (${esc(l.user_role_name || '')})` : 'System'}
            ${l.entity_type ? ` · ${esc(l.entity_type)} #${l.entity_id}` : ''}
          </div>
          ${l.meta ? `<div style="font-size:11px;color:var(--pay-text-muted);margin-top:4px;font-family:monospace;">${esc(l.meta)}</div>` : ''}
        </div>
        <div class="pay-audit-time">${fmtDate(l.created_at)}</div>
      </div>
    `).join('');

    // Pagination
    const pg = document.getElementById('auditPagination');
    if (pg) {
      const hasPrev = page > 1;
      const hasNext = res.logs.length >= 30;
      pg.innerHTML = `
        ${hasPrev ? `<button onclick="PayAdmin.loadAudit(${page-1})">← Prev</button>` : ''}
        <button class="active">Page ${page}</button>
        ${hasNext ? `<button onclick="PayAdmin.loadAudit(${page+1})">Next →</button>` : ''}
      `;
    }
  }

  // ─── Settings ────────────────────────────────────────────────────────────

  async function loadSettings() {
    const res = await apiGet('owner_get_settings');
    if (res.error || !res.settings) {
      toast('Failed to load settings.', 'error');
      return;
    }

    const s = res.settings;

    // Mode radio
    const modeEl = document.getElementById(s.mode === 'live' ? 'modeLive' : 'modeSandbox');
    if (modeEl) modeEl.checked = true;

    // Enabled methods checkboxes
    const methods = (s.enabled_methods || '').split(',').map(m => m.trim());
    ['qr_upi','cod','sandbox','live_upi','live_card'].forEach(m => {
      const cb = document.querySelector(`input[name="method_${m}"]`);
      if (cb) cb.checked = methods.includes(m);
    });

    // Provider
    const provEl = document.getElementById('liveProvider');
    if (provEl) {
      provEl.value = s.live_provider || 'none';
      toggleProviderFields();
    }

    // Env var names
    setVal('providerKeyEnv',    s.provider_key_env);
    setVal('providerSecretEnv', s.provider_secret_env);
    setVal('webhookSecretEnv',  s.webhook_secret_env);
    setVal('settingsUpiId',     s.upi_id);

    // Checkboxes
    const mvEl = document.getElementById('manualVerify');
    if (mvEl) mvEl.checked = !!parseInt(s.manual_verify_enabled);
    const saEl = document.getElementById('sandboxAuto');
    if (saEl) saEl.checked = !!parseInt(s.sandbox_auto_approve);

    // QR preview
    if (s.qr_image_path) {
      const img = document.getElementById('qrPreviewImg');
      const placeholder = document.getElementById('qrPreviewNone');
      if (img) { img.src = '/' + s.qr_image_path; img.style.display = ''; }
      if (placeholder) placeholder.style.display = 'none';
    }

    // Webhook URL
    const whu = document.getElementById('webhookUrl');
    if (whu) whu.textContent = window.location.origin + '/pay/webhook.php';
  }

  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  }

  function toggleProviderFields() {
    const prov = document.getElementById('liveProvider')?.value;
    const fields = document.getElementById('liveProviderFields');
    if (fields) fields.style.display = (prov && prov !== 'none') ? 'block' : 'none';
  }

  async function saveSettings(e) {
    e.preventDefault();
    const form = document.getElementById('settingsForm');
    if (!form) return;

    // Build enabled_methods string from checkboxes
    const methods = [];
    ['qr_upi','cod','sandbox','live_upi','live_card'].forEach(m => {
      if (form.querySelector(`input[name="method_${m}"]`)?.checked) methods.push(m);
    });

    const data = {
      mode:                  form.querySelector('input[name="mode"]:checked')?.value || 'sandbox',
      enabled_methods:       methods.join(','),
      live_provider:         document.getElementById('liveProvider')?.value || 'none',
      provider_key_env:      document.getElementById('providerKeyEnv')?.value || '',
      provider_secret_env:   document.getElementById('providerSecretEnv')?.value || '',
      webhook_secret_env:    document.getElementById('webhookSecretEnv')?.value || '',
      upi_id:                document.getElementById('settingsUpiId')?.value || '',
      manual_verify_enabled: document.getElementById('manualVerify')?.checked ? 1 : 0,
      sandbox_auto_approve:  document.getElementById('sandboxAuto')?.checked ? 1 : 0
    };

    const res = await apiPost('owner_update_settings', data);
    if (res.success) {
      toast('Settings saved!', 'success');
      loadDashboard();
    } else {
      toast(res.error || 'Save failed.', 'error');
    }
  }

  async function uploadQr() {
    const input = document.getElementById('qrImageInput');
    if (!input?.files?.length) {
      toast('Please select a QR image file first.', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('action', 'owner_upload_qr');
    formData.append('_csrf', CSRF);
    formData.append('qr_image', input.files[0]);

    const res = await fetch(API, {
      method: 'POST',
      body: formData,
      credentials: 'same-origin'
    }).then(r => r.json()).catch(e => ({ error: e.message }));

    if (res.success) {
      toast('QR image uploaded!', 'success');
      const img = document.getElementById('qrPreviewImg');
      const placeholder = document.getElementById('qrPreviewNone');
      if (img) { img.src = '/' + res.qr_image_path + '?v=' + Date.now(); img.style.display = ''; }
      if (placeholder) placeholder.style.display = 'none';
    } else {
      toast(res.error || 'Upload failed.', 'error');
    }
  }

  // ─── CSV Export ──────────────────────────────────────────────────────────

  function exportCsv(status = '') {
    const params = new URLSearchParams({ action: 'owner_export_csv' });
    if (status) params.set('status', status);
    window.open(API + '?' + params.toString(), '_blank');
  }

  // ─── Modal helpers ───────────────────────────────────────────────────────

  function openModal(html) {
    const body = document.getElementById('payModalBody');
    const ov   = document.getElementById('payModal');
    if (body) body.innerHTML = html;
    if (ov)   ov.classList.add('show');
  }

  function closeModal() {
    const ov = document.getElementById('payModal');
    if (ov) ov.classList.remove('show');
  }

  // ─── Init ────────────────────────────────────────────────────────────────

  function init() {
    loadDashboard();
    // Auto-refresh dashboard every 60 seconds
    setInterval(loadDashboard, 60000);
  }

  document.addEventListener('DOMContentLoaded', init);

  // Public API
  return {
    showSection,
    toggleSidebar,
    closeSidebar,
    loadDashboard,
    loadTransactions,
    filterTransactions,
    loadQrQueue,
    loadAudit,
    loadReports,
    loadSettings,
    verifyQr,
    openVerify,
    doVerify,
    openRefund,
    doRefund,
    openSandboxSim,
    doSandboxSim,
    exportCsv,
    saveSettings,
    uploadQr,
    toggleProviderFields,
    openModal,
    closeModal
  };

})();
