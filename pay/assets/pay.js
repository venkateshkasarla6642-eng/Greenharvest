/* =====================================================================
   GreenHarvest Pay — Admin Dashboard JavaScript
   All API calls go through /pay/api.php
   CSRF token always included in POST requests
   ===================================================================== */

'use strict';

const PayAdmin = (function() {

  let currentPage = { transactions: 1, audit: 1 };
  const API = 'api.php';
  const CSRF = window.GH_CSRF || '';

  // ─── Utility ────────────────────────────────────────────────────────────

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

  function api(params, method = 'GET') {
    const url = API + (method === 'GET' ? '?' + new URLSearchParams(params).toString() : '');
    const opts = { credentials: 'same-origin', signal: _timeoutSignal(45000) };

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
      case 'overview':      loadDashboard();      break;
      case 'transactions':  loadTransactions();   break;
      case 'payment_links': loadPaymentLinks();   break;
      case 'qr_queue':      loadQrQueue();        break;
      case 'reports':       loadReports();        break;
      case 'audit':         loadAudit();          break;
      case 'settings':      loadSettings();       break;
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

    // Authoritative mode badge and pills update
    updateModeBadge(
      ps.effective_status || (ps.mode === 'live' ? (ps.live_configured ? 'LIVE PRODUCTION' : 'LIVE NOT READY') : 'SANDBOX'),
      ps.mode || 'sandbox',
      ps.live_provider || 'none',
      !!ps.live_configured,
      ps.badge_class,
      ps.badge_text,
      ps.pill_text,
      ps.status_message
    );

    // QR queue badge
    const qrBadge = document.getElementById('qrQueueBadge');
    if (qrBadge && ps.pending_qr_queue > 0) {
      qrBadge.textContent = ps.pending_qr_queue;
      qrBadge.style.display = '';
    } else if (qrBadge) {
      qrBadge.style.display = 'none';
    }

    // Provider status
    const isLive = ps.mode === 'live';
    const isConfigured = !!ps.live_configured;
    const prov = document.getElementById('providerStatus');
    if (prov) {
      prov.innerHTML = `
        <div class="pay-provider-stat">
          <div class="pay-provider-stat-label">Current Mode</div>
          <div class="pay-provider-stat-value">${isLive ? (isConfigured ? '🔴 Live Production' : '⚠️ Live Not Ready') : '🧪 Sandbox'}</div>
        </div>
        <div class="pay-provider-stat">
          <div class="pay-provider-stat-label">Live Provider</div>
          <div class="pay-provider-stat-value">${esc((ps.live_provider || 'none').toUpperCase())}</div>
        </div>
        <div class="pay-provider-stat">
          <div class="pay-provider-stat-label">Provider Config</div>
          <div class="pay-provider-stat-value" style="color:${isConfigured ? '#059669' : '#d97706'};font-weight:700;">${isConfigured ? '✅ Configured & Ready' : '⚠️ Configuration Required'}</div>
        </div>
        <div class="pay-provider-stat">
          <div class="pay-provider-stat-label">Total Verified Revenue</div>
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

  // ─── Settings ────────────────────────────────────────────────────────────

  async function loadSettings() {
    const res = await apiGet('owner_get_settings');
    if (res.error || !res.settings) {
      toast('Failed to load settings.', 'error');
      return;
    }

    const s = res.settings;

    // 1. Sync hidden mode input
    const input = document.getElementById('selectedModeInput');
    if (input) input.value = s.mode || 'sandbox';

    // 2. Update all UI badges authoritatively
    updateModeBadge(
      s.effective_status,
      s.mode,
      s.live_provider,
      s.is_ready,
      s.badge_class,
      s.badge_text,
      s.pill_text,
      s.status_message
    );

    // 3. Enabled methods checkboxes
    const methods = (s.enabled_methods || '').split(',').map(m => m.trim());
    ['qr_upi','cod','sandbox','live_upi','live_card'].forEach(m => {
      const cb = document.querySelector(`input[name="method_${m}"]`);
      if (cb) cb.checked = methods.includes(m);
    });

    // 4. Provider selection dropdown
    const provEl = document.getElementById('liveProvider');
    if (provEl) {
      provEl.value = (s.live_provider && s.live_provider !== 'none') ? s.live_provider : 'none';
      toggleProviderFields();
    }

    // 5. Populate separate provider credentials
    setVal('razorpayKeyId',         s.razorpay_key_id);
    setVal('razorpayKeySecret',     s.razorpay_key_secret);
    setVal('razorpayWebhookSecret', s.razorpay_webhook_secret);

    setVal('cashfreeAppId',         s.cashfree_app_id);
    setVal('cashfreeSecretKey',     s.cashfree_secret_key);
    setVal('cashfreeWebhookSecret', s.cashfree_webhook_secret);

    // Legacy fallbacks
    setVal('providerKeyEnv',        s.provider_key_env);
    setVal('providerSecretEnv',     s.provider_secret_env);
    setVal('webhookSecretEnv',      s.webhook_secret_env);
    setVal('settingsUpiId',         s.upi_id);

    // 6. Credentials status banner
    updateCredentialsBanner(s);

    // 7. Checkboxes
    const mvEl = document.getElementById('manualVerify');
    if (mvEl) mvEl.checked = !!parseInt(s.manual_verify_enabled);
    const saEl = document.getElementById('sandboxAuto');
    if (saEl) saEl.checked = !!parseInt(s.sandbox_auto_approve);

    // 8. QR preview
    if (s.qr_image_path) {
      const img = document.getElementById('qrPreviewImg');
      const placeholder = document.getElementById('qrPreviewNone');
      if (img) {
        img.src = (s.qr_image_path.startsWith('data:') || s.qr_image_path.startsWith('http'))
          ? s.qr_image_path
          : ('/' + s.qr_image_path.replace(/^\//, ''));
        img.style.display = 'block';
      }
      if (placeholder) placeholder.style.display = 'none';
    }

    // 9. Webhook URL
    const whu = document.getElementById('webhookUrl');
    if (whu) whu.textContent = window.location.origin + '/pay/webhook.php';
  }

  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  }

  function updateCredentialsBanner(s) {
    const statusBanner = document.getElementById('credentialsStatusBanner');
    if (!statusBanner) return;

    const prov = (s.live_provider || 'none').toLowerCase();
    const hasKeys = !!s.has_live_keys;

    if (hasKeys && prov !== 'none') {
      const isTest = prov === 'cashfree' ? s.is_cashfree_test : s.is_razorpay_test;
      const keyPreview = prov === 'cashfree'
        ? (s.cashfree_app_id || 'Configured')
        : (s.razorpay_key_id ? (s.razorpay_key_id.length > 12 ? (s.razorpay_key_id.slice(0, 8) + '...' + s.razorpay_key_id.slice(-4)) : s.razorpay_key_id) : 'Configured');
      const provLabel = prov === 'cashfree' ? 'Cashfree' : 'Razorpay';

      statusBanner.style.display = 'flex';
      statusBanner.style.background = '#ecfdf5';
      statusBanner.style.border = '1.5px solid #a7f3d0';
      statusBanner.style.color = '#065f46';
      statusBanner.style.alignItems = 'center';
      statusBanner.style.gap = '10px';
      statusBanner.innerHTML = `
        <div style="font-size:24px;">✅</div>
        <div>
          <div style="font-weight:800;font-size:14px;">${provLabel} Gateway Active &amp; Ready!</div>
          <div style="font-size:12px;opacity:0.9;margin-top:2px;">
            Key: <code>${esc(keyPreview)}</code> &bull;
            Mode: <strong style="color:${isTest ? '#2563eb' : '#16a34a'};">${isTest ? '🧪 Test / Sandbox' : '🟢 Live Production'}</strong> &bull;
            Ready to process customer orders.
          </div>
        </div>
      `;
    } else if (s.mode === 'live' && prov !== 'none') {
      const provLabel = prov === 'cashfree' ? 'Cashfree' : 'Razorpay';
      statusBanner.style.display = 'flex';
      statusBanner.style.background = '#fffbeb';
      statusBanner.style.border = '1.5px solid #fcd34d';
      statusBanner.style.color = '#92400e';
      statusBanner.style.alignItems = 'center';
      statusBanner.style.gap = '10px';
      statusBanner.innerHTML = `
        <div style="font-size:24px;">⚠️</div>
        <div>
          <div style="font-weight:800;font-size:14px;">Live Mode Selected — ${provLabel} Credentials Required</div>
          <div style="font-size:12px;opacity:0.9;margin-top:2px;">
            Please enter your ${provLabel} API credentials below and click <strong>Test Connection</strong> to activate.
          </div>
        </div>
      `;
    } else {
      statusBanner.style.display = 'none';
    }
  }

  function toggleProviderFields() {
    const prov = document.getElementById('liveProvider')?.value || 'none';
    const rzpBlock = document.getElementById('providerFieldsRazorpay');
    const cfBlock  = document.getElementById('providerFieldsCashfree');
    const phBlock  = document.getElementById('providerFieldsPhonepe');

    if (rzpBlock) rzpBlock.style.display = (prov === 'razorpay') ? 'block' : 'none';
    if (cfBlock)  cfBlock.style.display  = (prov === 'cashfree') ? 'block' : 'none';
    if (phBlock)  phBlock.style.display  = (prov === 'phonepe') ? 'block' : 'none';

    const warnProv = document.getElementById('warnProviderName');
    if (warnProv) warnProv.textContent = (prov !== 'none') ? prov.toUpperCase() : 'Live Provider';
  }

  function updateModeBadge(effectiveStatus, mode, provider, isConfigured, badgeClass, badgeText, pillText, message) {
    const isLive = (mode === 'live');
    const effStatus = effectiveStatus || (isLive ? (isConfigured ? 'LIVE PRODUCTION' : 'LIVE NOT READY') : 'SANDBOX');
    const isLiveReady = (isLive && isConfigured);
    const isLiveNotReady = (isLive && !isConfigured);

    // 1. Topbar badge (shared desktop & mobile header)
    const tbBadge = document.getElementById('topbarModeBadge');
    if (tbBadge) {
      tbBadge.textContent = badgeText || effStatus;
      tbBadge.className = 'pay-mode-badge ' + (badgeClass || (isLiveReady ? 'live-mode' : (isLiveNotReady ? 'warning-mode' : 'sandbox-mode')));
      if (message) tbBadge.title = message;
    }

    // 2. Overview pill
    const pill = document.getElementById('modePill');
    if (pill) {
      pill.className = 'pay-mode-pill ' + (badgeClass || (isLiveReady ? 'live-mode' : (isLiveNotReady ? 'warning-mode' : 'sandbox-mode')));
      setText('modePillText', pillText || (isLiveReady ? '🔴 Live Production' : (isLiveNotReady ? '⚠️ Live Not Ready' : '🧪 Sandbox Mode')));
      if (message) pill.title = message;
    }

    // 3. Settings pill
    const setPill = document.getElementById('settingsModePill');
    if (setPill) {
      setPill.className = 'pay-mode-pill ' + (badgeClass || (isLiveReady ? 'live-mode' : (isLiveNotReady ? 'warning-mode' : 'sandbox-mode')));
      setText('settingsModePillText', pillText || (isLiveReady ? '🔴 Live Production' : (isLiveNotReady ? '⚠️ Live Not Ready' : '🧪 Sandbox Mode')));
      if (message) setPill.title = message;
    }

    // 4. Settings Mode Cards
    const cardLive = document.getElementById('cardModeLive');
    const cardSandbox = document.getElementById('cardModeSandbox');
    const indLive = document.getElementById('indicatorLive');
    const indSandbox = document.getElementById('indicatorSandbox');

    if (cardLive) {
      if (isLive) cardLive.classList.add('active');
      else cardLive.classList.remove('active');
    }
    if (cardSandbox) {
      if (!isLive) cardSandbox.classList.add('active');
      else cardSandbox.classList.remove('active');
    }
    if (indLive) {
      if (isLive) {
        indLive.style.display = 'inline-block';
        if (isLiveReady) {
          indLive.textContent = 'ACTIVE';
          indLive.style.background = '#ef4444';
          indLive.style.color = '#fff';
        } else {
          indLive.textContent = 'CONFIGURATION REQUIRED';
          indLive.style.background = '#f59e0b';
          indLive.style.color = '#fff';
        }
      } else {
        indLive.style.display = 'none';
      }
    }
    if (indSandbox) {
      indSandbox.style.display = !isLive ? 'inline-block' : 'none';
      indSandbox.textContent = 'ACTIVE';
      indSandbox.style.background = '#10b981';
      indSandbox.style.color = '#fff';
    }

    // 5. Warning banner on Settings page
    const warnEl = document.getElementById('liveConfigWarning');
    if (warnEl) {
      warnEl.style.display = isLiveNotReady ? 'block' : 'none';
      const warnProv = document.getElementById('warnProviderName');
      if (warnProv) warnProv.textContent = (provider && provider !== 'none') ? provider.toUpperCase() : 'Live Provider';
    }
  }

  function updateModeUI(mode) {
    const isLive = (mode === 'live');
    const input = document.getElementById('selectedModeInput');
    if (input) input.value = isLive ? 'live' : 'sandbox';
    updateModeBadge('', isLive ? 'live' : 'sandbox', document.getElementById('liveProvider')?.value || 'none', false);
  }

  async function selectMode(mode) {
    const targetMode = (mode === 'live') ? 'live' : 'sandbox';
    const input = document.getElementById('selectedModeInput');
    if (input) input.value = targetMode;

    toast(targetMode === 'live' ? '🔴 Switching to Live (Production) Mode...' : '🧪 Switching to Sandbox Mode...', 'info');

    const res = await apiPost('owner_switch_mode', { mode: targetMode });
    if (res && res.success) {
      updateModeBadge(
        res.effective_status,
        res.mode,
        res.provider,
        res.is_ready,
        res.badge_class,
        res.badge_text,
        res.pill_text,
        res.status_message
      );
      if (res.mode === 'live') {
        if (res.is_ready) {
          toast('✅ Live (Production) Mode Active & Ready!', 'success');
        } else {
          toast('⚠️ Live Mode Selected — Provider configuration required below!', 'info');
        }
      } else {
        toast('✅ Sandbox Mode Active & Saved!', 'success');
      }
      await loadSettings();
      loadDashboard();
    } else {
      toast(res?.error || 'Failed to switch mode on server.', 'error');
    }
  }

  async function onModeChange(mode) {
    return selectMode(mode);
  }

  async function saveSettings(e) {
    e.preventDefault();
    const form = document.getElementById('settingsForm');
    if (!form) return;

    // Auto-upload QR image if a new file was chosen in the file input
    const qrInput = document.getElementById('qrImageInput');
    if (qrInput && qrInput.files?.length && !qrInput._uploaded) {
      await uploadQr();
    }

    // Build enabled_methods string from checkboxes
    const methods = [];
    ['qr_upi','cod','sandbox','live_upi','live_card'].forEach(m => {
      if (form.querySelector(`input[name="method_${m}"]`)?.checked) methods.push(m);
    });

    const modeVal = document.getElementById('selectedModeInput')?.value || 'sandbox';
    let provVal = document.getElementById('liveProvider')?.value || 'none';

    const rzpKey = document.getElementById('razorpayKeyId')?.value?.trim() || '';
    const rzpSec = document.getElementById('razorpayKeySecret')?.value?.trim() || '';
    const rzpWh  = document.getElementById('razorpayWebhookSecret')?.value?.trim() || '';

    const cfApp = document.getElementById('cashfreeAppId')?.value?.trim() || '';
    const cfSec = document.getElementById('cashfreeSecretKey')?.value?.trim() || '';
    const cfWh  = document.getElementById('cashfreeWebhookSecret')?.value?.trim() || '';

    const data = {
      mode:                     modeVal,
      enabled_methods:          methods.join(','),
      live_provider:            provVal,
      razorpay_key_id:          rzpKey,
      razorpay_key_secret:      rzpSec,
      razorpay_webhook_secret:  rzpWh,
      cashfree_app_id:          cfApp,
      cashfree_secret_key:      cfSec,
      cashfree_webhook_secret:  cfWh,
      provider_key_env:         provVal === 'cashfree' ? cfApp : rzpKey,
      provider_secret_env:      provVal === 'cashfree' ? cfSec : rzpSec,
      webhook_secret_env:       provVal === 'cashfree' ? cfWh : rzpWh,
      upi_id:                   document.getElementById('settingsUpiId')?.value?.trim() || '',
      manual_verify_enabled:    document.getElementById('manualVerify')?.checked ? 1 : 0,
      sandbox_auto_approve:     document.getElementById('sandboxAuto')?.checked ? 1 : 0
    };

    const res = await apiPost('owner_update_settings', data);
    if (res.success) {
      toast('✅ GreenHarvest Pay settings saved successfully!', 'success');
      await loadSettings();
      loadDashboard();
    } else {
      toast(res.error || 'Save failed.', 'error');
    }
  }

  async function testProvider(specificProvider) {
    const prov = specificProvider || document.getElementById('liveProvider')?.value || 'razorpay';
    const btn = document.getElementById(prov === 'cashfree' ? 'btnTestCashfree' : 'btnTestRazorpay');
    const resultEl = document.getElementById('testConnectionResult');
    if (!resultEl) return;

    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ Testing connection...';
    }

    resultEl.style.display = 'block';
    resultEl.innerHTML = `<span style="color:#64748b;">Connecting to ${prov.toUpperCase()} API...</span>`;

    let keyId = '';
    let keySecret = '';

    if (prov === 'cashfree') {
      keyId = document.getElementById('cashfreeAppId')?.value?.trim() || '';
      keySecret = document.getElementById('cashfreeSecretKey')?.value?.trim() || '';
    } else {
      keyId = document.getElementById('razorpayKeyId')?.value?.trim() || document.getElementById('providerKeyEnv')?.value?.trim() || '';
      keySecret = document.getElementById('razorpayKeySecret')?.value?.trim() || document.getElementById('providerSecretEnv')?.value?.trim() || '';
    }

    const payload = { provider: prov };
    if (keyId) payload.key_id = keyId;
    if (keySecret && !keySecret.includes('•••')) payload.key_secret = keySecret;

    const res = await apiPost('owner_test_provider', payload);

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }

    if (res && res.success) {
      resultEl.innerHTML = `
        <div style="background:#ecfdf5;border:1px solid #10b981;color:#065f46;border-radius:8px;padding:10px 12px;line-height:1.5;">
          <strong>✅ Connection Successful!</strong><br>
          ${esc(res.message || (prov.toUpperCase() + ' API responded successfully.'))}
          ${res.key_id ? `<br><small style="color:#047857;">Active Key: <code>${esc(res.key_id)}</code></small>` : ''}
        </div>
      `;
      await loadSettings();
      loadDashboard();
    } else {
      resultEl.innerHTML = `
        <div style="background:#fef2f2;border:1px solid #ef4444;color:#991b1b;border-radius:8px;padding:10px 12px;line-height:1.5;">
          <strong>❌ Connection Failed:</strong><br>
          ${esc(res?.error || ('Could not authenticate with ' + prov.toUpperCase() + '. Please check your credentials.'))}
        </div>
      `;
    }
  }

  function testRazorpay() {
    return testProvider('razorpay');
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

    toast('Uploading QR image...', 'info');
    const res = await fetch(API, {
      method: 'POST',
      body: formData,
      credentials: 'same-origin'
    }).then(r => r.json()).catch(e => ({ error: e.message }));

    if (res && res.success) {
      input._uploaded = true;
      toast('QR image uploaded & active!', 'success');
      const img = document.getElementById('qrPreviewImg');
      const placeholder = document.getElementById('qrPreviewNone');
      if (img) {
        img.src = res.qr_image_path;
        img.style.display = 'block';
      }
      if (placeholder) placeholder.style.display = 'none';
    } else {
      toast(res?.error || 'Upload failed.', 'error');
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

  // ─── Payment Links (Create & Share) ──────────────────────────────────────

  let currentCreatedLink = null;
  let cachedPaymentLinks = [];
  let plFilterTimer = null;

  function buildShareMessage(title, amount, url, custName) {
    const greeting = custName ? `Hello ${custName}! 🌿` : 'Hello! 🌿';
    return `${greeting}

Your GreenHarvest payment request of ₹${parseFloat(amount).toFixed(2)} for "${title}" is ready.

Please click the link below to pay securely:
${url}

Thank you for shopping with GreenHarvest Fresh Vegetables!`;
  }

  function copyTextToClipboard(text, successMsg = 'Link copied to clipboard!') {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        toast(successMsg, 'success');
      }).catch(() => fallbackCopyText(text, successMsg));
    } else {
      fallbackCopyText(text, successMsg);
    }
  }

  function fallbackCopyText(text, successMsg) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) {
        toast(successMsg, 'success');
      } else {
        prompt('Copy this link:', text);
      }
    } catch (e) {
      prompt('Copy this link:', text);
    }
  }

  async function submitCreatePaymentLink(event) {
    event.preventDefault();
    const btn = document.getElementById('plSubmitBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Creating Payment Link…';
    }

    const title        = (document.getElementById('plInputTitle')?.value || '').trim();
    const amount       = parseFloat(document.getElementById('plInputAmount')?.value || 0);
    const custName     = (document.getElementById('plInputCustName')?.value || '').trim();
    const custPhone    = (document.getElementById('plInputCustPhone')?.value || '').trim();
    const custEmail    = (document.getElementById('plInputCustEmail')?.value || '').trim();
    const orderRef     = (document.getElementById('plInputOrderRef')?.value || '').trim();
    const expiresIn    = document.getElementById('plInputExpiresIn')?.value || '';
    const description  = (document.getElementById('plInputDescription')?.value || '').trim();

    if (!title) {
      toast('Please enter a payment purpose or title.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '🚀 Create Payment Link'; }
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      toast('Please enter a valid amount greater than ₹0.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '🚀 Create Payment Link'; }
      return;
    }

    const payload = {
      title,
      amount,
      customer_name: custName,
      customer_phone: custPhone,
      customer_email: custEmail,
      order_ref: orderRef,
      expires_in: expiresIn,
      description
    };

    const res = await apiPost('owner_create_payment_link', payload);
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🚀 Create Payment Link';
    }

    if (!res || !res.success) {
      toast(res?.error || 'Failed to create payment link.', 'error');
      return;
    }

    const link = res.link;
    currentCreatedLink = link;

    // Display success panel
    const panel = document.getElementById('plSuccessPanel');
    if (panel) {
      panel.style.display = 'block';
      setText('plResultTitle', link.title);
      setText('plResultAmount', link.formatted_amount);
      setText('plResultSub', `Customer: ${link.customer_name || 'Customer'} · ${link.order_ref ? 'Ref: ' + link.order_ref : 'No Ref'}`);
      const urlInput = document.getElementById('plResultUrl');
      if (urlInput) urlInput.value = link.url;
      const openA = document.getElementById('plResultOpenLink');
      if (openA) openA.href = link.url;

      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    toast('🎉 Payment link generated successfully!', 'success');
    loadPaymentLinks();
  }

  function copyGeneratedLink() {
    if (!currentCreatedLink || !currentCreatedLink.url) {
      toast('No active link to copy.', 'error');
      return;
    }
    copyTextToClipboard(currentCreatedLink.url, 'Payment link copied to clipboard!');
    const btn = document.getElementById('plCopyBtn');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Copied!';
      btn.style.background = '#059669';
      setTimeout(() => {
        btn.textContent = orig;
        btn.style.background = '';
      }, 2000);
    }
  }

  function copyLinkByUrl(url) {
    if (!url) return;
    copyTextToClipboard(url, 'Payment link copied to clipboard!');
  }

  function shareNativeLink() {
    if (!currentCreatedLink || !currentCreatedLink.url) {
      toast('No payment link available to share.', 'error');
      return;
    }
    const msg = buildShareMessage(
      currentCreatedLink.title,
      currentCreatedLink.amount,
      currentCreatedLink.url,
      currentCreatedLink.customer_name
    );

    if (navigator.share) {
      navigator.share({
        title: 'GreenHarvest Pay: ' + currentCreatedLink.title,
        text: msg,
        url: currentCreatedLink.url
      }).catch(() => {});
    } else {
      // Fallback to copying
      copyTextToClipboard(msg, 'Payment details copied! You can paste in any app.');
    }
  }

  function shareToWhatsApp(url, amount, title, phone, custName) {
    const u = url || currentCreatedLink?.url;
    const a = amount || currentCreatedLink?.amount || 0;
    const t = title || currentCreatedLink?.title || 'Payment';
    const p = (phone || currentCreatedLink?.customer_phone || '').replace(/[^0-9]/g, '');
    const n = custName || currentCreatedLink?.customer_name || '';

    if (!u) { toast('No link to share.', 'error'); return; }

    const msg = buildShareMessage(t, a, u, n);
    let waUrl = 'https://api.whatsapp.com/send?text=' + encodeURIComponent(msg);
    if (p) {
      const cleanPhone = (p.length === 10) ? ('91' + p) : p;
      waUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(msg)}`;
    }
    window.open(waUrl, '_blank');
  }

  function shareToTelegram(url, amount, title, custName) {
    const u = url || currentCreatedLink?.url;
    const a = amount || currentCreatedLink?.amount || 0;
    const t = title || currentCreatedLink?.title || 'Payment';
    const n = custName || currentCreatedLink?.customer_name || '';

    if (!u) { toast('No link to share.', 'error'); return; }

    const msg = buildShareMessage(t, a, u, n);
    const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(msg)}`;
    window.open(tgUrl, '_blank');
  }

  function shareToSMS(url, amount, title, phone, custName) {
    const u = url || currentCreatedLink?.url;
    const a = amount || currentCreatedLink?.amount || 0;
    const t = title || currentCreatedLink?.title || 'Payment';
    const p = (phone || currentCreatedLink?.customer_phone || '').replace(/[^0-9+]/g, '');
    const n = custName || currentCreatedLink?.customer_name || '';

    if (!u) { toast('No link to share.', 'error'); return; }

    const msg = buildShareMessage(t, a, u, n);
    const smsUrl = p ? `sms:${p}?body=${encodeURIComponent(msg)}` : `sms:?body=${encodeURIComponent(msg)}`;
    window.location.href = smsUrl;
  }

  function shareToEmail(url, amount, title, email, custName) {
    const u = url || currentCreatedLink?.url;
    const a = amount || currentCreatedLink?.amount || 0;
    const t = title || currentCreatedLink?.title || 'Payment';
    const e = email || currentCreatedLink?.customer_email || '';
    const n = custName || currentCreatedLink?.customer_name || '';

    if (!u) { toast('No link to share.', 'error'); return; }

    const msg = buildShareMessage(t, a, u, n);
    const subject = `GreenHarvest Payment Request: ₹${parseFloat(a).toFixed(2)} - ${t}`;
    const mailto = `mailto:${encodeURIComponent(e)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(msg)}`;
    window.location.href = mailto;
  }

  function copyPaymentDetailsText(customLink) {
    const l = customLink || currentCreatedLink;
    if (!l || !l.url) {
      toast('No link to copy details for.', 'error');
      return;
    }
    const msg = buildShareMessage(l.title, l.amount, l.url, l.customer_name);
    copyTextToClipboard(msg, 'Full payment request details copied!');
  }

  async function loadPaymentLinks(page = 1) {
    const tableEl = document.getElementById('paymentLinksTable');
    if (tableEl) tableEl.innerHTML = '<div class="pay-spinner"></div>';

    const search = (document.getElementById('plFilterSearch')?.value || '').trim();
    const status = document.getElementById('plFilterStatus')?.value || 'all';

    const res = await apiGet('owner_get_payment_links', { search, status, page, limit: 20 });
    if (!res || res.error) {
      if (tableEl) tableEl.innerHTML = `<div class="pay-empty" style="color:var(--pay-red);">Failed to load payment links: ${esc(res?.error || 'Unknown error')}</div>`;
      return;
    }

    // Update stats
    const stats = res.stats || {};
    setText('plStatPaidTotal', fmtCurrency(stats.paid_total || 0));
    setText('plStatPaidCount', (stats.paid_count || 0) + ' paid links');
    setText('plStatUnpaidCount', stats.unpaid_count || 0);
    setText('plStatPendingReview', (stats.pending_count || 0) + ' pending review');
    setText('plStatTotalCount', stats.total || 0);
    setText('plStatExpiredCount', ((stats.expired_count || 0) + (stats.cancelled_count || 0)) + ' expired / cancelled');

    const links = res.links || [];
    cachedPaymentLinks = links;

    if (!links.length) {
      if (tableEl) tableEl.innerHTML = '<div class="pay-empty">No payment links found. Generate your first payment link using the form above.</div>';
      renderPagination('paymentLinksPagination', 0, page, 20, 'PayAdmin.loadPaymentLinks');
      return;
    }

    let html = `
      <table class="pay-table">
        <thead>
          <tr>
            <th>Link Purpose / Reference</th>
            <th>Amount</th>
            <th>Customer</th>
            <th>Expiry / Created</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (let i = 0; i < links.length; i++) {
      const l = links[i];
      const statusBadges = {
        unpaid:    '<span class="pay-status-badge pay-status-initiated">Unpaid</span>',
        paid:      '<span class="pay-status-badge pay-status-paid">✅ Paid</span>',
        pending:   '<span class="pay-status-badge pay-status-pending">⏳ Pending</span>',
        expired:   '<span class="pay-status-badge pay-status-expired">Expired</span>',
        cancelled: '<span class="pay-status-badge pay-status-failed">Cancelled</span>'
      };
      const badge = statusBadges[l.status] || `<span class="pay-status-badge">${esc(l.status)}</span>`;

      html += `
        <tr>
          <td>
            <div style="font-weight:700;color:var(--pay-text);font-size:13.5px;">${esc(l.title)}</div>
            ${l.order_ref ? `<div style="font-size:11px;color:var(--pay-text-muted);">Ref: <code>${esc(l.order_ref)}</code></div>` : ''}
            <div style="font-size:11px;color:var(--pay-primary);font-family:monospace;margin-top:2px;">${esc(l.link_token)}</div>
          </td>
          <td>
            <span style="font-size:14px;font-weight:800;color:var(--pay-primary);">${esc(l.formatted_amount)}</span>
          </td>
          <td>
            <div style="font-size:13px;font-weight:600;">${esc(l.customer_name || '—')}</div>
            ${l.customer_phone ? `<div style="font-size:11.5px;color:var(--pay-text-muted);">${esc(l.customer_phone)}</div>` : ''}
            ${l.customer_email ? `<div style="font-size:11.5px;color:var(--pay-text-muted);">${esc(l.customer_email)}</div>` : ''}
          </td>
          <td>
            <div style="font-size:12px;">${l.created_at ? fmtDate(l.created_at) : '—'}</div>
            ${l.expires_at ? `<div style="font-size:11px;color:${l.is_expired ? 'var(--pay-red)' : 'var(--pay-text-muted)'};font-weight:${l.is_expired ? '700' : '400'};">Expires: ${fmtDate(l.expires_at)}</div>` : '<div style="font-size:11px;color:var(--pay-text-muted);">No expiry</div>'}
          </td>
          <td>${badge}</td>
          <td>
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
              <button class="pay-btn pay-btn-sm pay-btn-outline" onclick="PayAdmin.copyLinkByUrl('${esc(l.url)}')" title="Copy Public URL">
                📋
              </button>
              <button class="pay-btn pay-btn-sm pay-btn-primary" onclick="PayAdmin.openShareModal(${i})" title="Share to Apps">
                📱 Share
              </button>
              <a href="${esc(l.url)}" target="_blank" class="pay-btn pay-btn-sm pay-btn-outline" title="Open Customer Page" style="text-decoration:none;">
                👁️
              </a>
              ${l.status === 'unpaid' ? `
                <button class="pay-btn pay-btn-sm pay-btn-danger" onclick="PayAdmin.cancelPaymentLink(${l.id})" title="Cancel this link">
                  ✕
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }

    html += '</tbody></table>';
    if (tableEl) tableEl.innerHTML = html;
    renderPagination('paymentLinksPagination', res.total || 0, page, 20, 'PayAdmin.loadPaymentLinks');
  }

  function filterPaymentLinks() {
    clearTimeout(plFilterTimer);
    plFilterTimer = setTimeout(() => {
      loadPaymentLinks(1);
    }, 280);
  }

  async function cancelPaymentLink(linkId) {
    if (!confirm('Are you sure you want to cancel this payment link? Customers will no longer be able to pay it.')) {
      return;
    }
    const res = await apiPost('owner_cancel_payment_link', { link_id: linkId });
    if (res && res.success) {
      toast('Payment link cancelled.', 'success');
      loadPaymentLinks();
    } else {
      toast(res?.error || 'Failed to cancel link.', 'error');
    }
  }

  function openShareModal(index) {
    const link = cachedPaymentLinks[index];
    if (!link) return;

    const modalHtml = `
      <div style="padding:10px 0;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <h3 style="color:var(--pay-text);font-size:18px;font-weight:800;">📱 Share Payment Link</h3>
          <span style="font-size:18px;font-weight:900;color:var(--pay-primary);">${esc(link.formatted_amount)}</span>
        </div>
        <p style="font-size:13px;color:var(--pay-text-muted);margin-bottom:16px;">
          <strong>${esc(link.title)}</strong><br>
          ${link.customer_name ? 'Customer: ' + esc(link.customer_name) : ''}
          ${link.order_ref ? ' · Ref: ' + esc(link.order_ref) : ''}
        </p>

        <label class="pay-label">Payment URL</label>
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <input type="text" class="pay-input" value="${esc(link.url)}" readonly style="flex:1;background:var(--pay-bg);font-family:monospace;font-size:12px;color:var(--pay-primary);">
          <button class="pay-btn pay-btn-primary" onclick="PayAdmin.copyLinkByUrl('${esc(link.url)}')">📋 Copy</button>
        </div>

        <label class="pay-label">Direct Share via Installed Apps</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
          <button type="button" class="pay-share-btn pay-share-whatsapp" onclick="PayAdmin.shareToWhatsApp('${esc(link.url)}', ${link.amount}, '${esc(link.title)}', '${esc(link.customer_phone || '')}', '${esc(link.customer_name || '')}')">
            💬 WhatsApp
          </button>
          <button type="button" class="pay-share-btn pay-share-telegram" onclick="PayAdmin.shareToTelegram('${esc(link.url)}', ${link.amount}, '${esc(link.title)}', '${esc(link.customer_name || '')}')">
            ✈️ Telegram
          </button>
          <button type="button" class="pay-share-btn pay-share-sms" onclick="PayAdmin.shareToSMS('${esc(link.url)}', ${link.amount}, '${esc(link.title)}', '${esc(link.customer_phone || '')}', '${esc(link.customer_name || '')}')">
            ✉️ SMS
          </button>
          <button type="button" class="pay-share-btn pay-share-gmail" onclick="PayAdmin.shareToEmail('${esc(link.url)}', ${link.amount}, '${esc(link.title)}', '${esc(link.customer_email || '')}', '${esc(link.customer_name || '')}')">
            📧 Gmail / Email
          </button>
        </div>

        <button type="button" class="pay-btn pay-btn-outline" onclick="PayAdmin.copyPaymentDetailsText(${JSON.stringify(link).replace(/"/g, '&quot;')})" style="width:100%;margin-bottom:12px;">
          📄 Copy Full Details (With Instructions)
        </button>

        <div style="display:flex;justify-content:flex-end;">
          <button class="pay-btn pay-btn-outline" onclick="PayAdmin.closeModal()">Close</button>
        </div>
      </div>
    `;

    openModal(modalHtml);
  }

  // ─── Init ────────────────────────────────────────────────────────────────

  function init() {
    loadDashboard();
    // Auto-refresh dashboard every 60 seconds
    setInterval(loadDashboard, 60000);

    // Auto-upload QR image when file is chosen
    const qrInput = document.getElementById('qrImageInput');
    if (qrInput) {
      qrInput.addEventListener('change', () => {
        if (qrInput.files?.length) {
          qrInput._uploaded = false;
          uploadQr();
        }
      });
    }
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
    selectMode,
    onModeChange,
    testRazorpay,
    uploadQr,
    toggleProviderFields,
    openModal,
    closeModal,
    // Payment Links
    submitCreatePaymentLink,
    copyGeneratedLink,
    copyLinkByUrl,
    shareNativeLink,
    shareToWhatsApp,
    shareToTelegram,
    shareToSMS,
    shareToEmail,
    copyPaymentDetailsText,
    loadPaymentLinks,
    filterPaymentLinks,
    cancelPaymentLink,
    openShareModal
  };

})();
