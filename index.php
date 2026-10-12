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
    <a href="#" class="brand-logo" onclick="location.reload(); return false;">
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

</body>
</html>
