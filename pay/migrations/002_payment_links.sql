-- ============================================================
-- GreenHarvest Pay — Migration 002: Payment Links
-- Additive-only migration. Persists shareable customer payment links.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS gh_payment_links (
  id                  SERIAL PRIMARY KEY,
  link_token          VARCHAR(64) NOT NULL UNIQUE,
  title               VARCHAR(255) NOT NULL,
  description         TEXT DEFAULT NULL,
  amount              NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  currency            VARCHAR(3) NOT NULL DEFAULT 'INR',
  customer_name       VARCHAR(150) DEFAULT NULL,
  customer_phone      VARCHAR(20) DEFAULT NULL,
  customer_email      VARCHAR(150) DEFAULT NULL,
  order_ref           VARCHAR(100) DEFAULT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'unpaid'
                        CHECK (status IN ('unpaid','pending','paid','cancelled','expired')),
  expires_at          TIMESTAMP DEFAULT NULL,
  created_by_user_id  INT DEFAULT NULL,
  payment_attempt_id  INT DEFAULT NULL,
  payment_method      VARCHAR(30) DEFAULT NULL,
  transaction_ref     VARCHAR(100) DEFAULT NULL,
  utr_reference       VARCHAR(100) DEFAULT NULL,
  screenshot_path     VARCHAR(255) DEFAULT NULL,
  paid_at             TIMESTAMP DEFAULT NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gpl_token     ON gh_payment_links(link_token);
CREATE INDEX IF NOT EXISTS idx_gpl_status    ON gh_payment_links(status);
CREATE INDEX IF NOT EXISTS idx_gpl_created   ON gh_payment_links(created_at);
CREATE INDEX IF NOT EXISTS idx_gpl_order_ref ON gh_payment_links(order_ref);

-- Optional: Allow gh_payment_attempts to link to payment links as well as orders
ALTER TABLE gh_payment_attempts ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE gh_payment_attempts ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE gh_payment_attempts ADD COLUMN IF NOT EXISTS payment_link_id INT DEFAULT NULL;

COMMIT;
