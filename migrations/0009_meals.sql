-- One logged food per row. Nutrition is a snapshot of the amount eaten, so later
-- changes in Open Food Facts never rewrite history. day is the user's local YYYY-MM-DD.
CREATE TABLE meal_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  meal TEXT NOT NULL,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  grams REAL,
  kcal REAL NOT NULL,
  protein REAL,
  carbs REAL,
  fat REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_meal_items_user_day ON meal_items(user_id, day);
