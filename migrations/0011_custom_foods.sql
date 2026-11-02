-- One row per photo sent for reading. Holds the numbers read, never the photo.
-- Proves a custom food came from a scan, and drives the daily scan limit.
CREATE TABLE label_scans (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reading TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX idx_label_scans_user ON label_scans(user_id, created_at);

-- A food built from a scanned label. The same normalized name with the same numbers is
-- the same food, so matching scans from different users land on one row.
-- All nutrition values are per serving, as printed.
CREATE TABLE custom_foods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL,
  serving_label TEXT NOT NULL DEFAULT '',
  serving_grams REAL NOT NULL,
  kcal REAL NOT NULL,
  protein REAL NOT NULL,
  carbs REAL NOT NULL,
  fat REAL NOT NULL,
  plausible INTEGER NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (name_key, fingerprint)
);

-- Who has this food. verified = 1 means they kept the numbers exactly as read from their
-- photo; only those rows count toward going public.
CREATE TABLE custom_food_scans (
  food_id INTEGER NOT NULL REFERENCES custom_foods(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verified INTEGER NOT NULL,
  PRIMARY KEY (food_id, user_id)
);
CREATE INDEX idx_custom_food_scans_user ON custom_food_scans(user_id);

CREATE TABLE custom_food_reports (
  food_id INTEGER NOT NULL REFERENCES custom_foods(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (food_id, user_id)
);
