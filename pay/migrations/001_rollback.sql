-- ============================================================
-- GreenHarvest Pay — Rollback 001
-- DANGER: This removes all GreenHarvest Pay tables.
-- Run only to undo migration 001.
-- Does NOT delete existing orders, users, or payment history.
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS gh_audit_log         CASCADE;
DROP TABLE IF EXISTS gh_qr_submissions    CASCADE;
DROP TABLE IF EXISTS gh_payment_events    CASCADE;
DROP TABLE IF EXISTS gh_payment_attempts  CASCADE;
DROP TABLE IF EXISTS gh_pay_settings      CASCADE;

-- Revert users.role CHECK to original (without 'owner')
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('customer', 'shopkeeper'));

-- Note: if any user has role='owner', this will fail.
-- First run: UPDATE users SET role='shopkeeper' WHERE role='owner';

-- Revert orders.order_status CHECK to original (without 'Cancelled')
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_order_status_check
  CHECK (order_status IN (
    'Placed','Accepted','Preparing','OutForDelivery',
    'Delivered','Rejected'
  ));

-- Note: if any order has status='Cancelled', this will fail.
-- First run: UPDATE orders SET order_status='Rejected' WHERE order_status='Cancelled';

COMMIT;

SELECT 'Rollback 001 applied — GreenHarvest Pay tables removed' AS result;
