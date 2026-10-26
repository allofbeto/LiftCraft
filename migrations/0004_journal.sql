ALTER TABLE exercises ADD COLUMN equipment TEXT NOT NULL DEFAULT '';
ALTER TABLE exercises ADD COLUMN muscle TEXT NOT NULL DEFAULT '';

-- One free-text note per exercise per calendar day (day is the user's local date, YYYY-MM-DD).
CREATE TABLE day_notes (
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  note TEXT NOT NULL,
  PRIMARY KEY (exercise_id, day)
);
