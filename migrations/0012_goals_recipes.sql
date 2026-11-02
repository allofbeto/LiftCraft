-- Daily nutrition targets. NULL means no goal for that value.
CREATE TABLE nutrition_goals (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  kcal REAL,
  protein REAL
);

CREATE TABLE recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  servings REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_recipes_user ON recipes(user_id);

-- Like meal_items, nutrition is a snapshot of the amount used, so later changes
-- in the food databases never alter a saved recipe.
CREATE TABLE recipe_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  qty REAL,
  unit TEXT NOT NULL DEFAULT '',
  grams REAL,
  kcal REAL NOT NULL,
  protein REAL,
  carbs REAL,
  fat REAL
);
CREATE INDEX idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id, position);
