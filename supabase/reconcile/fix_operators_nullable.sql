-- Match staging: seeded employee operators have no PIN/login until provisioned in-app.
-- Prod had operators.pin NOT NULL; staging allows null. Relax it (no effect on existing rows).
ALTER TABLE production.operators ALTER COLUMN pin DROP NOT NULL;
