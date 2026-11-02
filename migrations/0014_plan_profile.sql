-- What the goal planner needs to estimate calories, and the plan chosen from it.
ALTER TABLE user_goals ADD COLUMN sex TEXT NOT NULL DEFAULT '';
ALTER TABLE user_goals ADD COLUMN birth_year INTEGER;
ALTER TABLE user_goals ADD COLUMN height_cm REAL;
ALTER TABLE user_goals ADD COLUMN activity TEXT NOT NULL DEFAULT '';
ALTER TABLE user_goals ADD COLUMN plan TEXT NOT NULL DEFAULT '';
ALTER TABLE user_goals ADD COLUMN pace TEXT NOT NULL DEFAULT '';
