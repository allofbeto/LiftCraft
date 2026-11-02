-- Goals now cover the body as well as nutrition. NULL means no goal for that value.
ALTER TABLE nutrition_goals RENAME TO user_goals;
ALTER TABLE user_goals ADD COLUMN carbs REAL;
ALTER TABLE user_goals ADD COLUMN fat REAL;
ALTER TABLE user_goals ADD COLUMN weight REAL;
ALTER TABLE user_goals ADD COLUMN weight_unit TEXT NOT NULL DEFAULT 'lb';
ALTER TABLE user_goals ADD COLUMN body_fat REAL;

-- One entry per calendar day (the user's local date, YYYY-MM-DD). Weight keeps the unit it was entered in.
CREATE TABLE body_logs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  weight REAL,
  unit TEXT NOT NULL DEFAULT 'lb',
  body_fat REAL,
  PRIMARY KEY (user_id, day)
);
