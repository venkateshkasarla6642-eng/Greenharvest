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

      <!-- PWA Install App Button -->
      <button id="pwaInstallBtn" class="btn-pwa-install" title="Install GreenHarvest App" style="display:none;" onclick="GH_PWA.promptInstall()">
        <span class="pwa-install-icon">📲</span>
        <span class="pwa-install-label">Install App</span>
      </button>

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
        console.log('[PWA] GreenHarvest installed!');
      });
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
      var btn = document.getElementById('pwaInstallBtn');
      if (btn) btn.style.display = 'flex';
    },

    _hideInstallBtn: function() {
      var btn = document.getElementById('pwaInstallBtn');
      if (btn) btn.style.display = 'none';
    },

    _showIOSInstructions: function() {
      var html = [
        '<div style="text-align:center;padding:8px 0;">',
        '<div style="font-size:48px;margin-bottom:12px;">📱</div>',
        '<h3 style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:10px;">Install GreenHarvest</h3>',
        '<p style="font-size:14px;color:#475569;margin-bottom:16px;line-height:1.6;">To install on your iPhone or iPad:</p>',
        '<ol style="text-align:left;font-size:14px;color:#334155;line-height:2;padding-left:20px;">',
        '<li>Tap the <strong>Share</strong> button &#x2015; <span style="font-size:18px;">⎋</span> at the bottom of Safari</li>',
        '<li>Scroll down and tap <strong>"Add to Home Screen"</strong></li>',
        '<li>Tap <strong>"Add"</strong> in the top-right corner</li>',
        '</ol>',
        '<div style="margin-top:16px;padding:12px;background:#f0fdf4;border-radius:12px;font-size:13px;color:#15803d;font-weight:600;">',
        '🥬 GreenHarvest will appear on your home screen!',
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
        '<div style="font-size:48px;margin-bottom:12px;">💻</div>',
        '<h3 style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:10px;">Install GreenHarvest</h3>',
        '<p style="font-size:14px;color:#475569;margin-bottom:16px;line-height:1.6;">',
        'To install GreenHarvest, look for the install icon in your browser address bar, or open the browser menu and select <strong>"Install App"</strong> or <strong>"Add to Home Screen"</strong>.',
        '</p>',
        '<div style="padding:12px;background:#f0fdf4;border-radius:12px;font-size:13px;color:#15803d;font-weight:600;">',
        '🥬 Best experience: Use Chrome on Android or Chrome/Edge on desktop.',
        '</div>',
        '</div>'
      ].join('');
      var ov = document.getElementById('modalOverlay');
      var body = document.getElementById('modalBody');
      if (ov && body) { body.innerHTML = html; ov.classList.add('show'); }
    }
  };

  // iOS: always show install button in Safari (no beforeinstallprompt)
  document.addEventListener('DOMContentLoaded', function() {
    GH_PWA.init();

    // On iOS Safari, show install button manually if not already installed
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    var isStandalone = window.navigator.standalone === true;
    if (isIOS && !isStandalone) {
      GH_PWA._showInstallBtn();
    }
  });
})();
</script>

</body>
</html>
