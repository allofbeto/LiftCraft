-- What the user actually entered ("2" + "large"), alongside the grams it converts to.
-- source says which database code belongs to: 'off' (barcode) or 'usda' (FDC id).
ALTER TABLE meal_items ADD COLUMN qty REAL;
ALTER TABLE meal_items ADD COLUMN unit TEXT NOT NULL DEFAULT '';
ALTER TABLE meal_items ADD COLUMN source TEXT NOT NULL DEFAULT '';
