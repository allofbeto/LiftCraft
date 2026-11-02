// Recipes on the Meals screen: a list, an editor, and logging a recipe as a meal.
// Ingredients are chosen with the food dialog in app.js, so they search the same databases.

let recipes = null; // the list, once loaded
let recipeDraft = null; // what the editor is holding: { id, name, servings, ingredients, dirty }

const recipeEditorOpen = () => current?.view === "meals" && !!current.recipe && !!recipeDraft;

function resetRecipes() {
  recipes = null;
  recipeDraft = null;
}

const recipeServings = (v) => (Number(v) > 0 ? Number(v) : 1);

async function loadRecipes() {
  ({ recipes } = await api("recipes"));
  return recipes;
}

// Recipes offered in the food dialog. They carry one serving's nutrition, ready to log.
function recipeFoods(q = "") {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return (recipes || [])
    .filter((r) => words.every((w) => r.name.toLowerCase().includes(w)))
    .map((r) => ({ source: "recipe", recipe: r, id: String(r.id), name: r.name, brand: "", kcal: r.kcal / r.servings }));
}

/* ---------- list ---------- */

function recipeRowHtml(r) {
  const each = (v) => Math.round((v || 0) / r.servings);
  return `<div class="food-row recipe-row">
    <button class="food-main food-edit" data-go="#/meals/recipes/${r.id}" aria-label="Edit ${esc(r.name)}">
      <span class="name">${esc(r.name)}</span>
      <span class="meta">${fmtKcal(r.kcal / r.servings)} kcal · P ${each(r.protein)}g · C ${each(r.carbs)}g · F ${each(r.fat)}g a serving</span>
    </button>
    <button class="ghost recipe-log" data-act="log-recipe" data-id="${r.id}" aria-label="Log ${esc(r.name)}">Log</button>
  </div>`;
}

function drawRecipeList() {
  $("#recipe-list").innerHTML = recipes.length
    ? recipes.map(recipeRowHtml).join("")
    : emptyHero("No recipes yet. Build one from your favorite ingredients.");
}

async function renderRecipes() {
  app.innerHTML = `
    ${topbar("Meals")}
    ${mealTabs("recipes")}
    <button class="primary recipe-new" data-go="#/meals/recipes/new">+ New recipe</button>
    <div id="recipe-list">${recipes ? "" : skeletons("skel-row", 3)}</div>`;
  if (recipes) drawRecipeList();
  try {
    await loadRecipes();
    if ($("#recipe-list") && !current.recipe) drawRecipeList();
  } catch (ex) {
    if ($("#recipe-list") && !recipes) $("#recipe-list").innerHTML = `<div class="empty">${esc(ex.message)}</div>`;
  }
}

/* ---------- editor ---------- */

function recipeTotals(draft) {
  const n = recipeServings(draft.servings);
  const total = (k) => sumOf(draft.ingredients, k);
  return { n, kcal: total("kcal"), protein: total("protein"), carbs: total("carbs"), fat: total("fat") };
}

function drawRecipeTotals() {
  const t = recipeTotals(recipeDraft);
  const shares = macroShares(t);
  $("#recipe-totals").innerHTML = `
    <div class="kcal"><div class="n">${fmtKcal(t.kcal / t.n)}</div><div class="l">Calories a serving</div></div>
    <div class="macros">
      ${[["protein", "Protein", "--viz-1"], ["carbs", "Carbs", "--viz-2"], ["fat", "Fat", "--viz-3"]]
        .map(([k, label, color]) => `<div class="macro"><div class="n">${fmtGrams(t[k] / t.n)}</div><div class="l"><i class="key" style="background:var(${color})"></i>${label}</div></div>`)
        .join("")}
    </div>
    <div class="macro-bar" aria-hidden="true">
      <i style="background:var(--viz-1);flex-grow:${shares.protein}"></i><i style="background:var(--viz-2);flex-grow:${shares.carbs}"></i><i style="background:var(--viz-3);flex-grow:${shares.fat}"></i>
    </div>
    <div class="meta recipe-whole">Whole recipe: ${fmtKcal(t.kcal)} kcal</div>`;
}

