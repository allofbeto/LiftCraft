CREATE TABLE folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{"exercises":[]}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_folders_user ON folders(user_id);
CREATE INDEX idx_workouts_user ON workouts(user_id);
