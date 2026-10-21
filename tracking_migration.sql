-- GreenHarvest Real-Time Delivery Tracking Migration
-- Run once against the production PostgreSQL database.
-- This migration is idempotent (IF NOT EXISTS guards).

-- Delivery tracking table: stores the latest GPS location for an active delivery.
-- One row per order; upserted on every location update by the shopkeeper device.
CREATE TABLE IF NOT EXISTS delivery_tracking (
    id            SERIAL PRIMARY KEY,
    order_id      INT NOT NULL UNIQUE,               -- FK → orders.id; UNIQUE enforces one row per order
    latitude      DOUBLE PRECISION NOT NULL,
    longitude     DOUBLE PRECISION NOT NULL,
    accuracy      DOUBLE PRECISION DEFAULT NULL,     -- GPS accuracy in metres (from browser Geolocation API)
    heading       DOUBLE PRECISION DEFAULT NULL,     -- compass bearing 0-360 (optional)
    speed         DOUBLE PRECISION DEFAULT NULL,     -- m/s (optional, from browser)
    is_active     SMALLINT NOT NULL DEFAULT 1,       -- 1 = tracking live; 0 = stopped
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_dt_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Index for fast look-up by order_id (already unique, creates implicit index, but explicit is clearer)
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_order ON delivery_tracking(order_id);

-- Auto-update updated_at on every GPS write
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
