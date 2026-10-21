<?php
// index.php — GreenHarvest 100% Fresh Vegetable Shop
require_once 'config.php';
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>GreenHarvest Veggies | 100% Fresh Online Vegetable Store</title>
  <meta name="description" content="Order 100% farm-fresh vegetables online from GreenHarvest. Tomatoes, Potatoes, Onions, Carrots, Spinach and more — delivered to your doorstep in 30 minutes.">
  <meta name="keywords" content="fresh vegetables online, vegetable delivery, tomato, potato, onion, carrot, spinach, organic vegetables">

  <!-- ═══ PWA: Manifest & Icons ═══ -->
  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="#16a34a">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="GreenHarvest">
  <link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="192x192" href="/assets/icons/icon-192.png">
  <link rel="icon" type="image/png" sizes="512x512" href="/assets/icons/icon-512.png">
  <link rel="shortcut icon" href="/assets/icons/favicon.png">

  <link rel="stylesheet" href="assets/css/styles.css?v=<?php echo filemtime(__DIR__ . '/assets/css/styles.css'); ?>">
  <!-- Canvas Confetti -->
  <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js"></script>
</head>
<body>

<!-- ═══════════════════════ HEADER ═══════════════════════════ -->
<header class="header-bar">
  <div class="header-container">

    <!-- Mobile & Tablet Menu Hamburger Button -->
    <button id="mobileMenuBtn" class="mobile-menu-btn" onclick="App.toggleSideMenu()" aria-label="Open navigation menu" title="Menu">
      <span class="hamburger-bar"></span>
      <span class="hamburger-bar"></span>
      <span class="hamburger-bar"></span>
    </button>

    <!-- Brand Logo -->
    <a href="#" class="brand-logo" onclick="(function(){ var s=App.getState?App.getState():{}; if(s.role==='shopkeeper'){window.location.hash='dashboard';App.navigateToShopPage('dashboard');}else if(s.role==='customer'){window.location.hash='';App.renderCustomerView();}else{location.reload();} App.closeSideMenu&&App.closeSideMenu(); })(); return false;">
      <div class="brand-icon">🥬</div>
      <div>
        <div class="brand-name">GreenHarvest</div>
        <div class="brand-subtitle">100% Fresh Vegetables Only</div>
      </div>
    </a>

    <!-- Search Bar (Only shown for customer browsing) -->
    <div class="search-wrapper" id="searchWrapper" style="display:none;">
      <span class="search-icon">🔍</span>
      <input type="search" id="globalSearch"
             placeholder="Search Tomato, Potato, Onion, Carrot, Spinach..."
             autocomplete="off">
    </div>

    <!-- Header Action Buttons -->
    <div class="header-actions" id="headerActions">

      <!-- Guest Visitor Auth Actions -->
      <div id="guestAuthArea" class="guest-auth-area" style="display:none;">
        <button class="btn-guest-login" onclick="App.renderAuthView('customer','login')" title="Sign In">Sign In</button>
        <button class="btn-guest-register" onclick="App.renderAuthView('customer','register')" title="Register">Register</button>
      </div>

      <!-- Notifications -->
      <div style="position:relative; display:none;" id="notifWrapper">
        <button class="icon-btn" id="notifBtn" title="Notifications">🔔
          <span id="notifBadge" class="badge" style="display:none;">0</span>
        </button>
        <div id="notifPanel" class="notif-panel"></div>
      </div>

      <!-- Cart (Only for customer) -->
      <button class="icon-btn" id="cartBtn" title="Shopping Cart" onclick="App.openCartDrawer()" style="display:none;">🛒
        <span id="cartBadge" class="badge" style="display:none;">0</span>
      </button>

      <!-- PWA Install App: available exclusively in the side navigation menu -->

    </div>
  </div>
</header>

<!-- ═══════════════════════ MAIN APP ═══════════════════════════ -->
<main class="main-wrapper" id="app">
  <div class="page-loader" style="min-height:50vh; justify-content:center;">
    <div class="spinner"></div>
    <span style="color:var(--primary-dark); font-weight:700;">Loading GreenHarvest Fresh Vegetable Store...</span>
  </div>
</main>

