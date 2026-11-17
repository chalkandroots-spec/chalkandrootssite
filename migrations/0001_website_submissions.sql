CREATE TABLE IF NOT EXISTS website_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_name TEXT NOT NULL CHECK (form_name IN ('vault-signup', 'quiz-result')),
  email TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'direct',
  payload_json TEXT NOT NULL,
  notification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (notification_status IN ('pending', 'sent', 'failed')),
  notification_attempts INTEGER NOT NULL DEFAULT 0,
  notification_last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_website_submissions_created
  ON website_submissions(created_at);

CREATE INDEX IF NOT EXISTS idx_website_submissions_notification
  ON website_submissions(notification_status, created_at);
