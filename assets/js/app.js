// assets/js/app.js — GreenHarvest Vegetable Shop — Full Application Logic
// 100% Vegetables Only | Customer + Shopkeeper | Real-time

'use strict';

const App = (() => {
  // ───────────────────────────────────────────────
  // STATE
  // ───────────────────────────────────────────────
  const state = {
    role: null,
    user: null,
    cart: JSON.parse(localStorage.getItem('gh_cart') || '[]'),
    settings: { shop_status:'OPEN', min_order_amount:100, free_delivery_above:300, delivery_charge:20, estimated_delivery_time:'25-35 mins', shop_upi_id:'greenharvest@upi' },
    activeCategory: 'all',
    activeFilter: 'all',
    searchQuery: '',
    shopTab: 'orders',
    coupon: null,
    lastOrderId: null,
    pollingTimer: null,
    notifBadgeCount: 0,
    notifPanelOpen: false,
    selectedProductUnits: {},
  };

  // ───────────────────────────────────────────────
  // UTILS
  // ───────────────────────────────────────────────
  async function api(action, params = {}, method = 'GET') {
    try {
      let url = `api.php?action=${action}`;
      let opts = {};
      if (method === 'POST') {
        const fd = new FormData();
        for (const [k, v] of Object.entries(params)) fd.append(k, v);
        opts = { method: 'POST', body: fd };
      } else if (Object.keys(params).length) {
        url += '&' + new URLSearchParams(params).toString();
      }
      const r = await fetch(url, opts);
      return await r.json();
    } catch (e) {
      console.error('[API error]', action, e);
      return {};
    }
  }

  async function apiJSON(action, payload) {
    try {
      const r = await fetch(`api.php?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await r.json();
    } catch (e) {
      return {};
    }
  }

  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = 'toast';
    if (type === 'error') el.style.background = '#ef4444';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function qs(sel, root = document) { return root.querySelector(sel); }
  function el(tag, cls = '', html = '') {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html) d.innerHTML = html;
    return d;
  }

  function rupee(n) { return '₹' + parseFloat(n).toFixed(2); }
  function timeAgo(ts) {
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function getWeightMult(w) {
    if (!w) return 1;
    if (w === '250g') return 0.25;
    if (w === '500g') return 0.5;
    const m = String(w).match(/^([\d.]+)kg/);
    return m ? (parseFloat(m[1]) || 1) : 1;
  }

  // ───────────────────────────────────────────────
  // CART HELPERS
  // ───────────────────────────────────────────────
  function cartSave() { localStorage.setItem('gh_cart', JSON.stringify(state.cart)); }

  function cartAdd(p, unit) {
    const unit_w = unit || state.selectedProductUnits[p.id] || (p.available_units || '1kg').split(',')[0].trim();
    const idx = state.cart.findIndex(c => c.product_id === p.id && c.unit_weight === unit_w);
    if (idx >= 0) {
      state.cart[idx].quantity++;
    } else {
      state.cart.push({
        product_id: p.id,
        product_name: p.name,
        price: parseFloat(p.price),
        unit_weight: unit_w,
        quantity: 1,
        image_url: p.image_url,
        unit: p.unit || 'kg'
      });
    }
    cartSave();
    updateCartBadge();
    toast(`🛒 ${p.name} (${unit_w}) added to cart!`);
  }

  function cartChange(pid, unit_w, delta) {
    const idx = state.cart.findIndex(c => c.product_id === pid && c.unit_weight === unit_w);
    if (idx >= 0) {
      state.cart[idx].quantity += delta;
      if (state.cart[idx].quantity <= 0) state.cart.splice(idx, 1);
    }
    cartSave();
    updateCartBadge();
  }

  function cartClear() { state.cart = []; cartSave(); updateCartBadge(); }

  function cartTotals() {
    const subtotal = state.cart.reduce((s, c) => {
      const p = parseFloat(c.price) || 0;
      const mult = getWeightMult(c.unit_weight);
      const q = parseInt(c.quantity) || 1;
      return s + (p * mult * q);
    }, 0);
    const freeAbove = parseFloat(state.settings.free_delivery_above) || 300;
    const delivCharge = parseFloat(state.settings.delivery_charge) || 20;
    const fee = subtotal >= freeAbove ? 0 : delivCharge;
    let discount = 0;
    if (state.coupon && state.coupon.discount_value) {
      const dval = parseFloat(state.coupon.discount_value) || 0;
      discount = state.coupon.discount_type === 'percentage'
        ? (subtotal * dval / 100)
        : dval;
    }
    const total = Math.max(0, (subtotal + fee) - (discount || 0));
    return { subtotal, fee, discount, total };
  }

  function updateCartBadge() {
    const count = state.cart.reduce((s, c) => s + c.quantity, 0);
    const b = qs('#cartBadge');
    if (b) { b.textContent = count; b.style.display = count ? 'flex' : 'none'; }
  }

  // ───────────────────────────────────────────────
  // MODAL SYSTEM
  // ───────────────────────────────────────────────
  const Modal = {
    overlay: null,
    card: null,
    body: null,
    init() {
      this.overlay = qs('#modalOverlay');
      this.card = qs('#modalCard');
      this.body = qs('#modalBody');
    },
    show(htmlContent, wide = false) {
      this.body.innerHTML = htmlContent;
      this.card.style.maxWidth = wide ? '720px' : '520px';
      this.overlay.classList.add('show');
    },
    hide() {
      if (this.overlay) this.overlay.classList.remove('show');
    }
  };

  // ───────────────────────────────────────────────
  // CART DRAWER
  // ───────────────────────────────────────────────
  function renderCartDrawer() {
    const body = qs('#cartDrawerBody');
    const footer = qs('#cartDrawerFooter');
    if (!body || !footer) return;

    if (state.cart.length === 0) {
      body.innerHTML = `<div class="empty-state" style="border:none;">
        <div class="emj">🛒</div>
        <h3>Cart is Empty</h3>
        <p>Add fresh vegetables to continue.</p>
      </div>`;
      footer.innerHTML = '';
      return;
    }

    body.innerHTML = state.cart.map(c => {
      const lineTotal = c.price * getWeightMult(c.unit_weight) * c.quantity;
      return `
        <div class="cart-item-row">
          <img src="${c.image_url}" class="ci-img" alt="${c.product_name}" onerror="this.src='https://placehold.co/52x52/dcfce7/16a34a?text=🥬'">
          <div class="ci-info">
            <div class="ci-name">${c.product_name}</div>
            <div class="ci-sub">${c.unit_weight} × ₹${c.price}/${c.unit || 'kg'}</div>
          </div>
          <div>
            <div class="qty-ctrl" style="width:90px;">
              <button onclick="App.cartChg(${c.product_id},'${c.unit_weight}',-1)">-</button>
              <span class="qty-val">${c.quantity}</span>
              <button onclick="App.cartChg(${c.product_id},'${c.unit_weight}',1)">+</button>
            </div>
            <div class="ci-price text-center mt-1">${rupee(lineTotal)}</div>
          </div>
        </div>
      `;
    }).join('');

    const { subtotal, fee, discount, total } = cartTotals();
    footer.innerHTML = `
      <div class="coupon-row">
        <input id="couponInput" placeholder="COUPON CODE (VEG10, FRESH15...)" value="${state.coupon ? state.coupon.code : ''}">
        <button onclick="applyCoupon()">Apply</button>
      </div>
      <div class="summ-row"><span>Vegetable Subtotal</span><span>${rupee(subtotal)}</span></div>
      <div class="summ-row"><span>Delivery Fee</span><span>${fee === 0 ? '<strong style="color:var(--primary)">FREE 🎉</strong>' : rupee(fee)}</span></div>
      ${discount > 0 ? `<div class="summ-row" style="color:var(--primary)"><span>Coupon (${state.coupon.code})</span><span>-${rupee(discount)}</span></div>` : ''}
      <div class="summ-row big"><span>TOTAL</span><span>${rupee(total)}</span></div>
      ${subtotal < state.settings.min_order_amount ? `<p style="font-size:12px;color:var(--danger);margin-bottom:8px;">Minimum order: ${rupee(state.settings.min_order_amount)}</p>` : ''}
      <button class="btn-checkout" onclick="App.checkout()" ${subtotal < state.settings.min_order_amount ? 'disabled' : ''}>
        Proceed to Checkout →
      </button>
    `;
  }

  function openCartDrawer() {
    renderCartDrawer();
    const d = qs('#cartDrawer');
    if (d) {
      d.style.display = 'flex';
      requestAnimationFrame(() => d.classList.add('open'));
    }
  }

  function closeCartDrawer() {
    const d = qs('#cartDrawer');
    if (d) {
      d.classList.remove('open');
      setTimeout(() => {
        if (!d.classList.contains('open')) d.style.display = 'none';
      }, 300);
    }
  }

  async function applyCoupon() {
    const code = qs('#couponInput').value.trim().toUpperCase();
    if (!code) return;
    const data = await api('get_offers');
    const offer = (data.offers || []).find(o => o.code === code && o.is_active == 1);
    const { subtotal } = cartTotals();
    if (offer && subtotal >= parseFloat(offer.min_order)) {
      state.coupon = offer;
      toast(`✅ Coupon "${code}" applied! You save ${offer.discount_type === 'percentage' ? offer.discount_value + '%' : rupee(offer.discount_value)}`);
    } else if (offer) {
      toast(`Min order ${rupee(offer.min_order)} required for this coupon`, 'error');
    } else {
      toast('Invalid coupon code', 'error');
    }
    renderCartDrawer();
  }

  // ───────────────────────────────────────────────
  // CHECKOUT FLOW
  // ───────────────────────────────────────────────
  async function checkout() {
    closeCartDrawer();
    const { total } = cartTotals();

    // Fetch saved delivery addresses
    let addresses = [];
    try {
      const addrRes = await api('get_addresses');
      addresses = addrRes.addresses || [];
    } catch (e) {
      console.warn('Addresses fetch error', e);
    }

    let defaultAddr = addresses.find(a => a.is_default == 1) || addresses[0] || null;
    let selectedAddrId = defaultAddr ? defaultAddr.id : 0;

    // Auto-generate UPI Ref ID like real UPI apps generate
    const digits = Math.floor(10000000000000 + Math.random() * 90000000000000);
    const autoRef = `${digits}`;

    Modal.show(`
      <h2 style="margin-bottom:18px;">🛍️ Checkout</h2>
      <form id="checkoutForm">
        <div class="form-group">
          <label class="form-label">Full Name</label>
          <input class="form-input" id="ckName" value="${escapeHtml(defaultAddr?.recipient_name || state.user?.name || '')}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Phone Number</label>
          <input class="form-input" id="ckPhone" type="tel" value="${escapeHtml(defaultAddr?.phone || state.user?.phone || '')}" required>
        </div>

        <div class="form-group">
          <div class="flex justify-between items-center mb-1">
            <label class="form-label" style="margin:0;">📍 Delivery Address</label>
            <div style="display:flex; gap:10px;">
              ${addresses.length > 1 ? `<button type="button" class="text-xs font-bold" id="btnToggleAddrSelect" style="background:none; border:none; color:var(--primary); cursor:pointer;">🔄 Change Address</button>` : ''}
              <button type="button" class="text-xs font-bold" id="btnAddAddrFromCheckout" style="background:none; border:none; color:var(--primary); cursor:pointer;">➕ Add New</button>
            </div>
          </div>

          <div id="checkoutSelectedAddrCard" class="ck-address-card-selected">
            ${defaultAddr ? `
              <div class="flex justify-between items-center mb-1">
                <span class="addr-label-tag ${(defaultAddr.label || 'Home').toLowerCase()}">${escapeHtml(defaultAddr.label || 'Home')}</span>
                ${defaultAddr.is_default == 1 ? '<span class="addr-default-badge">⭐ Default</span>' : ''}
              </div>
              <div style="font-weight:800; font-size:13.5px; color:var(--slate-900);">${escapeHtml(defaultAddr.recipient_name)} (📞 ${escapeHtml(defaultAddr.phone)})</div>
              <div style="font-size:13px; color:var(--slate-600); margin-top:2px;">
                ${escapeHtml([defaultAddr.house_no, defaultAddr.street, defaultAddr.city, defaultAddr.district, defaultAddr.state, defaultAddr.pincode ? 'PIN: ' + defaultAddr.pincode : ''].filter(Boolean).join(', '))}
              </div>
              ${defaultAddr.delivery_instructions ? `<div class="text-xs text-muted mt-1">📝 ${escapeHtml(defaultAddr.delivery_instructions)}</div>` : ''}
            ` : `
              <div class="text-sm text-muted">Please enter your delivery address below:</div>
            `}
          </div>

          <input type="hidden" id="ckAddressId" value="${selectedAddrId}">
          <textarea class="form-textarea" id="ckAddr" ${defaultAddr ? 'style="display:none;"' : ''} placeholder="House/Flat No, Street, City, State, PIN Code" required>${defaultAddr ? [defaultAddr.house_no, defaultAddr.street, defaultAddr.city, defaultAddr.district, defaultAddr.state, defaultAddr.pincode].filter(Boolean).join(', ') : (state.user?.address || '')}</textarea>

          <div id="checkoutAddrListWrap" style="display:none; margin-top:10px; max-height:220px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:10px; padding:8px;">
            ${addresses.map(a => `
              <div class="ck-addr-option ${a.id == selectedAddrId ? 'selected' : ''}" data-addr-id="${a.id}">
                <input type="radio" name="ckAddrChoice" value="${a.id}" ${a.id == selectedAddrId ? 'checked' : ''}>
                <div style="flex:1;">
                  <div class="flex justify-between items-center">
                    <strong>${escapeHtml(a.recipient_name)}</strong>
                    <span class="addr-label-tag ${(a.label || 'Home').toLowerCase()}">${escapeHtml(a.label || 'Home')}</span>
                  </div>
                  <div class="text-xs text-muted" style="margin-top:2px;">
                    ${escapeHtml([a.house_no, a.street, a.city, a.pincode].filter(Boolean).join(', '))}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Payment Method</label>
          <div class="pay-option selected" id="pay_scanpay" onclick="selectPay('ScanPay', this)">
            <input type="radio" name="payMethod" value="ScanPay" checked>
            <div><div class="pay-option-label">📷 SCAN &amp; PAY (UPI QR)</div><div class="pay-option-sub">Scan QR with GPay / PhonePe / Paytm</div></div>
          </div>
          <div class="pay-option" id="pay_gpay" onclick="selectPay('GPay', this)">
            <input type="radio" name="payMethod" value="GPay">
            <div><div class="pay-option-label">📱 Google Pay / PhonePe / UPI</div><div class="pay-option-sub">Pay directly using your UPI app</div></div>
          </div>
          <div class="pay-option" id="pay_card" onclick="selectPay('Card', this)">
            <input type="radio" name="payMethod" value="Card">
            <div><div class="pay-option-label">💳 Credit / Debit Card</div><div class="pay-option-sub">All major cards accepted</div></div>
          </div>
          <div class="pay-option" id="pay_cod" onclick="selectPay('COD', this)">
            <input type="radio" name="payMethod" value="COD">
            <div><div class="pay-option-label">💵 Cash on Delivery</div><div class="pay-option-sub">Pay when order arrives</div></div>
          </div>
        </div>

        <!-- SCAN & PAY QR section -->
        <div id="scanPaySection">
          <div class="qr-box">
            <h4 style="margin-bottom:8px;">📷 Shop's Official UPI QR Code</h4>
            <p class="text-xs text-muted" style="margin-bottom:12px;">Scan using Google Pay, PhonePe, Paytm or any UPI app</p>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=175x175&data=upi://pay?pa=${state.settings.shop_upi_id}%26pn=GreenHarvest%26am=${total.toFixed(2)}%26cu=INR" alt="UPI QR Code">
            <p style="font-weight:800; color:var(--primary-deep); font-size:14px; margin-top:6px;">${state.settings.shop_upi_id}</p>
            <p style="font-size:12px; color:var(--slate-500);">Amount: <strong>${rupee(total)}</strong></p>
          </div>
          <div class="form-group">
            <label class="form-label">UPI Transaction / Reference ID <span style="color:var(--danger)">*</span></label>
            <input class="ref-input" id="upiRefId" value="${autoRef}" placeholder="Enter UPI Transaction ID" required>
            <p class="text-xs text-muted" style="margin-top:4px;">After paying, enter the transaction reference ID shown in your UPI app.</p>
          </div>
        </div>

        <div style="background:#f0fdf4; border-radius:10px; padding:12px; margin-bottom:16px; font-size:13.5px; border:1px solid #d1fae5;">
          <div class="flex justify-between"><span>Total Amount:</span><strong>${rupee(total)}</strong></div>
          <div class="flex justify-between mt-1"><span>Est. Delivery:</span><strong>${state.settings.estimated_delivery_time}</strong></div>
        </div>

        <button type="submit" class="btn-checkout" style="margin:0;">
          🎉 Place Order — ${rupee(total)}
        </button>
      </form>
    `);

    // Address selector toggle
    qs('#btnToggleAddrSelect')?.addEventListener('click', () => {
      const list = qs('#checkoutAddrListWrap');
      if (list) list.style.display = (list.style.display === 'none' ? 'block' : 'none');
    });

    qs('#btnAddAddrFromCheckout')?.addEventListener('click', () => {
      openAddressModal();
    });

    document.querySelectorAll('.ck-addr-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const addrId = opt.getAttribute('data-addr-id');
        const chosen = addresses.find(a => a.id == addrId);
        if (!chosen) return;

        selectedAddrId = chosen.id;
        qs('#ckAddressId').value = chosen.id;
        qs('#ckName').value = chosen.recipient_name;
        qs('#ckPhone').value = chosen.phone;
        const fullTxt = [chosen.house_no, chosen.street, chosen.city, chosen.district, chosen.state, chosen.pincode ? 'PIN: ' + chosen.pincode : ''].filter(Boolean).join(', ');
        qs('#ckAddr').value = fullTxt;

        qs('#checkoutSelectedAddrCard').innerHTML = `
          <div class="flex justify-between items-center mb-1">
            <span class="addr-label-tag ${(chosen.label || 'Home').toLowerCase()}">${escapeHtml(chosen.label || 'Home')}</span>
            ${chosen.is_default == 1 ? '<span class="addr-default-badge">⭐ Default</span>' : ''}
          </div>
          <div style="font-weight:800; font-size:13.5px; color:var(--slate-900);">${escapeHtml(chosen.recipient_name)} (📞 ${escapeHtml(chosen.phone)})</div>
          <div style="font-size:13px; color:var(--slate-600); margin-top:2px;">${escapeHtml(fullTxt)}</div>
          ${chosen.delivery_instructions ? `<div class="text-xs text-muted mt-1">📝 ${escapeHtml(chosen.delivery_instructions)}</div>` : ''}
        `;

        document.querySelectorAll('.ck-addr-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        const r = opt.querySelector('input[type="radio"]');
        if (r) r.checked = true;

        qs('#checkoutAddrListWrap').style.display = 'none';
      });
    });

    window.selectPay = (val, el) => {
      document.querySelectorAll('.pay-option').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      el.querySelector('input').checked = true;
      qs('#scanPaySection').style.display = (val === 'ScanPay' || val === 'GPay') ? 'block' : 'none';
    };

    qs('#checkoutForm').onsubmit = async (e) => {
      e.preventDefault();
      const method = document.querySelector('input[name="payMethod"]:checked').value;
      const refId = (method === 'ScanPay' || method === 'GPay') ? (qs('#upiRefId')?.value || '') : '';
      const btn = qs('#checkoutForm button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Placing Order...';

      const payload = {
        customer_name: qs('#ckName').value,
        customer_phone: qs('#ckPhone').value,
        address_id: selectedAddrId,
        delivery_address: qs('#ckAddr').value,
        payment_method: method,
        upi_trans_id: refId,
        coupon_code: state.coupon?.code || '',
        items: state.cart
      };

      const res = await apiJSON('place_order', payload);
      if (res.success) {
        state.lastOrderId = res.order_id;
        cartClear();
        state.coupon = null;
        showOrderConfirmation(res);
      } else {
        toast(res.error || 'Failed to place order', 'error');
        btn.disabled = false;
        btn.textContent = `🎉 Place Order — ${rupee(total)}`;
      }
    };
  }

  // ───────────────────────────────────────────────
  // ORDER CONFIRMATION
  // ───────────────────────────────────────────────
  function showOrderConfirmation(res) {
    fireConfetti();
    Modal.show(`
      <div class="text-center" style="padding:10px 0;">
        <div class="order-confirm-check">✓</div>
        <h2 style="font-size:26px; color:var(--primary-deep); margin-bottom:6px;">ORDER CONFIRMED! 🎉</h2>
        <p class="text-muted" style="font-size:14px; margin-bottom:16px;">"Your fresh vegetables are being prepared."</p>
        <div style="display:inline-block; background:var(--primary-light); padding:6px 20px; border-radius:20px; font-weight:900; font-size:17px; margin-bottom:20px; color:var(--primary-deep);">
          ${res.order_number}
        </div>
        <div style="background:#f8fafc; border-radius:12px; padding:14px; text-align:left; font-size:13.5px; margin-bottom:20px; border:1px solid #e2e8f0;">
          <div class="flex justify-between mb-3"><span>Vegetables Subtotal:</span><strong>${rupee(res.subtotal)}</strong></div>
          <div class="flex justify-between mb-3"><span>Delivery Fee:</span><strong>${res.delivery_fee == 0 ? 'FREE 🎉' : rupee(res.delivery_fee)}</strong></div>
          ${res.discount_amount > 0 ? `<div class="flex justify-between mb-3" style="color:var(--primary)"><span>Coupon Discount:</span><strong>-${rupee(res.discount_amount)}</strong></div>` : ''}
          <div class="flex justify-between" style="font-size:16px; font-weight:900; color:var(--primary-deep); border-top:1px dashed #d1fae5; padding-top:10px; margin-top:4px;"><span>TOTAL PAID:</span><span>${rupee(res.total_amount)}</span></div>
        </div>
        <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
          <button class="btn-primary" onclick="App.trackOrder(${res.order_id})">🛵 Track Order</button>
          <button class="btn-outline" onclick="Modal.hide(); App.renderCustomerOrdersView();">📦 View All Orders</button>
          <button class="btn-outline" onclick="Modal.hide()">Close</button>
        </div>
      </div>
    `);
  }

  function fireConfetti() {
    if (!window.confetti) return;
    const count = 120, defaults = { origin: { y: 0.65 }, colors: ['#16a34a', '#86efac', '#f59e0b', '#ffffff', '#dcfce7'] };
    const fire = (part, opts) => confetti({ ...defaults, ...opts, particleCount: Math.floor(count * part) });
    fire(0.35, { spread: 26, startVelocity: 55 });
    fire(0.20, { spread: 60 });
    fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
    fire(0.10, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
    fire(0.10, { spread: 120, startVelocity: 45 });
  }

  // ───────────────────────────────────────────────
  // LIVE ORDER TRACKING
  // ───────────────────────────────────────────────
  async function trackOrder(orderId) {
    const data = await api('get_order_details', { id: orderId });
    const ord = data.order;
    if (!ord) { toast('Order not found', 'error'); return; }

    const steps = [
      { key: 'Placed',         label: 'Order Placed ✓',                  desc: 'We received your vegetable order.' },
      { key: 'Accepted',       label: 'Order Accepted ✓',                desc: 'Shopkeeper confirmed your order.' },
      { key: 'Preparing',      label: 'Vegetables Being Prepared 🥬',    desc: 'Fresh veggies picked & packed for you.' },
      { key: 'OutForDelivery', label: 'Out for Delivery 🛵',             desc: 'Rider is heading to your location.' },
      { key: 'Delivered',      label: 'Delivered 🎉',                    desc: 'Fresh veggies delivered. Enjoy!' }
    ];

    const statusOrder = { Placed:0, Accepted:1, Preparing:2, OutForDelivery:3, Delivered:4, Rejected:-1, Cancelled:-1 };
    const curIdx = statusOrder[ord.order_status] ?? 0;

    const stepsHtml = steps.map((s, i) => {
      const cls = i < curIdx ? 'done' : i === curIdx ? 'current' : '';
      return `<div class="t-step ${cls}">
        <div class="t-dot"></div>
        <div class="t-info">
          <h4>${s.label}</h4>
          <p>${s.desc}</p>
        </div>
      </div>`;
    }).join('');

    const reviewSection = ord.order_status === 'Delivered' && !ord.review ? `
      <button class="btn-primary w-full mt-3" onclick="App.openReview(${ord.id})" style="background:var(--accent);">
        ⭐ Rate Your Experience
      </button>
    ` : '';

    const rejectSection = ord.order_status === 'Rejected' ? `
      <div style="background:var(--danger-light); border-radius:10px; padding:12px; margin-top:12px; color:var(--danger); font-size:13.5px;">
        ❌ Order Rejected: ${escapeHtml(ord.rejection_reason || 'Contact shop for details')}
      </div>
    ` : '';

    const cancelSection = ord.order_status === 'Placed' ? `
      <button class="btn-danger w-full mt-3" onclick="Modal.hide(); App.cancelCustomerOrder(${ord.id}, '${escapeHtml(ord.order_number)}');">
        ✕ Cancel Order
      </button>
    ` : '';

    const cancelledNotice = ord.order_status === 'Cancelled' ? `
      <div style="background:#fee2e2; border:1px solid #fca5a5; border-radius:10px; padding:12px; margin-top:12px; color:#b91c1c; font-size:13.5px; font-weight:700;">
        ❌ This order was cancelled. (${escapeHtml(ord.rejection_reason || 'Cancelled by customer')})
      </div>
    ` : '';

    const acceptedNotice = ['Accepted', 'Preparing', 'OutForDelivery'].includes(ord.order_status) ? `
      <div class="order-accepted-notice" style="margin-top:12px;">
        🔒 This order has been accepted by the shopkeeper and can no longer be cancelled.
      </div>
    ` : '';

    Modal.show(`
      <div class="flex justify-between items-center mb-3">
        <h2>🛵 Live Order Tracking</h2>
        <span style="background:var(--primary-light); padding:5px 14px; border-radius:20px; font-weight:800; color:var(--primary-deep);">${escapeHtml(ord.order_number)}</span>
      </div>

      <div style="background:#f8fafc; border-radius:10px; padding:10px 14px; font-size:13px; margin-bottom:16px;">
        <div class="flex justify-between"><span class="text-muted">Customer:</span><strong>${escapeHtml(ord.customer_name)}</strong></div>
        <div class="flex justify-between mt-1"><span class="text-muted">Total:</span><strong>${rupee(ord.total_amount)}</strong></div>
        <div class="flex justify-between mt-1"><span class="text-muted">Payment:</span><strong>${escapeHtml(ord.payment_method)} (${escapeHtml(ord.payment_status)})</strong></div>
        <div class="flex justify-between mt-1"><span class="text-muted">Delivery Address:</span><strong style="text-align:right; max-width:60%;">${escapeHtml(ord.delivery_address)}</strong></div>
      </div>

      <div class="tracking-wrap">
        <div class="tracking-timeline">${stepsHtml}</div>
      </div>
      ${rejectSection}
      ${cancelledNotice}
      ${acceptedNotice}
      ${reviewSection}
      ${cancelSection}

      <button class="btn-outline w-full mt-3" onclick="App.openChat()">
        💬 Chat with Shopkeeper
      </button>
    `);
  }

  // ───────────────────────────────────────────────
  // REVIEWS
  // ───────────────────────────────────────────────
  function openReview(orderId) {
    let ratings = { overall: 5, freshness: 5, delivery: 5 };
    const starHtml = (key, label) => `
      <div class="form-group">
        <label class="form-label">${label}</label>
        <div class="stars" id="stars_${key}">
          ${[1,2,3,4,5].map(n => `<span class="star" onclick="App.setStar('${key}', ${n})" data-val="${n}">⭐</span>`).join('')}
        </div>
      </div>
    `;

    Modal.show(`
      <h2 style="margin-bottom:16px;">⭐ Rate Your Experience</h2>
      ${starHtml('overall', '🥬 Overall Experience')}
      ${starHtml('freshness', '🌿 Vegetable Freshness')}
      ${starHtml('delivery', '🛵 Delivery Speed')}
      <div class="form-group">
        <label class="form-label">Your Feedback</label>
        <textarea class="form-textarea" id="reviewComment" placeholder="Tell us about vegetable quality, freshness, packaging..."></textarea>
      </div>
      <button class="btn-primary w-full" onclick="App.submitReview(${orderId}, ${JSON.stringify(ratings).replace(/"/g,'&quot;')})">
        Submit Review
      </button>
    `);

    window._reviewRatings = ratings;
  }

  window.App = window.App || {};

  function setStar(key, val) {
    window._reviewRatings[key] = val;
    const container = qs(`#stars_${key}`);
    if (!container) return;
    container.querySelectorAll('.star').forEach((s, i) => {
      s.style.filter = i < val ? 'saturate(1)' : 'saturate(0) opacity(0.5)';
    });
  }

  async function submitReview(orderId, ratings) {
    const comment = qs('#reviewComment')?.value || '';
    const r = window._reviewRatings || ratings;
    const res = await api('submit_review', {
      order_id: orderId,
      rating: r.overall || 5,
      freshness_rating: r.freshness || 5,
      delivery_rating: r.delivery || 5,
      comment
    }, 'POST');
    if (res.success) {
      toast('Thank you for your feedback! 🌿');
      Modal.hide();
    }
  }

  // ───────────────────────────────────────────────
  // CHAT
  // ───────────────────────────────────────────────
  async function openChat() {
    const data = await api('get_messages');
    const msgs = data.messages || [];
    const custId = state.user?.id || 1;

    const bubbles = msgs.map(m => `
      <div class="chat-bubble ${m.sender_type === 'customer' ? 'customer' : 'shopkeeper'}">
        ${m.message}
        <div class="text-xs text-muted mt-1">${timeAgo(m.created_at)}</div>
      </div>
    `).join('');

    Modal.show(`
      <h2 style="margin-bottom:14px;">💬 Chat with Shopkeeper</h2>
      <div style="height:260px; overflow-y:auto; padding:8px; background:#f8fafc; border-radius:12px; margin-bottom:14px; display:flex; flex-direction:column;" id="chatMsgs">
        ${bubbles || '<p class="text-center text-muted" style="padding:20px;">No messages yet. Say hello!</p>'}
      </div>
      <div style="display:flex; gap:8px;">
        <input class="form-input" id="chatInput" placeholder="Type your message..." style="flex:1;">
        <button class="btn-primary" onclick="App.sendChat(${custId})">Send</button>
      </div>
    `);
    const msgEl = qs('#chatMsgs');
    if (msgEl) msgEl.scrollTop = msgEl.scrollHeight;
  }

  async function sendChat(custId) {
    const input = qs('#chatInput');
    const msg = input?.value?.trim();
    if (!msg) return;
    await api('send_message', { message: msg, sender_type: state.role, customer_id: custId }, 'POST');
    input.value = '';
    openChat();
  }

  // ───────────────────────────────────────────────
  // PRODUCT DETAIL MODAL
  // ───────────────────────────────────────────────
  function openProductDetail(p) {
    const units = (p.available_units || '1kg').split(',').map(u => u.trim());
    const selectedUnit = state.selectedProductUnits[p.id] || units[0];
    const stockPct = Math.min(100, (p.available_stock / 50) * 100);
    const isOut = p.available_stock <= 0;

    Modal.show(`
      <div class="pd-img-wrap">
        <img src="${p.image_url}" alt="${p.name}" onerror="this.src='https://placehold.co/520x220/dcfce7/16a34a?text=🥬'">
      </div>

      <div class="pd-badges">
        ${p.is_fresh_today == 1 ? '<span class="pd-badge green">🌱 Fresh Today</span>' : ''}
        ${p.is_organic == 1 ? '<span class="pd-badge green">🌿 Organic</span>' : ''}
        ${p.is_best_seller == 1 ? '<span class="pd-badge amber">🔥 Best Seller</span>' : ''}
        ${p.discount_percent > 0 ? `<span class="pd-badge red">${p.discount_percent}% OFF</span>` : ''}
        ${isOut ? '<span class="pd-badge" style="background:#f1f5f9;color:var(--slate-500);">Out of Stock</span>' : ''}
      </div>

      <h2 style="font-size:22px; margin-bottom:6px;">${p.name}</h2>
      <p class="text-muted text-sm" style="margin-bottom:12px;">${p.description || 'Farm-fresh quality vegetable.'}</p>

      <div style="display:flex; align-items:baseline; gap:10px; margin-bottom:12px;">
        <span style="font-size:28px; font-weight:900; color:var(--primary-deep);">₹${p.price}</span>
        <span class="text-muted">/ ${p.unit || 'kg'}</span>
        ${p.discount_percent > 0 ? `<span style="font-size:16px; text-decoration:line-through; color:#94a3b8;">₹${Math.round(p.price / (1 - p.discount_percent/100))}</span>` : ''}
      </div>

      <div class="stock-bar-wrap">
        <div class="stock-bar-label">
          <span>Available Stock</span>
          <span>${parseFloat(p.available_stock).toFixed(1)} ${p.unit}</span>
        </div>
        <div class="stock-bar-bg">
          <div class="stock-bar-fill" style="width:${stockPct}%"></div>
        </div>
      </div>

      <div class="form-group" style="margin-top:14px;">
        <label class="form-label">Choose Weight</label>
        <div class="unit-chips">
          ${units.map(u => `
            <span class="uchip ${u === selectedUnit ? 'active' : ''}"
              onclick="App.selectUnit(${p.id}, '${u}', this)">${u}</span>
          `).join('')}
        </div>
      </div>

      <div style="display:flex; gap:10px; margin-top:6px;">
        ${isOut
          ? '<button class="btn-cart" disabled>Out of Stock</button>'
          : `<button class="btn-primary w-full" onclick="App.addFromDetail(${JSON.stringify(p).replace(/"/g,'&quot;')})">🛒 Add to Cart</button>`
        }
        ${!isOut ? `<button class="btn-checkout" style="width:180px; padding:11px;" onclick="App.addFromDetail(${JSON.stringify(p).replace(/"/g,'&quot;')}); App.checkout();">Buy Now</button>` : ''}
      </div>
    `);
  }

  function selectUnit(productId, unit, el) {
    state.selectedProductUnits[productId] = unit;
    el.closest('.unit-chips').querySelectorAll('.uchip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
  }

  function addFromDetail(p) {
    const unit = state.selectedProductUnits[p.id] || (p.available_units || '1kg').split(',')[0].trim();
    cartAdd(p, unit);
    updateCartBadge();
    Modal.hide();
    // Re-render product cards so button states update
    loadProducts();
  }

  // ───────────────────────────────────────────────
  // HELPER FORMATTERS
  // ───────────────────────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDate(str) {
    if (!str) return '';
    try {
      const d = new Date(str.replace(/-/g, '/'));
      if (isNaN(d.getTime())) return str;
      return d.toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      });
    } catch (e) {
      return str;
    }
  }

  // ───────────────────────────────────────────────
  // CUSTOMER ORDERS VIEW
  // ───────────────────────────────────────────────
  async function renderCustomerOrdersView(filter = 'all') {
    state.currentView = 'orders';
    if (window.location.hash !== '#orders') {
      window.location.hash = '#orders';
    }

    // Update bottom nav tab state
    document.querySelectorAll('.bnav-item').forEach(b => b.classList.remove('active'));
    qs('#bnOrders')?.classList.add('active');

    const app = qs('#app');
    if (!app) return;

    // Show initial loading state
    app.innerHTML = `
      <div class="orders-page-wrap">
        <div class="orders-page-header">
          <div>
            <h1 class="orders-page-title">📦 My Vegetable Orders</h1>
            <p class="text-sm text-muted" style="margin-top:2px;">Track your live orders and view past purchases</p>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn-outline" onclick="App.renderCustomerView()" style="display:inline-flex; align-items:center; gap:6px;">
              ← Back to Shop
            </button>
            <button class="btn-outline" onclick="App.renderCustomerPaymentsView()" style="display:inline-flex; align-items:center; gap:6px;">
              💳 Payment History
            </button>
          </div>
        </div>
        <div class="page-loader" style="min-height:300px;">
          <div class="spinner"></div>
          <span style="color:var(--primary-dark); font-weight:700;">Fetching your vegetable orders...</span>
        </div>
      </div>
    `;

    // Fetch real orders from API
    let data;
    try {
      data = await api('get_customer_orders');
    } catch (err) {
      data = null;
    }

    if (!data || !Array.isArray(data.orders)) {
      app.innerHTML = `
        <div class="orders-page-wrap">
          <div class="orders-page-header">
            <div>
              <h1 class="orders-page-title">📦 My Vegetable Orders</h1>
              <p class="text-sm text-muted" style="margin-top:2px;">Track your live orders and view past purchases</p>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button class="btn-outline" onclick="App.renderCustomerView()">← Back to Shop</button>
              <button class="btn-outline" onclick="App.renderCustomerPaymentsView()">💳 Payment History</button>
            </div>
          </div>
          <div class="empty-state" style="border-color:#fca5a5;">
            <div class="emj">⚠️</div>
            <h3>Unable to Load Orders</h3>
            <p>Could not retrieve your orders. Please check your connection and try again.</p>
            <button class="btn-primary" onclick="App.renderCustomerOrdersView('${filter}')" style="margin-top:14px;">
              🔄 Retry
            </button>
          </div>
        </div>
      `;
      return;
    }

    const allOrders = data.orders;

    if (allOrders.length === 0) {
      app.innerHTML = `
        <div class="orders-page-wrap">
          <div class="orders-page-header">
            <div>
              <h1 class="orders-page-title">📦 My Vegetable Orders</h1>
              <p class="text-sm text-muted" style="margin-top:2px;">Track your live orders and view past purchases</p>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button class="btn-outline" onclick="App.renderCustomerView()">← Back to Shop</button>
              <button class="btn-outline" onclick="App.renderCustomerPaymentsView()">💳 Payment History</button>
            </div>
          </div>
          <div class="empty-state">
            <div class="emj">🛒</div>
            <h3>No Orders Found Yet</h3>
            <p>You haven't placed any fresh vegetable orders yet. Order farm-fresh vegetables delivered to your doorstep in 30 minutes!</p>
            <button class="btn-primary" onclick="App.renderCustomerView()" style="margin-top:16px;">
              Shop Fresh Veggies 🥕
            </button>
          </div>
        </div>
      `;
      return;
    }

    // Filter counts
    const activeOrders = allOrders.filter(o => ['Placed', 'Accepted', 'Preparing', 'OutForDelivery'].includes(o.order_status));
    const deliveredOrders = allOrders.filter(o => o.order_status === 'Delivered');
    const cancelledOrders = allOrders.filter(o => ['Cancelled', 'Rejected'].includes(o.order_status));

    let displayOrders = allOrders;
    if (filter === 'active') displayOrders = activeOrders;
    else if (filter === 'delivered') displayOrders = deliveredOrders;
    else if (filter === 'cancelled') displayOrders = cancelledOrders;

    const statusBadgeClass = {
      Placed: 'sp-placed',
      Accepted: 'sp-accepted',
      Preparing: 'sp-preparing',
      OutForDelivery: 'sp-out',
      Delivered: 'sp-delivered',
      Rejected: 'sp-rejected',
      Cancelled: 'sp-cancelled'
    };

    const statusDisplayLabel = {
      Placed: '🔵 Placed',
      Accepted: '🟢 Accepted',
      Preparing: '🟡 Preparing Veggies 🥬',
      OutForDelivery: '🛵 Out for Delivery',
      Delivered: '✅ Delivered 🎉',
      Rejected: '🔴 Rejected',
      Cancelled: '⚪ Cancelled'
    };

    app.innerHTML = `
      <div class="orders-page-wrap">
        <!-- Header -->
        <div class="orders-page-header">
          <div>
            <h1 class="orders-page-title">📦 My Vegetable Orders</h1>
            <p class="text-sm text-muted" style="margin-top:2px;">
              Logged in as <strong>${escapeHtml(state.user?.name || 'Customer')}</strong> · ${allOrders.length} total order${allOrders.length > 1 ? 's' : ''}
            </p>
          </div>
          <button class="btn-outline" onclick="App.renderCustomerView()" style="display:inline-flex; align-items:center; gap:6px;">
            ← Back to Shop
          </button>
        </div>

        <!-- Filter tabs -->
        <div class="orders-filter-bar">
          <button class="filter-chip ${filter === 'all' ? 'active' : ''}" onclick="App.renderCustomerOrdersView('all')">
            ✨ All Orders (${allOrders.length})
          </button>
          <button class="filter-chip ${filter === 'active' ? 'active' : ''}" onclick="App.renderCustomerOrdersView('active')">
            ⏳ Active (${activeOrders.length})
          </button>
          <button class="filter-chip ${filter === 'delivered' ? 'active' : ''}" onclick="App.renderCustomerOrdersView('delivered')">
            ✅ Delivered (${deliveredOrders.length})
          </button>
          <button class="filter-chip ${filter === 'cancelled' ? 'active' : ''}" onclick="App.renderCustomerOrdersView('cancelled')">
            ❌ Cancelled / Rejected (${cancelledOrders.length})
          </button>
        </div>

        <!-- Orders list or empty tab state -->
        ${displayOrders.length === 0 ? `
          <div class="empty-state" style="padding:40px 20px;">
            <div class="emj">🔍</div>
            <h3>No ${filter.charAt(0).toUpperCase() + filter.slice(1)} Orders</h3>
            <p>You have no orders matching this filter.</p>
            <button class="filter-chip active" onclick="App.renderCustomerOrdersView('all')" style="margin-top:12px;">
              View All Orders (${allOrders.length})
            </button>
          </div>
        ` : `
          <div class="orders-cards-stack">
            ${displayOrders.map(ord => {
              const items = ord.items || [];
              const isPlaced = ord.order_status === 'Placed';
              const isDelivered = ord.order_status === 'Delivered';
              const isReviewable = isDelivered && !ord.review;
              const dateStr = formatDate(ord.created_at);

              return `
                <div class="cust-order-card" id="custOrder_${ord.id}">
                  <!-- Order Card Header -->
                  <div class="cust-order-header">
                    <div class="cust-order-id-block">
                      <div class="cust-order-num">${escapeHtml(ord.order_number)}</div>
                      <div class="cust-order-date">📅 ${dateStr}</div>
                    </div>
                    <span class="status-pill ${statusBadgeClass[ord.order_status] || ''}">
                      ${statusDisplayLabel[ord.order_status] || ord.order_status}
                    </span>
                  </div>

                  <!-- Ordered Items List -->
                  <div class="cust-order-items-list">
                    ${items.map(item => `
                      <div class="cust-order-item-row">
                        ${item.image_url ? `
                          <img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.product_name)}" class="cust-item-thumb" onerror="this.src='https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=200';">
                        ` : `
                          <div class="cust-item-thumb flex items-center justify-center" style="font-size:24px;">🥬</div>
                        `}
                        <div class="cust-item-info">
                          <div class="cust-item-name">${escapeHtml(item.product_name)}</div>
                          <div class="cust-item-meta">
                            <span>${escapeHtml(item.unit_weight)}</span> × <strong>${item.quantity}</strong>
                            <span style="color:var(--slate-400); margin:0 4px;">•</span>
                            <span>₹${parseFloat(item.price).toFixed(2)}/unit</span>
                          </div>
                        </div>
                        <div class="cust-item-total">
                          ₹${parseFloat(item.item_total).toFixed(2)}
                        </div>
                      </div>
                    `).join('')}
                  </div>

                  <!-- Order Bill Breakdown -->
                  <div class="cust-order-summary-box">
                    <div class="cust-summary-row">
                      <span>Vegetables Subtotal</span>
                      <span>₹${parseFloat(ord.subtotal).toFixed(2)}</span>
                    </div>
                    <div class="cust-summary-row">
                      <span>Delivery Charge</span>
                      <span>${parseFloat(ord.delivery_fee) > 0 ? `₹${parseFloat(ord.delivery_fee).toFixed(2)}` : '<strong style="color:var(--primary);">FREE</strong>'}</span>
                    </div>
                    ${parseFloat(ord.discount_amount) > 0 ? `
                      <div class="cust-summary-row" style="color:var(--primary);">
                        <span>Coupon Discount</span>
                        <span>-₹${parseFloat(ord.discount_amount).toFixed(2)}</span>
                      </div>
                    ` : ''}
                    <div class="cust-summary-row total">
                      <span>Total Paid / Payable</span>
                      <span>₹${parseFloat(ord.total_amount).toFixed(2)}</span>
                    </div>
                  </div>

                  <!-- Order Footer with Details & Actions -->
                  <div class="cust-order-footer">
                    <div class="cust-order-meta-info">
                      <div>
                        💳 <strong>Payment:</strong> ${escapeHtml(ord.payment_method)}
                        <span style="color:${ord.payment_status === 'Paid' ? 'var(--primary)' : 'var(--accent)'}; font-weight:700;">(${escapeHtml(ord.payment_status)})</span>
                        ${ord.upi_trans_id ? `<span class="text-xs text-muted" style="margin-left:6px;">(Ref: ${escapeHtml(ord.upi_trans_id)})</span>` : ''}
                      </div>
                      <div>
                        📍 <strong>Address:</strong> ${escapeHtml(ord.delivery_address || 'Customer Delivery Address')}
                      </div>
                      ${ord.rejection_reason ? `
                        <div style="color:var(--danger); font-weight:600;">
                          ⚠️ <strong>Reason:</strong> ${escapeHtml(ord.rejection_reason)}
                        </div>
                      ` : ''}
                    </div>

                    <div class="cust-order-actions-group">
                      <button class="os-btn active" onclick="App.trackOrder(${ord.id})" title="View Live Status">
                        🛵 Track Order
                      </button>

                      ${isReviewable ? `
                        <button class="os-btn" onclick="App.openReview(${ord.id})" style="background:#fef3c7; border-color:#fcd34d; color:#b45309;">
                          ⭐ Rate & Review
                        </button>
                      ` : ''}

                      ${ord.review ? `
                        <span class="text-xs" style="color:var(--primary-dark); font-weight:700; padding:6px 10px; background:#f0fdf4; border-radius:6px;">
                          ⭐ Reviewed (${ord.review.rating_overall || 5}/5)
                        </span>
                      ` : ''}

                      ${isPlaced ? `
                        <button class="os-btn reject" onclick="App.cancelCustomerOrder(${ord.id}, '${escapeHtml(ord.order_number)}')" title="Cancel Order">
                          ✕ Cancel Order
                        </button>
                      ` : ''}

                      ${['Accepted', 'Preparing', 'OutForDelivery'].includes(ord.order_status) ? `
                        <div class="order-accepted-notice" style="grid-column: 1 / -1;">
                          🔒 This order has been accepted by the shopkeeper and can no longer be cancelled.
                        </div>
                      ` : ''}

                      <button class="os-btn" onclick="App.reorderItems(${ord.id})" title="Add items to cart">
                        🥕 Reorder
                      </button>

                      <button class="os-btn" onclick="App.openPaymentReceipt(${ord.id})" title="View / Print Receipt">
                        🧾 Receipt
                      </button>

                      <button class="os-btn" onclick="App.openChat()" title="Chat with store">
                        💬 Support
                      </button>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;
  }

  async function cancelCustomerOrder(orderId, orderNumber) {
    Modal.show(`
      <div class="cancel-confirm-box" style="padding:10px 0; text-align:center;">
        <div style="font-size:42px; margin-bottom:10px;">⚠️</div>
        <h3 style="font-size:20px; font-weight:800; margin-bottom:8px; color:var(--slate-800);">Cancel Order ${escapeHtml(orderNumber)}?</h3>
        <p style="font-size:13.5px; color:var(--slate-600); margin-bottom:20px; line-height:1.5;">
          Are you sure you want to cancel this fresh vegetable order?<br>
          Reserved vegetables will be safely returned to store inventory.
        </p>
        <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
          <button class="btn-danger" id="btnConfirmOrderCancel" style="padding:10px 22px; font-weight:800;">
            ✕ Confirm Cancellation
          </button>
          <button class="btn-outline" onclick="Modal.hide()" style="padding:10px 22px;">
            Keep Order
          </button>
        </div>
      </div>
    `);

    qs('#btnConfirmOrderCancel')?.addEventListener('click', async () => {
      const btn = qs('#btnConfirmOrderCancel');
      if (btn) { btn.disabled = true; btn.textContent = 'Cancelling...'; }

      const res = await api('cancel_customer_order', { order_id: orderId, reason: 'Cancelled by customer' }, 'POST');
      Modal.hide();

      if (res.success) {
        toast('Your order has been cancelled successfully.');
        renderCustomerOrdersView('cancelled');
      } else {
        toast(res.error || 'Failed to cancel order', 'error');
        renderCustomerOrdersView();
      }
    });
  }

  async function reorderItems(orderId) {
    const res = await api('get_order_details', { id: orderId });
    if (!res.order || !res.order.items) {
      toast('Could not fetch order items to reorder', 'error');
      return;
    }
    const items = res.order.items;
    for (const item of items) {
      const prod = (window._allProducts || []).find(p => p.id == item.product_id) || {
        id: item.product_id,
        name: item.product_name,
        price: item.price,
        image_url: item.image_url,
        unit: 'kg'
      };
      cartAdd(prod, item.unit_weight);
    }
    updateCartBadge();
    toast(`🛒 Added ${items.length} vegetable item(s) to cart!`);
    openCartDrawer();
  }

  // ───────────────────────────────────────────────
  // CUSTOMER PAYMENT HISTORY VIEW
  // ───────────────────────────────────────────────
  let _custPayFilters = { search: '', status: 'all', method: 'all', sort: 'newest' };

  async function renderCustomerPaymentsView() {
    state.currentView = 'payments';
    window.location.hash = '#payments';
    closeSideMenu();

    const app = qs('#app');
    if (!app) return;

    // Loading state
    app.innerHTML = `
      <div class="payments-page-wrap">
        <div class="payments-page-header">
          <div>
            <h1 class="payments-page-title">💳 My Payment History</h1>
            <p class="text-sm text-muted" style="margin-top:2px;">Track your vegetable payments, transaction references &amp; receipts</p>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn-outline" onclick="App.renderCustomerView()" style="display:inline-flex; align-items:center; gap:6px;">← Back to Shop</button>
            <button class="btn-outline" onclick="App.renderCustomerOrdersView()" style="display:inline-flex; align-items:center; gap:6px;">📦 My Orders</button>
          </div>
        </div>
        <div class="page-loader" style="min-height:280px;">
          <div class="spinner"></div>
          <span style="color:var(--primary-dark); font-weight:700;">Fetching your payment transaction history...</span>
        </div>
      </div>
    `;

    const res = await api('get_customer_payments', _custPayFilters);
    const payments = res.payments || [];
    const summary = res.summary || { total_paid: 0, count_paid: 0, total_pending: 0, count_pending: 0, total_transactions: 0 };

    const statBadge = {
      Paid: '<span class="pay-status-pill paid">✓ Successful</span>',
      Pending: '<span class="pay-status-pill pending">⏳ Pending</span>',
      Failed: '<span class="pay-status-pill failed">❌ Failed</span>',
      Refunded: '<span class="pay-status-pill refunded">↩️ Refunded</span>'
    };

    const methodLabels = {
      ScanPay: '📷 Scan &amp; Pay (QR)',
      GPay: '📱 GPay / PhonePe / UPI',
      Card: '💳 Credit / Debit Card',
      COD: '💵 Cash on Delivery'
    };

    const hasFilters = _custPayFilters.search || _custPayFilters.status !== 'all' || _custPayFilters.method !== 'all' || _custPayFilters.sort !== 'newest';

    app.innerHTML = `
      <div class="payments-page-wrap">
        <!-- Header -->
        <div class="payments-page-header">
          <div>
            <h1 class="payments-page-title">💳 My Payment History</h1>
            <p class="text-sm text-muted" style="margin-top:2px;">Track your vegetable payments, transaction references &amp; receipts</p>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn-outline" onclick="App.renderCustomerView()" style="display:inline-flex; align-items:center; gap:6px;">← Back to Shop</button>
            <button class="btn-outline" onclick="App.renderCustomerOrdersView()" style="display:inline-flex; align-items:center; gap:6px;">📦 My Orders</button>
          </div>
        </div>

        <!-- Summary Strip -->
        <div class="payments-summary-strip">
          <div class="pay-summary-card success">
            <div class="pay-summary-icon">✅</div>
            <div>
              <div class="pay-summary-val">₹${parseFloat(summary.total_paid).toFixed(2)}</div>
              <div class="pay-summary-lbl">Total Paid (${summary.count_paid})</div>
            </div>
          </div>
          <div class="pay-summary-card pending">
            <div class="pay-summary-icon">⏳</div>
            <div>
              <div class="pay-summary-val">₹${parseFloat(summary.total_pending).toFixed(2)}</div>
              <div class="pay-summary-lbl">Pending Payable (${summary.count_pending})</div>
            </div>
          </div>
          <div class="pay-summary-card info">
            <div class="pay-summary-icon">🧾</div>
            <div>
              <div class="pay-summary-val">${summary.total_transactions}</div>
              <div class="pay-summary-lbl">Total Transactions</div>
            </div>
          </div>
        </div>

        <!-- Filter & Search Controls -->
        <div class="payments-filter-bar">
          <div class="payments-filter-search">
            <span class="search-ico">🔍</span>
            <input type="text" id="custPaySearch" placeholder="Search transaction reference or order #..." value="${escapeHtml(_custPayFilters.search)}">
          </div>
          <select class="payments-filter-select" id="custPayStatus">
            <option value="all" ${_custPayFilters.status === 'all' ? 'selected' : ''}>All Statuses</option>
            <option value="Paid" ${_custPayFilters.status === 'Paid' ? 'selected' : ''}>✓ Successful (Paid)</option>
            <option value="Pending" ${_custPayFilters.status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
            <option value="Failed" ${_custPayFilters.status === 'Failed' ? 'selected' : ''}>❌ Failed</option>
            <option value="Refunded" ${_custPayFilters.status === 'Refunded' ? 'selected' : ''}>↩️ Refunded</option>
          </select>
          <select class="payments-filter-select" id="custPayMethod">
            <option value="all" ${_custPayFilters.method === 'all' ? 'selected' : ''}>All Payment Methods</option>
            <option value="ScanPay" ${_custPayFilters.method === 'ScanPay' ? 'selected' : ''}>📷 Scan &amp; Pay (QR)</option>
            <option value="GPay" ${_custPayFilters.method === 'GPay' ? 'selected' : ''}>📱 GPay / PhonePe</option>
            <option value="Card" ${_custPayFilters.method === 'Card' ? 'selected' : ''}>💳 Card</option>
            <option value="COD" ${_custPayFilters.method === 'COD' ? 'selected' : ''}>💵 Cash on Delivery</option>
          </select>
          <select class="payments-filter-select" id="custPaySort">
            <option value="newest" ${_custPayFilters.sort === 'newest' ? 'selected' : ''}>Newest First</option>
            <option value="oldest" ${_custPayFilters.sort === 'oldest' ? 'selected' : ''}>Oldest First</option>
            <option value="amount_high" ${_custPayFilters.sort === 'amount_high' ? 'selected' : ''}>Amount High-to-Low</option>
            <option value="amount_low" ${_custPayFilters.sort === 'amount_low' ? 'selected' : ''}>Amount Low-to-High</option>
          </select>
          ${hasFilters ? `<button class="btn-outline" id="btnCustPayClear" style="padding:6px 12px; font-size:12px;">✕ Clear</button>` : ''}
        </div>

        <!-- Transactions List -->
        ${!payments.length ? `
          <div class="empty-state">
            <div class="emj">💳</div>
            <h3>You don't have any payment history yet.</h3>
            <p>${hasFilters ? 'No transactions match your search or filter criteria.' : 'Your payment receipts and transaction records will appear here as soon as you place an order.'}</p>
            ${hasFilters ? `
              <button class="btn-primary mt-2" onclick="App.clearCustPayFilters()">Clear Filters</button>
            ` : `
              <button class="btn-primary" onclick="App.renderCustomerView()" style="margin-top:16px;">
                Shop Fresh Veggies 🥕
              </button>
            `}
          </div>
        ` : `
          <div style="display:flex; flex-direction:column; gap:14px;">
            ${payments.map(p => `
              <div class="cust-payment-card" id="payCard_${p.id}">
                <div class="cust-payment-card-header">
                  <div class="pay-txn-id-block">
                    <div class="pay-txn-ref">
                      <span>🆔 ${escapeHtml(p.transaction_ref)}</span>
                      <span class="pay-order-tag">${escapeHtml(p.order_number)}</span>
                    </div>
                    <div class="pay-date-txt">📅 ${formatDate(p.created_at)}</div>
                  </div>
                  <div>
                    ${statBadge[p.payment_status] || p.payment_status}
                  </div>
                </div>

                <div class="cust-payment-card-body">
                  <div>
                    <div style="font-size:12px; font-weight:700; color:var(--slate-500); text-transform:uppercase; margin-bottom:4px;">Vegetables Purchased:</div>
                    <div class="pay-items-summary">${escapeHtml(p.items_summary || 'Fresh vegetables order')}</div>
                    <div style="margin-top:8px;">
                      <span class="pay-method-badge">${methodLabels[p.payment_method] || escapeHtml(p.payment_method)}</span>
                    </div>
                  </div>

                  <div class="pay-amount-box">
                    <div class="pay-amount-row">
                      <span class="text-muted">Subtotal:</span>
                      <span>₹${parseFloat(p.subtotal).toFixed(2)}</span>
                    </div>
                    <div class="pay-amount-row">
                      <span class="text-muted">Delivery Fee:</span>
                      <span>${parseFloat(p.delivery_fee) > 0 ? '₹' + parseFloat(p.delivery_fee).toFixed(2) : '<strong style="color:var(--primary);">FREE</strong>'}</span>
                    </div>
                    ${parseFloat(p.discount_amount) > 0 ? `
                      <div class="pay-amount-row" style="color:var(--primary);">
                        <span>Coupon Discount:</span>
                        <span>-₹${parseFloat(p.discount_amount).toFixed(2)}</span>
                      </div>
                    ` : ''}
                    <div class="pay-amount-row total">
                      <span>${p.payment_status === 'Paid' ? 'Amount Paid:' : 'Amount Payable:'}</span>
                      <span>₹${parseFloat(p.total_amount).toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div class="cust-payment-card-footer">
                  <div class="text-xs text-muted">
                    Order Status: <strong>${escapeHtml(p.order_status)}</strong>
                  </div>
                  <div style="display:flex; gap:8px;">
                    <button class="os-btn active" onclick="App.trackOrder(${p.id})" title="View Related Order">
                      📦 View Order
                    </button>
                    <button class="os-btn" onclick="App.openPaymentReceipt(${p.id})" style="background:#f0fdf4; color:#15803d; border-color:#86efac; font-weight:700;" title="View Receipt">
                      🧾 View Receipt
                    </button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;

    // Event listeners
    const sInput = qs('#custPaySearch');
    let searchDebounce;
    sInput?.addEventListener('input', (e) => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        _custPayFilters.search = e.target.value.trim();
        renderCustomerPaymentsView();
      }, 350);
    });

    qs('#custPayStatus')?.addEventListener('change', (e) => {
      _custPayFilters.status = e.target.value;
      renderCustomerPaymentsView();
    });

    qs('#custPayMethod')?.addEventListener('change', (e) => {
      _custPayFilters.method = e.target.value;
      renderCustomerPaymentsView();
    });

    qs('#custPaySort')?.addEventListener('change', (e) => {
      _custPayFilters.sort = e.target.value;
      renderCustomerPaymentsView();
    });

    qs('#btnCustPayClear')?.addEventListener('click', () => {
      _custPayFilters = { search: '', status: 'all', method: 'all', sort: 'newest' };
      renderCustomerPaymentsView();
    });
  }

  function clearCustPayFilters() {
    _custPayFilters = { search: '', status: 'all', method: 'all', sort: 'newest' };
    renderCustomerPaymentsView();
  }

  async function openPaymentReceipt(orderId) {
    Modal.show(`<div class="page-loader" style="padding:40px;"><div class="spinner"></div><p class="text-sm mt-2">Loading receipt...</p></div>`);
    const res = await api('get_payment_receipt', { order_id: orderId });
    if (!res.success || !res.receipt) {
      Modal.show(`<div class="empty-state"><h3>Unable to Load Receipt</h3><p>${res.error || 'Receipt not found'}</p><button class="btn-primary mt-2" onclick="Modal.hide()">Close</button></div>`);
      return;
    }

    const { order, items, shop, transaction_ref, receipt_no, amount_paid } = res.receipt;
    const isPaid = (order.payment_status === 'Paid');

    Modal.show(`
      <div class="receipt-paper" id="printableReceipt">
        <div class="receipt-header">
          <div class="receipt-shop-logo">🥬 ${escapeHtml(shop.shop_name || 'GreenHarvest Veggies')}</div>
          <div class="text-xs text-muted" style="margin-top:2px;">100% Farm-Fresh Vegetables Directly to Your Door</div>
          <div style="display:inline-block; margin-top:8px; padding:3px 12px; border-radius:12px; font-size:11px; font-weight:800; background:${isPaid ? '#dcfce7; color:#15803d;' : '#fef3c7; color:#b45309;'}">
            ${isPaid ? 'PAID RECEIPT ✓' : 'PAYMENT PENDING ⏳'}
          </div>
        </div>

        <div class="receipt-meta-grid">
          <div>
            <span class="text-muted">Receipt No:</span><br>
            <strong>${escapeHtml(receipt_no)}</strong>
          </div>
          <div style="text-align:right;">
            <span class="text-muted">Order No:</span><br>
            <strong>${escapeHtml(order.order_number)}</strong>
          </div>
          <div>
            <span class="text-muted">Customer Name:</span><br>
            <strong>${escapeHtml(order.customer_name)}</strong> (📞 ${escapeHtml(order.customer_phone)})
          </div>
          <div style="text-align:right;">
            <span class="text-muted">Date &amp; Time:</span><br>
            <span>${formatDate(order.created_at)}</span>
          </div>
          <div>
            <span class="text-muted">Payment Method:</span><br>
            <strong>${escapeHtml(order.payment_method)}</strong>
          </div>
          <div style="text-align:right;">
            <span class="text-muted">Transaction Ref:</span><br>
            <code style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-size:11px;">${escapeHtml(transaction_ref)}</code>
          </div>
          <div style="grid-column: 1 / -1;">
            <span class="text-muted">Delivery Address:</span><br>
            <span style="font-size:12px;">${escapeHtml(order.delivery_address)}</span>
          </div>
        </div>

        <table class="receipt-items-table">
          <thead>
            <tr>
              <th>Vegetable Item</th>
              <th style="text-align:center;">Weight × Qty</th>
              <th style="text-align:right;">Rate</th>
              <th style="text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(it => `
              <tr>
                <td><strong>${escapeHtml(it.product_name)}</strong></td>
                <td style="text-align:center;">${escapeHtml(it.unit_weight)} × ${it.quantity}</td>
                <td style="text-align:right;">₹${parseFloat(it.price).toFixed(2)}</td>
                <td style="text-align:right; font-weight:700;">₹${parseFloat(it.item_total).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="receipt-total-strip">
          <div class="flex justify-between">
            <span class="text-muted">Vegetables Subtotal:</span>
            <span>₹${parseFloat(order.subtotal).toFixed(2)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted">Delivery Charge:</span>
            <span>${parseFloat(order.delivery_fee) > 0 ? '₹' + parseFloat(order.delivery_fee).toFixed(2) : 'FREE'}</span>
          </div>
          ${parseFloat(order.discount_amount) > 0 ? `
            <div class="flex justify-between" style="color:var(--primary);">
              <span>Discount Coupon:</span>
              <span>-₹${parseFloat(order.discount_amount).toFixed(2)}</span>
            </div>
          ` : ''}
          <div class="flex justify-between" style="font-size:15px; font-weight:900; color:var(--primary-deep); border-top:1.5px dashed #cbd5e1; padding-top:6px;">
            <span>${isPaid ? 'TOTAL AMOUNT PAID:' : 'TOTAL PAYABLE:'}</span>
            <span>₹${parseFloat(order.total_amount).toFixed(2)}</span>
          </div>
        </div>

        <div style="display:flex; gap:10px; justify-content:center; margin-top:20px; flex-wrap:wrap;">
          <button class="btn-primary" onclick="window.print()" style="padding:8px 18px; font-size:13px; font-weight:700;">
            🖨️ Print Receipt
          </button>
          <button class="btn-outline" onclick="Modal.hide()" style="padding:8px 18px; font-size:13px;">
            Close
          </button>
        </div>
      </div>
    `);
  }

  // ───────────────────────────────────────────────
  // CUSTOMER PROFILE SETTINGS & MULTIPLE ADDRESSES
  // ───────────────────────────────────────────────
  async function renderCustomerProfileView(editMode = false) {
    state.currentView = 'profile';
    const app = qs('#app');
    if (!app) return;

    window.location.hash = '#profile';
    closeSideMenu();

    app.innerHTML = `
      <div class="profile-page-wrap">
        <div class="page-loader" style="min-height:300px; justify-content:center;">
          <div class="spinner"></div>
          <span style="color:var(--primary-dark); font-weight:700;">Loading Profile & Saved Addresses...</span>
        </div>
      </div>
    `;

    const [profRes, addrRes] = await Promise.all([
      api('get_profile'),
      api('get_addresses')
    ]);

    const profile = profRes.profile || state.user || {};
    state.user = { ...state.user, ...profile };
    const addresses = addrRes.addresses || [];

    const avatarSrc = profile.profile_photo || '';

    app.innerHTML = `
      <div class="profile-page-wrap">
        <!-- Top Nav / Back button -->
        <div class="flex justify-between items-center mb-1">
          <button class="btn-outline" onclick="App.renderCustomerView()" style="display:inline-flex; align-items:center; gap:6px;">
            ← Back to Shop
          </button>
          <div style="display:inline-flex; gap:8px;">
            <button class="btn-outline" onclick="App.renderCustomerPaymentsView()" style="display:inline-flex; align-items:center; gap:6px;">
              💳 Payments
            </button>
            <button class="btn-outline" onclick="App.renderCustomerOrdersView()" style="display:inline-flex; align-items:center; gap:6px;">
              📦 My Orders
            </button>
          </div>
        </div>

        <!-- 1. Profile Header Card with Avatar & Photo Upload -->
        <div class="profile-card profile-header-card">
          <div class="profile-avatar-container" id="profileAvatarBox">
            ${avatarSrc ? `
              <img src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(profile.name)}" class="profile-avatar-img" id="avatarDisplayImg" onerror="this.onerror=null; this.src='https://placehold.co/100x100/dcfce7/16a34a?text=👤';">
            ` : `
              <div class="profile-avatar-placeholder" id="avatarDisplayPlaceholder">👤</div>
            `}
            <button type="button" class="profile-avatar-overlay-btn" onclick="document.getElementById('profilePhotoInput').click()" title="Click to upload new photo">
              📷 Change
            </button>
          </div>

          <input type="file" id="profilePhotoInput" accept="image/jpeg,image/png,image/webp" style="display:none;">

          <div class="profile-header-info">
            <h2 class="profile-header-name">${escapeHtml(profile.name)}</h2>
            <div class="profile-header-meta">
              <span>📞 ${escapeHtml(profile.phone)}</span>
              ${profile.email ? `<span>✉️ ${escapeHtml(profile.email)}</span>` : ''}
              <span class="profile-role-badge">🛒 Customer #CUST-${profile.id}</span>
            </div>

            <!-- Photo Upload Action Bar (Preview & Save) -->
            <div id="photoPreviewActions" class="profile-photo-actions" style="display:none;">
              <span class="text-xs font-bold text-muted">Previewing selected photo:</span>
              <button class="btn-primary" id="btnSavePhoto" style="padding:5px 12px; font-size:12px;">💾 Save Photo</button>
              <button class="btn-outline" id="btnCancelPhoto" style="padding:5px 12px; font-size:12px;">✕ Cancel</button>
            </div>
          </div>
        </div>

        <!-- 2. Personal & Profile Address Details Card -->
        <div class="profile-card">
          <div class="profile-card-header">
            <h3 class="profile-card-title">👤 Profile Details</h3>
            ${!editMode ? `
              <button class="btn-outline" id="btnStartEditProfile" style="padding:6px 14px; font-size:13px; font-weight:700;">
                ✏️ Edit Profile
              </button>
            ` : ''}
          </div>

          ${!editMode ? `
            <!-- View Mode -->
            <div class="profile-grid">
              <div class="profile-info-item">
                <div class="profile-info-label">Customer ID</div>
                <div class="profile-info-value">#CUST-${profile.id}</div>
              </div>
              <div class="profile-info-item">
                <div class="profile-info-label">Full Name</div>
                <div class="profile-info-value">${escapeHtml(profile.name)}</div>
              </div>
              <div class="profile-info-item">
                <div class="profile-info-label">Mobile Number</div>
                <div class="profile-info-value">${escapeHtml(profile.phone)}</div>
              </div>
              <div class="profile-info-item">
                <div class="profile-info-label">Email Address</div>
                <div class="profile-info-value">${escapeHtml(profile.email || 'Not provided')}</div>
              </div>
              <div class="profile-info-item">
                <div class="profile-info-label">House / Building No</div>
                <div class="profile-info-value">${escapeHtml(profile.house_no || '—')}</div>
              </div>
              <div class="profile-info-item">
                <div class="profile-info-label">Street / Locality</div>
                <div class="profile-info-value">${escapeHtml(profile.street || '—')}</div>
              </div>
              <div class="profile-info-item">
                <div class="profile-info-label">Village / Town / City</div>
                <div class="profile-info-value">${escapeHtml(profile.city || 'Pune')}</div>
              </div>
              <div class="profile-info-item">
                <div class="profile-info-label">District</div>
                <div class="profile-info-value">${escapeHtml(profile.district || 'Pune')}</div>
              </div>
              <div class="profile-info-item">
                <div class="profile-info-label">State</div>
                <div class="profile-info-value">${escapeHtml(profile.state || 'Maharashtra')}</div>
              </div>
              <div class="profile-info-item">
                <div class="profile-info-label">PIN Code</div>
                <div class="profile-info-value">${escapeHtml(profile.pincode || '411001')}</div>
              </div>
              <div class="profile-info-item" style="grid-column: 1 / -1;">
                <div class="profile-info-label">Complete Profile Address</div>
                <div class="profile-info-value">${escapeHtml(profile.address || 'Flat 402, Sunshine Apartments, Green Park, Pune')}</div>
              </div>
            </div>
          ` : `
            <!-- Edit Mode -->
            <form id="editProfileForm">
              <div class="profile-grid">
                <div class="form-group">
                  <label class="form-label">Full Name <span style="color:var(--danger)">*</span></label>
                  <input class="form-input" id="epName" value="${escapeHtml(profile.name)}" required>
                </div>
                <div class="form-group">
                  <label class="form-label">Mobile Number <span style="color:var(--danger)">*</span></label>
                  <input class="form-input" id="epPhone" type="tel" maxlength="10" pattern="[0-9]{10}" value="${escapeHtml(profile.phone)}" required>
                </div>
                <div class="form-group">
                  <label class="form-label">Email Address</label>
                  <input class="form-input" id="epEmail" type="email" value="${escapeHtml(profile.email || '')}">
                </div>
                <div class="form-group">
                  <label class="form-label">House / Flat / Building No</label>
                  <input class="form-input" id="epHouse" value="${escapeHtml(profile.house_no || '')}" placeholder="e.g. Flat 402, Sunshine Apts">
                </div>
                <div class="form-group">
                  <label class="form-label">Street / Area / Locality</label>
                  <input class="form-input" id="epStreet" value="${escapeHtml(profile.street || '')}" placeholder="e.g. Green Park Road">
                </div>
                <div class="form-group">
                  <label class="form-label">Village / Town / City <span style="color:var(--danger)">*</span></label>
                  <input class="form-input" id="epCity" value="${escapeHtml(profile.city || 'Pune')}" required>
                </div>
                <div class="form-group">
                  <label class="form-label">District</label>
                  <input class="form-input" id="epDistrict" value="${escapeHtml(profile.district || 'Pune')}">
                </div>
                <div class="form-group">
                  <label class="form-label">State</label>
                  <input class="form-input" id="epState" value="${escapeHtml(profile.state || 'Maharashtra')}">
                </div>
                <div class="form-group">
                  <label class="form-label">PIN Code <span style="color:var(--danger)">*</span></label>
                  <input class="form-input" id="epPincode" maxlength="6" pattern="[0-9]{6}" value="${escapeHtml(profile.pincode || '411001')}" required>
                </div>
              </div>

              <div class="profile-edit-actions">
                <button type="button" class="btn-outline" id="btnCancelEditProfile">✕ Cancel</button>
                <button type="submit" class="btn-primary" id="btnSaveProfile">💾 Save Changes</button>
              </div>
            </form>
          `}
        </div>

        <!-- 3. Saved Delivery Addresses Card -->
        <div class="profile-card">
          <div class="profile-card-header">
            <h3 class="profile-card-title">📍 Saved Delivery Addresses (${addresses.length})</h3>
            <button class="btn-primary" onclick="App.openAddressModal()" style="padding:6px 14px; font-size:13px; font-weight:700;">
              ➕ Add New Address
            </button>
          </div>

          ${!addresses.length ? `
            <div class="empty-state" style="padding:24px 0; border:none;">
              <div class="emj">📍</div>
              <h4>No Delivery Addresses Saved Yet</h4>
              <p>Add your home or office address for fast 1-click checkout.</p>
              <button class="btn-primary mt-2" onclick="App.openAddressModal()">+ Add Your First Address</button>
            </div>
          ` : `
            <div class="addresses-list">
              ${addresses.map(a => `
                <div class="cust-address-card ${a.is_default == 1 ? 'is-default' : ''}" id="addrCard_${a.id}">
                  <div class="cust-address-top">
                    <div class="cust-address-tags">
                      <span class="addr-label-tag ${(a.label || 'Home').toLowerCase()}">${escapeHtml(a.label || 'Home')}</span>
                      ${a.is_default == 1 ? '<span class="addr-default-badge">⭐ Default Delivery Address</span>' : ''}
                    </div>
                    <span class="text-xs text-muted">Saved on ${formatDate(a.created_at)}</span>
                  </div>

                  <div class="cust-address-body">
                    <div class="cust-address-recipient">${escapeHtml(a.recipient_name)} &nbsp;·&nbsp; 📞 ${escapeHtml(a.phone)}</div>
                    <div>${escapeHtml([a.house_no, a.street, a.city, a.district, a.state, a.pincode ? 'PIN: ' + a.pincode : ''].filter(Boolean).join(', '))}</div>
                    ${a.delivery_instructions ? `<div class="cust-address-instructions">📝 <em>Instructions:</em> ${escapeHtml(a.delivery_instructions)}</div>` : ''}
                  </div>

                  <div class="cust-address-actions">
                    ${a.is_default != 1 ? `
                      <button class="addr-btn btn-def" onclick="App.setDefaultAddress(${a.id})" title="Set as default delivery address">
                        ⭐ Set as Default
                      </button>
                    ` : ''}
                    <button class="addr-btn btn-edit" onclick="App.openAddressModal(${JSON.stringify(a).replace(/"/g, '&quot;')})" title="Edit address">
                      ✏️ Edit
                    </button>
                    <button class="addr-btn btn-del" onclick="App.deleteAddress(${a.id}, '${escapeHtml(a.label)}')" title="Delete address">
                      🗑️ Delete
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;

    initProfileEvents(profile, editMode);
  }

  function initProfileEvents(profile, editMode) {
    let selectedPhotoFile = null;
    const photoInput = qs('#profilePhotoInput');
    const previewActions = qs('#photoPreviewActions');
    const avatarBox = qs('#profileAvatarBox');

    photoInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        toast('Please select a valid image (JPEG, PNG, WebP)', 'error');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast('Image size must be less than 5MB', 'error');
        return;
      }

      selectedPhotoFile = file;
      const reader = new FileReader();
      reader.onload = (evt) => {
        avatarBox.innerHTML = `
          <img src="${evt.target.result}" class="profile-avatar-img" id="avatarDisplayImg">
          <button type="button" class="profile-avatar-overlay-btn" onclick="document.getElementById('profilePhotoInput').click()">📷 Change</button>
        `;
        if (previewActions) previewActions.style.display = 'flex';
      };
      reader.readAsDataURL(file);
    });

    qs('#btnCancelPhoto')?.addEventListener('click', () => {
      selectedPhotoFile = null;
      photoInput.value = '';
      renderCustomerProfileView(editMode);
    });

    qs('#btnSavePhoto')?.addEventListener('click', async () => {
      if (!selectedPhotoFile) return;
      const btn = qs('#btnSavePhoto');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      const fd = new FormData();
      fd.append('photo', selectedPhotoFile);

      try {
        const r = await fetch('api.php?action=upload_profile_photo', { method: 'POST', body: fd });
        const data = await r.json();
        if (data.success) {
          toast('Profile photo uploaded and saved successfully!');
          state.user.profile_photo = data.photo_url;
          selectedPhotoFile = null;
          renderCustomerProfileView(editMode);
          renderSideMenu();
        } else {
          toast(data.error || 'Failed to upload photo', 'error');
          btn.disabled = false;
          btn.textContent = '💾 Save Photo';
        }
      } catch (err) {
        toast('Upload failed: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = '💾 Save Photo';
      }
    });

    qs('#btnStartEditProfile')?.addEventListener('click', () => {
      renderCustomerProfileView(true);
    });

    qs('#btnCancelEditProfile')?.addEventListener('click', () => {
      renderCustomerProfileView(false);
    });

    qs('#editProfileForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = qs('#btnSaveProfile');
      btn.disabled = true;
      btn.textContent = 'Saving Changes...';

      const payload = {
        name: qs('#epName').value.trim(),
        phone: qs('#epPhone').value.trim(),
        email: qs('#epEmail').value.trim(),
        house_no: qs('#epHouse').value.trim(),
        street: qs('#epStreet').value.trim(),
        city: qs('#epCity').value.trim(),
        district: qs('#epDistrict').value.trim(),
        state: qs('#epState').value.trim(),
        pincode: qs('#epPincode').value.trim()
      };

      const res = await api('update_profile', payload, 'POST');
      if (res.success) {
        toast('Profile details updated successfully!');
        state.user = { ...state.user, ...res.user };
        renderCustomerProfileView(false);
        renderSideMenu();
      } else {
        toast(res.error || 'Failed to update profile', 'error');
        btn.disabled = false;
        btn.textContent = '💾 Save Changes';
      }
    });
  }

  function openAddressModal(addr = null) {
    const isEdit = !!addr;
    const a = addr || {
      id: 0,
      label: 'Home',
      recipient_name: state.user?.name || '',
      phone: state.user?.phone || '',
      house_no: state.user?.house_no || '',
      street: state.user?.street || '',
      city: state.user?.city || 'Pune',
      district: state.user?.district || 'Pune',
      state: state.user?.state || 'Maharashtra',
      pincode: state.user?.pincode || '411001',
      delivery_instructions: '',
      is_default: 0
    };

    Modal.show(`
      <h2 style="margin-bottom:16px;">${isEdit ? '✏️ Edit Delivery Address' : '➕ Add Delivery Address'}</h2>
      <form id="addressForm">
        <div class="form-group">
          <label class="form-label">Address Label</label>
          <div style="display:flex; gap:16px;">
            ${['Home', 'Work', 'Other'].map(lbl => `
              <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-weight:700; font-size:13.5px;">
                <input type="radio" name="addrLabel" value="${lbl}" ${a.label === lbl ? 'checked' : ''}>
                <span>${lbl === 'Home' ? '🏠 Home' : lbl === 'Work' ? '🏢 Work' : '📍 Other'}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div class="form-group">
            <label class="form-label">Recipient Name <span style="color:var(--danger)">*</span></label>
            <input class="form-input" id="afRecipient" value="${escapeHtml(a.recipient_name)}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Contact Mobile <span style="color:var(--danger)">*</span></label>
            <input class="form-input" id="afPhone" type="tel" maxlength="10" pattern="[0-9]{10}" value="${escapeHtml(a.phone)}" required>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">House / Flat / Building No</label>
          <input class="form-input" id="afHouse" value="${escapeHtml(a.house_no)}" placeholder="e.g. Flat 301, Tower B">
        </div>

        <div class="form-group">
          <label class="form-label">Street / Area / Locality</label>
          <input class="form-input" id="afStreet" value="${escapeHtml(a.street)}" placeholder="e.g. MG Road, Near City Mall">
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div class="form-group">
            <label class="form-label">City / Town <span style="color:var(--danger)">*</span></label>
            <input class="form-input" id="afCity" value="${escapeHtml(a.city)}" required>
          </div>
          <div class="form-group">
            <label class="form-label">District</label>
            <input class="form-input" id="afDistrict" value="${escapeHtml(a.district || '')}">
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div class="form-group">
            <label class="form-label">State</label>
            <input class="form-input" id="afState" value="${escapeHtml(a.state || 'Maharashtra')}">
          </div>
          <div class="form-group">
            <label class="form-label">PIN Code <span style="color:var(--danger)">*</span></label>
            <input class="form-input" id="afPincode" maxlength="6" pattern="[0-9]{6}" value="${escapeHtml(a.pincode)}" required>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Delivery Instructions (Optional)</label>
          <input class="form-input" id="afInstructions" value="${escapeHtml(a.delivery_instructions || '')}" placeholder="e.g. Ring doorbell, leave at security">
        </div>

        <div class="form-group" style="margin-bottom:20px;">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:700; font-size:13.5px;">
            <input type="checkbox" id="afIsDefault" ${a.is_default == 1 ? 'checked' : ''}>
            <span>⭐ Set as my default delivery address</span>
          </label>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button type="button" class="btn-outline" onclick="Modal.hide()">Cancel</button>
          <button type="submit" class="btn-primary" id="btnSubmitAddress">💾 ${isEdit ? 'Update Address' : 'Save Address'}</button>
        </div>
      </form>
    `);

    qs('#addressForm').onsubmit = async (e) => {
      e.preventDefault();
      const btn = qs('#btnSubmitAddress');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      const label = document.querySelector('input[name="addrLabel"]:checked')?.value || 'Home';
      const payload = {
        id: a.id,
        label,
        recipient_name: qs('#afRecipient').value.trim(),
        phone: qs('#afPhone').value.trim(),
        house_no: qs('#afHouse').value.trim(),
        street: qs('#afStreet').value.trim(),
        city: qs('#afCity').value.trim(),
        district: qs('#afDistrict').value.trim(),
        state: qs('#afState').value.trim(),
        pincode: qs('#afPincode').value.trim(),
        delivery_instructions: qs('#afInstructions').value.trim(),
        is_default: qs('#afIsDefault').checked ? 1 : 0
      };

      const action = isEdit ? 'update_address' : 'add_address';
      const res = await api(action, payload, 'POST');
      if (res.success) {
        toast(`Address ${isEdit ? 'updated' : 'saved'} successfully!`);
        Modal.hide();
        if (state.currentView === 'profile') {
          renderCustomerProfileView(false);
        } else if (qs('#checkoutForm')) {
          checkout();
        }
      } else {
        toast(res.error || 'Failed to save address', 'error');
        btn.disabled = false;
        btn.textContent = isEdit ? 'Update Address' : 'Save Address';
      }
    };
  }

  async function setDefaultAddress(addrId) {
    const res = await api('set_default_address', { id: addrId }, 'POST');
    if (res.success) {
      toast('Default delivery address updated!');
      renderCustomerProfileView(false);
    } else {
      toast(res.error || 'Failed to set default address', 'error');
    }
  }

  async function deleteAddress(addrId, label) {
    if (!confirm(`Are you sure you want to delete this "${label}" delivery address?`)) {
      return;
    }
    const res = await api('delete_address', { id: addrId }, 'POST');
    if (res.success) {
      toast('Address deleted successfully!');
      renderCustomerProfileView(false);
    } else {
      toast(res.error || 'Failed to delete address', 'error');
    }
  }

  // ───────────────────────────────────────────────
  // SHOPKEEPER PROFILE SETTINGS
  // ───────────────────────────────────────────────
  async function loadShopProfile(container) {
    container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;
    const res = await api('get_profile');
    const profile = res.profile || state.user || {};
    const shop = res.extra?.shop_settings || state.settings || {};

    let editMode = false;

    function renderShopProfileUI() {
      container.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:20px; max-width:850px; margin:0 auto;">
          <!-- Shopkeeper Photo & Header Card -->
          <div class="profile-card profile-header-card">
            <div class="profile-avatar-container" id="shopAvatarBox">
              ${profile.profile_photo ? `
                <img src="${escapeHtml(profile.profile_photo)}" alt="${escapeHtml(profile.name)}" class="profile-avatar-img" id="shopAvatarImg" onerror="this.onerror=null; this.src='https://placehold.co/100x100/dcfce7/16a34a?text=🏪';">
              ` : `
                <div class="profile-avatar-placeholder" id="shopAvatarPlaceholder">🏪</div>
              `}
              <button type="button" class="profile-avatar-overlay-btn" onclick="document.getElementById('shopPhotoInput').click()" title="Upload Photo">
                📷 Change
              </button>
            </div>

            <input type="file" id="shopPhotoInput" accept="image/jpeg,image/png,image/webp" style="display:none;">

            <div class="profile-header-info">
              <h2 class="profile-header-name">${escapeHtml(shop.shop_name || 'GreenHarvest Fresh Vegetables')}</h2>
              <div class="profile-header-meta">
                <span>👤 Owner: <strong>${escapeHtml(profile.name)}</strong></span>
                <span>📞 ${escapeHtml(profile.phone)}</span>
                <span class="profile-role-badge">🏪 Store Manager #ID-${profile.id}</span>
              </div>

              <div id="shopPhotoPreviewActions" class="profile-photo-actions" style="display:none;">
                <span class="text-xs font-bold text-muted">Previewing photo:</span>
                <button class="btn-primary" id="btnSaveShopPhoto" style="padding:5px 12px; font-size:12px;">💾 Save Photo</button>
                <button class="btn-outline" id="btnCancelShopPhoto" style="padding:5px 12px; font-size:12px;">✕ Cancel</button>
              </div>
            </div>
          </div>

          <!-- Shopkeeper & Store Details Card -->
          <div class="profile-card">
            <div class="profile-card-header">
              <h3 class="profile-card-title">🏪 Store & Manager Profile Details</h3>
              ${!editMode ? `
                <button class="btn-outline" id="btnEditShopProfile" style="padding:6px 14px; font-size:13px; font-weight:700;">
                  ✏️ Edit Profile
                </button>
              ` : ''}
            </div>

            ${!editMode ? `
              <div class="profile-grid">
                <div class="profile-info-item">
                  <div class="profile-info-label">Shop / Store Name</div>
                  <div class="profile-info-value">${escapeHtml(shop.shop_name || 'GreenHarvest Fresh Vegetables')}</div>
                </div>
                <div class="profile-info-item">
                  <div class="profile-info-label">Store Manager / Owner Name</div>
                  <div class="profile-info-value">${escapeHtml(profile.name)}</div>
                </div>
                <div class="profile-info-item">
                  <div class="profile-info-label">Registered Mobile Number</div>
                  <div class="profile-info-value">${escapeHtml(profile.phone)}</div>
                </div>
                <div class="profile-info-item">
                  <div class="profile-info-label">Official Email Address</div>
                  <div class="profile-info-value">${escapeHtml(profile.email || 'shop@greenharvest.com')}</div>
                </div>
                <div class="profile-info-item" style="grid-column: 1 / -1;">
                  <div class="profile-info-label">Physical Shop Address</div>
                  <div class="profile-info-value">${escapeHtml(profile.address || 'Shop #12, Fresh Vegetable Market, Main Road')}</div>
                </div>
              </div>
            ` : `
              <form id="editShopProfileForm">
                <div class="profile-grid">
                  <div class="form-group">
                    <label class="form-label">Shop / Store Name <span style="color:var(--danger)">*</span></label>
                    <input class="form-input" id="espShopName" value="${escapeHtml(shop.shop_name || '')}" required>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Owner / Manager Name <span style="color:var(--danger)">*</span></label>
                    <input class="form-input" id="espName" value="${escapeHtml(profile.name)}" required>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Mobile Number <span style="color:var(--danger)">*</span></label>
                    <input class="form-input" id="espPhone" type="tel" maxlength="10" pattern="[0-9]{10}" value="${escapeHtml(profile.phone)}" required>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Official Email</label>
                    <input class="form-input" id="espEmail" type="email" value="${escapeHtml(profile.email || '')}">
                  </div>
                  <div class="form-group" style="grid-column: 1 / -1;">
                    <label class="form-label">Shop Physical Address</label>
                    <textarea class="form-textarea" id="espAddress" rows="2">${escapeHtml(profile.address || '')}</textarea>
                  </div>
                </div>

                <div class="profile-edit-actions">
                  <button type="button" class="btn-outline" id="btnCancelShopEdit">✕ Cancel</button>
                  <button type="submit" class="btn-primary" id="btnSaveShopProfile">💾 Save Changes</button>
                </div>
              </form>
            `}
          </div>
        </div>
      `;

      const photoInput = qs('#shopPhotoInput');
      const photoActions = qs('#shopPhotoPreviewActions');
      const avatarBox = qs('#shopAvatarBox');
      let chosenFile = null;

      photoInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        chosenFile = file;
        const reader = new FileReader();
        reader.onload = (evt) => {
          avatarBox.innerHTML = `
            <img src="${evt.target.result}" class="profile-avatar-img">
            <button type="button" class="profile-avatar-overlay-btn" onclick="document.getElementById('shopPhotoInput').click()">📷 Change</button>
          `;
          if (photoActions) photoActions.style.display = 'flex';
        };
        reader.readAsDataURL(file);
      });

      qs('#btnCancelShopPhoto')?.addEventListener('click', () => {
        chosenFile = null;
        photoInput.value = '';
        renderShopProfileUI();
      });

      qs('#btnSaveShopPhoto')?.addEventListener('click', async () => {
        if (!chosenFile) return;
        const btn = qs('#btnSaveShopPhoto');
        btn.disabled = true;
        btn.textContent = 'Saving...';

        const fd = new FormData();
        fd.append('photo', chosenFile);
        try {
          const r = await fetch('api.php?action=upload_profile_photo', { method: 'POST', body: fd });
          const data = await r.json();
          if (data.success) {
            toast('Profile photo updated successfully!');
            profile.profile_photo = data.photo_url;
            state.user.profile_photo = data.photo_url;
            chosenFile = null;
            renderShopProfileUI();
            renderSideMenu();
          } else {
            toast(data.error || 'Failed to upload photo', 'error');
            btn.disabled = false;
            btn.textContent = '💾 Save Photo';
          }
        } catch (err) {
          toast('Upload failed: ' + err.message, 'error');
          btn.disabled = false;
          btn.textContent = '💾 Save Photo';
        }
      });

      qs('#btnEditShopProfile')?.addEventListener('click', () => {
        editMode = true;
        renderShopProfileUI();
      });

      qs('#btnCancelShopEdit')?.addEventListener('click', () => {
        editMode = false;
        renderShopProfileUI();
      });

      qs('#editShopProfileForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = qs('#btnSaveShopProfile');
        btn.disabled = true;
        btn.textContent = 'Saving...';

        const payload = {
          name: qs('#espName').value.trim(),
          phone: qs('#espPhone').value.trim(),
          email: qs('#espEmail').value.trim(),
          shop_name: qs('#espShopName').value.trim(),
          address: qs('#espAddress').value.trim()
        };

        const r = await api('update_profile', payload, 'POST');
        if (r.success) {
          toast('Shopkeeper profile updated successfully!');
          profile.name = payload.name;
          profile.phone = payload.phone;
          profile.email = payload.email;
          profile.address = payload.address;
          shop.shop_name = payload.shop_name;
          state.settings.shop_name = payload.shop_name;
          state.user = { ...state.user, ...r.user };
          editMode = false;
          renderShopProfileUI();
          renderSideMenu();
        } else {
          toast(r.error || 'Failed to update profile', 'error');
          btn.disabled = false;
          btn.textContent = '💾 Save Changes';
        }
      });
    }

    renderShopProfileUI();
  }

  // ───────────────────────────────────────────────
  // CUSTOMER HOME VIEW
  // ───────────────────────────────────────────────
  async function renderCustomerView() {
    state.currentView = 'home';
    if (window.location.hash === '#orders') {
      try { history.replaceState(null, '', ' '); } catch (e) { window.location.hash = ''; }
    }
    document.querySelectorAll('.bnav-item').forEach(b => b.classList.remove('active'));
    qs('#bnHome')?.classList.add('active');

    qs('#app').innerHTML = `
      ${state.settings.shop_status === 'CLOSED' ? `
        <div class="shop-closed-banner">
          <span>🔴</span>
          <span><strong>🥬 Our vegetable shop is currently closed.</strong> You can still browse the catalog!</span>
        </div>` : ''}

      <!-- HERO -->
      <div class="hero-banner">
        <div class="hero-content">
          <div class="hero-badge">🥬 100% Farm Fresh · Delivered Daily</div>
          <h1>Fresh Vegetables<br>Delivered To Your Door</h1>
          <p>Handpicked daily from local organic farms. Order before 10 AM for same-day delivery.</p>
          <button class="hero-cta" onclick="document.getElementById('vegCatalog').scrollIntoView({behavior:'smooth'})">
            Shop Fresh Veggies 🥕
          </button>
        </div>
        <div class="hero-emoji-group">🍅<br>🥕<br>🥦</div>
      </div>

      <!-- CATEGORIES -->
      <div id="catScroller" class="cat-scroller">
        <div class="page-loader"><div class="spinner"></div></div>
      </div>

      <!-- FILTERS -->
      <div class="filter-row">
        <button class="filter-chip ${state.activeFilter==='all'?'active':''}" onclick="App.setFilter('all')">✨ All</button>
        <button class="filter-chip ${state.activeFilter==='fresh'?'active':''}" onclick="App.setFilter('fresh')">🌱 Fresh Today</button>
        <button class="filter-chip ${state.activeFilter==='bestseller'?'active':''}" onclick="App.setFilter('bestseller')">🔥 Best Sellers</button>
        <button class="filter-chip ${state.activeFilter==='organic'?'active':''}" onclick="App.setFilter('organic')">🌿 Organic</button>
        <button class="filter-chip ${state.activeFilter==='offers'?'active':''}" onclick="App.setFilter('offers')">🏷️ Offers</button>
      </div>

      <!-- PRODUCT CATALOG -->
      <div class="section-header" id="vegCatalog">
        <h2 class="section-title">🥕 Fresh Vegetables</h2>
        <span class="section-count" id="prodCount">Loading...</span>
      </div>
      <div id="productGrid" class="product-grid">
        <div class="page-loader" style="grid-column:1/-1;"><div class="spinner"></div><span>Loading fresh veggies...</span></div>
      </div>
    `;

    await loadCategories();
    await loadProducts();
    updateCartBadge();
  }

  async function loadCategories() {
    const data = await api('get_categories');
    const cats = data.categories || [];
    const container = qs('#catScroller');
    if (!container) return;
    container.innerHTML = cats.map(c => `
      <div class="cat-chip ${state.activeCategory === c.slug ? 'active' : ''}"
           onclick="App.setCat('${c.slug}')">
        <span>${c.icon}</span>${c.name}
      </div>
    `).join('');
  }

  async function loadProducts() {
    const grid = qs('#productGrid');
    const countEl = qs('#prodCount');
    if (!grid) return;

    const data = await api('get_products', {
      category: state.activeCategory,
      search: state.searchQuery,
      filter: state.activeFilter
    });

    const products = data.products || [];
    if (countEl) countEl.textContent = `${products.length} items available`;

    if (!products.length) {
      grid.innerHTML = `<div class="empty-state"><div class="emj">🥬</div><h3>No Vegetables Found</h3><p>Try: Tomato, Potato, Onion, Carrot, Spinach, Cauliflower, Brinjal, Capsicum...</p></div>`;
      return;
    }

    grid.innerHTML = products.map(p => {
      const isOut = p.available_stock <= 0;
      const units = (p.available_units || '1kg').split(',').map(u => u.trim());
      const selUnit = state.selectedProductUnits[p.id] || units[0];
      const inCart = state.cart.find(c => c.product_id === p.id && c.unit_weight === selUnit);

      return `
        <div class="product-card">
          <div class="card-badges">
            ${p.is_fresh_today==1 ? '<span class="badge-pill bp-fresh">Fresh Today</span>' : ''}
            ${p.is_organic==1 ? '<span class="badge-pill bp-organic">Organic</span>' : ''}
            ${p.is_best_seller==1 ? '<span class="badge-pill bp-best">Best Seller</span>' : ''}
            ${p.discount_percent>0 ? `<span class="badge-pill bp-discount">${p.discount_percent}% OFF</span>` : ''}
            ${isOut ? '<span class="badge-pill bp-out">Out of Stock</span>' : ''}
          </div>

          <div class="card-img-wrap" onclick="App.detail(${p.id})">
            <img src="${p.image_url}" alt="${p.name}" loading="lazy"
                 onerror="this.src='https://placehold.co/400x175/dcfce7/16a34a?text=${encodeURIComponent(p.name)}'">
          </div>

          <div class="card-body">
            <div class="card-name" onclick="App.detail(${p.id})">${p.name}</div>
            <div class="card-desc">${p.description || 'Farm fresh quality vegetable.'}</div>

            <div class="card-price-row">
              <span class="price-main">₹${p.price}</span>
              <span class="price-unit">/ ${p.unit || 'kg'}</span>
              ${p.discount_percent>0 ? `<span class="price-strike">₹${Math.round(p.price/(1-p.discount_percent/100))}</span>` : ''}
            </div>

            <div class="unit-chips">
              ${units.map(u => `
                <span class="uchip ${u===selUnit?'active':''}"
                      data-pid="${p.id}"
                      onclick="App.pickUnit(${p.id},'${u}',this)">${u}</span>
              `).join('')}
            </div>

            <div class="card-actions">
              ${isOut
                ? '<button class="btn-cart" disabled>Out of Stock</button>'
                : inCart
                ? `<div class="qty-ctrl">
                    <button onclick="App.cartChg(${p.id},'${selUnit}',-1)">-</button>
                    <span class="qty-val">${inCart.quantity}</span>
                    <button onclick="App.cartChg(${p.id},'${selUnit}',1)">+</button>
                   </div>`
                : `<button class="btn-cart" onclick="App.addCard(${p.id}, event)">🛒 Add to Cart</button>`
              }
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Store products in memory for quick lookup
    window._allProducts = products;
  }

  // ───────────────────────────────────────────────
  // SHOPKEEPER VIEW
  // ───────────────────────────────────────────────
  async function renderShopkeeperView() {
    state.shopOrderCategory = state.shopOrderCategory || 'active';
    qs('#app').innerHTML = `
      <div class="bg-card flex justify-between items-center flex-wrap gap-3" style="margin-bottom:20px;">
        <div>
          <h2 style="font-size:20px;">🏪 Shopkeeper Dashboard</h2>
          <p class="text-sm text-muted" style="margin-top:2px;">Overview of today's orders, status breakdown &amp; real-time operations.</p>
        </div>
        <button id="shopStatusBtn" class="role-btn" onclick="App.toggleShop()" style="background:${state.settings.shop_status==='OPEN'?'#dcfce7':'#fef2f2'}; color:${state.settings.shop_status==='OPEN'?'#166534':'#dc2626'}; border-color:${state.settings.shop_status==='OPEN'?'#86efac':'#fca5a5'};">
          ${state.settings.shop_status==='OPEN' ? '🟢 SHOP OPEN — Click to Close' : '🔴 SHOP CLOSED — Click to Open'}
        </button>
      </div>

      <!-- SEVEN COMPACT SUMMARY CARDS -->
      <div id="statsGrid" class="stats-grid shopkeeper-summary-grid">
        <div class="stat-card" id="sc0" onclick="App.setShopOrderCategory('today')" title="View today's orders">
          <div class="stat-icon">📦</div>
          <div class="stat-val" id="sv0">...</div>
          <div class="stat-lbl">Today's Orders</div>
        </div>
        <div class="stat-card" id="sc1" onclick="App.setShopOrderCategory('pending')" title="View orders awaiting decision">
          <div class="stat-icon">⏳</div>
          <div class="stat-val" id="sv1">...</div>
          <div class="stat-lbl">Pending</div>
        </div>
        <div class="stat-card" id="sc2" onclick="App.setShopOrderCategory('active')" title="View preparing orders">
          <div class="stat-icon">🥬</div>
          <div class="stat-val" id="sv2">...</div>
          <div class="stat-lbl">Preparing</div>
        </div>
        <div class="stat-card" id="sc3" onclick="App.setShopOrderCategory('active')" title="View dispatched orders">
          <div class="stat-icon">🛵</div>
          <div class="stat-val" id="sv3">...</div>
          <div class="stat-lbl">Out for Delivery</div>
        </div>
        <div class="stat-card" id="sc4" onclick="App.setShopOrderCategory('completed')" title="View completed orders">
          <div class="stat-icon">✅</div>
          <div class="stat-val" id="sv4">...</div>
          <div class="stat-lbl">Done</div>
        </div>
        <div class="stat-card" id="sc5" onclick="App.navigateToShopPage('reports')" title="View Sales Reports">
          <div class="stat-icon">💰</div>
          <div class="stat-val" id="sv5">...</div>
          <div class="stat-lbl">Sales</div>
        </div>
        <div class="stat-card" id="sc6" onclick="App.navigateToShopPage('payments')" title="View Payment History">
          <div class="stat-icon">⚠️</div>
          <div class="stat-val" id="sv6">...</div>
          <div class="stat-lbl">Payment Pending</div>
        </div>
      </div>

      <!-- ORDER MANAGEMENT SECTION (IMMEDIATELY BELOW SUMMARY CARDS) -->
      <div id="shopOrdersSection" class="shop-orders-section" style="margin-top:22px;">
        <div class="order-mgmt-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:14px;">
          <div>
            <h3 style="font-size:18px; font-weight:800; color:var(--dark);">📦 Order Management</h3>
            <p class="text-xs text-muted" style="margin-top:2px;">Live incoming orders, active preparation, completed deliveries and rejected orders</p>
          </div>
          <div class="orders-filter-bar order-mgmt-chips" style="margin:0;">
            <button class="filter-chip ${state.shopOrderCategory === 'active' ? 'active' : ''}" id="socChip_active" onclick="App.setShopOrderCategory('active')">
              ⚡ Active Orders
            </button>
            <button class="filter-chip ${state.shopOrderCategory === 'pending' ? 'active' : ''}" id="socChip_pending" onclick="App.setShopOrderCategory('pending')">
              ⏳ Pending Orders
            </button>
            <button class="filter-chip ${state.shopOrderCategory === 'completed' ? 'active' : ''}" id="socChip_completed" onclick="App.setShopOrderCategory('completed')">
              ✅ Completed Orders
            </button>
            <button class="filter-chip ${state.shopOrderCategory === 'rejected' ? 'active' : ''}" id="socChip_rejected" onclick="App.setShopOrderCategory('rejected')">
              ❌ Rejected Orders
            </button>
          </div>
        </div>

        <div id="shopOrdersContainer">
          <div class="page-loader" style="min-height:160px;"><div class="spinner"></div></div>
        </div>
      </div>
    `;

    renderSideMenu();
    await loadShopStats();
    await loadShopOrders();
    updateCartBadge();
  }

  async function loadShopStats() {
    const d = await api('get_shop_dashboard');
    if (!d) return;
    const vals = [
      d.today_orders ?? 0,
      d.pending_orders ?? 0,
      d.preparing_orders ?? 0,
      d.out_for_delivery ?? 0,
      d.completed_orders ?? 0,
      `₹${parseFloat(d.today_sales || 0).toFixed(0)}`,
      d.pending_payments ?? 0
    ];
    vals.forEach((v, i) => { const el = qs(`#sv${i}`); if (el) el.textContent = v; });

    // Update category badge counts on chips
    const chipActive = qs('#socChip_active');
    const chipPending = qs('#socChip_pending');
    const chipCompleted = qs('#socChip_completed');
    const chipRejected = qs('#socChip_rejected');
    if (chipActive && d.active_orders !== undefined) chipActive.innerHTML = `⚡ Active Orders (${d.active_orders})`;
    if (chipPending && d.pending_orders !== undefined) chipPending.innerHTML = `⏳ Pending Orders (${d.pending_orders})`;
    if (chipCompleted && d.completed_orders !== undefined) chipCompleted.innerHTML = `✅ Completed Orders (${d.completed_orders})`;
    if (chipRejected && d.rejected_orders !== undefined) chipRejected.innerHTML = `❌ Rejected Orders (${d.rejected_orders})`;
  }

  function setShopOrderCategory(cat) {
    state.shopOrderCategory = cat;
    document.querySelectorAll('.order-mgmt-chips .filter-chip').forEach(b => b.classList.remove('active'));
    const activeChip = qs(`#socChip_${cat}`);
    if (activeChip) activeChip.classList.add('active');
    loadShopOrders();
  }

  let _shopOrdersCache = [];

  async function loadShopOrders(container) {
    const target = container || qs('#shopOrdersContainer') || qs('#shopContent');
    if (!target) return;
    target.innerHTML = `<div class="page-loader" style="min-height:140px;"><div class="spinner"></div></div>`;

    const data = await api('get_shop_orders');
    const orders = data.orders || [];
    _shopOrdersCache = orders;

    // Map into the four categories
    const activeOrders = orders.filter(o => ['Accepted', 'Preparing', 'OutForDelivery'].includes(o.order_status));
    const pendingOrders = orders.filter(o => o.order_status === 'Placed');
    const completedOrders = orders.filter(o => o.order_status === 'Delivered');
    const rejectedOrders = orders.filter(o => o.order_status === 'Rejected');

    // Update category chip labels
    const chipActive = qs('#socChip_active');
    const chipPending = qs('#socChip_pending');
    const chipCompleted = qs('#socChip_completed');
    const chipRejected = qs('#socChip_rejected');
    if (chipActive) chipActive.innerHTML = `⚡ Active Orders (${activeOrders.length})`;
    if (chipPending) chipPending.innerHTML = `⏳ Pending Orders (${pendingOrders.length})`;
    if (chipCompleted) chipCompleted.innerHTML = `✅ Completed Orders (${completedOrders.length})`;
    if (chipRejected) chipRejected.innerHTML = `❌ Rejected Orders (${rejectedOrders.length})`;

    const cat = state.shopOrderCategory || 'active';
    let displayed = [];
    let emptyTitle = '';
    let emptyDesc = '';

    if (cat === 'pending') {
      displayed = pendingOrders;
      emptyTitle = 'No Pending Orders';
      emptyDesc = 'New orders awaiting your acceptance will appear here in real-time.';
    } else if (cat === 'completed') {
      displayed = completedOrders;
      emptyTitle = 'No Completed Orders';
      emptyDesc = 'Orders that have been successfully delivered will appear here.';
    } else if (cat === 'rejected') {
      displayed = rejectedOrders;
      emptyTitle = 'No Rejected Orders';
      emptyDesc = 'Orders rejected by the store will appear here with re-acceptance options.';
    } else if (cat === 'today') {
      const todayStr = new Date().toISOString().split('T')[0];
      displayed = orders.filter(o => (o.created_at || '').startsWith(todayStr));
      emptyTitle = "No Orders Today";
      emptyDesc = 'Orders placed today will appear here.';
    } else {
      displayed = activeOrders;
      emptyTitle = 'No Active Orders';
      emptyDesc = 'Orders currently in preparation or out for delivery will appear here.';
    }

    if (!displayed.length) {
      target.innerHTML = `
        <div class="empty-state" style="padding:32px 16px;">
          <div class="emj">📦</div>
          <h3>${emptyTitle}</h3>
          <p>${emptyDesc}</p>
        </div>
      `;
      return;
    }

    target.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:16px;">
        ${displayed.map(o => renderShopOrderCard(o)).join('')}
      </div>
    `;
  }

  function renderShopOrderCard(o) {
    const statusClass = { Placed:'sp-placed', Accepted:'sp-accepted', Preparing:'sp-preparing', OutForDelivery:'sp-out', Delivered:'sp-delivered', Rejected:'sp-rejected', Cancelled:'sp-cancelled' };
    const items = o.items || [];
    const dateFormatted = o.created_at ? formatDate(o.created_at) : '';

    return `
      <div class="order-card" id="oc${o.id}">
        <!-- Top header: Order Number & Date pill on left, Status pill on right -->
        <div class="order-card-header">
          <div class="order-card-id-block">
            <span class="order-card-num">📦 ${escapeHtml(o.order_number)}</span>
            ${dateFormatted ? `<span class="order-card-date">🕒 ${dateFormatted}</span>` : ''}
          </div>
          <span class="status-pill ${statusClass[o.order_status] || ''}">${escapeHtml(o.order_status)}</span>
        </div>

        <!-- Customer details card box -->
        <div class="order-card-cust-info">
          <div class="order-card-cust-row">
            <span class="order-card-cust-name">👤 ${escapeHtml(o.customer_name || 'Customer')}</span>
            ${o.customer_phone ? `
              <a href="tel:${escapeHtml(o.customer_phone)}" class="order-card-cust-phone" title="Call customer">
                📞 ${escapeHtml(o.customer_phone)}
              </a>
            ` : ''}
          </div>
          <div class="order-card-address">
            <span style="font-size:14px; flex-shrink:0;">📍</span>
            <span>${escapeHtml(o.delivery_address || 'No address provided')}</span>
          </div>
        </div>

        <!-- Vegetables Preview List -->
        <div class="order-items-preview">
          <div class="order-items-title">
            <span>🥬 Ordered Vegetables (${items.length})</span>
          </div>
          <div class="order-item-chip-list">
            ${items.map(i => `
              <div class="order-item-chip">
                <div class="order-item-chip-left">
                  <span class="order-item-icon">🌱</span>
                  <span class="order-item-name">${escapeHtml(i.product_name)}</span>
                  <span class="order-item-qty-badge">${escapeHtml(i.unit_weight)} × ${i.quantity}</span>
                </div>
                <span class="order-item-price">₹${parseFloat(i.item_total || 0).toFixed(2)}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Footer with payment details & total bill -->
        <div class="order-card-footer">
          <div class="order-card-pay-info">
            <span class="order-pay-method-tag">💳 ${escapeHtml(o.payment_method)}</span>
            <span class="order-pay-status-pill ${o.payment_status === 'Paid' ? 'paid' : 'pending'}">
              ${o.payment_status === 'Paid' ? '✓ Paid' : '⏳ Pending'}
            </span>
            ${o.upi_trans_id ? `<span class="text-xs text-muted" style="font-family:monospace; font-size:11px; background:#ffffff; padding:2px 6px; border:1px solid #cbd5e1; border-radius:4px;">Ref: ${escapeHtml(o.upi_trans_id)}</span>` : ''}
          </div>
          <div class="order-card-total-box">
            <span class="order-card-total-lbl">Total:</span>
            <span class="order-card-total-val">₹${parseFloat(o.total_amount || 0).toFixed(2)}</span>
          </div>
        </div>

        ${o.order_status === 'Rejected' && o.rejection_reason ? `
          <div style="font-size:12.5px; color:#991b1b; background:#fef2f2; border:1px solid #fca5a5; padding:8px 12px; border-radius:8px;">
            <strong>⚠️ Rejection Reason:</strong> ${escapeHtml(o.rejection_reason)}
          </div>
        ` : ''}

        <!-- Actions Row: View Details button on left, Status action buttons on right -->
        <div class="order-card-actions">
          <div class="order-card-actions-left">
            <button class="btn-view-details" onclick="App.openShopOrderDetailsModal(${o.id})" title="View full order details">
              👁️ View Details
            </button>
            ${o.order_status === 'Delivered' ? `
              <button class="os-btn" onclick="App.openPaymentReceipt(${o.id})" title="View / Print Receipt">🧾 Receipt</button>
            ` : ''}
          </div>

          <div class="order-card-actions-right">
            ${o.order_status === 'Placed' ? `
              <button class="os-btn active" onclick="App.setOrderStatus(${o.id},'Accepted')">✅ Accept Order</button>
              <button class="os-btn reject" onclick="App.rejectOrderModal(${o.id},'${escapeHtml(o.order_number)}')">❌ Reject</button>
            ` : ''}
            ${o.order_status === 'Accepted' ? `<button class="os-btn active" onclick="App.setOrderStatus(${o.id},'Preparing')">🥬 Start Preparing</button>` : ''}
            ${o.order_status === 'Preparing' ? `<button class="os-btn active" onclick="App.setOrderStatus(${o.id},'OutForDelivery')">🛵 Out for Delivery</button>` : ''}
            ${o.order_status === 'OutForDelivery' ? `<button class="os-btn active" onclick="App.setOrderStatus(${o.id},'Delivered')">🎉 Mark Delivered</button>` : ''}
            ${o.order_status === 'Delivered' ? `
              <span class="text-xs" style="font-weight:750; color:#15803d; background:#dcfce7; padding:4px 10px; border-radius:6px;">✔ Delivered</span>
            ` : ''}
            ${o.order_status === 'Rejected' ? `
              <button class="os-btn active" onclick="App.reacceptOrder(${o.id},'${escapeHtml(o.order_number)}')">🔄 Re-Accept Order</button>
            ` : ''}
            ${o.order_status === 'Cancelled' ? `
              <span class="badge" style="background:#fee2e2; color:#b91c1c; font-weight:700; padding:6px 12px; border-radius:6px; font-size:12px;">❌ Cancelled by Customer</span>
            ` : ''}
            ${o.payment_status !== 'Paid' && !['Rejected', 'Cancelled'].includes(o.order_status) ? `<button class="os-btn" onclick="App.verifyPay(${o.id})">💳 Mark as Paid</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  async function openShopOrderDetailsModal(orderId) {
    let o = (_shopOrdersCache || []).find(x => x.id === orderId);
    if (!o) {
      Modal.show(`<div class="page-loader" style="padding:40px;"><div class="spinner"></div><p class="text-sm mt-2">Loading order details...</p></div>`, true);
      const res = await api('get_order_details', { id: orderId });
      if (res && res.order) {
        o = res.order;
      }
    }
    if (!o) {
      toast('Order details not found', 'error');
      return;
    }

    const statusClass = { Placed:'sp-placed', Accepted:'sp-accepted', Preparing:'sp-preparing', OutForDelivery:'sp-out', Delivered:'sp-delivered', Rejected:'sp-rejected', Cancelled:'sp-cancelled' };
    const items = o.items || [];
    const subtotal = parseFloat(o.subtotal || 0);
    const deliveryFee = parseFloat(o.delivery_fee || 0);
    const discount = parseFloat(o.discount_amount || 0);
    const totalAmount = parseFloat(o.total_amount || 0);
    const isPaid = (o.payment_status === 'Paid');

    Modal.show(`
      <div class="shop-order-modal-details">
        <!-- Header -->
        <div class="som-header">
          <div>
            <div class="som-title">📦 Order ${escapeHtml(o.order_number.startsWith('#') ? o.order_number : '#' + o.order_number)}</div>
            <div class="som-subtitle">🕒 Placed on ${formatDate(o.created_at)}</div>
          </div>
          <span class="status-pill ${statusClass[o.order_status] || ''}">${escapeHtml(o.order_status)}</span>
        </div>

        <!-- Customer & Delivery Card -->
        <div class="som-card-section">
          <div class="som-section-heading">👤 Customer &amp; Delivery Information</div>
          <div class="som-cust-grid">
            <div class="som-cust-field">
              <span class="som-label">Customer Name</span>
              <strong class="som-val">${escapeHtml(o.customer_name || 'Customer')}</strong>
            </div>
            <div class="som-cust-field">
              <span class="som-label">Phone Number</span>
              <a href="tel:${escapeHtml(o.customer_phone || '')}" class="som-phone-link">
                📞 ${escapeHtml(o.customer_phone || 'N/A')}
              </a>
            </div>
            <div class="som-cust-field full-width">
              <span class="som-label">Delivery Address</span>
              <div class="som-address-val">📍 ${escapeHtml(o.delivery_address || 'No address provided')}</div>
            </div>
          </div>
        </div>

        <!-- Ordered Vegetables Table -->
        <div class="som-card-section">
          <div class="som-section-heading">🥬 Ordered Vegetables (${items.length} ${items.length === 1 ? 'item' : 'items'})</div>
          <div class="som-table-wrapper">
            <table class="som-items-table">
              <thead>
                <tr>
                  <th>Vegetable</th>
                  <th style="text-align:center;">Weight/Unit</th>
                  <th style="text-align:center;">Qty</th>
                  <th style="text-align:right;">Unit Price</th>
                  <th style="text-align:right;">Total</th>
                </tr>
              </thead>
              <tbody>
                ${items.map(it => `
                  <tr>
                    <td>
                      <div class="som-item-cell">
                        <span class="som-veg-icon">🌱</span>
                        <strong>${escapeHtml(it.product_name)}</strong>
                      </div>
                    </td>
                    <td style="text-align:center;"><span class="som-unit-badge">${escapeHtml(it.unit_weight)}</span></td>
                    <td style="text-align:center;"><strong>${it.quantity}</strong></td>
                    <td style="text-align:right; color:var(--slate-600);">₹${parseFloat(it.price || 0).toFixed(2)}</td>
                    <td style="text-align:right; font-weight:800; color:var(--dark);">₹${parseFloat(it.item_total || 0).toFixed(2)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Bill & Payment Breakdown -->
        <div class="som-card-section">
          <div class="som-section-heading">💳 Bill &amp; Payment Summary</div>
          <div class="som-bill-grid">
            <div class="som-bill-row">
              <span>Vegetables Subtotal:</span>
              <strong>₹${subtotal.toFixed(2)}</strong>
            </div>
            <div class="som-bill-row">
              <span>Delivery Fee:</span>
              <span>${deliveryFee > 0 ? `₹${deliveryFee.toFixed(2)}` : '<strong style="color:var(--primary);">FREE</strong>'}</span>
            </div>
            ${discount > 0 ? `
              <div class="som-bill-row" style="color:var(--primary);">
                <span>Coupon Discount:</span>
                <strong>-₹${discount.toFixed(2)}</strong>
              </div>
            ` : ''}
            <div class="som-bill-row total">
              <span>Total Bill Amount:</span>
              <strong class="som-grand-total">₹${totalAmount.toFixed(2)}</strong>
            </div>
          </div>

          <div class="som-pay-meta">
            <div class="som-pay-meta-item">
              <span class="som-label">Payment Method:</span>
              <span class="order-pay-method-tag">💳 ${escapeHtml(o.payment_method)}</span>
            </div>
            <div class="som-pay-meta-item">
              <span class="som-label">Payment Status:</span>
              <span class="order-pay-status-pill ${isPaid ? 'paid' : 'pending'}">
                ${isPaid ? '✓ Paid' : '⏳ Pending'}
              </span>
            </div>
            ${o.upi_trans_id ? `
              <div class="som-pay-meta-item full">
                <span class="som-label">UPI Reference ID:</span>
                <code class="som-upi-ref">${escapeHtml(o.upi_trans_id)}</code>
              </div>
            ` : ''}
          </div>
        </div>

        ${o.order_status === 'Rejected' && o.rejection_reason ? `
          <div class="som-reject-notice">
            <strong>⚠️ Rejection Reason:</strong> ${escapeHtml(o.rejection_reason)}
          </div>
        ` : ''}

        <!-- Actions in Modal -->
        <div class="som-modal-actions">
          <div class="som-modal-actions-left">
            <button class="os-btn" onclick="App.openPaymentReceipt(${o.id})" title="Print or View Receipt">
              🧾 View Receipt
            </button>
            ${!isPaid && !['Rejected', 'Cancelled'].includes(o.order_status) ? `
              <button class="os-btn" onclick="App.verifyPay(${o.id}); Modal.hide();" style="background:#fef3c7; border-color:#fde68a; color:#b45309; font-weight:750;">
                💳 Mark as Paid
              </button>
            ` : ''}
          </div>
          <div class="som-modal-actions-right">
            ${o.order_status === 'Placed' ? `
              <button class="os-btn active" onclick="App.setOrderStatus(${o.id},'Accepted'); Modal.hide();">✅ Accept</button>
              <button class="os-btn reject" onclick="Modal.hide(); App.rejectOrderModal(${o.id},'${escapeHtml(o.order_number)}');">❌ Reject</button>
            ` : ''}
            ${o.order_status === 'Accepted' ? `<button class="os-btn active" onclick="App.setOrderStatus(${o.id},'Preparing'); Modal.hide();">🥬 Start Preparing</button>` : ''}
            ${o.order_status === 'Preparing' ? `<button class="os-btn active" onclick="App.setOrderStatus(${o.id},'OutForDelivery'); Modal.hide();">🛵 Out for Delivery</button>` : ''}
            ${o.order_status === 'OutForDelivery' ? `<button class="os-btn active" onclick="App.setOrderStatus(${o.id},'Delivered'); Modal.hide();">🎉 Mark Delivered</button>` : ''}
            ${o.order_status === 'Rejected' ? `<button class="os-btn active" onclick="App.reacceptOrder(${o.id},'${escapeHtml(o.order_number)}'); Modal.hide();">🔄 Re-Accept</button>` : ''}
            <button class="os-btn" onclick="Modal.hide()" style="border-color:#cbd5e1; color:var(--slate-600);">✕ Close</button>
          </div>
        </div>
      </div>
    `, true);
  }

  async function rejectOrderModal(orderId, orderNum) {
    const reason = prompt(`Enter reason for rejecting order ${orderNum} (optional):`, 'Store closing or item temporarily out of stock');
    if (reason === null) return; // User cancelled prompt
    await setOrderStatus(orderId, 'Rejected', reason.trim() || 'Store item unavailable');
  }

  async function reacceptOrder(orderId, orderNum) {
    const confirmed = confirm(
      `Are you sure you want to re-accept order ${orderNum}?\n\nThis will update the order status to 'Accepted' and move it back into Active Orders.`
    );
    if (!confirmed) return;

    try {
      const res = await api('reaccept_order', { order_id: orderId }, 'POST');
      if (res.success) {
        toast(`✅ Order ${orderNum} re-accepted! Moved to Active Orders.`);
        await loadShopStats();
        await loadShopOrders();
      } else {
        toast(res.error || 'Failed to re-accept order.', 'error');
        await loadShopOrders();
      }
    } catch (e) {
      toast('Network error while re-accepting order.', 'error');
    }
  }

  async function setOrderStatus(orderId, status, reason = '') {
    const res = await api('update_order_status', { order_id: orderId, status, reason }, 'POST');
    if (res.success) {
      toast(`✅ Order ${status}!`);
      await loadShopStats();
      await loadShopOrders();
    } else {
      toast(res.error || `Failed to update order status`, 'error');
      await loadShopOrders();
    }
  }

  async function verifyPay(orderId) {
    const res = await api('verify_payment', { order_id: orderId, payment_status: 'Paid' }, 'POST');
    if (res.success) {
      toast('Payment marked as Paid');
      await loadShopStats();
      await loadShopOrders();
    }
  }

  function navigateToShopPage(page) {
    state.shopTab = page;
    if (page === 'dashboard' || page === 'orders') {
      window.location.hash = (page === 'orders') ? '#orders' : '#dashboard';
      renderShopkeeperView();
      if (page === 'orders') {
        setTimeout(() => {
          const el = qs('#shopOrdersSection');
          if (el) el.scrollIntoView({ behavior: 'smooth' });
        }, 150);
      }
    } else {
      window.location.hash = '#' + page;
      renderShopkeeperDedicatedPage(page);
    }
  }

  function renderShopkeeperDedicatedPage(page) {
    state.shopTab = page;
    const pageTitles = {
      vegetables: { title: '🥕 Manage Vegetable Catalog', subtitle: 'Add, edit prices, units, stock and discounts for all fresh vegetables.' },
      inventory: { title: '📊 Stock & Inventory Management', subtitle: 'Monitor available stock, sold stock and inventory levels in real-time.' },
      payments: { title: '💳 Shopkeeper Payment History', subtitle: 'Customer payment transactions, methods, UPI verifications and accounting.' },
      reports: { title: '📈 Sales & Revenue Reports', subtitle: 'View daily, weekly, and monthly sales totals and top-performing vegetables.' },
      chat: { title: '💬 Customer Support Messages', subtitle: 'Live chat and direct communication with customers.' },
      settings: { title: '⚙️ Store Settings & UPI Configuration', subtitle: 'Configure shop status, UPI payments, delivery charges and thresholds.' },
      profile: { title: '👤 Store Profile Settings', subtitle: 'Update shopkeeper details, contact number, store address and photo.' }
    };

    const info = pageTitles[page] || { title: '🏪 Shopkeeper Portal', subtitle: 'GreenHarvest store management' };

    qs('#app').innerHTML = `
      <div class="bg-card flex justify-between items-center flex-wrap gap-3" style="margin-bottom:20px;">
        <div>
          <h2 style="font-size:20px;">${info.title}</h2>
          <p class="text-sm text-muted" style="margin-top:2px;">${info.subtitle}</p>
        </div>
        <div style="display:flex; gap:10px; align-items:center;">
          <button class="os-btn" onclick="App.navigateToShopPage('dashboard')">📊 Dashboard</button>
          <button id="shopStatusBtn" class="role-btn" onclick="App.toggleShop()" style="background:${state.settings.shop_status==='OPEN'?'#dcfce7':'#fef2f2'}; color:${state.settings.shop_status==='OPEN'?'#166534':'#dc2626'}; border-color:${state.settings.shop_status==='OPEN'?'#86efac':'#fca5a5'};">
            ${state.settings.shop_status==='OPEN' ? '🟢 SHOP OPEN' : '🔴 SHOP CLOSED'}
          </button>
        </div>
      </div>
      <div id="shopContent">
        <div class="page-loader"><div class="spinner"></div></div>
      </div>
    `;

    renderSideMenu();
    const container = qs('#shopContent');
    switch (page) {
      case 'vegetables': loadVegManagement(container); break;
      case 'inventory': loadInventory(container); break;
      case 'payments': loadPayments(container); break;
      case 'reports': loadReports(container); break;
      case 'chat': loadShopChat(container); break;
      case 'settings': loadSettings(container); break;
      case 'profile': loadShopProfile(container); break;
      default: renderShopkeeperView(); break;
    }
    updateCartBadge();
  }

  async function loadShopTabContent(tab) {
    navigateToShopPage(tab);
  }

  // VEGETABLE MANAGEMENT (SHOPKEEPER CRUD)
  async function loadVegManagement(container) {
    const [pData, cData] = await Promise.all([api('get_products'), api('get_categories')]);
    const products = pData.products || [];
    const cats = cData.categories || [];

    container.innerHTML = `
      <div class="flex justify-between items-center mb-3">
        <h3>🥕 Vegetable Management</h3>
        <button class="btn-primary" onclick="App.addVegModal(${JSON.stringify(cats).replace(/"/g,'&quot;')})">+ Add Vegetable</button>
      </div>
      <div style="display:flex; flex-direction:column; gap:10px;">
        ${products.map(p => `
          <div class="bg-card flex items-center gap-3" style="padding:12px 16px;">
            <img src="${p.image_url}" style="width:52px; height:52px; border-radius:10px; object-fit:cover; flex-shrink:0;"
                 onerror="this.src='https://placehold.co/52x52/dcfce7/16a34a?text=🥬'">
            <div style="flex:1; min-width:0;">
              <div class="font-bold">${p.name}</div>
              <div class="text-xs text-muted">${p.category_name} · ₹${p.price}/${p.unit} · Stock: ${parseFloat(p.available_stock).toFixed(1)}${p.unit}</div>
              <div style="display:flex; gap:5px; margin-top:4px; flex-wrap:wrap;">
                ${p.is_fresh_today==1 ? '<span class="badge-pill bp-fresh" style="font-size:9px;">Fresh</span>' : ''}
                ${p.is_organic==1 ? '<span class="badge-pill bp-organic" style="font-size:9px;">Organic</span>' : ''}
                ${p.is_best_seller==1 ? '<span class="badge-pill bp-best" style="font-size:9px;">Best Seller</span>' : ''}
                ${p.discount_percent>0 ? `<span class="badge-pill bp-discount" style="font-size:9px;">${p.discount_percent}% OFF</span>` : ''}
              </div>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="btn-outline" style="padding:6px 12px; font-size:12px;" onclick="App.editVegModal(${p.id}, ${JSON.stringify(cats).replace(/"/g,'&quot;')})">Edit</button>
              <button class="btn-danger" onclick="App.deleteVeg(${p.id})">Delete</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function addVegModal(cats) {
    Modal.show(`
      <h2 style="margin-bottom:16px;">🥕 Add New Vegetable</h2>
      <form id="addVegForm">
        <div class="form-group"><label class="form-label">Vegetable Name</label><input class="form-input" name="name" required placeholder="e.g. Fresh Tomato"></div>
        <div class="form-group"><label class="form-label">Category</label>
          <select class="form-select" name="category_id">
            ${cats.map(c=>`<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')}
          </select>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div class="form-group"><label class="form-label">Price (₹)</label><input class="form-input" name="price" type="number" step="0.01" required placeholder="40.00"></div>
          <div class="form-group"><label class="form-label">Unit</label><select class="form-select" name="unit"><option>kg</option><option>pack</option><option>piece</option><option>bunch</option></select></div>
        </div>
        <div class="form-group"><label class="form-label">Available Stock (in kg/units)</label><input class="form-input" name="stock" type="number" step="0.5" value="50"></div>
        <div class="form-group"><label class="form-label">Available Weight Options</label><input class="form-input" name="available_units" value="250g, 500g, 1kg, 2kg, 5kg"></div>
        <div class="form-group"><label class="form-label">Image URL</label><input class="form-input" name="image_url" placeholder="https://..."></div>
        <div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" name="description" placeholder="Describe this vegetable..."></textarea></div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div class="form-group"><label class="form-label">Discount %</label><input class="form-input" name="discount_percent" type="number" value="0" min="0" max="100"></div>
        </div>
        <div style="display:flex; gap:16px; margin-bottom:12px;">
          <label class="checkbox-row"><input type="checkbox" name="is_fresh_today" checked> Fresh Today</label>
          <label class="checkbox-row"><input type="checkbox" name="is_best_seller"> Best Seller</label>
          <label class="checkbox-row"><input type="checkbox" name="is_organic"> Organic</label>
        </div>
        <button type="submit" class="btn-primary w-full">Add Vegetable</button>
      </form>
    `);

    qs('#addVegForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const res = await api('add_product', Object.fromEntries(fd), 'POST');
      if (res.success) {
        toast('✅ Vegetable added!');
        Modal.hide();
        loadShopTabContent('vegetables');
      } else {
        toast(res.error || 'Failed to add vegetable', 'error');
      }
    };
  }

  async function editVegModal(prodId, cats) {
    const data = await api('get_products');
    const p = (data.products || []).find(x => x.id == prodId);
    if (!p) return;

    Modal.show(`
      <h2 style="margin-bottom:16px;">✏️ Edit: ${p.name}</h2>
      <form id="editVegForm">
        <input type="hidden" name="id" value="${p.id}">
        <div class="form-group"><label class="form-label">Vegetable Name</label><input class="form-input" name="name" value="${p.name}" required></div>
        <div class="form-group"><label class="form-label">Category</label>
          <select class="form-select" name="category_id">
            ${cats.map(c=>`<option value="${c.id}" ${c.id==p.category_id?'selected':''}>${c.icon} ${c.name}</option>`).join('')}
          </select>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div class="form-group"><label class="form-label">Price (₹)</label><input class="form-input" name="price" type="number" step="0.01" value="${p.price}" required></div>
          <div class="form-group"><label class="form-label">Unit</label><select class="form-select" name="unit"><option ${p.unit==='kg'?'selected':''}>kg</option><option ${p.unit==='pack'?'selected':''}>pack</option><option ${p.unit==='piece'?'selected':''}>piece</option><option ${p.unit==='bunch'?'selected':''}>bunch</option></select></div>
        </div>
        <div class="form-group"><label class="form-label">Stock (${p.unit})</label><input class="form-input" name="stock" type="number" step="0.5" value="${p.available_stock}"></div>
        <div class="form-group"><label class="form-label">Available Weight Options</label><input class="form-input" name="available_units" value="${p.available_units}"></div>
        <div class="form-group"><label class="form-label">Image URL</label><input class="form-input" name="image_url" value="${p.image_url}"></div>
        <div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" name="description">${p.description || ''}</textarea></div>
        <div class="form-group"><label class="form-label">Discount %</label><input class="form-input" name="discount_percent" type="number" value="${p.discount_percent}" min="0" max="100"></div>
        <div style="display:flex; gap:16px; margin-bottom:14px;">
          <label class="checkbox-row"><input type="checkbox" name="is_fresh_today" ${p.is_fresh_today==1?'checked':''}> Fresh Today</label>
          <label class="checkbox-row"><input type="checkbox" name="is_best_seller" ${p.is_best_seller==1?'checked':''}> Best Seller</label>
          <label class="checkbox-row"><input type="checkbox" name="is_organic" ${p.is_organic==1?'checked':''}> Organic</label>
        </div>
        <button type="submit" class="btn-primary w-full">Save Changes</button>
      </form>
    `);

    qs('#editVegForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const res = await api('update_product', Object.fromEntries(fd), 'POST');
      if (res.success) {
        toast('✅ Vegetable updated!');
        Modal.hide();
        loadShopTabContent('vegetables');
      }
    };
  }

  async function deleteVeg(id) {
    if (!confirm('Delete this vegetable? It will be hidden from customers.')) return;
    const res = await api('delete_product', { id }, 'POST');
    if (res.success) { toast('Vegetable removed.'); loadShopTabContent('vegetables'); }
  }

  // INVENTORY
  async function loadInventory(container) {
    const data = await api('get_inventory');
    const inv = data.inventory || [];

    container.innerHTML = `
      <h3 style="margin-bottom:16px;">📊 Vegetable Inventory</h3>
      <div style="overflow-x:auto; background:white; border-radius:var(--radius-md); border:1px solid #e2e8f0;">
        <table class="inv-table">
          <thead>
            <tr>
              <th>Vegetable</th>
              <th>Category</th>
              <th>Price</th>
              <th>Available</th>
              <th>Sold</th>
              <th>Stock Level</th>
            </tr>
          </thead>
          <tbody>
            ${inv.map(p => {
              const total = parseFloat(p.available_stock) + parseFloat(p.sold_stock);
              const pct = total > 0 ? (p.available_stock / total) * 100 : 0;
              const cls = pct > 60 ? 'sfill-high' : pct > 25 ? 'sfill-mid' : 'sfill-low';
              const isOut = p.available_stock <= 0;
              return `
                <tr>
                  <td>
                    <div style="display:flex; align-items:center; gap:10px;">
                      <img src="${p.image_url}" style="width:38px; height:38px; border-radius:8px; object-fit:cover;" onerror="this.src='https://placehold.co/38x38/dcfce7/16a34a?text=🥬'">
                      <div>
                        <div class="font-bold text-sm">${p.name}</div>
                        ${isOut ? '<span class="badge-pill bp-out" style="font-size:9px;">Out of Stock</span>' : ''}
                      </div>
                    </div>
                  </td>
                  <td class="text-sm text-muted">${p.category_name}</td>
                  <td class="font-bold text-sm">₹${p.price}</td>
                  <td class="font-bold text-sm" style="color:${isOut?'var(--danger)':'var(--primary-deep)'};">${parseFloat(p.available_stock).toFixed(1)} ${p.unit}</td>
                  <td class="text-sm text-muted">${parseFloat(p.sold_stock).toFixed(1)} ${p.unit}</td>
                  <td style="min-width:120px;">
                    <div class="stock-mini-bar"><div class="stock-mini-fill ${cls}" style="width:${pct}%;"></div></div>
                    <div class="text-xs text-muted mt-1">${pct.toFixed(0)}% remaining</div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // PAYMENTS (SHOPKEEPER)
  let _shopPayFilters = { search: '', status: 'all', method: 'all', date_filter: 'all', sort: 'newest' };

  async function loadPayments(container) {
    container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;
    const data = await api('get_payments', _shopPayFilters);
    const payments = data.payments || [];
    const summary = data.summary || { total_paid: 0, count_paid: 0, total_pending: 0, count_pending: 0, count_failed: 0, total_refunded: 0, count_refunded: 0, total_orders: 0 };
    const filtered = data.filtered_summary || summary;

    const statBadge = {
      Paid: '<span class="pay-status-pill paid">✓ Paid</span>',
      Pending: '<span class="pay-status-pill pending">⏳ Pending</span>',
      Failed: '<span class="pay-status-pill failed">❌ Failed</span>',
      Refunded: '<span class="pay-status-pill refunded">↩️ Refunded</span>'
    };

    const hasFilters = _shopPayFilters.search || _shopPayFilters.status !== 'all' || _shopPayFilters.method !== 'all' || _shopPayFilters.date_filter !== 'all' || _shopPayFilters.sort !== 'newest';

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0;">💳 Payment Transactions &amp; Receipts</h3>
        <span class="text-xs text-muted">Real-time payment verification &amp; order linking</span>
      </div>

      <!-- Payment Summary Cards (Accurate DB calculations) -->
      <div class="shop-payments-summary">
        <div class="shop-pay-stat green">
          <div class="shop-pay-stat-val">₹${parseFloat(summary.total_paid).toFixed(2)}</div>
          <div class="shop-pay-stat-lbl">✅ Total Paid (${summary.count_paid})</div>
        </div>
        <div class="shop-pay-stat amber">
          <div class="shop-pay-stat-val">₹${parseFloat(summary.total_pending).toFixed(2)}</div>
          <div class="shop-pay-stat-lbl">⏳ Pending Payments (${summary.count_pending})</div>
        </div>
        <div class="shop-pay-stat red">
          <div class="shop-pay-stat-val">${summary.count_failed}</div>
          <div class="shop-pay-stat-lbl">❌ Failed / Cancelled</div>
        </div>
        <div class="shop-pay-stat blue">
          <div class="shop-pay-stat-val">₹${parseFloat(summary.total_refunded).toFixed(2)}</div>
          <div class="shop-pay-stat-lbl">↩️ Refunded (${summary.count_refunded})</div>
        </div>
        <div class="shop-pay-stat">
          <div class="shop-pay-stat-val">${summary.total_orders}</div>
          <div class="shop-pay-stat-lbl">📊 Total Order Records</div>
        </div>
      </div>

      <!-- Search & Filters Bar -->
      <div class="payments-filter-bar mb-3">
        <div class="payments-filter-search">
          <span class="search-ico">🔍</span>
          <input type="text" id="shopPaySearch" placeholder="Search order #, UPI ref, customer name..." value="${escapeHtml(_shopPayFilters.search)}">
        </div>
        <select class="payments-filter-select" id="shopPayStatus">
          <option value="all" ${_shopPayFilters.status === 'all' ? 'selected' : ''}>All Statuses</option>
          <option value="Paid" ${_shopPayFilters.status === 'Paid' ? 'selected' : ''}>✅ Paid Only</option>
          <option value="Pending" ${_shopPayFilters.status === 'Pending' ? 'selected' : ''}>⏳ Pending Only</option>
          <option value="Failed" ${_shopPayFilters.status === 'Failed' ? 'selected' : ''}>❌ Failed Only</option>
          <option value="Refunded" ${_shopPayFilters.status === 'Refunded' ? 'selected' : ''}>↩️ Refunded Only</option>
        </select>
        <select class="payments-filter-select" id="shopPayMethod">
          <option value="all" ${_shopPayFilters.method === 'all' ? 'selected' : ''}>All Methods</option>
          <option value="ScanPay" ${_shopPayFilters.method === 'ScanPay' ? 'selected' : ''}>📷 Scan &amp; Pay (QR)</option>
          <option value="GPay" ${_shopPayFilters.method === 'GPay' ? 'selected' : ''}>📱 GPay / PhonePe</option>
          <option value="Card" ${_shopPayFilters.method === 'Card' ? 'selected' : ''}>💳 Card</option>
          <option value="COD" ${_shopPayFilters.method === 'COD' ? 'selected' : ''}>💵 Cash on Delivery</option>
        </select>
        <select class="payments-filter-select" id="shopPayDate">
          <option value="all" ${_shopPayFilters.date_filter === 'all' ? 'selected' : ''}>All Time</option>
          <option value="today" ${_shopPayFilters.date_filter === 'today' ? 'selected' : ''}>📅 Today</option>
          <option value="week" ${_shopPayFilters.date_filter === 'week' ? 'selected' : ''}>📆 Last 7 Days</option>
          <option value="month" ${_shopPayFilters.date_filter === 'month' ? 'selected' : ''}>🗓️ Last 30 Days</option>
        </select>
        <select class="payments-filter-select" id="shopPaySort">
          <option value="newest" ${_shopPayFilters.sort === 'newest' ? 'selected' : ''}>Newest First</option>
          <option value="oldest" ${_shopPayFilters.sort === 'oldest' ? 'selected' : ''}>Oldest First</option>
          <option value="amount_high" ${_shopPayFilters.sort === 'amount_high' ? 'selected' : ''}>Amount High-to-Low</option>
          <option value="amount_low" ${_shopPayFilters.sort === 'amount_low' ? 'selected' : ''}>Amount Low-to-High</option>
        </select>
        ${hasFilters ? `<button class="btn-outline" id="btnShopPayClear" style="padding:6px 12px; font-size:12px;">✕ Clear</button>` : ''}
      </div>

      <!-- Table / Empty State -->
      ${!payments.length ? `
        <div class="empty-state" style="background:white; border-radius:12px;">
          <div class="emj">💳</div>
          <h3>No Payment Records Found</h3>
          <p>No transactions match your active filters or search terms.</p>
          ${hasFilters ? `<button class="btn-primary mt-2" onclick="App.clearShopPayFilters()">Clear Filters</button>` : ''}
        </div>
      ` : `
        <div style="overflow-x:auto; background:white; border-radius:var(--radius-md); border:1px solid #e2e8f0; box-shadow:0 2px 8px rgba(15,23,42,0.04);">
          <table class="inv-table">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Transaction / UPI Ref</th>
                <th>Status</th>
                <th>Date &amp; Time</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${payments.map(p => `
                <tr>
                  <td>
                    <button class="os-btn active" style="padding:4px 8px; font-size:12px;" onclick="App.trackOrder(${p.id})" title="View Order Details">
                      ${escapeHtml(p.order_number)}
                    </button>
                  </td>
                  <td class="text-sm">
                    <strong>${escapeHtml(p.customer_name)}</strong><br>
                    <span class="text-xs text-muted">📞 ${escapeHtml(p.customer_phone)}</span>
                  </td>
                  <td class="font-bold text-sm">
                    <span style="color:var(--primary-deep); font-size:14.5px;">₹${parseFloat(p.total_amount).toFixed(2)}</span>
                    ${p.discount_amount > 0 ? `<div class="text-xs text-muted">Disc: -₹${parseFloat(p.discount_amount).toFixed(0)}</div>` : ''}
                  </td>
                  <td>
                    <span class="pay-method-badge">${escapeHtml(p.payment_method)}</span>
                  </td>
                  <td class="text-xs">
                    ${p.upi_trans_id 
                      ? `<code style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-family:monospace;">${escapeHtml(p.upi_trans_id)}</code>` 
                      : `<span class="text-muted">TXN-${escapeHtml(p.order_number).replace('#','')}</span>`
                    }
                  </td>
                  <td>${statBadge[p.payment_status] || p.payment_status}</td>
                  <td class="text-xs text-muted" style="white-space:nowrap;">
                    ${formatDate(p.created_at)}
                  </td>
                  <td>
                    <div style="display:flex; gap:6px; align-items:center;">
                      ${p.payment_status !== 'Paid' ? `
                        <button class="os-btn" style="font-size:11px; padding:4px 8px; background:#f0fdf4; color:#15803d; border-color:#86efac;" onclick="App.verifyPay(${p.id})">
                          Mark Paid
                        </button>
                      ` : `
                        <span style="color:#15803d; font-weight:800; font-size:13px;" title="Payment Verified">✓</span>
                      `}
                      <button class="os-btn" style="font-size:11px; padding:4px 8px;" onclick="App.openPaymentReceipt(${p.id})" title="View Receipt">
                        🧾
                      </button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;

    // Wire listeners
    const sInput = qs('#shopPaySearch');
    let searchDebounce;
    sInput?.addEventListener('input', (e) => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        _shopPayFilters.search = e.target.value.trim();
        loadPayments(container);
      }, 350);
    });

    qs('#shopPayStatus')?.addEventListener('change', (e) => {
      _shopPayFilters.status = e.target.value;
      loadPayments(container);
    });

    qs('#shopPayMethod')?.addEventListener('change', (e) => {
      _shopPayFilters.method = e.target.value;
      loadPayments(container);
    });

    qs('#shopPayDate')?.addEventListener('change', (e) => {
      _shopPayFilters.date_filter = e.target.value;
      loadPayments(container);
    });

    qs('#shopPaySort')?.addEventListener('change', (e) => {
      _shopPayFilters.sort = e.target.value;
      loadPayments(container);
    });

    qs('#btnShopPayClear')?.addEventListener('click', () => {
      _shopPayFilters = { search: '', status: 'all', method: 'all', date_filter: 'all', sort: 'newest' };
      loadPayments(container);
    });
  }

  function clearShopPayFilters() {
    _shopPayFilters = { search: '', status: 'all', method: 'all', date_filter: 'all', sort: 'newest' };
    const container = qs('#shopContent');
    if (container) loadPayments(container);
  }

  // SALES REPORTS
  async function loadReports(container) {
    const data = await api('get_sales_reports');
    const medals = ['🥇','🥈','🥉','🏅','🏅'];

    container.innerHTML = `
      <h3 style="margin-bottom:16px;">📈 Vegetable Sales Reports</h3>
      <div class="stats-grid" style="margin-bottom:24px;">
        <div class="stat-card"><div class="stat-icon">📅</div><div class="stat-val">₹${parseFloat(data.today_sales||0).toFixed(0)}</div><div class="stat-lbl">Today's Sales</div></div>
        <div class="stat-card"><div class="stat-icon">📆</div><div class="stat-val">₹${parseFloat(data.weekly_sales||0).toFixed(0)}</div><div class="stat-lbl">Weekly Sales</div></div>
        <div class="stat-card"><div class="stat-icon">🗓️</div><div class="stat-val">₹${parseFloat(data.monthly_sales||0).toFixed(0)}</div><div class="stat-lbl">Monthly Sales</div></div>
        <div class="stat-card"><div class="stat-icon">🛒</div><div class="stat-val">${data.total_orders||0}</div><div class="stat-lbl">Total Orders</div></div>
        <div class="stat-card"><div class="stat-icon">📊</div><div class="stat-val">₹${parseFloat(data.avg_order_value||0).toFixed(0)}</div><div class="stat-lbl">Avg Order Value</div></div>
      </div>

      <h4 style="margin-bottom:12px; font-size:16px;">🏆 Top Selling Vegetables Leaderboard</h4>
      ${(data.top_vegetables||[]).length === 0
        ? '<div class="empty-state"><div class="emj">🥬</div><h3>No Sales Data Yet</h3><p>Sales leaderboard appears after orders are placed.</p></div>'
        : (data.top_vegetables||[]).map((v, i) => `
          <div class="leaderboard-item">
            <div class="lb-rank">${medals[i]||'🏅'}</div>
            <div class="lb-info">
              <div class="lb-name">${v.product_name}</div>
              <div class="lb-qty">${parseFloat(v.total_qty).toFixed(1)} units sold</div>
            </div>
            <div class="lb-rev">₹${parseFloat(v.total_rev).toFixed(2)}</div>
          </div>
        `).join('')
      }
    `;
  }

  // SHOP CHAT (SHOPKEEPER SIDE)
  async function loadShopChat(container) {
    const data = await api('get_messages');
    const msgs = data.messages || [];

    container.innerHTML = `
      <h3 style="margin-bottom:16px;">💬 Customer Messages</h3>
      <div style="background:white; border-radius:var(--radius-md); border:1px solid #e2e8f0; overflow:hidden;">
        <div style="height:320px; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:0;" id="shopChatMsgs">
          ${msgs.length === 0
            ? '<p class="text-center text-muted" style="padding:40px;">No messages from customers yet.</p>'
            : msgs.map(m => `
              <div class="chat-bubble ${m.sender_type}" style="margin-bottom:10px;">
                <div class="text-xs text-muted font-bold" style="margin-bottom:3px;">${m.sender_type === 'customer' ? '👤 ' + m.customer_name : '🏪 Shopkeeper'}</div>
                ${m.message}
                <div class="text-xs text-muted mt-1">${timeAgo(m.created_at)}</div>
              </div>
            `).join('')
          }
        </div>
        <div style="padding:14px; border-top:1px solid #f1f5f9; display:flex; gap:8px;">
          <input class="form-input" id="shopReplyInput" placeholder="Reply to customer..." style="flex:1;">
          <button class="btn-primary" onclick="App.shopReply()">Send Reply</button>
        </div>
      </div>
    `;
    const msgs_el = qs('#shopChatMsgs');
    if (msgs_el) msgs_el.scrollTop = msgs_el.scrollHeight;
  }

  async function shopReply() {
    const input = qs('#shopReplyInput');
    const msg = input?.value?.trim();
    if (!msg) return;
    await api('send_message', { message: msg, sender_type: 'shopkeeper', customer_id: 1 }, 'POST');
    input.value = '';
    loadShopTabContent('chat');
  }

  // SETTINGS
  async function loadSettings(container) {
    const s = state.settings;
    container.innerHTML = `
      <h3 style="margin-bottom:16px;">⚙️ Shop Settings</h3>
      <form id="settingsForm" class="bg-card">
        <div class="form-group"><label class="form-label">Shop Name</label><input class="form-input" name="shop_name" value="${s.shop_name || 'GreenHarvest Veggies'}"></div>
        <div class="form-group"><label class="form-label">UPI ID (for payments)</label><input class="form-input" name="shop_upi_id" value="${s.shop_upi_id || ''}"></div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
          <div class="form-group"><label class="form-label">Minimum Order (₹)</label><input class="form-input" name="min_order_amount" type="number" value="${s.min_order_amount}"></div>
          <div class="form-group"><label class="form-label">Delivery Charge (₹)</label><input class="form-input" name="delivery_charge" type="number" value="${s.delivery_charge}"></div>
          <div class="form-group"><label class="form-label">Free Delivery Above (₹)</label><input class="form-input" name="free_delivery_above" type="number" value="${s.free_delivery_above}"></div>
          <div class="form-group"><label class="form-label">Est. Delivery Time</label><input class="form-input" name="estimated_delivery_time" value="${s.estimated_delivery_time}"></div>
        </div>
        <button type="submit" class="btn-primary">Save Settings</button>
      </form>
    `;

    qs('#settingsForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const params = Object.fromEntries(fd);
      params.shop_status = s.shop_status;
      const res = await api('update_shop_settings', params, 'POST');
      if (res.success) {
        toast('✅ Settings saved!');
        await fetchSettings();
      }
    };
  }

  async function toggleShop() {
    const newStatus = state.settings.shop_status === 'OPEN' ? 'CLOSED' : 'OPEN';
    const res = await api('toggle_shop_status', { status: newStatus }, 'POST');
    if (res.success) {
      state.settings.shop_status = newStatus;
      toast(`Shop is now ${newStatus} ${newStatus==='OPEN'?'🟢':'🔴'}`);
      renderShopkeeperView();
    }
  }

  // NOTIFICATIONS
  async function loadNotifications() {
    const data = await api('get_notifications', { role: state.role });
    const notifs = data.notifications || [];
    const panel = qs('#notifPanel');
    if (!panel) return;

    state.notifBadgeCount = notifs.filter(n => !n.is_read).length;
    const badge = qs('#notifBadge');
    if (badge) { badge.textContent = state.notifBadgeCount; badge.style.display = state.notifBadgeCount ? 'flex' : 'none'; }

    panel.innerHTML = `
      <div class="notif-header">🔔 Notifications ${state.notifBadgeCount > 0 ? `<span style="background:var(--danger);color:white;font-size:11px;padding:2px 7px;border-radius:10px;margin-left:6px;">${state.notifBadgeCount} new</span>` : ''}</div>
      <div class="notif-list">
        ${notifs.length === 0
          ? '<div class="text-center text-muted" style="padding:20px;">No notifications</div>'
          : notifs.map(n => `
            <div class="notif-item ${n.is_read==0?'unread':''}">
              <div class="notif-title">${n.title}</div>
              <div class="notif-msg">${n.message}</div>
              <div class="notif-time">${timeAgo(n.created_at)}</div>
            </div>
          `).join('')
        }
      </div>
    `;
  }

  function toggleNotifPanel() {
    const panel = qs('#notifPanel');
    if (!panel) return;
    state.notifPanelOpen = !state.notifPanelOpen;
    panel.classList.toggle('open', state.notifPanelOpen);
    if (state.notifPanelOpen) loadNotifications();
  }

  // REAL-TIME POLLING
  function startPolling() {
    if (state.pollingTimer) clearInterval(state.pollingTimer);
    state.pollingTimer = setInterval(async () => {
      try {
        if (state.role === 'shopkeeper') {
          const d = await api('stream_updates', { role: 'shopkeeper' });
          const curPending = parseInt(qs('#sv1')?.textContent) || 0;
          if (d.pending_orders_count > curPending) {
            toast(`🔔 NEW VEGETABLE ORDER received! (${d.pending_orders_count} pending)`);
            if (state.shopTab === 'orders') loadShopOrders(qs('#shopContent'));
            loadShopStats();
          }
        }
        await loadNotifications();
      } catch (e) { /* silent */ }
    }, 5000);
  }

  // SETTINGS FETCH
  async function fetchSettings() {
    const d = await api('get_shop_settings');
    if (d.settings) Object.assign(state.settings, d.settings);
  }

  // ───────────────────────────────────────────────
  // PUBLIC INTERFACE (exposed to HTML inline events)
  // ───────────────────────────────────────────────
  const Public = {
    setCat(slug) { state.activeCategory = slug; state.activeFilter = 'all'; renderCustomerView(); },
    setFilter(f) { state.activeFilter = f; loadProducts(); },
    cartChg(pid, unit, delta) { cartChange(pid, unit, delta); renderCartDrawer(); loadProducts(); },
    addCard(pid, evt) {
      const p = (window._allProducts || []).find(x => x.id == pid);
      if (!p) return;
      const unit = state.selectedProductUnits[pid] || (p.available_units||'1kg').split(',')[0].trim();
      cartAdd(p, unit);
      loadProducts();
    },
    pickUnit(pid, unit, el) { selectUnit(pid, unit, el); loadProducts(); },
    detail(pid) {
      const p = (window._allProducts || []).find(x => x.id == pid);
      if (p) openProductDetail(p);
    },
    addFromDetail,
    checkout,
    trackOrder,
    openReview,
    setStar,
    submitReview,
    openChat,
    sendChat,
    shopTab: loadShopTabContent,
    setOrderStatus,
    verifyPay,
    addVegModal,
    editVegModal,
    deleteVeg,
    shopReply,
    toggleShop,
    logout,
    renderAuthView,
    handleAuthSubmit,
    quickDemoLogin,
    openSideMenu,
    closeSideMenu,
    toggleSideMenu,
    renderSideMenu,
    renderCustomerOrdersView,
    renderCustomerPaymentsView,
    openPaymentReceipt,
    clearCustPayFilters,
    clearShopPayFilters,
    cancelCustomerOrder,
    reorderItems,
    renderCustomerProfileView,
    openAddressModal,
    setDefaultAddress,
    deleteAddress,
    loadShopProfile,
    getState: () => state,
  };

  // ───────────────────────────────────────────────
  // MOBILE & TABLET SIDE MENU DRAWER
  // ───────────────────────────────────────────────
  function openSideMenu() {
    renderSideMenu();
    const drawer = qs('#sideMenuDrawer');
    const overlay = qs('#sideMenuOverlay');
    const btn = qs('#mobileMenuBtn');
    if (drawer) {
      drawer.style.display = 'flex';
      setTimeout(() => drawer.classList.add('open'), 15);
    }
    if (overlay) overlay.classList.add('show');
    if (btn) btn.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeSideMenu() {
    const drawer = qs('#sideMenuDrawer');
    const overlay = qs('#sideMenuOverlay');
    const btn = qs('#mobileMenuBtn');
    if (drawer) {
      drawer.classList.remove('open');
      setTimeout(() => {
        if (!drawer.classList.contains('open')) drawer.style.display = 'none';
      }, 300);
    }
    if (overlay) overlay.classList.remove('show');
    if (btn) btn.classList.remove('active');
    document.body.style.overflow = '';
  }

  function toggleSideMenu() {
    const drawer = qs('#sideMenuDrawer');
    if (drawer && drawer.classList.contains('open')) {
      closeSideMenu();
    } else {
      openSideMenu();
    }
  }

  function renderSideMenu() {
    const container = qs('#sideMenuContent');
    if (!container) return;

    if (!state.user) {
      container.innerHTML = `
        <div class="side-menu-profile-card">
          <div class="side-menu-user-name">Welcome to GreenHarvest</div>
          <div class="side-menu-user-role">Please Sign In to Shop</div>
        </div>
        <div class="side-menu-nav-list">
          <button class="side-menu-nav-item" id="smGuestLogin">
            <span class="icon">🛒</span> Customer Login
          </button>
          <button class="side-menu-nav-item" id="smGuestRegister">
            <span class="icon">📝</span> Customer Register
          </button>
          <button class="side-menu-nav-item" id="smShopLogin">
            <span class="icon">🏪</span> Shopkeeper Login
          </button>
        </div>
      `;
      qs('#smGuestLogin')?.addEventListener('click', () => { closeSideMenu(); renderAuthView('customer', 'login'); });
      qs('#smGuestRegister')?.addEventListener('click', () => { closeSideMenu(); renderAuthView('customer', 'register'); });
      qs('#smShopLogin')?.addEventListener('click', () => { closeSideMenu(); renderAuthView('shopkeeper', 'login'); });
      return;
    }

    if (state.role === 'customer') {
      const cartCount = state.cart.reduce((s, i) => s + i.quantity, 0);
      container.innerHTML = `
        <div class="side-menu-profile-card">
          <div style="display:flex; align-items:center; gap:12px;">
            ${state.user.profile_photo ? `
              <img src="${escapeHtml(state.user.profile_photo)}" class="side-menu-avatar-img" onerror="this.onerror=null; this.src='https://placehold.co/56x56/dcfce7/16a34a?text=👤';">
            ` : `
              <div class="side-menu-avatar-placeholder">👤</div>
            `}
            <div style="flex:1; min-width:0;">
              <div class="side-menu-user-name">${escapeHtml(state.user.name)}</div>
              <div class="side-menu-user-role">🛒 Customer (${escapeHtml(state.user.phone)})</div>
            </div>
          </div>
        </div>
        <div class="side-menu-nav-list">
          <button class="side-menu-nav-item" id="smCustProfile">
            <span class="icon">👤</span> My Profile &amp; Addresses
          </button>
          <button class="side-menu-nav-item" id="smCustHome">
            <span class="icon">🏠</span> Home &amp; Vegetables
          </button>
          <button class="side-menu-nav-item" id="smCustCatalog">
            <span class="icon">🥕</span> All Fresh Vegetables
          </button>
          <button class="side-menu-nav-item" id="smCustCart">
            <span class="icon">🛒</span> Shopping Cart <span class="badge" style="margin-left:auto;background:var(--primary);color:#fff;border-radius:99px;padding:2px 8px;font-size:11px;">${cartCount}</span>
          </button>
          <button class="side-menu-nav-item" id="smCustOrders">
            <span class="icon">📦</span> My Orders &amp; Tracking
          </button>
          <button class="side-menu-nav-item" id="smCustPayments">
            <span class="icon">💳</span> Payment History &amp; Receipts
          </button>
          <button class="side-menu-nav-item" id="smCustSupport">
            <span class="icon">💬</span> Support &amp; Chat
          </button>
          <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--slate-100);">
            <button class="side-menu-nav-item danger" id="smCustLogout">
              <span class="icon">🚪</span> Sign Out / Logout
            </button>
          </div>
        </div>
      `;
      qs('#smCustProfile')?.addEventListener('click', () => { closeSideMenu(); renderCustomerProfileView(); });
      qs('#smCustHome')?.addEventListener('click', () => { closeSideMenu(); renderCustomerView(); });
      qs('#smCustCatalog')?.addEventListener('click', () => {
        closeSideMenu();
        renderCustomerView();
        setTimeout(() => qs('#vegCatalog')?.scrollIntoView({ behavior: 'smooth' }), 300);
      });
      qs('#smCustCart')?.addEventListener('click', () => { closeSideMenu(); openCartDrawer(); });
      qs('#smCustOrders')?.addEventListener('click', () => {
        closeSideMenu();
        renderCustomerOrdersView();
      });
      qs('#smCustPayments')?.addEventListener('click', () => {
        closeSideMenu();
        renderCustomerPaymentsView();
      });
      qs('#smCustSupport')?.addEventListener('click', () => { closeSideMenu(); openChat(); });
      qs('#smCustLogout')?.addEventListener('click', () => { closeSideMenu(); logout(); });
    } else if (state.role === 'shopkeeper') {
      const curHash = window.location.hash.replace('#', '') || 'dashboard';
      container.innerHTML = `
        <div class="side-menu-profile-card">
          <div style="display:flex; align-items:center; gap:12px;">
            ${state.user.profile_photo ? `
              <img src="${escapeHtml(state.user.profile_photo)}" class="side-menu-avatar-img" onerror="this.onerror=null; this.src='https://placehold.co/56x56/dcfce7/16a34a?text=🏪';">
            ` : `
              <div class="side-menu-avatar-placeholder">🏪</div>
            `}
            <div style="flex:1; min-width:0;">
              <div class="side-menu-user-name">${escapeHtml(state.user.name)}</div>
              <div class="side-menu-user-role">Shop Manager Portal</div>
            </div>
          </div>
        </div>
        <div class="side-menu-nav-list">
          <button class="side-menu-nav-item ${(curHash === 'dashboard' || curHash === '') ? 'active' : ''}" id="smShopDashboard">
            <span class="icon">📊</span> Shopkeeper Dashboard
          </button>
          <button class="side-menu-nav-item ${curHash === 'orders' ? 'active' : ''}" id="smShopOrders">
            <span class="icon">📦</span> Order Management
          </button>
          <button class="side-menu-nav-item ${curHash === 'vegetables' ? 'active' : ''}" id="smShopVeg">
            <span class="icon">🥕</span> Vegetable Catalog
          </button>
          <button class="side-menu-nav-item ${curHash === 'inventory' ? 'active' : ''}" id="smShopInv">
            <span class="icon">📊</span> Stock &amp; Inventory
          </button>
          <button class="side-menu-nav-item ${curHash === 'payments' ? 'active' : ''}" id="smShopPayments">
            <span class="icon">💳</span> Payment History &amp; Accounting
          </button>
          <button class="side-menu-nav-item ${curHash === 'reports' ? 'active' : ''}" id="smShopReports">
            <span class="icon">📈</span> Sales Reports
          </button>
          <button class="side-menu-nav-item ${curHash === 'chat' ? 'active' : ''}" id="smShopChat">
            <span class="icon">💬</span> Customer Support Chat
          </button>
          <button class="side-menu-nav-item ${curHash === 'settings' ? 'active' : ''}" id="smShopSettings">
            <span class="icon">⚙️</span> Store Settings &amp; UPI
          </button>
          <button class="side-menu-nav-item ${curHash === 'profile' ? 'active' : ''}" id="smShopProfile">
            <span class="icon">👤</span> Store Profile Settings
          </button>
          <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--slate-100);">
            <button class="side-menu-nav-item danger" id="smShopLogout">
              <span class="icon">🚪</span> Sign Out / Logout
            </button>
          </div>
        </div>
      `;
      qs('#smShopDashboard')?.addEventListener('click', () => { closeSideMenu(); navigateToShopPage('dashboard'); });
      qs('#smShopOrders')?.addEventListener('click', () => { closeSideMenu(); navigateToShopPage('orders'); });
      qs('#smShopVeg')?.addEventListener('click', () => { closeSideMenu(); navigateToShopPage('vegetables'); });
      qs('#smShopInv')?.addEventListener('click', () => { closeSideMenu(); navigateToShopPage('inventory'); });
      qs('#smShopPayments')?.addEventListener('click', () => { closeSideMenu(); navigateToShopPage('payments'); });
      qs('#smShopReports')?.addEventListener('click', () => { closeSideMenu(); navigateToShopPage('reports'); });
      qs('#smShopChat')?.addEventListener('click', () => { closeSideMenu(); navigateToShopPage('chat'); });
      qs('#smShopSettings')?.addEventListener('click', () => { closeSideMenu(); navigateToShopPage('settings'); });
      qs('#smShopProfile')?.addEventListener('click', () => { closeSideMenu(); navigateToShopPage('profile'); });
      qs('#smShopLogout')?.addEventListener('click', () => { closeSideMenu(); logout(); });
    }
  }

  // ───────────────────────────────────────────────
  // HEADER & NAV AUTH SYNC
  // ───────────────────────────────────────────────
  function updateHeaderAuth() {
    const profileArea = qs('#userProfileArea');
    const guestArea = qs('#guestAuthArea');
    const searchWrapper = qs('#searchWrapper');
    const notifWrapper = qs('#notifWrapper');
    const cartBtn = qs('#cartBtn');

    if (profileArea) profileArea.style.display = 'none';

    if (state.user) {
      if (guestArea) guestArea.style.display = 'none';
      if (notifWrapper) notifWrapper.style.display = 'block';

      if (state.role === 'customer') {
        if (searchWrapper) searchWrapper.style.display = 'block';
        if (cartBtn) cartBtn.style.display = 'flex';
      } else {
        if (searchWrapper) searchWrapper.style.display = 'none';
        if (cartBtn) cartBtn.style.display = 'none';
      }
    } else {
      if (guestArea) guestArea.style.display = 'flex';
      if (searchWrapper) searchWrapper.style.display = 'none';
      if (notifWrapper) notifWrapper.style.display = 'none';
      if (cartBtn) cartBtn.style.display = 'none';
    }

    updateBottomNav();
    renderSideMenu();
  }

  function updateBottomNav() {
    const nav = qs('#bottomNav');
    if (!nav) return;

    if (!state.user) {
      nav.style.display = 'none';
      nav.innerHTML = '';
      return;
    }

    nav.style.display = 'flex';
    if (state.role === 'customer') {
      nav.innerHTML = `
        <button class="bnav-item" id="bnHome" title="Home">
          <span class="icon">🏠</span>Home
        </button>
        <button class="bnav-item" id="bnVeg" title="Vegetables">
          <span class="icon">🥕</span>Vegetables
        </button>
        <button class="bnav-item" id="bnCart" title="Cart">
          <span class="icon">🛒</span>Cart
        </button>
        <button class="bnav-item" id="bnOrders" title="My Orders">
          <span class="icon">📦</span>Orders
        </button>
        <button class="bnav-item" id="bnLogout" title="Logout" style="color:var(--danger);">
          <span class="icon">🚪</span>Logout
        </button>
      `;

      qs('#bnHome')?.addEventListener('click', () => renderCustomerView());
      qs('#bnVeg')?.addEventListener('click', () => {
        renderCustomerView();
        setTimeout(() => qs('#vegCatalog')?.scrollIntoView({ behavior: 'smooth' }), 300);
      });
      qs('#bnCart')?.addEventListener('click', openCartDrawer);
      qs('#bnOrders')?.addEventListener('click', () => {
        renderCustomerOrdersView();
      });
      qs('#bnLogout')?.addEventListener('click', () => logout());
    } else if (state.role === 'shopkeeper') {
      nav.innerHTML = `
        <button class="bnav-item" id="bnShopOrders" title="Dashboard">
          <span class="icon">📊</span>Dashboard
        </button>
        <button class="bnav-item" id="bnShopVeg" title="Vegetables">
          <span class="icon">🥕</span>Vegetables
        </button>
        <button class="bnav-item" id="bnShopPayments" title="Payments">
          <span class="icon">💳</span>Payments
        </button>
        <button class="bnav-item" id="bnShopSettings" title="Settings">
          <span class="icon">⚙️</span>Settings
        </button>
        <button class="bnav-item" id="bnShopLogout" title="Logout" style="color:var(--danger);">
          <span class="icon">🚪</span>Logout
        </button>
      `;

      qs('#bnShopOrders')?.addEventListener('click', () => navigateToShopPage('dashboard'));
      qs('#bnShopVeg')?.addEventListener('click', () => navigateToShopPage('vegetables'));
      qs('#bnShopPayments')?.addEventListener('click', () => navigateToShopPage('payments'));
      qs('#bnShopSettings')?.addEventListener('click', () => navigateToShopPage('settings'));
      qs('#bnShopLogout')?.addEventListener('click', () => logout());
    }
  }

  // ───────────────────────────────────────────────
  // AUTH PORTAL (REGISTER & LOGIN GATEKEEPER)
  // ───────────────────────────────────────────────
  function renderAuthView(portal = 'customer', mode = 'login', errorMsg = '', successMsg = '') {
    updateHeaderAuth();

    const isCustomer = (portal === 'customer');
    const isLogin = (mode === 'login');

    const appEl = qs('#app');
    if (!appEl) return;

    appEl.innerHTML = `
      <div class="auth-view-wrapper">
        <div class="auth-card">

          <!-- BRAND HEADER -->
          <div class="auth-header">
            <div class="auth-icon-badge">${isCustomer ? '🥬' : '🏪'}</div>
            <h1 class="auth-title">GreenHarvest</h1>
            <p class="auth-subtitle">
              ${isCustomer 
                ? '100% Farm-Fresh Vegetables · Delivered to Your Doorstep' 
                : 'Shopkeeper Portal · Produce & Inventory Management'}
            </p>
          </div>

          <!-- PORTAL TABS (Customer vs Shopkeeper) -->
          <div class="portal-switch-tabs">
            <button type="button" class="portal-tab-btn cust-tab ${isCustomer ? 'active' : ''}" 
                    onclick="App.renderAuthView('customer', '${mode}')">
              🛒 Customer Portal
            </button>
            <button type="button" class="portal-tab-btn shop-tab ${!isCustomer ? 'active' : ''}" 
                    onclick="App.renderAuthView('shopkeeper', '${mode}')">
              🏪 Shopkeeper Portal
            </button>
          </div>

          <!-- AUTH MODE TABS (Sign In vs Register) -->
          <div class="auth-mode-switch">
            <button type="button" class="auth-mode-btn ${isLogin ? 'active' : ''}" 
                    onclick="App.renderAuthView('${portal}', 'login')">
              Sign In
            </button>
            <button type="button" class="auth-mode-btn ${!isLogin ? 'active' : ''}" 
                    onclick="App.renderAuthView('${portal}', 'register')">
              Create Account
            </button>
          </div>

          <!-- ALERT MESSAGE CONTAINER -->
          <div id="authAlertArea">
            ${errorMsg ? `<div class="auth-alert-box error">⚠️ ${errorMsg}</div>` : ''}
            ${successMsg ? `<div class="auth-alert-box success">✅ ${successMsg}</div>` : ''}
          </div>

          <!-- AUTH FORM -->
          <form id="authForm" onsubmit="App.handleAuthSubmit(event, '${portal}', '${mode}')">

            ${!isLogin ? `
              <!-- REGISTRATION FIELDS -->
              <div class="auth-input-group">
                <label class="auth-label">${isCustomer ? 'Full Name' : 'Store / Owner Name'} *</label>
                <input type="text" id="authName" class="auth-input" required 
                       placeholder="${isCustomer ? 'e.g. Rahul Sharma' : 'e.g. GreenHarvest Owner'}">
              </div>

              <div class="auth-input-group">
                <label class="auth-label">Email Address (Optional)</label>
                <input type="email" id="authEmail" class="auth-input" 
                       placeholder="${isCustomer ? 'rahul@example.com' : 'shop@greenharvest.com'}">
              </div>

              <div class="auth-input-group">
                <label class="auth-label">${isCustomer ? 'Delivery Address' : 'Shop / Stall Address'} *</label>
                <input type="text" id="authAddress" class="auth-input" required 
                       placeholder="${isCustomer ? 'Flat / House No, Street, Landmark' : 'Shop #12, Vegetable Market'}">
              </div>
            ` : ''}

            <!-- COMMON FIELDS: PHONE & PASSWORD -->
            <div class="auth-input-group">
              <label class="auth-label">Phone Number *</label>
              <input type="tel" id="authPhone" class="auth-input" required 
                     maxlength="15"
                     placeholder="${isCustomer ? 'e.g. 9123456789' : 'e.g. 9876543210'}">
            </div>

            <div class="auth-input-group">
              <label class="auth-label">Password *</label>
              <input type="password" id="authPassword" class="auth-input" required 
                     placeholder="Enter your password">
            </div>

            <button type="submit" id="authSubmitBtn" 
                    class="auth-submit-btn ${!isCustomer ? 'shop-btn' : ''}">
              ${isLogin 
                ? (isCustomer ? '🥬 Sign In to Vegetable Store' : '🏪 Enter Shopkeeper Dashboard') 
                : (isCustomer ? '🌱 Create Customer Account' : '🏪 Register Merchant Account')}
            </button>
          </form>

          <!-- QUICK DEMO FILL & LOGIN -->
          <div class="auth-demo-card">
            <p>⚡ Quick Test: One-click Login with Demo Credentials</p>
            ${isCustomer ? `
              <button type="button" class="demo-auto-btn" 
                      onclick="App.quickDemoLogin('customer')">
                👤 Demo Customer (9123456789 / 123456)
              </button>
            ` : `
              <button type="button" class="demo-auto-btn" 
                      onclick="App.quickDemoLogin('shopkeeper')">
                🏪 Demo Shopkeeper (9876543210 / 123456)
              </button>
            `}
          </div>

        </div>
      </div>
    `;
  }

  async function handleAuthSubmit(e, portal, mode) {
    e.preventDefault();
    const btn = qs('#authSubmitBtn');
    const alertArea = qs('#authAlertArea');

    const phone = qs('#authPhone')?.value.trim();
    const password = qs('#authPassword')?.value.trim();

    if (!phone || !password) {
      if (alertArea) alertArea.innerHTML = `<div class="auth-alert-box error">⚠️ Phone number and password are required.</div>`;
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Authenticating...';
    }

    try {
      if (mode === 'login') {
        const res = await api('login', { phone, password, role: portal }, 'POST');
        if (res.success && res.user) {
          state.user = res.user;
          state.role = res.user.role;
          toast(`Welcome, ${res.user.name}!`);
          updateHeaderAuth();
          initSearch();
          initNotifBtn();
          initCartOverlay();
          updateCartBadge();
          await loadNotifications();
          if (state.role === 'customer') renderCustomerView();
          else renderShopkeeperView();
          startPolling();
        } else {
          const err = res.error || 'Invalid phone number or password.';
          renderAuthView(portal, mode, err);
        }
      } else {
        const name = qs('#authName')?.value.trim();
        const email = qs('#authEmail')?.value.trim();
        const address = qs('#authAddress')?.value.trim();

        if (!name) {
          if (alertArea) alertArea.innerHTML = `<div class="auth-alert-box error">⚠️ Please enter your name.</div>`;
          if (btn) { btn.disabled = false; btn.textContent = 'Try Again'; }
          return;
        }

        const res = await api('register', { name, phone, email, password, role: portal, address }, 'POST');
        if (res.success && res.user) {
          state.user = res.user;
          state.role = res.user.role;
          toast(`Account created! Welcome, ${res.user.name}.`);
          updateHeaderAuth();
          initSearch();
          initNotifBtn();
          initCartOverlay();
          updateCartBadge();
          await loadNotifications();
          if (state.role === 'customer') renderCustomerView();
          else renderShopkeeperView();
          startPolling();
        } else {
          const err = res.error || 'Registration failed. Please try again.';
          renderAuthView(portal, mode, err);
        }
      }
    } catch (err) {
      renderAuthView(portal, mode, 'Network error. Please try again.');
    }
  }

  async function quickDemoLogin(targetRole) {
    const phone = (targetRole === 'shopkeeper') ? '9876543210' : '9123456789';
    const password = '123456';

    const res = await api('login', { phone, password, role: targetRole }, 'POST');
    if (res.success && res.user) {
      state.user = res.user;
      state.role = res.user.role;
      toast(`Signed in as ${res.user.name} (${res.user.role})`);
      updateHeaderAuth();
      initSearch();
      initNotifBtn();
      initCartOverlay();
      updateCartBadge();
      await loadNotifications();
      if (state.role === 'customer') renderCustomerView();
      else renderShopkeeperView();
      startPolling();
    } else {
      renderAuthView(targetRole, 'login', res.error || 'Demo login failed.');
    }
  }

  async function logout() {
    if (state.pollingTimer) clearInterval(state.pollingTimer);
    await api('logout', {}, 'POST');
    state.user = null;
    state.role = null;
    state.cart = [];
    localStorage.removeItem('gh_cart');
    localStorage.removeItem('ghRole');
    toast('Signed out successfully.');
    renderAuthView('customer', 'login', '', 'You have signed out successfully.');
  }

  // SEARCH
  function initSearch() {
    const inp = qs('#globalSearch');
    if (!inp) return;
    inp.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      if (state.role === 'customer') loadProducts();
    });
  }

  // NOTIF TOGGLE
  function initNotifBtn() {
    qs('#notifBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleNotifPanel();
    });
    document.addEventListener('click', () => {
      if (state.notifPanelOpen) {
        state.notifPanelOpen = false;
        qs('#notifPanel')?.classList.remove('open');
      }
    });
  }

  // CART OVERLAY CLOSE
  function initCartOverlay() {
    qs('#cartOverlay')?.addEventListener('click', closeCartDrawer);
  }

  // ───────────────────────────────────────────────
  // INIT
  // ───────────────────────────────────────────────
  async function init() {
    Modal.init();
    await fetchSettings();

    const userData = await api('get_current_user');
    if (!userData.user) {
      state.user = null;
      state.role = null;
      renderAuthView();
      return;
    }

    state.user = userData.user;
    state.role = userData.user.role;

    updateHeaderAuth();
    initSearch();
    initNotifBtn();
    initCartOverlay();
    updateCartBadge();
    await loadNotifications();

    if (state.role === 'customer') {
      if (window.location.hash === '#orders') {
        renderCustomerOrdersView();
      } else if (window.location.hash === '#payments') {
        renderCustomerPaymentsView();
      } else if (window.location.hash === '#profile') {
        renderCustomerProfileView();
      } else {
        renderCustomerView();
      }
    } else {
      const h = window.location.hash.replace('#', '');
      if (['vegetables', 'inventory', 'payments', 'reports', 'chat', 'settings', 'profile'].includes(h)) {
        navigateToShopPage(h);
      } else {
        renderShopkeeperView();
      }
    }

    startPolling();
  }

  return {
    ...Public,
    init,
    openCartDrawer,
    closeCartDrawer,
    logout,
    renderAuthView,
    handleAuthSubmit,
    quickDemoLogin,
    renderCustomerOrdersView,
    renderCustomerPaymentsView,
    openPaymentReceipt,
    clearCustPayFilters,
    clearShopPayFilters,
    cancelCustomerOrder,
    reorderItems,
    renderCustomerProfileView,
    openAddressModal,
    setDefaultAddress,
    deleteAddress,
    loadShopProfile,
    renderShopkeeperView,
    setShopOrderCategory,
    reacceptOrder,
    rejectOrderModal,
    navigateToShopPage,
    shopTab: navigateToShopPage,
    loadShopStats,
    loadShopOrders,
    setOrderStatus,
    verifyPay,
    openShopOrderDetailsModal,
    getState: () => state
  };
})();

// Expose for inline handlers
window.App = App;
window.Modal = {
  hide: () => {
    if (App.closeCartDrawer) App.closeCartDrawer();
    const ov = document.getElementById('modalOverlay');
    if (ov) ov.classList.remove('show');
  },
  show: (html, wide) => {
    const card = document.getElementById('modalCard');
    const body = document.getElementById('modalBody');
    const ov = document.getElementById('modalOverlay');
    if (body) body.innerHTML = html;
    if (card) card.style.maxWidth = wide ? '720px' : '520px';
    if (ov) ov.classList.add('show');
  }
};
window.applyCoupon = () => {
  const code = document.getElementById('couponInput')?.value?.trim().toUpperCase();
  if (!code) return;
  fetch(`api.php?action=get_offers`).then(r=>r.json()).then(d => {
    const offer = (d.offers||[]).find(o=>o.code===code && o.is_active==1);
    const cart = JSON.parse(localStorage.getItem('gh_cart')||'[]');
    const subtotal = cart.reduce((s,c)=>{
      let m=1; if(c.unit_weight==='250g')m=0.25; else if(c.unit_weight==='500g')m=0.5; else if(c.unit_weight.includes('kg'))m=parseFloat(c.unit_weight);
      return s+(c.price*m*c.quantity);
    }, 0);
    if (offer && subtotal >= parseFloat(offer.min_order)) {
      App.__coupon = offer;
    }
  });
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();

  // Close drawers/modals on Escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (App.closeSideMenu) App.closeSideMenu();
      if (App.closeCartDrawer) App.closeCartDrawer();
      const modal = document.getElementById('modalOverlay');
      if (modal) modal.classList.remove('show');
    }
  });

  // Handle URL hash changes (back/forward navigation)
  window.addEventListener('hashchange', () => {
    const curRole = App.getState ? App.getState().role : null;
    const h = window.location.hash.replace('#', '');
    if (curRole === 'shopkeeper') {
      if (['vegetables', 'inventory', 'payments', 'reports', 'chat', 'settings', 'profile'].includes(h)) {
        App.navigateToShopPage(h);
      } else if (h === 'orders' || h === 'dashboard' || !h) {
        App.navigateToShopPage('dashboard');
      }
    } else {
      if (App.renderCustomerOrdersView && window.location.hash === '#orders') {
        App.renderCustomerOrdersView();
      } else if (window.location.hash === '#payments') {
        if (App.renderCustomerPaymentsView) App.renderCustomerPaymentsView();
      } else if (window.location.hash === '#profile') {
        if (App.renderCustomerProfileView) App.renderCustomerProfileView();
      } else if (App.renderCustomerView && (!window.location.hash || window.location.hash === '#')) {
        App.renderCustomerView();
      }
    }
  });

  // Auto close mobile side drawer on desktop resize
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024 && App.closeSideMenu) {
      App.closeSideMenu();
    }
  });
});