<!-- ═══════════════════════ MOBILE & TABLET SIDE MENU ════════════ -->
<div id="sideMenuOverlay" class="side-menu-overlay" onclick="App.closeSideMenu()"></div>
<aside id="sideMenuDrawer" class="side-menu-drawer" style="display:none;" aria-label="Mobile Navigation">
  <div class="side-menu-header">
    <div class="brand-logo">
      <div class="brand-icon">🥬</div>
      <div>
        <div class="brand-name">GreenHarvest</div>
        <div class="brand-subtitle">100% Fresh Vegetables</div>
      </div>
    </div>
    <button class="side-menu-close-btn" onclick="App.closeSideMenu()" aria-label="Close menu">✕</button>
  </div>
  <div class="side-menu-body" id="sideMenuContent">
    <!-- Populated dynamically based on auth and role -->
  </div>
</aside>

<!-- ═══════════════════════ CART DRAWER ══════════════════════ -->
<div id="cartOverlay" style="position:fixed;inset:0;background:rgba(15,23,42,0.4);z-index:599;display:none;" onclick="App.closeCartDrawer()"></div>
<aside id="cartDrawer" class="cart-drawer" style="display:none;">
  <div class="drawer-header">
    <h3 style="font-size:17px; font-weight:800;">🛒 Your Vegetable Cart</h3>
    <button onclick="App.closeCartDrawer()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--slate-500);">✕</button>
  </div>
  <div class="drawer-body" id="cartDrawerBody">
    <div class="empty-state" style="border:none;">
      <div class="emj">🛒</div>
      <h3>Cart is Empty</h3>
      <p>Add fresh vegetables to continue.</p>
    </div>
  </div>
  <div class="drawer-footer" id="cartDrawerFooter"></div>
</aside>

<!-- ═══════════════════════ UNIVERSAL MODAL ══════════════════ -->
<div id="modalOverlay" class="modal-overlay" onclick="if(event.target===this)this.classList.remove('show')">
  <div class="modal-card" id="modalCard">
    <button class="modal-close-btn" onclick="document.getElementById('modalOverlay').classList.remove('show')">✕</button>
    <div id="modalBody"></div>
  </div>
</div>

<!-- ═══════════════════════ BOTTOM NAV (MOBILE & TABLET ONLY) ═ -->
<nav class="bottom-nav" id="bottomNav" style="display:none;"></nav>

<!-- ═══════════════════════ APP SCRIPT ═══════════════════════ -->
<script src="assets/js/app.js?v=<?php echo filemtime(__DIR__ . '/assets/js/app.js'); ?>"></script>

<!-- ═══════════ GreenHarvest Pay Customer Widget ═══════════ -->
<script src="/pay/assets/pay-checkout.js?v=<?php echo @filemtime(__DIR__ . '/pay/assets/pay-checkout.js'); ?>"></script>
<script>
  // Hook GreenHarvest Pay into the existing order confirmation flow.
  // After place_order succeeds, the confirmation modal offers the GHPay sheet.
  // This never changes the existing place_order API or checkout form behaviour.
  (function () {
    'use strict';
    var _origShowConfirm = null;

    function hookGHPay() {
      if (!window.App || typeof App.showOrderConfirmation !== 'function') {
        setTimeout(hookGHPay, 300);
        return;
      }
      _origShowConfirm = App.showOrderConfirmation.bind(App);

      App.showOrderConfirmation = function (res) {
        // Run the existing confirmation UI first
        _origShowConfirm(res);

        // After a short delay, append a "Pay Now with GreenHarvest Pay" button
        // only when payment method is not COD
        setTimeout(function () {
          var modalBody = document.getElementById('modalBody');
          if (!modalBody) return;

          // Determine if GHPay should auto-open (non-COD orders)
          var method = res.payment_method || 'ScanPay';
          var isCod  = (method === 'COD' || method === 'Cash on Delivery');

          // Add GHPay button to confirmation modal
          var ghBtn = document.createElement('button');
          ghBtn.className = 'btn-primary';
          ghBtn.style.cssText = 'background:linear-gradient(135deg,#10b981,#059669);width:100%;margin-top:10px;';
          ghBtn.innerHTML = '💳 Pay with GreenHarvest Pay';
          ghBtn.onclick = function () {
            GHPay.openForOrder(
              res.order_id,
              res.order_number,
              res.total_amount,
              method
            );
          };

          var btnWrap = modalBody.querySelector('div[style*="justify-content:center"]');
          if (btnWrap) {
            btnWrap.insertAdjacentElement('beforebegin', ghBtn);
          } else {
            modalBody.appendChild(ghBtn);
          }

          // Auto-open for non-COD payments
          if (!isCod) {
            setTimeout(function () {
              GHPay.openForOrder(
                res.order_id,
                res.order_number,
                res.total_amount,
                method
              );
            }, 800);
          }
        }, 200);
      };
    }

    document.addEventListener('DOMContentLoaded', hookGHPay);
  })();
