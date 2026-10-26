-- Folder -> Exercise -> Entry. Replaces the earlier workouts table.
DROP TABLE workouts;

CREATE TABLE exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reps INTEGER NOT NULL,
  weight REAL,
  unit TEXT NOT NULL DEFAULT 'lb',
  logged_at TEXT NOT NULL
);

CREATE INDEX idx_exercises_user ON exercises(user_id);
CREATE INDEX idx_entries_exercise ON entries(exercise_id, logged_at);
