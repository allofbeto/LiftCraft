-- Unilateral exercises log left/right reps separately.
ALTER TABLE exercises ADD COLUMN split INTEGER NOT NULL DEFAULT 0;
