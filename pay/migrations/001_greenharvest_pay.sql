-- ============================================================
-- GreenHarvest Pay — Migration 001
-- Safe, additive-only migration. Does NOT alter existing data.
-- Run with: psql $DATABASE_URL -f pay/migrations/001_greenharvest_pay.sql
-- ============================================================

BEGIN;

-- ─── 1. Extend users.role to include 'owner' ──────────────────────────────
-- Drop the old CHECK, add new one with 'owner'
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('customer', 'shopkeeper', 'owner'));

-- Fix latent bug: orders.order_status missing 'Cancelled'
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_order_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_order_status_check
  CHECK (order_status IN (
    'Placed','Accepted','Preparing','OutForDelivery',
    'Delivered','Rejected','Cancelled'
  ));

-- ─── 2. GreenHarvest Pay Gateway Settings ─────────────────────────────────
CREATE TABLE IF NOT EXISTS gh_pay_settings (
  id                    INT PRIMARY KEY DEFAULT 1,
  mode                  VARCHAR(10) NOT NULL DEFAULT 'sandbox'
                          CHECK (mode IN ('sandbox','live')),
  enabled_methods       TEXT NOT NULL DEFAULT 'qr_upi,cod',
  -- Live provider: 'none' | 'razorpay' | 'cashfree' | 'phonepe'
  live_provider         VARCHAR(30) NOT NULL DEFAULT 'none',
  -- Encrypted/env-referenced credentials (stored as env var NAMES, not values)
  provider_key_env      VARCHAR(100) DEFAULT NULL,
  provider_secret_env   VARCHAR(100) DEFAULT NULL,
  webhook_secret_env    VARCHAR(100) DEFAULT NULL,
  -- QR / UPI display settings
  upi_id                VARCHAR(100) DEFAULT NULL,
  qr_image_path         VARCHAR(255) DEFAULT NULL,
  -- Manual verification toggle
  manual_verify_enabled SMALLINT NOT NULL DEFAULT 1,
  -- Sandbox auto-approve (for testing)
  sandbox_auto_approve  SMALLINT NOT NULL DEFAULT 0,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id    INT DEFAULT NULL
);

