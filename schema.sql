-- Vegetable Shop Database Schema
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(20) NOT NULL UNIQUE,
  `email` VARCHAR(100),
  `password` VARCHAR(255) NOT NULL,
  `role` ENUM('customer', 'shopkeeper') NOT NULL DEFAULT 'customer',
  `address` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `categories` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL,
  `icon` VARCHAR(50) DEFAULT '🥬',
  `slug` VARCHAR(100) NOT NULL UNIQUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `products` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `category_id` INT NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `description` TEXT,
  `price` DECIMAL(10,2) NOT NULL,
  `unit` VARCHAR(20) DEFAULT 'kg',
  `available_stock` DECIMAL(10,2) NOT NULL DEFAULT 50.00,
  `sold_stock` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `available_units` VARCHAR(255) DEFAULT '250g, 500g, 1kg, 2kg, 5kg',
  `image_url` VARCHAR(255),
  `is_fresh_today` TINYINT(1) DEFAULT 1,
  `is_best_seller` TINYINT(1) DEFAULT 0,
  `is_organic` TINYINT(1) DEFAULT 0,
  `discount_percent` INT DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `orders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_number` VARCHAR(50) NOT NULL UNIQUE,
  `customer_id` INT NOT NULL,
  `customer_name` VARCHAR(100) NOT NULL,
  `customer_phone` VARCHAR(20) NOT NULL,
  `subtotal` DECIMAL(10,2) NOT NULL,
  `delivery_fee` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `discount_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `total_amount` DECIMAL(10,2) NOT NULL,
  `delivery_address` TEXT NOT NULL,
  `payment_method` VARCHAR(50) NOT NULL,
  `payment_status` ENUM('Pending', 'Paid', 'Failed', 'Refunded') DEFAULT 'Pending',
  `upi_trans_id` VARCHAR(100) DEFAULT NULL,
  `order_status` ENUM('Placed', 'Accepted', 'Preparing', 'OutForDelivery', 'Delivered', 'Rejected') DEFAULT 'Placed',
  `rejection_reason` VARCHAR(255) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `order_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `product_id` INT NOT NULL,
  `product_name` VARCHAR(100) NOT NULL,
  `price` DECIMAL(10,2) NOT NULL,
  `unit_weight` VARCHAR(20) NOT NULL,
  `quantity` INT NOT NULL,
  `item_total` DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT DEFAULT NULL,
  `for_role` ENUM('customer', 'shopkeeper', 'all') DEFAULT 'customer',
  `title` VARCHAR(150) NOT NULL,
  `message` TEXT NOT NULL,
  `type` VARCHAR(50) DEFAULT 'info',
  `is_read` TINYINT(1) DEFAULT 0,
  `link` VARCHAR(100) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `offers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(150) NOT NULL,
  `code` VARCHAR(50) NOT NULL UNIQUE,
  `discount_type` ENUM('percentage', 'fixed') NOT NULL DEFAULT 'percentage',
  `discount_value` DECIMAL(10,2) NOT NULL,
  `min_order` DECIMAL(10,2) DEFAULT 0.00,
  `banner_image` VARCHAR(255) DEFAULT NULL,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `reviews` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `customer_id` INT NOT NULL,
  `customer_name` VARCHAR(100) NOT NULL,
  `rating` INT NOT NULL DEFAULT 5,
  `freshness_rating` INT DEFAULT 5,
  `delivery_rating` INT DEFAULT 5,
  `comment` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `support_messages` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT DEFAULT NULL,
  `customer_id` INT NOT NULL,
  `sender_type` ENUM('customer', 'shopkeeper') NOT NULL,
  `message` TEXT NOT NULL,
  `is_read` TINYINT(1) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `shop_settings` (
  `id` INT PRIMARY KEY DEFAULT 1,
  `shop_name` VARCHAR(100) DEFAULT 'GreenHarvest Fresh Vegetables',
  `shop_status` ENUM('OPEN', 'CLOSED') DEFAULT 'OPEN',
  `shop_upi_id` VARCHAR(100) DEFAULT 'greenharvest@upi',
  `shop_qr_code` VARCHAR(255) DEFAULT 'assets/images/shop_upi_qr.png',
  `min_order_amount` DECIMAL(10,2) DEFAULT 100.00,
  `free_delivery_above` DECIMAL(10,2) DEFAULT 300.00,
  `delivery_charge` DECIMAL(10,2) DEFAULT 20.00,
  `estimated_delivery_time` VARCHAR(50) DEFAULT '20-35 mins'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
