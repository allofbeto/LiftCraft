-- Per-item color label (one of a fixed palette, or '' for none).
ALTER TABLE folders ADD COLUMN color TEXT NOT NULL DEFAULT '';
ALTER TABLE exercises ADD COLUMN color TEXT NOT NULL DEFAULT '';