function drawRecipeEditor() {
  const d = recipeDraft;
  const rows = d.ingredients
    .map((it, i) => {
      const detail = [it.brand, mealAmountText(it)].filter(Boolean).join(" · ");
      return `<div class="food-row">
        <button class="food-main food-edit" data-act="recipe-edit-ingredient" data-i="${i}" aria-label="Edit ${esc(it.name)}"><span class="name">${esc(it.name)}</span>${detail ? `<span class="meta">${esc(detail)}</span>` : ""}</button>
        <div class="food-kcal">${fmtKcal(it.kcal)}<small> kcal</small></div>
        <button class="x" data-act="recipe-remove-ingredient" data-i="${i}" aria-label="Remove ${esc(it.name)}">×</button>
      </div>`;
    })
    .join("");
  app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" data-act="recipe-back" aria-label="Back">←</button>
      <div class="title">${d.id ? "Edit recipe" : "New recipe"}</div>
      ${d.id ? `<button class="icon-btn danger" data-act="recipe-delete" aria-label="Delete recipe">🗑</button>` : ""}
    </div>
    <section class="panel details">
      <label>Name <input data-f="recipe-name" value="${esc(d.name)}" maxlength="80" autocomplete="off" placeholder="Chicken and rice bowl"></label>
      <label>Servings it makes <input data-f="recipe-servings" type="number" inputmode="decimal" min="0.1" max="1000" step="any" value="${esc(d.servings)}"></label>
    </section>
    <div class="meal-total" id="recipe-totals"></div>
    <h2 class="section">Ingredients</h2>
    ${rows}
    <button class="ghost add-food" data-act="recipe-add-ingredient">+ Add ingredient</button>
    <p class="error recipe-error" id="recipe-error" role="alert"></p>
    <button class="primary recipe-save" data-act="recipe-save">Save recipe</button>`;
  drawRecipeTotals();
}

// A draft survives leaving the screen, so a stray tap never loses typed work.
async function renderRecipeEditor(key) {
  const id = key === "new" ? null : Number(key);
  if (recipeDraft && recipeDraft.id === id) return drawRecipeEditor();
  if (id === null) {
    recipeDraft = { id: null, name: "", servings: "1", ingredients: [], dirty: false };
    drawRecipeEditor();
    $('[data-f="recipe-name"]').focus();
    return;
  }
  app.innerHTML = topbar("Edit recipe", { back: "#/meals/recipes" }) + skeletons("skel-panel", 2);
  try {
    const { recipe } = await api(`recipes/${id}`);
    if (current?.recipe !== key) return; // navigated away while loading
    recipeDraft = { id, name: recipe.name, servings: String(recipe.servings), ingredients: recipe.ingredients, dirty: false };
    drawRecipeEditor();
  } catch {
    location.hash = "#/meals/recipes";
  }
}

function onRecipeField(f, value) {
  if (f === "recipe-name") recipeDraft.name = value;
  else {
    recipeDraft.servings = value;
    drawRecipeTotals();
  }
  recipeDraft.dirty = true;
}

// Called by the food dialog in place of logging to a meal.
function saveIngredient(item, editing) {
  const num = (v) => (v === "" || v == null ? null : Number(v));
  const clean = { ...item, qty: num(item.qty), grams: num(item.grams), kcal: num(item.kcal), protein: num(item.protein), carbs: num(item.carbs), fat: num(item.fat) };
  const list = recipeDraft.ingredients;
  if (editing) list[list.indexOf(editing)] = clean;
  else list.push(clean);
  recipeDraft.dirty = true;
  $("#food").close();
  drawRecipeEditor();
}

function removeIngredient(item) {
  const list = recipeDraft.ingredients;
  list.splice(list.indexOf(item), 1);
  recipeDraft.dirty = true;
  drawRecipeEditor();
}

async function saveRecipe(btn) {
  const d = recipeDraft;
  const err = $("#recipe-error");
  err.textContent = "";
  if (!d.name.trim()) return (err.textContent = "Give the recipe a name.");
  if (!(Number(d.servings) > 0)) return (err.textContent = "Enter how many servings it makes.");
  if (!d.ingredients.length) return (err.textContent = "Add at least one ingredient.");
  btn.disabled = true;
  try {
    const body = { name: d.name, servings: Number(d.servings), ingredients: d.ingredients };
    await (d.id ? api(`recipes/${d.id}`, { method: "PUT", body }) : api("recipes", { body }));
    recipeDraft = null;
    toast("Recipe saved");
    location.hash = "#/meals/recipes";
  } catch (ex) {
    err.textContent = ex.message;
    btn.disabled = false;
  }
}

async function leaveRecipe() {
  if (recipeDraft?.dirty) {
    const yes = await askConfirm({ title: "Discard changes?", message: "What you've changed in this recipe won't be saved.", confirmLabel: "Discard" });
    if (!yes) return;
  }
  recipeDraft = null;
  location.hash = "#/meals/recipes";
}

async function deleteRecipe() {
  const yes = await askConfirm({ title: `Delete "${recipeDraft.name}"?`, message: "Meals you've already logged from it stay." });
  if (!yes) return;
  await api(`recipes/${recipeDraft.id}`, { method: "DELETE" });
  recipeDraft = null;
  toast("Recipe deleted");
  location.hash = "#/meals/recipes";
}

/* ---------- logging ---------- */

let recipeLogging = null;

function recipeLogItem(r, servings) {
  const scale = (v) => (v == null ? null : (v / r.servings) * servings);
  return {
    name: r.name,
    brand: "",
    source: "recipe",
    code: String(r.id),
    qty: servings,
    unit: "serving",
    grams: scale(r.grams),
    kcal: scale(r.kcal),
    protein: scale(r.protein),
    carbs: scale(r.carbs),
    fat: scale(r.fat),
  };
}

function drawRecipePreview() {
  const qty = Number($("#recipe-log-qty").value);
  const t = recipeLogItem(recipeLogging, qty > 0 ? qty : 0);
  $("#food-preview").innerHTML = `<strong>${fmtKcal(t.kcal)} kcal</strong><span>P ${fmtGrams(t.protein)}</span><span>C ${fmtGrams(t.carbs)}</span><span>F ${fmtGrams(t.fat)}</span>`;
}

function drawRecipeLog(r) {
  recipeLogging = r;
  foodPicked = null;
  $("#food-title").textContent = "How many servings?";
  $("#food-body").innerHTML = `
    <form id="food-recipe-log" class="food-form">
      <div class="name">${esc(r.name)}</div>
      ${mealSelect()}
      <label>Servings <input id="recipe-log-qty" type="number" inputmode="decimal" min="0.1" max="1000" step="any" value="1" required></label>
      <div id="food-preview" class="food-preview"></div>
      ${mealLogShown() ? "" : `<p class="food-note muted">Adds to today.</p>`}
      <p class="error" role="alert"></p>
      <div class="dlg-actions">
        <button type="button" data-food="${$("#food-q") ? "back" : "close"}">${$("#food-q") ? "Back" : "Cancel"}</button>
        <button class="primary" type="submit">Add</button>
      </div>
    </form>`;
  drawRecipePreview();
}

function logRecipe(id) {
  const r = recipes.find((x) => x.id === id);
  if (!r) return;
  foodEditing = null;
  foodMeal = mealForNow();
  $("#food-body").replaceChildren(); // the last dialog's search box would offer a way Back
  drawRecipeLog(r);
  $("#food").showModal();
}
