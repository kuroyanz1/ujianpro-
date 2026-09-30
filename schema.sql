PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('murid','guru','admin')),
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  is_active INTEGER NOT NULL DEFAULT 0,
  lock_on_violation INTEGER NOT NULL DEFAULT 1,
  require_camera INTEGER NOT NULL DEFAULT 0,
  require_screen INTEGER NOT NULL DEFAULT 0,
  capture_evidence INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_option TEXT NOT NULL CHECK(correct_option IN ('A','B','C','D')),
  points INTEGER NOT NULL DEFAULT 1,
  order_no INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','submitted','locked','expired')),
  score REAL NOT NULL DEFAULT 0,
  violation_count INTEGER NOT NULL DEFAULT 0,
  last_heartbeat TEXT,
  user_agent TEXT DEFAULT '',
  client_id TEXT DEFAULT '',
  UNIQUE(exam_id, user_id)
);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_option TEXT CHECK(selected_option IN ('A','B','C','D') OR selected_option IS NULL),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS violations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  reason TEXT NOT NULL,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('camera','screen')),
  object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_exam ON attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_violations_attempt ON violations(attempt_id);
CREATE INDEX IF NOT EXISTS idx_evidence_attempt ON evidence(attempt_id);

INSERT OR IGNORE INTO users (username,name,role,password_hash,salt,active) VALUES
('admin','Administrator','admin','Ke-0YlJ0m0AEnIa6V4v1QBHnyZ2legFqeBJgekk7kUk','v2x45DHj36mlMTueuZcn6g',1),
('guru01','Guru Demo','guru','8Y7Et96-Oy5fgX0TFv7PXw8Qn_MzFS_viO_DDv5Dkno','dp7s9Q3O35MLBFMBHxUc0Q',1),
('murid01','Murid Demo','murid','j-dFa7QkXirZ5qmc9ockBi8QvMGYMvCC8N10Ilzg9JE','4__80_Xe5zxZk2QF-mC9uQ',1);

INSERT OR IGNORE INTO exams (id,title,description,duration_minutes,is_active,lock_on_violation,require_camera,require_screen,capture_evidence,created_by)
VALUES (1,'Ujian Demo','Ujian contoh untuk mengecek alur Murid, Guru, dan Admin.',20,1,1,0,0,1,(SELECT id FROM users WHERE username='guru01'));

INSERT OR IGNORE INTO questions (id,exam_id,prompt,option_a,option_b,option_c,option_d,correct_option,points,order_no)
VALUES
(1,1,'Ibu kota Indonesia adalah ...','Bandung','Jakarta','Surabaya','Medan','B',1,1),
(2,1,'Hasil dari 7 × 8 adalah ...','48','54','56','64','C',1,2),
(3,1,'Planet yang dikenal sebagai Planet Merah adalah ...','Mars','Venus','Jupiter','Saturnus','A',1,3);
