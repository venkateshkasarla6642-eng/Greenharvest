# 🥬 GreenHarvest — 100% Farm-Fresh Online Vegetable Store & PWA

**GreenHarvest** is a modern, high-performance web application and Progressive Web App (PWA) built for ordering farm-fresh vegetables directly from the local store with ultra-fast delivery.

---

## 🌟 Key Features

### 🛒 Customer Experience
* **100% Fresh Vegetable Catalog**: Filter by categories (Leafy, Roots, Tubers, Organic, Offers, etc.) with real-time search.
* **Interactive Cart & Drawer**: Live price calculation, quantity selectors (`250g`, `500g`, `1kg`, `2kg`, `5kg`), coupon codes, and dynamic free delivery tracker.
* **Seamless Checkout & Delivery**: Multi-address management (Home, Work, Other) with instant address switcher.
* **Flexible Payments**: Cash on Delivery (COD) and UPI QR / UPI reference entry.
* **Live Order Tracking**: Real-time status progression (`Placed` ➔ `Accepted` ➔ `Preparing` ➔ `Out for Delivery` ➔ `Delivered`).
* **Order & Payment History**: Complete transaction logs, payment receipt viewing and printing, and quick reorder.
* **Profile Management**: Profile photo upload, customizable contact information, and delivery addresses.

### 🏪 Shopkeeper Dashboard
* **7 Real-time Summary Cards**: Today's Orders, Pending, Preparing, Out for Delivery, Delivered, Accurate Sales, and Pending Payments.
* **Attractive Order Management Cards**:
  * Live status pill badges with animated indicators.
  * Customer details with direct clickable phone call links and full address pins.
  * Vegetable item breakdown chips with unit weights and prices.
  * Payment method and status summary.
  * **"👁️ View Details" modal** displaying full customer details, itemized vegetables table, bill breakdown, and instant order actions.
* **Complete Order Lifecycle Workflow**: One-click Accept, Reject (with reason), Start Preparing, Out for Delivery, Delivered, and Re-Accept rejected orders.
* **Vegetables & Inventory Control**: Manage stock, pricing, and availability.
* **Receipt Generation**: Generate and print official receipts with unique receipt numbers.

---

## 🛠️ Technology Stack

* **Backend**: PHP 8+ (PDO, RESTful JSON API)
* **Database**: MySQL / MariaDB
* **Frontend**: Vanilla JavaScript (ES6+), Modern Vanilla CSS (no framework dependencies)
* **Libraries**: Canvas Confetti
* **Environment**: Apache / XAMPP on Windows, Linux, or macOS

---

## 🚀 Installation & Setup Guide

### 1. Prerequisites
* [XAMPP](https://www.apachefriends.org/) (Apache + MySQL + PHP 8.x)
* [Git](https://git-scm.com/)

### 2. Clone the Repository
Clone into your XAMPP `htdocs` directory:
```bash
cd c:/xampp/htdocs
git clone https://github.com/aravindkasarla5/GREENHARVEST.git market
```

### 3. Start Apache & MySQL
Open **XAMPP Control Panel** and start both **Apache** and **MySQL**.

### 4. Database Setup
1. Open [phpMyAdmin](http://localhost/phpmyadmin).
2. The database `vegetable_shop_db` will automatically be created on first launch via `config.php`.
3. To seed demo vegetables, categories, and accounts, open your browser and run:
   ```
   http://localhost/market/seed.php
   ```

### 5. Access the Web App
Open your browser and navigate to:
```
http://localhost/market/
```

---

## 👥 Demo Login Credentials

| Role | Phone Number | Password |
| :--- | :--- | :--- |
| **Shopkeeper** | `9876543210` | `123456` |
| **Customer** | `9123456789` | `123456` |

---

## 📁 Project Structure

```
market/
├── api.php              # RESTful API endpoints for auth, products, orders, payments
├── config.php           # Database configuration, session & helpers
├── index.php            # Main single-page application entry point
├── schema.sql           # Database schema & tables definition
├── seed.php             # Initial sample database seeder
├── README.md            # Project documentation
├── assets/
│   ├── css/
│   │   └── styles.css   # Complete application stylesheet & responsive design
│   └── js/
│       └── app.js       # Core frontend application logic, state & UI handlers
└── uploads/             # User profile pictures & uploaded media
```

---

## 📄 License
This project is open source and available under the [MIT License](LICENSE).