</script>

<style>
  /* Cart drawer overlay sync */
  .cart-drawer.open ~ * #cartOverlay { display: block !important; }
</style>

<script>
  // Keep cart overlay in sync with drawer
  const _drawer = document.getElementById('cartDrawer');
  const _overlay = document.getElementById('cartOverlay');

  const _origOpen = App.openCartDrawer.bind(App);
  App.openCartDrawer = function() {
    _origOpen();
    _overlay.style.display = 'block';
  };
  const _origClose = App.closeCartDrawer.bind(App);
  App.closeCartDrawer = function() {
    _origClose();
    _overlay.style.display = 'none';
  };
</script>

<!-- ═══════════════════════ PWA: SERVICE WORKER & INSTALL LOGIC ═════ -->
<script>
(function() {
  'use strict';

  window.GH_PWA = {
    _deferredPrompt: null,
    _installed: false,

    init: function() {
      // Register Service Worker
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/assets/js/sw.js', { scope: '/' })
          .then(function(reg) {
            console.log('[PWA] Service Worker registered, scope:', reg.scope);
            // Check for updates on each visit
            reg.addEventListener('updatefound', function() {
              const newWorker = reg.installing;
              newWorker.addEventListener('statechange', function() {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('[PWA] New version available — will activate on next visit.');
                  GH_PWA._showUpdateToast();
                }
              });
            });
          })
          .catch(function(err) {
            console.warn('[PWA] Service Worker registration failed:', err);
          });
      }

      // Detect if already installed (running in standalone)
      if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) {
        this._installed = true;
        return; // Already installed — hide install button
      }

      // Listen for beforeinstallprompt (Android Chrome + desktop)
      window.addEventListener('beforeinstallprompt', function(e) {
        e.preventDefault();
        GH_PWA._deferredPrompt = e;
        GH_PWA._showInstallBtn();
      });

      // Hide button after successful install
      window.addEventListener('appinstalled', function() {
        GH_PWA._deferredPrompt = null;
        GH_PWA._installed = true;
        GH_PWA._hideInstallBtn();
        console.log('[PWA] GreenHarvest installed successfully!');
      });

      // Online / Offline network status banner
      GH_PWA._initNetworkBanner();
    },

    promptInstall: function() {
      if (this._deferredPrompt) {
        // Android Chrome / desktop — native install prompt
        this._deferredPrompt.prompt();
        this._deferredPrompt.userChoice.then(function(result) {
          if (result.outcome === 'accepted') {
            GH_PWA._hideInstallBtn();
          }
          GH_PWA._deferredPrompt = null;
        });
      } else if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream) {
        // iOS Safari — show instructions
        GH_PWA._showIOSInstructions();
      } else {
        // Other browsers — show generic instructions
        GH_PWA._showBrowserInstructions();
      }
    },

    _showInstallBtn: function() {
      // Install button removed from header — install option is in side menu only.
      // Side menu's _pwaInstallSideBtn() handles visibility automatically.
    },

    _hideInstallBtn: function() {
      // Install button removed from header — no action needed.
    },

    _showUpdateToast: function() {
      var t = document.createElement('div');
      t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:9999;background:#0f172a;color:#fff;padding:10px 20px;border-radius:50px;font-size:13px;font-weight:700;box-shadow:0 4px 20px rgba(0,0,0,0.3);display:flex;align-items:center;gap:10px;white-space:nowrap;';
      t.innerHTML = '<span>\uD83D\uDD04</span> <span>Update available \u2014 <a href="" style="color:#86efac;text-decoration:underline;" onclick="location.reload();return false;">Refresh</a> for latest version</span>';
      document.body.appendChild(t);
      setTimeout(function() {
        t.style.opacity = '0';
        t.style.transition = 'opacity 0.5s';
        setTimeout(function(){ t.remove(); }, 500);
      }, 8000);
    },

    _initNetworkBanner: function() {
      var banner = document.createElement('div');
      banner.id = 'pwaOfflineBanner';
      banner.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;z-index:9998;background:#dc2626;color:white;text-align:center;padding:8px 16px;font-size:13px;font-weight:700;letter-spacing:0.2px;';
      banner.innerHTML = '\u26A0\uFE0F You are offline \u2014 some features may be unavailable';
      document.body.appendChild(banner);

      function updateBanner() {
        banner.style.display = navigator.onLine ? 'none' : 'block';
      }
      window.addEventListener('online', updateBanner);
      window.addEventListener('offline', updateBanner);
      updateBanner();
    },

    _showIOSInstructions: function() {
      var html = [
        '<div style="text-align:center;padding:8px 0;">',
        '<div style="font-size:52px;margin-bottom:14px;">\uD83D\uDCF1</div>',
        '<h3 style="font-size:19px;font-weight:800;color:#0f172a;margin-bottom:8px;">Install GreenHarvest</h3>',
        '<p style="font-size:14px;color:#475569;margin-bottom:18px;line-height:1.6;">Add GreenHarvest to your iPhone or iPad home screen:</p>',
        '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:16px;text-align:left;">',
        '<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px;">',
        '<span style="background:#16a34a;color:white;border-radius:50%;width:24px;height:24px;min-width:24px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;">1</span>',
        '<span style="font-size:14px;color:#334155;line-height:1.5;">Tap the <strong>Share</strong> button \u238B at the bottom of Safari</span>',
        '</div>',
        '<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px;">',
        '<span style="background:#16a34a;color:white;border-radius:50%;width:24px;height:24px;min-width:24px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;">2</span>',
        '<span style="font-size:14px;color:#334155;line-height:1.5;">Scroll down and tap <strong>"Add to Home Screen"</strong></span>',
        '</div>',
        '<div style="display:flex;align-items:flex-start;gap:12px;">',
        '<span style="background:#16a34a;color:white;border-radius:50%;width:24px;height:24px;min-width:24px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;">3</span>',
        '<span style="font-size:14px;color:#334155;line-height:1.5;">Tap <strong>"Add"</strong> in the top-right corner</span>',
        '</div>',
        '</div>',
        '<div style="margin-top:16px;padding:12px;background:#f0fdf4;border-radius:12px;font-size:13px;color:#15803d;font-weight:600;">',
        '\uD83E\uDD6C GreenHarvest will appear on your home screen!',
        '</div>',
        '</div>'
      ].join('');
      var ov = document.getElementById('modalOverlay');
      var body = document.getElementById('modalBody');
      if (ov && body) { body.innerHTML = html; ov.classList.add('show'); }
    },

    _showBrowserInstructions: function() {
      var html = [
        '<div style="text-align:center;padding:8px 0;">',
        '<div style="font-size:52px;margin-bottom:14px;">\uD83D\uDCBB</div>',
        '<h3 style="font-size:19px;font-weight:800;color:#0f172a;margin-bottom:8px;">Install GreenHarvest</h3>',
        '<p style="font-size:14px;color:#475569;margin-bottom:18px;line-height:1.6;">Install GreenHarvest as an app on your device:</p>',
        '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:16px;text-align:left;">',
        '<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px;">',
        '<span style="font-size:20px;">\uD83C\uDF10</span>',
        '<span style="font-size:14px;color:#334155;line-height:1.5;"><strong>Chrome / Edge:</strong> Look for the install icon in the address bar, or open the browser menu &rarr; <strong>"Install app"</strong></span>',
        '</div>',
        '<div style="display:flex;align-items:flex-start;gap:12px;">',
        '<span style="font-size:20px;">\uD83D\uDCF1</span>',
        '<span style="font-size:14px;color:#334155;line-height:1.5;"><strong>Android Chrome:</strong> Tap the 3-dot menu &rarr; <strong>"Add to Home screen"</strong></span>',
        '</div>',
        '</div>',
        '<div style="margin-top:16px;padding:12px;background:#f0fdf4;border-radius:12px;font-size:13px;color:#15803d;font-weight:600;">',
        '\uD83E\uDD6C Best experience: Chrome on Android or Chrome/Edge on desktop.',
        '</div>',
        '</div>'
      ].join('');
      var ov = document.getElementById('modalOverlay');
      var body = document.getElementById('modalBody');
      if (ov && body) { body.innerHTML = html; ov.classList.add('show'); }
    }
  };

  // iOS Safari: The side navigation menu's Install App item handles
  // iOS installation instructions via GH_PWA.promptInstall() — no header button needed.
  document.addEventListener('DOMContentLoaded', function() {
    GH_PWA.init();
  });
})();
</script>

</body>
</html>
