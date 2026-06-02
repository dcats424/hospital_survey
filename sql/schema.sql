CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '+251000000000',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS patients_phone_key ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(name);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);

CREATE TABLE IF NOT EXISTS doctors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  department TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  email TEXT,
  image_url TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS doctors_email_key ON doctors(email);
CREATE INDEX IF NOT EXISTS idx_doctors_name ON doctors(name);
CREATE INDEX IF NOT EXISTS idx_doctors_active_name ON doctors(is_active, name);

CREATE TABLE IF NOT EXISTS roles (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id BIGSERIAL PRIMARY KEY,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  UNIQUE(role_id, module)
);

CREATE TABLE IF NOT EXISTS admin_users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  role_id INTEGER REFERENCES roles(id)
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE,
  user_id BIGINT,
  username TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON admin_sessions(token_hash);

CREATE TABLE IF NOT EXISTS email_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS survey_questions (
  id BIGSERIAL PRIMARY KEY,
  question_key TEXT UNIQUE,
  label TEXT,
  type TEXT DEFAULT 'stars',
  required BOOLEAN DEFAULT TRUE,
  options JSONB DEFAULT '[]'::jsonb,
  min_value INTEGER DEFAULT 1,
  max_value INTEGER DEFAULT 5,
  order_no INTEGER,
  is_active BOOLEAN DEFAULT TRUE,
  is_deleted BOOLEAN DEFAULT FALSE,
  category TEXT DEFAULT 'general',
  page_number INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_survey_questions_active_order ON survey_questions(is_active, is_deleted, page_number, order_no);

CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS visit_doctors (
  visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  doctor_id TEXT NOT NULL REFERENCES doctors(id),
  PRIMARY KEY (visit_id, doctor_id)
);

CREATE TABLE IF NOT EXISTS encounters (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  status TEXT NOT NULL DEFAULT 'in_progress',
  survey_token TEXT,
  survey_link TEXT,
  survey_sent BOOLEAN NOT NULL DEFAULT FALSE,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_encounters_status ON encounters(status);
CREATE INDEX IF NOT EXISTS idx_encounters_patient_id ON encounters(patient_id);
CREATE INDEX IF NOT EXISTS idx_encounters_survey_token ON encounters(survey_token);
CREATE INDEX IF NOT EXISTS idx_encounters_created_at ON encounters(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_encounters_survey_sent ON encounters(survey_sent);
CREATE INDEX IF NOT EXISTS idx_encounters_patient_status_date ON encounters(patient_id, status, created_at);

CREATE TABLE IF NOT EXISTS encounter_doctors (
  encounter_id TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
  doctor_id TEXT NOT NULL REFERENCES doctors(id),
  PRIMARY KEY (encounter_id, doctor_id)
);

CREATE TABLE IF NOT EXISTS survey_tokens (
  token TEXT PRIMARY KEY,
  patient_name TEXT,
  visit_id TEXT REFERENCES visits(id),
  patient_id TEXT REFERENCES patients(id),
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_survey_tokens_visit_id ON survey_tokens(visit_id);
CREATE INDEX IF NOT EXISTS idx_survey_tokens_patient_id ON survey_tokens(patient_id);
CREATE INDEX IF NOT EXISTS idx_survey_tokens_used_at ON survey_tokens(used_at);

CREATE TABLE IF NOT EXISTS token_doctors (
  token TEXT NOT NULL REFERENCES survey_tokens(token) ON DELETE CASCADE,
  doctor_id TEXT NOT NULL REFERENCES doctors(id),
  PRIMARY KEY (token, doctor_id)
);

CREATE TABLE IF NOT EXISTS feedback_submissions (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES survey_tokens(token),
  visit_id TEXT REFERENCES visits(id),
  patient_id TEXT REFERENCES patients(id),
  patient_name TEXT,
  doctor_names TEXT,
  comment TEXT,
  selected_doctor_ids TEXT[],
  selected_doctor_names TEXT[],
  question_answers JSONB DEFAULT '{}'::jsonb,
  language TEXT DEFAULT 'en',
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_token ON feedback_submissions(token);
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_visit_id ON feedback_submissions(visit_id);
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_submitted_at ON feedback_submissions(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_question_answers_gin ON feedback_submissions USING GIN (question_answers);

CREATE TABLE IF NOT EXISTS feedback_ratings (
  id BIGSERIAL PRIMARY KEY,
  submission_id BIGINT NOT NULL REFERENCES feedback_submissions(id) ON DELETE CASCADE,
  doctor_id TEXT NOT NULL REFERENCES doctors(id),
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5)
);

CREATE INDEX IF NOT EXISTS idx_feedback_ratings_doctor_id ON feedback_ratings(doctor_id);
CREATE INDEX IF NOT EXISTS idx_feedback_ratings_submission_id ON feedback_ratings(submission_id);

CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES admin_users(id),
  action TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS admin_notification_seen (
  admin_id INTEGER PRIMARY KEY REFERENCES admin_users(id) ON DELETE CASCADE,
  last_seen_submission_id BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
