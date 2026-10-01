-- Jalankan SEKALI pada database D1 lama yang sudah memakai schema.sql versi sebelumnya.
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN block_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN blocked_at TEXT;
ALTER TABLE users ADD COLUMN blocked_by INTEGER;
ALTER TABLE attempts ADD COLUMN ended_by INTEGER;
ALTER TABLE attempts ADD COLUMN end_reason TEXT NOT NULL DEFAULT '';
UPDATE users SET status = CASE WHEN active=1 THEN 'active' ELSE 'blocked' END;
CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role,status);
