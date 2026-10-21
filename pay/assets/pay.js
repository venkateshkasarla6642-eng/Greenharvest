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

    // Credentials status banner
    const statusBanner = document.getElementById('credentialsStatusBanner');
    if (statusBanner) {
      if (s.has_live_keys) {
        statusBanner.style.display = 'flex';
        statusBanner.style.background = '#ecfdf5';
        statusBanner.style.border = '1.5px solid #a7f3d0';
        statusBanner.style.color = '#065f46';
        statusBanner.style.alignItems = 'center';
        statusBanner.style.gap = '10px';
        statusBanner.innerHTML = `
          <div style="font-size:24px;">✅</div>
          <div>
            <div style="font-weight:800;font-size:14px;">Razorpay Connected &amp; Active!</div>
            <div style="font-size:12px;opacity:0.9;margin-top:2px;">
              Key: <code>${s.key_id_preview || 'Configured'}</code> &bull;
              Mode: <strong style="color:${s.is_test_key ? '#2563eb' : '#16a34a'};">${s.is_test_key ? '🧪 Test Mode (rzp_test)' : '🟢 Live Production'}</strong> &bull;
              Ready to process customer orders.
            </div>
          </div>
        `;
      } else {
        statusBanner.style.display = 'none';
      }
    }

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
      await loadSettings();
      loadDashboard();
    } else {
      toast(res.error || 'Save failed.', 'error');
    }
  }

  async function testRazorpay() {
    const btn = document.getElementById('btnTestRazorpay');
    const resultEl = document.getElementById('testConnectionResult');
    if (!resultEl) return;

    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ Testing connection...';
    }

    resultEl.style.display = 'block';
    resultEl.innerHTML = '<span style="color:#64748b;">Connecting to Razorpay API...</span>';

    const keyId = document.getElementById('providerKeyEnv')?.value?.trim() || '';
    const keySecret = document.getElementById('providerSecretEnv')?.value?.trim() || '';

    const payload = {};
    if (keyId) payload.key_id = keyId;
    if (keySecret && !keySecret.includes('•••')) payload.key_secret = keySecret;

    const res = await apiPost('owner_test_razorpay', payload);

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }

    if (res && res.success) {
      resultEl.innerHTML = `
        <div style="background:#ecfdf5;border:1px solid #10b981;color:#065f46;border-radius:8px;padding:10px 12px;line-height:1.5;">
          <strong>✅ Connection Successful!</strong><br>
          ${esc(res.message || 'Razorpay API responded successfully.')}
          ${res.key_id ? `<br><small style="color:#047857;">Active Key: <code>${esc(res.key_id)}</code></small>` : ''}
        </div>
      `;
      // Ensure Live mode radio stays selected
      const modeLive = document.getElementById('modeLive');
      if (modeLive) modeLive.checked = true;
      const provEl = document.getElementById('liveProvider');
      if (provEl) {
        provEl.value = 'razorpay';
        toggleProviderFields();
      }
      // Ensure live methods checkboxes are checked
      const cbLiveUpi = document.querySelector('input[name="method_live_upi"]');
      if (cbLiveUpi) cbLiveUpi.checked = true;
      const cbLiveCard = document.querySelector('input[name="method_live_card"]');
      if (cbLiveCard) cbLiveCard.checked = true;

      // Update banner directly
      const statusBanner = document.getElementById('credentialsStatusBanner');
      if (statusBanner) {
        statusBanner.style.display = 'flex';
        statusBanner.style.background = '#ecfdf5';
        statusBanner.style.border = '1.5px solid #a7f3d0';
        statusBanner.style.color = '#065f46';
        statusBanner.style.alignItems = 'center';
        statusBanner.style.gap = '10px';
        statusBanner.innerHTML = `
          <div style="font-size:24px;">✅</div>
          <div>
            <div style="font-weight:800;font-size:14px;">Razorpay Connected &amp; Active!</div>
            <div style="font-size:12px;opacity:0.9;margin-top:2px;">
              Key: <code>${esc(res.key_id || keyId)}</code> &bull;
              Mode: <strong style="color:${res.is_test ? '#2563eb' : '#16a34a'};">${res.is_test ? '🧪 Test Mode (rzp_test)' : '🟢 Live Production'}</strong> &bull;
              Active &amp; ready to process customer orders.
            </div>
          </div>
        `;
      }
    } else {
      resultEl.innerHTML = `
        <div style="background:#fef2f2;border:1px solid #ef4444;color:#991b1b;border-radius:8px;padding:10px 12px;line-height:1.5;">
          <strong>❌ Connection Failed:</strong><br>
          ${esc(res?.error || 'Could not authenticate with Razorpay. Please check your Key ID and Key Secret.')}
        </div>
      `;
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