-- Insert default row if not exists
INSERT INTO gh_pay_settings (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

-- ─── 3. Payment Attempts ──────────────────────────────────────────────────
-- One row per checkout attempt. Linked to orders.
CREATE TABLE IF NOT EXISTS gh_payment_attempts (
  id                  SERIAL PRIMARY KEY,
  -- Cryptographically secure unique reference (shown to customer)
  payment_ref         VARCHAR(64) NOT NULL UNIQUE,
  -- Idempotency key (prevents duplicates on retry)
  idempotency_key     VARCHAR(64) NOT NULL UNIQUE,
  order_id            INT NOT NULL,
  customer_id         INT NOT NULL,
  -- Server-calculated amount (never trust client)
  amount              NUMERIC(10,2) NOT NULL,
  currency            VARCHAR(3) NOT NULL DEFAULT 'INR',
  -- Payment method chosen at checkout
  method              VARCHAR(30) NOT NULL
                        CHECK (method IN ('qr_upi','cod','sandbox','live_upi','live_card','live_netbanking')),
  -- State machine
  status              VARCHAR(20) NOT NULL DEFAULT 'initiated'
                        CHECK (status IN ('initiated','pending','processing',
                                          'paid','failed','cancelled','expired','refunded')),
  -- Provider-side references (filled after provider interaction)
  provider_name       VARCHAR(30) DEFAULT NULL,
  provider_order_id   VARCHAR(100) DEFAULT NULL,
  provider_payment_id VARCHAR(100) DEFAULT NULL,
  provider_signature  VARCHAR(500) DEFAULT NULL,
  -- Verification
  verified_at         TIMESTAMP DEFAULT NULL,
  verified_by_user_id INT DEFAULT NULL,
  -- Sandbox flag
  is_sandbox          SMALLINT NOT NULL DEFAULT 1,
  -- Timestamps
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at          TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 minutes'),
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- Relations
  FOREIGN KEY (order_id)    REFERENCES orders(id)    ON DELETE RESTRICT,
  FOREIGN KEY (customer_id) REFERENCES users(id)     ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_gpa_order_id     ON gh_payment_attempts(order_id);
CREATE INDEX IF NOT EXISTS idx_gpa_customer_id  ON gh_payment_attempts(customer_id);
CREATE INDEX IF NOT EXISTS idx_gpa_status       ON gh_payment_attempts(status);
CREATE INDEX IF NOT EXISTS idx_gpa_payment_ref  ON gh_payment_attempts(payment_ref);
CREATE INDEX IF NOT EXISTS idx_gpa_created      ON gh_payment_attempts(created_at);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_gh_payment_attempts_ts()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS gpa_updated_at ON gh_payment_attempts;
CREATE TRIGGER gpa_updated_at
  BEFORE UPDATE ON gh_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION update_gh_payment_attempts_ts();

-- ─── 4. Payment Events (Webhook + Server-side events) ─────────────────────
CREATE TABLE IF NOT EXISTS gh_payment_events (
  id                  SERIAL PRIMARY KEY,
  payment_attempt_id  INT DEFAULT NULL,
  event_type          VARCHAR(50) NOT NULL,
  -- Raw payload hash for duplicate detection (SHA-256 of body)
  payload_hash        VARCHAR(64) NOT NULL,
  provider_event_id   VARCHAR(100) DEFAULT NULL,
  source              VARCHAR(20) NOT NULL DEFAULT 'webhook'
                        CHECK (source IN ('webhook','api_poll','manual','sandbox','system')),
  status              VARCHAR(20) NOT NULL DEFAULT 'received'
                        CHECK (status IN ('received','processed','duplicate','failed','rejected')),
  -- Never store raw secrets; store only metadata
  signature_valid     SMALLINT DEFAULT NULL,
  raw_payload_size    INT DEFAULT NULL,
  error_message       TEXT DEFAULT NULL,
  processed_at        TIMESTAMP DEFAULT NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (payment_attempt_id) REFERENCES gh_payment_attempts(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gpe_payload_hash ON gh_payment_events(payload_hash);
CREATE INDEX IF NOT EXISTS idx_gpe_attempt_id ON gh_payment_events(payment_attempt_id);
CREATE INDEX IF NOT EXISTS idx_gpe_event_type ON gh_payment_events(event_type);

-- ─── 5. QR Payment Submissions (customer manual UPI verification) ──────────
CREATE TABLE IF NOT EXISTS gh_qr_submissions (
  id                  SERIAL PRIMARY KEY,
  payment_attempt_id  INT NOT NULL,
  order_id            INT NOT NULL,
  customer_id         INT NOT NULL,
  -- UTR / transaction reference entered by customer
  utr_reference       VARCHAR(100) DEFAULT NULL,
  -- Screenshot path (server-side stored, not public URL)
  screenshot_path     VARCHAR(255) DEFAULT NULL,
  -- Duplicate UTR detection index
  -- Verification
  verification_status VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (verification_status IN ('pending','approved','rejected','duplicate')),
  verified_by_user_id INT DEFAULT NULL,
  verified_at         TIMESTAMP DEFAULT NULL,
  rejection_reason    TEXT DEFAULT NULL,
  notes               TEXT DEFAULT NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (payment_attempt_id) REFERENCES gh_payment_attempts(id) ON DELETE RESTRICT,
  FOREIGN KEY (order_id)           REFERENCES orders(id)               ON DELETE RESTRICT,
  FOREIGN KEY (customer_id)        REFERENCES users(id)                ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_gqs_attempt_id ON gh_qr_submissions(payment_attempt_id);
CREATE INDEX IF NOT EXISTS idx_gqs_customer_id ON gh_qr_submissions(customer_id);
CREATE INDEX IF NOT EXISTS idx_gqs_utr ON gh_qr_submissions(utr_reference);
CREATE INDEX IF NOT EXISTS idx_gqs_status ON gh_qr_submissions(verification_status);

-- ─── 6. Audit Log ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gh_audit_log (
  id          SERIAL PRIMARY KEY,
  user_id     INT DEFAULT NULL,
  user_role   VARCHAR(20) DEFAULT NULL,
  action      VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) DEFAULT NULL,
  entity_id   INT DEFAULT NULL,
  -- JSON metadata (no secrets, no card data)
  meta        TEXT DEFAULT NULL,
  ip_address  VARCHAR(45) DEFAULT NULL,
  user_agent  VARCHAR(500) DEFAULT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gal_user_id    ON gh_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_gal_action     ON gh_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_gal_created    ON gh_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_gal_entity     ON gh_audit_log(entity_type, entity_id);

COMMIT;

-- ============================================================
-- Verify migration
-- ============================================================
SELECT 'Migration 001 applied successfully' AS result;
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'gh_pay_settings','gh_payment_attempts',
    'gh_payment_events','gh_qr_submissions','gh_audit_log'
  )
ORDER BY tablename;
