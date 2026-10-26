-- User-defined ordering for folders and exercises within their sibling group.
ALTER TABLE folders ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exercises ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
