-- Calibration certificate upload for the annual / calibration register.
-- Stores a reference to a certificate file (image or PDF) uploaded as proof
-- that an external party performed the calibration. The file itself lives in
-- the private `maintenance-card-photos` storage bucket under a `cert/` prefix
-- (kept out of the DB to avoid bloat); only the object path + metadata are
-- stored here and served via short-lived signed URLs.
alter table maintenance.annual_items add column if not exists cert_path text;
alter table maintenance.annual_items add column if not exists cert_name text;
alter table maintenance.annual_items add column if not exists cert_uploaded_at timestamptz;
alter table maintenance.annual_items add column if not exists cert_uploaded_by text;
