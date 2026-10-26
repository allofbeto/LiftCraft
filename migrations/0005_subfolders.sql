-- Folders can now nest inside other folders. NULL parent = top-level (parent) folder.
ALTER TABLE folders ADD COLUMN parent_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX idx_folders_parent ON folders(parent_id);
