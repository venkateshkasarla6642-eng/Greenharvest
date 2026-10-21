-- GreenHarvest PostgreSQL Schema

-- Users table (with all profile fields)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  email VARCHAR(100),
  password VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'shopkeeper')),
  address TEXT,
  profile_photo VARCHAR(255),
  house_no VARCHAR(100),
  street VARCHAR(100),
  city VARCHAR(100),
  district VARCHAR(100),
  state VARCHAR(100),
  pincode VARCHAR(10),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  icon VARCHAR(50) DEFAULT '🥬',
  slug VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Products table
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  category_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  unit VARCHAR(20) DEFAULT 'kg',
  available_stock DECIMAL(10,2) NOT NULL DEFAULT 50.00,
  sold_stock DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  available_units VARCHAR(255) DEFAULT '250g, 500g, 1kg, 2kg, 5kg',
  image_url VARCHAR(255),
  is_fresh_today SMALLINT DEFAULT 1,
  is_best_seller SMALLINT DEFAULT 0,
  is_organic SMALLINT DEFAULT 0,
  discount_percent INT DEFAULT 0,
  is_active SMALLINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_number VARCHAR(50) NOT NULL UNIQUE,
  customer_id INT NOT NULL,
  customer_name VARCHAR(100) NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(10,2) NOT NULL,
  delivery_address TEXT NOT NULL,
  payment_method VARCHAR(50) NOT NULL,
  payment_status VARCHAR(20) DEFAULT 'Pending' CHECK (payment_status IN ('Pending', 'Paid', 'Failed', 'Refunded')),
  upi_trans_id VARCHAR(100) DEFAULT NULL,
  order_status VARCHAR(20) DEFAULT 'Placed' CHECK (order_status IN ('Placed', 'Accepted', 'Preparing', 'OutForDelivery', 'Delivered', 'Rejected')),
  rejection_reason VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Trigger to auto-update updated_at on orders
CREATE OR REPLACE FUNCTION update_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_updated_at_trigger ON orders;
CREATE TRIGGER orders_updated_at_trigger
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_orders_updated_at();

-- Order Items table
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  product_name VARCHAR(100) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  unit_weight VARCHAR(20) NOT NULL,
  quantity INT NOT NULL,
  item_total DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT DEFAULT NULL,
  for_role VARCHAR(20) DEFAULT 'customer' CHECK (for_role IN ('customer', 'shopkeeper', 'all')),
  title VARCHAR(150) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'info',
  is_read SMALLINT DEFAULT 0,
  is_dismissed SMALLINT DEFAULT 0,
  link VARCHAR(100) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Offers table
CREATE TABLE IF NOT EXISTS offers (
  id SERIAL PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  discount_type VARCHAR(20) NOT NULL DEFAULT 'percentage' CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value DECIMAL(10,2) NOT NULL,
  min_order DECIMAL(10,2) DEFAULT 0.00,
  banner_image VARCHAR(255) DEFAULT NULL,
  is_active SMALLINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Reviews table
CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL,
  customer_id INT NOT NULL,
  customer_name VARCHAR(100) NOT NULL,
  rating INT NOT NULL DEFAULT 5,
  freshness_rating INT DEFAULT 5,
  delivery_rating INT DEFAULT 5,
  comment TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Support Messages table
CREATE TABLE IF NOT EXISTS support_messages (
  id SERIAL PRIMARY KEY,
  order_id INT DEFAULT NULL,
  customer_id INT NOT NULL,
  sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('customer', 'shopkeeper')),
  message TEXT NOT NULL,
  is_read SMALLINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Shop Settings table
CREATE TABLE IF NOT EXISTS shop_settings (
  id INT PRIMARY KEY DEFAULT 1,
  shop_name VARCHAR(100) DEFAULT 'GreenHarvest Fresh Vegetables',
  shop_status VARCHAR(10) DEFAULT 'OPEN' CHECK (shop_status IN ('OPEN', 'CLOSED')),
  shop_upi_id VARCHAR(100) DEFAULT 'greenharvest@upi',
  shop_qr_code VARCHAR(255) DEFAULT 'assets/images/shop_upi_qr.png',
  min_order_amount DECIMAL(10,2) DEFAULT 100.00,
  free_delivery_above DECIMAL(10,2) DEFAULT 300.00,
  delivery_charge DECIMAL(10,2) DEFAULT 20.00,
  estimated_delivery_time VARCHAR(50) DEFAULT '20-35 mins'
);

-- Customer Delivery Addresses table
CREATE TABLE IF NOT EXISTS customer_addresses (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL,
  label VARCHAR(50) DEFAULT 'Home',
  recipient_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  house_no VARCHAR(100),
  street VARCHAR(100),
  city VARCHAR(100),
  district VARCHAR(100),
  state VARCHAR(100),
  pincode VARCHAR(10),
  delivery_instructions TEXT,
  is_default SMALLINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Real-Time Delivery GPS Tracking table
-- One row per order; upserted on every GPS update from the shopkeeper device.
CREATE TABLE IF NOT EXISTS delivery_tracking (
  id         SERIAL PRIMARY KEY,
  order_id   INT NOT NULL UNIQUE,
  latitude   DOUBLE PRECISION NOT NULL,
  longitude  DOUBLE PRECISION NOT NULL,
  accuracy   DOUBLE PRECISION DEFAULT NULL,
  heading    DOUBLE PRECISION DEFAULT NULL,
  speed      DOUBLE PRECISION DEFAULT NULL,
  is_active  SMALLINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_dt_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_delivery_tracking_order ON delivery_tracking(order_id);

CREATE OR REPLACE FUNCTION update_delivery_tracking_ts()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS delivery_tracking_ts_trigger ON delivery_tracking;
CREATE TRIGGER delivery_tracking_ts_trigger
  BEFORE UPDATE ON delivery_tracking
  FOR EACH ROW EXECUTE FUNCTION update_delivery_tracking_ts();
