-- ============================================================
-- CNTP Maintenance — per-part barcode on the spare-parts register
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: existing maintenance.spare_parts table
-- Re-runnable (ADD COLUMN / CREATE INDEX are IF NOT EXISTS).
-- ============================================================
--
-- Adds an optional barcode to each spare part so storeroom staff can pick a
-- part fast with a handheld scanner, a phone camera (BarcodeDetector), or by
-- typing the code. The index speeds up the barcode → part lookup; it is
-- partial (WHERE barcode IS NOT NULL) because most legacy rows have no code.
-- ============================================================

ALTER TABLE maintenance.spare_parts
  ADD COLUMN IF NOT EXISTS barcode text;

CREATE INDEX IF NOT EXISTS spare_parts_barcode_idx
  ON maintenance.spare_parts(barcode) WHERE barcode IS NOT NULL;
