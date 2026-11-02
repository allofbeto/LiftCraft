const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let user = null;
let folders = [];
let exercises = [];

async function api(path, { method, body } = {}) {
  const res = await fetch(`/api/${path}`, {
    method: method || (body ? "POST" : "GET"),
    headers: { "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}

/* ---------- auth ---------- */

const forms = { signup: $("#signup-form"), login: $("#login-form") };

function selectTab(tab) {
  const signup = tab === "signup";
  forms.signup.hidden = !signup;
  forms.login.hidden = signup;
  $("#tab-signup").classList.toggle("active", signup);
  $("#tab-login").classList.toggle("active", !signup);
}
$("#tab-signup").onclick = () => selectTab("signup");
$("#tab-login").onclick = () => selectTab("login");

for (const [name, form] of Object.entries(forms)) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = form.querySelector(".error");
    const btn = form.querySelector("button.primary");
    err.textContent = "";
    btn.disabled = true;
    try {
      const { user: u } = await api(name, { body: Object.fromEntries(new FormData(form)) });
      form.reset();
      await start(u);
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });
}

async function start(u) {
  user = u;
  $("body > .card").hidden = true;
  $("#app").hidden = false;
  $("#tabbar").hidden = false;
  await loadLibrary();
  route();
}

function signedOut() {
  user = null;
  current = null;
  mealCache.clear();
  resetGoals();
  resetRecipes();
  resetBody();
  resetPlan();
  $("body > .card").hidden = false;
  $("#app").hidden = true;
  $("#tabbar").hidden = true;
}

// Bottom tab bar: Home / Meals / Add / Profile / Logout.
$("#tabbar").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-tab]");
  if (!btn) return;
  const tab = btn.dataset.tab;
  if (tab === "home") location.hash = "#/";
  else if (tab === "meals") location.hash = "#/meals";
  else if (tab === "profile") location.hash = "#/profile";
  else if (tab === "add") await addFlow().catch((ex) => toast(ex.message, { error: true }));
  else if (tab === "logout") await actions.logout();
});

function setActiveTab(view) {
  const map = { meals: "meals", profile: "profile" };
  const active = map[view] || "home"; // home, folder and exercise all live under Home
  for (const b of document.querySelectorAll("#tabbar [data-tab]"))
    b.classList.toggle("active", b.dataset.tab === active);
}

async function loadLibrary() {
  ({ folders, exercises } = await api("library"));
}

/* ---------- dialog ---------- */

function askName(title, initial = "") {
  const dlg = $("#dlg");
  $("#dlg-title").textContent = title;
  const input = $("#dlg-input");
  input.value = initial;
  return new Promise((resolve) => {
    dlg.onclose = () => resolve(dlg.returnValue === "ok" ? input.value.trim() : null);
    $("#dlg-cancel").onclick = () => dlg.close("cancel");
    dlg.showModal();
    input.focus();
    input.select();
  });
}

// Ask whether to add a Folder or an Exercise; resolves to "folder" | "exercise" | null.
function askAddType(where) {
  const dlg = $("#choose");
  $("#choose-ctx").textContent = where;
  return new Promise((resolve) => {
    dlg.onclose = () => resolve(["folder", "exercise"].includes(dlg.returnValue) ? dlg.returnValue : null);
    $("#choose-cancel").onclick = () => dlg.close("cancel");
    dlg.showModal();
  });
}

// Where a new item lands, based on the current screen. Exercises never contain anything,
// so from an exercise we add into its parent folder; from profile/home, top level.
function addContext() {
  let folderId = null;
  if (current?.view === "folder") folderId = current.id;
  else if (current?.view === "exercise") folderId = detail?.exercise?.folderId ?? null;
  const f = folders.find((x) => x.id === folderId);
  return { folderId, label: f ? f.name : "TorchRep" };
}

// The bottom-bar "Add" button: choose a type, then create it in context.
async function addFlow() {
  if (current?.view === "meals" && current.recipes && !current.recipe) return (location.hash = "#/meals/recipes/new");
  if (current?.view === "meals") return openFood();
  const type = await askAddType(addContext().label);
  if (type === "folder") await actions["new-folder"]();
  else if (type === "exercise") await actions["new-exercise"]();
}

// Color picker: resolves to a palette hex, "" (none), or null (cancelled).
function pickColor(current) {
  const dlg = $("#colors");
  const grid = $("#color-grid");
  grid.innerHTML =
    PALETTE.map((c) => `<button type="button" class="color-opt ${c === current ? "sel" : ""}" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join("") +
    `<button type="button" class="color-opt none ${!current ? "sel" : ""}" data-color="" aria-label="No color">∅</button>`;
  return new Promise((resolve) => {
    const done = (val) => {
      grid.onclick = null;
      $("#colors-cancel").onclick = null;
      dlg.close();
      resolve(val);
    };
    grid.onclick = (e) => {
      const b = e.target.closest("[data-color]");
      if (b) done(b.dataset.color);
    };
    $("#colors-cancel").onclick = () => done(null);
    dlg.showModal();
  });
}

/* ---------- formatting ---------- */

const pad = (n) => String(n).padStart(2, "0");
const localKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // user's local calendar day
const keyToDate = (k) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const fmtDay = (d) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

// Compact "last touched" label for a YYYY-MM-DD day.
function fmtShort(day) {
  if (!day) return "";
  const today = localKey(new Date());
  if (day === today) return "Today";
  if (day === localKey(new Date(Date.now() - 864e5))) return "Yesterday";
  const opts = day.slice(0, 4) === today.slice(0, 4) ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" };
  return keyToDate(day).toLocaleDateString("en-US", opts);
}
const touched = (day) => (day ? fmtShort(day) : `<span class="muted">No activity</span>`);

// Label palette (kept in sync with COLORS in src/index.js).
const PALETTE = ["#ef4444", "#f97316", "#f59e0b", "#22c55e", "#14b8a6", "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#94a3b8"];
const swatch = (kind, color) =>
  `<span class="swatch ${kind}" data-swatch${color ? ` style="background:${color}"` : ""}></span>`;

/* ---------- views ---------- */

const app = $("#app");
let current = null; // { view, id }
let detail = null; // { exercise, entries, notes } for the open exercise
let selDay = null; // selected calendar day, YYYY-MM-DD
let weekStart = null; // Sunday of the week shown in the carousel (local Date)
let unit = "lb";
let lastWeight = ""; // last weight entered, carried into the next set this session
let detailsOpen = false;

const topbar = (title, { back, right = "" } = {}) => `
  <div class="topbar">
    ${back ? `<button class="icon-btn" data-go="${back}" aria-label="Back">←</button>` : ""}
    <div class="title">${title}</div>
    ${right}
  </div>`;

const grip = `<span class="grip" aria-label="Drag to reorder" title="Drag to reorder">⠿</span>`;

const exerciseItem = (x) => `
  <div class="item" data-id="${x.id}" data-kind="exercise">
    <button class="item-main" data-go="#/exercise/${x.id}">
      ${swatch("exercise", x.color)}<span class="name">${esc(x.name)}</span>
      <span class="meta">${touched(x.lastDay)}</span>
    </button>
    <button class="stats-link" data-go="#/exercise/${x.id}/stats" aria-label="Stats for ${esc(x.name)}" title="Stats">${CHART_ICON}</button>${grip}
  </div>`;

// The most recent activity across a folder's whole subtree (its exercises and any nested folders').
function folderLastDay(fid) {
  const ids = new Set([fid]);
  for (let added = true; added; ) {
    added = false;
    for (const f of folders) {
      if (f.parentId != null && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        added = true;
      }
    }
  }
  let max = null;
  for (const x of exercises) if (ids.has(x.folderId) && x.lastDay && (!max || x.lastDay > max)) max = x.lastDay;
  return max;
}

const folderItem = (f) => `
  <div class="item" data-id="${f.id}" data-kind="folder">
    <button class="item-main" data-go="#/folder/${f.id}">
      ${swatch("folder", f.color)}<span class="name">${esc(f.name)}</span>
      <span class="meta">${touched(folderLastDay(f.id))}</span></button>${grip}
  </div>`;

function renderHome() {
  const topFolders = folders.filter((f) => f.parentId == null);
  const unfiled = exercises.filter((x) => x.folderId == null);
  app.innerHTML = `
    ${topbar(`<span class="brand-bar"><img src="/brand/mascot.png" width="253" height="224" alt=""><img class="on-dark" src="/brand/wordmark.png" width="427" height="132" alt="TorchRep"><img class="on-light" src="/brand/wordmark-light.png" width="491" height="156" alt="TorchRep"></span>`)}
    <p class="muted" style="margin:0">Hi ${esc(user.firstName)} 👋</p>
    <h2 class="section">Folders</h2>
    <div class="list" data-reorder="folders">${topFolders.length ? topFolders.map(folderItem).join("") : `<div class="empty">No folders yet</div>`}</div>
    <h2 class="section">Exercises</h2>
    <div class="list" data-reorder="exercises">${unfiled.length ? unfiled.map(exerciseItem).join("") : topFolders.length ? `<div class="empty">No loose exercises</div>` : emptyHero("Let's get to work. Add your first exercise to start logging.")}</div>
    <div class="actions">
      <button class="ghost" data-act="new-folder">+ Folder</button>
      <button class="primary" data-act="new-exercise">+ Exercise</button>
    </div>`;
}

function renderFolder(id) {
  const f = folders.find((x) => x.id === id);
  if (!f) return (location.hash = "#/");
  const subs = folders.filter((c) => c.parentId === id);
  const list = exercises.filter((x) => x.folderId === id);
  const back = f.parentId != null ? `#/folder/${f.parentId}` : "#/";
  app.innerHTML = `
    ${topbar(esc(f.name), {
      back,
      right: `<button class="icon-btn" data-act="rename-folder" aria-label="Rename">✏️</button>
              <button class="icon-btn danger" data-act="delete-folder" aria-label="Delete">🗑</button>`,
    })}
    <div class="dropout" data-dropout="${f.parentId != null ? f.parentId : ""}">⬆ Move out to ${f.parentId != null ? esc(folders.find((p) => p.id === f.parentId)?.name || "parent") : "Home"}</div>
    ${subs.length ? `<h2 class="section">Folders</h2><div class="list" data-reorder="folders">${subs.map(folderItem).join("")}</div>` : ""}
    <h2 class="section">Exercises</h2>
    <div class="list" data-reorder="exercises">${list.length ? list.map(exerciseItem).join("") : (subs.length ? `<div class="empty">No exercises in this folder</div>` : emptyHero("This folder is empty. Add an exercise to fill it."))}</div>
    <div class="actions">
      <button class="ghost" data-act="new-folder">+ Folder</button>
      <button class="primary" data-act="new-exercise">+ Exercise</button>
    </div>`;
}

// Training stats shown on the Profile screen.
async function progressHtml() {
  let data;
  try {
    data = await api("progress");
  } catch {
    data = { days: [], exerciseCount: 0 };
  }
  const days = data.days; // distinct YYYY-MM-DD, newest first
  const daySet = new Set(days);

  // Current streak: consecutive days ending today (today may be empty if not logged yet).
  let streak = 0;
  const cursor = new Date();
  if (!daySet.has(localKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (daySet.has(localKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  const thisMonth = days.filter((d) => d.startsWith(localKey(new Date()).slice(0, 7))).length;

  const active = exercises
    .filter((x) => x.lastDay)
    .sort((a, b) => b.lastDay.localeCompare(a.lastDay));

  const stat = (n, l) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`;

  return `
    <h2 class="section">Progress</h2>
    <div class="stats">
      ${stat(days.length, "Days trained")}
      ${stat(`${streak}🔥`, "Current streak")}
      ${stat(data.exerciseCount, "Exercises")}
      ${stat(thisMonth, "This month")}
    </div>
    <h2 class="section">Recent activity</h2>
    ${
      active.length
        ? active
            .map(
              (x) => `<button class="act" data-go="#/exercise/${x.id}">
                <span class="emoji">🏋️</span>
                <span class="name">${esc(x.name)}</span>
                <span class="meta">${x.dayCount} day${x.dayCount === 1 ? "" : "s"}<br>${fmtDay(keyToDate(x.lastDay))}</span>
              </button>`,
            )
            .join("")
        : `${emptyHero("Log a set to start tracking your progress.")}`
    }
    <h2 class="section">Brain breaks</h2>
    <div class="stats">
      ${stat(sudokuStats.completed, "Puzzles solved")}
      ${stat(fmtDuration(sudokuStats.timeMs), "Time spent")}
    </div>`;
}

async function renderProfile() {
  const initials = ((user.firstName[0] || "") + (user.lastName[0] || "")).toUpperCase();
  app.innerHTML = `
    ${topbar("Profile")}
    <div class="avatar">${esc(initials)}</div>
    <div class="prof-card">
      <div class="prof-row"><span class="k">Name</span><span class="v">${esc(user.firstName)} ${esc(user.lastName)}</span></div>
      <div class="prof-row"><span class="k">Email</span><span class="v">${esc(user.email)}</span></div>
      <div class="prof-row"><span class="k">Folders</span><span class="v">${folders.length}</span></div>
    </div>
    <div id="profile-body"><h2 class="section">Body</h2><div class="stats">${`<span class="skel skel-stat"></span>`.repeat(2)}</div></div>
    <h2 class="section">Appearance</h2>
    <div class="tabs theme-picker" role="radiogroup" aria-label="Appearance">
      ${["auto", "light", "dark"]
        .map((c) => `<button role="radio" data-act="set-theme" data-choice="${c}" aria-checked="${c === themeChoice()}" class="${c === themeChoice() ? "active" : ""}">${c[0].toUpperCase() + c.slice(1)}</button>`)
        .join("")}
    </div>
    <div id="profile-progress"><h2 class="section">Progress</h2><div class="stats">${`<span class="skel skel-stat"></span>`.repeat(4)}</div></div>
    <div class="actions" style="grid-template-columns:1fr; margin-top:16px">
      <button class="ghost" data-act="logout">Log out</button>
    </div>
    <p class="food-credit muted">Food data from <a href="https://fdc.nal.usda.gov" target="_blank" rel="noopener">USDA FoodData Central</a> and <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a>.</p>`;
  const [html] = await Promise.all([progressHtml(), loadBody()]);
  if (current?.view !== "profile" || !$("#profile-progress")) return; // navigated away while loading
  $("#profile-progress").innerHTML = html;
  animateIn($("#profile-progress"));
}

async function renderExercise(id) {
  // Moving between an exercise's log and its stats keeps the day being viewed.
  if (keepExercise && detail?.exercise?.id === id) return current.stats ? drawExerciseStats() : drawExercise();
  app.innerHTML = topbar("", { back: "#/" }) + `<span class="skel skel-panel"></span>`.repeat(3);
  const started = performance.now();
  try {
    detail = await api(`exercises/${id}`);
  } catch {
    return (location.hash = "#/");
  }
  if (current?.view !== "exercise" || current.id !== id) return; // navigated away while loading
  const now = new Date();
  selDay = localKey(now);
  weekStart = startOfWeek(now);
  detailsOpen = false;
  unit = "lb";
  lastWeight = "";
  if (current.stats) drawExerciseStats();
  else drawExercise();
  if (performance.now() - started > 200) animateIn(app); // it replaced visible placeholders
}

function startOfWeek(d) {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  s.setDate(s.getDate() - s.getDay()); // back up to Sunday
  return s;
}

const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function lastEntryLabel(recorded) {
  const last = [...recorded].sort().pop(); // keys are YYYY-MM-DD, so lexical sort = chronological
  return last
    ? `<button class="link last-entry" data-act="go-last" data-day="${last}"><i class="dot"></i> Last entry ${fmtDay(keyToDate(last))}</button>`
    : `<span><i class="dot"></i> No entries yet</span>`;
}

function calendarHtml(recorded) {
  const today = localKey(new Date());
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    days.push(d);
  }
  const cells = days
    .map((d, i) => {
      const key = localKey(d);
      const cls = ["wday", key === selDay && "sel", key === today && "today"].filter(Boolean).join(" ");
      return `<button class="${cls}" data-act="pick-day" data-day="${key}" aria-label="${fmtDay(d)}">
        <span class="wdow">${DOW[i]}</span><span class="wnum">${d.getDate()}</span>
        <i class="wdot ${recorded.has(key) ? "on" : ""}"></i></button>`;
    })
    .join("");
  const first = days[0], last = days[6];
  const sameMonth = first.getMonth() === last.getMonth();
  const title =
    `${first.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ` +
    `${last.toLocaleDateString("en-US", sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })}`;
  return `
    <section class="panel cal">
      <div class="cal-head">
        <button class="icon-btn" data-act="week" data-d="-1" aria-label="Previous week">‹</button>
        <strong>${title}</strong>
        <button class="icon-btn" data-act="week" data-d="1" aria-label="Next week">›</button>
      </div>
      <div class="week-grid">${cells}</div>
      <div class="cal-foot">${lastEntryLabel(recorded)}<button class="link" data-act="today">Today</button></div>
    </section>`;
}

const SAVE_ICON = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
// Split-pane glyph: one box divided down the middle, for logging left/right reps.
const SPLIT_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`;
// Brain glyph: two hemispheres, for the Sudoku brain break.
const CHART_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M21 20H3"/></svg>`;
const BRAIN_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5a2.5 2.5 0 0 0-5 0 2.5 2.5 0 0 0-2 4 2.5 2.5 0 0 0 .5 4.5A2.5 2.5 0 0 0 7 18a2.5 2.5 0 0 0 5 0z"/><path d="M12 5a2.5 2.5 0 0 1 5 0 2.5 2.5 0 0 1 2 4 2.5 2.5 0 0 1-.5 4.5A2.5 2.5 0 0 1 17 18a2.5 2.5 0 0 1-5 0z"/></svg>`;

function drawExercise() {
  const y = window.scrollY;
  const { exercise: x, notes } = detail;
  const back = x.folderId != null ? `#/folder/${x.folderId}` : "#/";
  // Days are "recorded" when they hold any journal text (sets are logged into the notes).
  const recorded = new Set(Object.keys(notes).filter((k) => (notes[k] || "").trim()));
  const sub = [x.equipment, x.muscle].filter(Boolean).join(" · ");
  const unitLabel = unit === "lb" ? "Lb" : "Kg";

  app.innerHTML = `
    ${topbar("", {
      back,
      right: `<button class="icon-btn" data-go="#/exercise/${x.id}/stats" aria-label="Stats" title="Stats">${CHART_ICON}</button>
              <button class="icon-btn" data-act="open-sudoku" aria-label="Brain break" title="Brain break">${BRAIN_ICON}</button>
              <button class="icon-btn${x.split ? " on" : ""}" data-act="toggle-split" aria-pressed="${x.split ? "true" : "false"}" aria-label="${x.split ? "Stop logging left and right separately" : "Split into left and right"}" title="Left / right split">${SPLIT_ICON}</button>
              <button class="icon-btn" data-act="toggle-details" aria-label="Edit details">✏️</button>
              <button class="icon-btn danger" data-act="delete-exercise" aria-label="Delete exercise">🗑</button>`,
    })}
    <header class="hdr">
      <div class="eyebrow">Exercise Journal</div>
      <h1 id="hdr-name">${esc(x.name)}</h1>
      <div class="sub" id="hdr-sub" ${sub ? "" : "hidden"}>${esc(sub)}</div>
    </header>

    <section class="panel details" ${detailsOpen ? "" : "hidden"}>
      <label>Name <input data-f="exname" value="${esc(x.name)}" maxlength="80"></label>
      <div class="row">
        <label>Equipment <input data-f="equipment" value="${esc(x.equipment)}" maxlength="80" placeholder="Barbell"></label>
        <label>Muscle group <input data-f="muscle" value="${esc(x.muscle)}" maxlength="80" placeholder="Chest"></label>
      </div>
      <label>Folder
        <select data-f="folder">
          <option value="">None</option>
          ${folders.map((f) => `<option value="${f.id}" ${f.id === x.folderId ? "selected" : ""}>${esc(f.name)}</option>`).join("")}
        </select>
      </label>
    </section>

    ${calendarHtml(recorded)}

    <section class="panel">
      <h2 class="day-title">${fmtDay(keyToDate(selDay))}</h2>
      <form id="log-form" novalidate>
        <div class="log-row">
          <div class="fld"><div class="lbl">Weight (<button type="button" class="unit-btn" data-act="toggle-unit">${unitLabel}</button>)</div>
            <input class="big" name="weight" type="number" inputmode="decimal" min="0" step="any" aria-label="Weight" placeholder="${esc(lastWeight)}"></div>
          ${x.split
            ? `<div class="fld"><div class="lbl">Left</div>
                 <input class="big" name="repsL" type="number" inputmode="numeric" min="0" step="1" aria-label="Left reps" placeholder="0"></div>
               <div class="fld"><div class="lbl">Right</div>
                 <input class="big" name="repsR" type="number" inputmode="numeric" min="0" step="1" aria-label="Right reps" placeholder="0"></div>`
            : `<div class="fld"><div class="lbl">Reps</div>
                 <input class="big" name="reps" type="number" inputmode="numeric" min="0" step="1" aria-label="Reps" placeholder="0"></div>`}
          <button class="save-btn" type="submit" aria-label="Save set">${SAVE_ICON}</button>
        </div>
        <p class="error" role="alert"></p>
      </form>
    </section>

    <section class="panel">
      <div class="notes-head"><h2>Workout Notes</h2><span id="note-status" class="muted">Ready</span></div>
      <div class="notes-box">
        <div class="eyebrow">Personal notes</div>
        <textarea data-f="note" rows="5" maxlength="5000" placeholder="Add notes about your workout...">${esc(notes[selDay] || "")}</textarea>
      </div>
    </section>`;
  window.scrollTo(0, y);
  playExerciseMotion();
}

// What the next exercise redraw should animate: "day", "details", or a week step of -1 or 1.
let exerciseMotion = null;

function playExerciseMotion() {
  const motion = exerciseMotion;
  exerciseMotion = null;
  if (!motion || !motionOK()) return;
  if (typeof motion === "number") {
    $(".week-grid")?.animate([{ opacity: 0, transform: `translateX(${motion * 32}px)` }, { opacity: 1, transform: "none" }], { duration: 220, easing: EASE_OUT });
    return;
  }
  if (motion === "details") {
    $(".panel.details")?.animate([{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: EASE_OUT });
    return;
  }
  $(".wday.sel")?.classList.add("pop");
  for (const el of document.querySelectorAll(".day-title, .notes-box")) el.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 200, easing: EASE_OUT });
}

// Eases in content that replaced something already on screen.
function animateIn(el) {
  el.classList.remove("content-in");
  void el.offsetWidth;
  el.classList.add("content-in");
}

/* ---------- routing ---------- */

const TAB_ORDER = { home: 0, meals: 1, profile: 2 };

// Which way a move between screens should slide: deeper or rightward goes forward.
function navDirection(from, to) {
  if (!from) return "fade";
  const place = ({ view, id, stats, recipes, recipe }) => {
    if (view === "meals" || view === "profile") return [TAB_ORDER[view], recipe ? 3 : recipes ? 2 : stats ? 1 : 0];
    if (view === "plan") return [TAB_ORDER.profile, 10 + (id || 0)];
    if (view === "exercise") return [0, stats ? 101 : 100];
    if (view === "folder") {
      let depth = 1;
      for (let f = folders.find((x) => x.id === id); f?.parentId != null; f = folders.find((x) => x.id === f.parentId)) depth++;
      return [0, depth];
    }
    return [0, 0];
  };
  const [tabA, depthA] = place(from);
  const [tabB, depthB] = place(to);
  if (tabA !== tabB) return tabB > tabA ? "forward" : "back";
  if (depthA !== depthB) return depthB > depthA ? "forward" : "back";
  return "fade";
}

let keepExercise = false;

function renderView({ view, id }) {
  if (view === "folder") return renderFolder(id);
  if (view === "exercise") return renderExercise(id);
  if (view === "plan") return renderPlan(id);
  if (view === "meals") {
    if (current.recipe) return renderRecipeEditor(current.recipe);
    if (current.recipes) return renderRecipes();
    return current.stats ? renderMealStats() : renderMeals();
  }
  if (view === "profile") return renderProfile();
  return renderHome();
}

function route() {
  if (!user) return;
  flushNote();
  flushExercise();
  const [, view, rawId, sub] = location.hash.split("/");
  if (view === "progress") return location.replace("#/profile"); // Progress now lives on Profile
  const id = Number(rawId);
  const from = current;
  const recipes = view === "meals" && rawId === "recipes";
  current = { view, id, stats: rawId === "stats" || sub === "stats", recipes, recipe: recipes ? sub || null : null };
  keepExercise = from?.view === "exercise" && view === "exercise" && from.id === id;
  const to = current;
  setActiveTab(view);
  $("#tabbar").hidden = view === "plan"; // the planner has the whole screen
  const paint = () => {
    const rendered = renderView(to);
    window.scrollTo(0, 0);
    markViewIn(app);
    return rendered;
  };
  // Hold the old screen briefly so fast loads swap straight to finished content, never longer.
  viewTransition(() => (current === to ? Promise.race([paint(), sleep(220)]) : undefined), navDirection(from, to));
}
window.addEventListener("hashchange", route);

/* ---------- events ---------- */

// Debounced save of exercise details (name, equipment, muscle, folder).
let exTimer = null;
let pendingEx = null;

function saveExercise() {
  pendingEx = { ...detail.exercise };
  clearTimeout(exTimer);
  exTimer = setTimeout(flushExercise, 500);
}

async function flushExercise() {
  clearTimeout(exTimer);
  const x = pendingEx;
  if (!x || !x.name.trim()) return;
  pendingEx = null;
  await api(`exercises/${x.id}`, { method: "PUT", body: x }).catch(() => {});
  const row = exercises.find((e) => e.id === x.id);
  if (row) Object.assign(row, { name: x.name, folderId: x.folderId });
}

// Debounced save of the selected day's note.
let noteTimer = null;
let pendingNote = null;

function setNoteStatus(t) {
  const el = $("#note-status");
  if (el) el.textContent = t;
}

function onNote(text) {
  if (text.trim()) detail.notes[selDay] = text;
  else delete detail.notes[selDay];
  syncCounts(); // keep the home/folder day counts current as notes change
  pendingNote = { id: detail.exercise.id, day: selDay, text };
  setNoteStatus("Saving…");
  clearTimeout(noteTimer);
  noteTimer = setTimeout(flushNote, 700);
}

async function flushNote() {
  clearTimeout(noteTimer);
  const p = pendingNote;
  if (!p) return;
  pendingNote = null;
  try {
    await api(`exercises/${p.id}/notes/${p.day}`, { method: "PUT", body: { note: p.text } });
    setNoteStatus("Saved");
  } catch {
    pendingNote = pendingNote || p;
    setNoteStatus("Offline");
  }
}

window.addEventListener("pagehide", () => {
  flushNote();
  flushExercise();
  sudokuAccrue(); // bank brain-break time if the modal is open when leaving
});

app.addEventListener("input", (e) => {
  const f = e.target.dataset.f;
  if (f === "note") return onNote(e.target.value);
  if (f === "recipe-name" || f === "recipe-servings") return onRecipeField(f, e.target.value);
  if (!["exname", "equipment", "muscle"].includes(f)) return;
  const x = detail.exercise;
  x[f === "exname" ? "name" : f] = e.target.value;
  $("#hdr-name").textContent = x.name;
  const sub = [x.equipment, x.muscle].filter(Boolean).join(" · ");
  $("#hdr-sub").textContent = sub;
  $("#hdr-sub").hidden = !sub;
  saveExercise();
});

app.addEventListener("change", (e) => {
  // `change` on an input only fires when its value was modified since focus,
  // so this is exactly "reps box touched, then clicked/tabbed out" → log it.
  if (e.target.name === "reps" || e.target.name === "repsR") return commitSet(false);
  if (e.target.dataset.f === "folder") {
    const v = e.target.value;
    detail.exercise.folderId = v === "" ? null : Number(v);
    $(".topbar [data-go]").dataset.go = v === "" ? "#/" : `#/folder/${v}`;
    saveExercise();
  }
});

// Logging a set happens on Enter, on the button, or when the reps box loses focus
// after being touched. One guarded path serves all three so nothing double-logs.
let committing = false;

async function commitSet(explicit) {
  if (committing) return;
  const form = $("#log-form");
  if (!form) return;
  const err = form.querySelector(".error");
  const split = detail.exercise.split;
  // Empty weight falls back to the last entered weight (shown as the ghost placeholder).
  const weight = form.weight.value.trim() || lastWeight;
  err.textContent = "";

  // Reps: one field normally, separate left/right when the exercise is split.
  const whole = (v) => /^\d+$/.test(v);
  let repsPart;
  if (split) {
    const l = form.repsL.value.trim();
    const r = form.repsR.value.trim();
    if (l === "" && r === "") {
      if (explicit) err.textContent = "Enter left and right reps.";
      return; // blur with nothing typed: stay quiet
    }
    if (!whole(l) || !whole(r)) {
      if (explicit) err.textContent = "Reps must be whole numbers.";
      return;
    }
    repsPart = `L ${l} / R ${r}`;
  } else {
    const reps = form.reps.value.trim();
    if (reps === "") {
      if (explicit) err.textContent = "Enter the number of reps.";
      return; // blur with nothing typed: stay quiet
    }
    if (!whole(reps)) {
      if (explicit) err.textContent = "Reps must be a whole number.";
      return;
    }
    repsPart = reps;
  }
  committing = true;
  lastWeight = weight; // carry the weight into the next set

  // The captured set lives only in the day's Workout Notes, as one appended line.
  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
  const set = weight !== "" ? `${weight} ${unit} × ${repsPart}` : `Bodyweight × ${repsPart}`;
  const line = `${time} · ${set}`;
  const existing = (detail.notes[selDay] || "").replace(/\s+$/, "");
  const updated = existing ? `${existing}\n${line}` : line;

  // Cancel any pending free-text note save so it can't overwrite this append.
  clearTimeout(noteTimer);
  pendingNote = null;
  try {
    await api(`exercises/${detail.exercise.id}/notes/${selDay}`, { method: "PUT", body: { note: updated } });
    detail.notes[selDay] = updated;
    syncCounts();
    drawExercise();
    $(".notes-box")?.classList.add("flash");
    $(".save-btn")?.classList.add("logged");
    burstFrom($(".save-btn"));
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    committing = false;
  }
}

app.addEventListener("submit", (e) => {
  if (e.target.id !== "log-form") return;
  e.preventDefault();
  commitSet(true);
});

// Keep the list screens' counts in step with the open exercise.
function syncCounts() {
  const row = exercises.find((x) => x.id === detail.exercise.id);
  if (row) {
    const days = Object.keys(detail.notes).filter((k) => (detail.notes[k] || "").trim()).sort();
    row.dayCount = days.length;
    row.lastDay = days.at(-1) || null;
  }
}

const actions = {
  async logout() {
    await api("logout", { method: "POST", body: {} });
    folders = exercises = [];
    location.hash = "";
    signedOut();
  },
  async "new-folder"() {
    const ctx = addContext(); // nests under the current folder, else top-level (parent)
    const name = await askName("New folder");
    if (!name) return;
    const { folder } = await api("folders", { body: { name, parentId: ctx.folderId } });
    folders.push(folder);
    folders.sort((a, b) => a.name.localeCompare(b.name));
    if (current.view === "folder") renderFolder(current.id);
    else if (!current.view) renderHome();
    else location.hash = "#/"; // from profile, show the new top-level folder on Home
  },
  async "rename-folder"() {
    const f = folders.find((x) => x.id === current.id);
    const name = await askName("Rename folder", f.name);
    if (!name) return;
    await api(`folders/${f.id}`, { method: "PUT", body: { name } });
    f.name = name;
    renderFolder(f.id);
  },
  async "delete-folder"() {
    const f = folders.find((x) => x.id === current.id);
    if (!(await askConfirm({ title: `Delete "${f.name}"?`, message: "Its contents will be kept." }))) return;
    await api(`folders/${f.id}`, { method: "DELETE" });
    const parent = f.parentId ?? null; // contents move up to this folder's parent
    exercises.forEach((x) => x.folderId === f.id && (x.folderId = parent));
    folders.forEach((c) => c.parentId === f.id && (c.parentId = parent));
    folders = folders.filter((x) => x.id !== f.id);
    location.hash = parent != null ? `#/folder/${parent}` : "#/";
  },
  async "new-exercise"() {
    const ctx = addContext(); // into the current folder, else unfiled
    const name = await askName("New exercise");
    if (!name) return;
    const { exercise } = await api("exercises", { body: { name, folderId: ctx.folderId } });
    exercises.push(exercise);
    location.hash = `#/exercise/${exercise.id}`;
  },
  async "delete-exercise"() {
    const x = detail.exercise;
    if (!(await askConfirm({ title: `Delete "${x.name}"?`, message: "Everything logged on it will be deleted too. This can't be undone." }))) return;
    await api(`exercises/${x.id}`, { method: "DELETE" });
    exercises = exercises.filter((e) => e.id !== x.id);
    location.hash = x.folderId != null ? `#/folder/${x.folderId}` : "#/";
  },
  "pick-day"(d) {
    flushNote();
    selDay = d.day;
    exerciseMotion = "day";
    drawExercise();
  },
  "go-last"(d) {
    flushNote();
    selDay = d.day;
    weekStart = startOfWeek(keyToDate(d.day)); // jump the calendar to the week holding that entry
    exerciseMotion = "day";
    drawExercise();
  },
  week(d) {
    changeWeek(Number(d.d));
  },
  today() {
    flushNote();
    const now = new Date();
    selDay = localKey(now);
    weekStart = startOfWeek(now);
    exerciseMotion = "day";
    drawExercise();
  },
  "toggle-unit"(d, btn) {
    unit = unit === "lb" ? "kg" : "lb";
    btn.textContent = unit === "lb" ? "Lb" : "Kg";
  },
  "toggle-details"() {
    detailsOpen = !detailsOpen;
    if (detailsOpen) exerciseMotion = "details";
    drawExercise();
  },
  "toggle-split"() {
    detail.exercise.split = !detail.exercise.split;
    saveExercise(); // persist the unilateral setting on the exercise
    drawExercise();
  },
  "set-theme"(d) {
    viewTransition(() => setThemeChoice(d.choice), "fade");
    for (const b of document.querySelectorAll(".theme-picker button")) {
      const on = b.dataset.choice === d.choice;
      b.classList.toggle("active", on);
      b.setAttribute("aria-checked", on);
    }
  },
  "open-sudoku"() {
    openSudoku();
  },
  "meal-range"(d) {
    return setMealStatsRange(Number(d.days));
  },
  "exercise-range"(d) {
    setExerciseStatsRange(Number(d.days));
  },
};

app.addEventListener("click", async (e) => {
  if (suppressClick || swipeSuppress || e.target.closest(".grip")) return; // a drag/swipe just happened, or the grip was tapped
  const sw = e.target.closest("[data-swatch]");
  if (sw) {
    const itemEl = sw.closest(".item");
    const type = itemEl.dataset.kind === "folder" ? "folders" : "exercises";
    const id = Number(itemEl.dataset.id);
    const arr = type === "folders" ? folders : exercises;
    const row = arr.find((r) => r.id === id);
    const color = await pickColor(row?.color || "");
    if (color === null) return;
    if (row) row.color = color;
    sw.style.background = color || "";
    api("color", { body: { type, id, color } }).catch(() => {});
    return;
  }
  const go = e.target.closest("[data-go]");
  if (go) {
    location.hash = go.dataset.go;
    return;
  }
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  try {
    await actions[btn.dataset.act]?.(btn.dataset, btn);
  } catch (ex) {
    toast(ex.message, { error: true });
  }
});

/* ---------- drag to reorder & move ---------- */

// Drag a list item by its grip. Within a list it reorders; dropped onto a folder it moves inside;
// dropped on the "Move out" strip it moves up a level. Works for mouse and touch via pointer events.
let drag = null;
let suppressClick = false;

app.addEventListener("pointerdown", (e) => {
  const handle = e.target.closest(".grip");
  if (!handle) return;
  const item = handle.closest(".item");
  const list = handle.closest("[data-reorder]");
  if (!item || !list) return;
  e.preventDefault();
  const rect = item.getBoundingClientRect();
  drag = {
    item,
    list,
    type: list.dataset.reorder,
    kind: item.dataset.kind,
    id: Number(item.dataset.id),
    grabDy: e.clientY - rect.top,
    moved: false,
    drop: null,
  };
  try {
    item.setPointerCapture(e.pointerId);
  } catch {
    /* pointer capture not available; dragging still works via document-level fallback */
  }
  item.classList.add("dragging");
  document.body.classList.add("dragging-active"); // reveals the "Move out" strip
  document.addEventListener("pointermove", onDragMove);
  document.addEventListener("pointerup", onDragEnd, { once: true });
  document.addEventListener("pointercancel", onDragEnd, { once: true });
});

function clearDropHighlights() {
  for (const el of document.querySelectorAll(".drop-into, .drop-active")) el.classList.remove("drop-into", "drop-active");
}

// A folder is a valid "drop into" target unless you'd be putting a folder inside itself or a descendant.
function validFolderTarget(folderEl) {
  if (drag.kind !== "folder") return true;
  const targetId = Number(folderEl.dataset.id);
  const pm = Object.fromEntries(folders.map((f) => [f.id, f.parentId]));
  for (let p = targetId; p != null; p = pm[p]) if (p === drag.id) return false;
  return true;
}

function onDragMove(e) {
  if (!drag) return;
  const { item, list } = drag;
  drag.moved = true;
  item.style.transform = "";
  const baseTop = item.getBoundingClientRect().top;
  item.style.transform = `translateY(${e.clientY - drag.grabDy - baseTop}px)`;

  // What's under the pointer? (The dragged item is pointer-events:none, so it's ignored.)
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const folderEl = under?.closest('.item[data-kind="folder"]');
  const outEl = under?.closest("[data-dropout]");
  clearDropHighlights();

  if (folderEl && folderEl !== item && validFolderTarget(folderEl)) {
    drag.drop = { dest: Number(folderEl.dataset.id) };
    folderEl.classList.add("drop-into");
    return;
  }
  if (outEl) {
    drag.drop = { dest: outEl.dataset.dropout === "" ? null : Number(outEl.dataset.dropout) };
    outEl.classList.add("drop-active");
    return;
  }

  // No move target: reorder within the current list by midpoints.
  drag.drop = null;
  const mid = item.getBoundingClientRect().top + item.offsetHeight / 2;
  const prev = item.previousElementSibling;
  const next = item.nextElementSibling;
  if (prev?.classList.contains("item") && mid < prev.getBoundingClientRect().top + prev.offsetHeight / 2) {
    const top = prev.getBoundingClientRect().top;
    list.insertBefore(item, prev);
    slideFrom(prev, top);
  } else if (next?.classList.contains("item") && mid > next.getBoundingClientRect().top + next.offsetHeight / 2) {
    const top = next.getBoundingClientRect().top;
    list.insertBefore(next, item);
    slideFrom(next, top);
  }
}

async function onDragEnd() {
  if (!drag) return;
  const { item, list, moved, drop, type, id } = drag;
  document.removeEventListener("pointermove", onDragMove);
  const heldAt = item.style.transform;
  item.style.transform = "";
  if (moved && heldAt && motionOK()) item.animate([{ transform: heldAt }, { transform: "none" }], { duration: 200, easing: EASE_SPRING }); // settle into its slot
  item.classList.remove("dragging");
  document.body.classList.remove("dragging-active");
  clearDropHighlights();
  drag = null;
  if (!moved) return;
  suppressClick = true; // don't let the drag's final pointerup open the item
  setTimeout(() => (suppressClick = false), 60);

  const arr = type === "folders" ? folders : exercises;
  const row = arr.find((r) => r.id === id);

  if (drop) {
    // Move into a folder (or out to a parent / Home).
    if (row) {
      if (type === "folders") row.parentId = drop.dest;
      else row.folderId = drop.dest;
    }
    rerenderCurrent();
    try {
      await api("move", { body: { type, id, dest: drop.dest } });
    } catch {
      await reload(); // fall back to server truth if the move failed
    }
    return;
  }

  // Reorder within the list.
  const ids = [...list.querySelectorAll(".item")].map((el) => Number(el.dataset.id));
  ids.forEach((rid, i) => {
    const r = arr.find((x) => x.id === rid);
    if (r) r.position = i;
  });
  arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  try {
    await api("reorder", { body: { type, order: ids } });
  } catch {
    /* order is kept locally; it will reconcile on next load */
  }
}

function rerenderCurrent() {
  flip(app, ".item", () => {
    if (current?.view === "folder") renderFolder(current.id);
    else renderHome();
  });
}

async function reload() {
  await loadLibrary();
  rerenderCurrent();
}

/* ---------- week carousel swipe ---------- */

function changeWeek(delta) {
  weekStart = new Date(weekStart);
  weekStart.setDate(weekStart.getDate() + 7 * delta);
  exerciseMotion = delta;
  drawExercise();
}

// Swipe left/right on the week strip to move between weeks (touch and mouse).
let swipeStart = null;
let swipeSuppress = false;

app.addEventListener("pointerdown", (e) => {
  const grid = e.target.closest(".cal .week-grid");
  if (!grid) return;
  swipeStart = { x: e.clientX, y: e.clientY };
});

app.addEventListener("pointerup", (e) => {
  if (!swipeStart) return;
  const dx = e.clientX - swipeStart.x;
  const dy = e.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    changeWeek(dx < 0 ? 1 : -1); // swipe left → next week
    swipeSuppress = true; // don't let this gesture also select the day it started on
    setTimeout(() => (swipeSuppress = false), 60);
  }
});

/* ---------- Sudoku brain break ---------- */
// A 4×4 puzzle (four boxes of 2 rows × 2 columns, digits 1–4) kept in localStorage so it survives reloads; cleared and regenerated
// only when the player solves it. Pure client-side — no server involved.
// These keys keep their original name so saved puzzles and stats survive the rebrand.
const SUDOKU_KEY = "liftcraft.sudoku";
const SUDOKU_STATS_KEY = "liftcraft.sudokuStats"; // { completed, timeMs } — lifetime totals
const S_BOX_R = 2, S_BOX_C = 2; // box height and width
const S_N = S_BOX_R * S_BOX_C; // grid side length, and the highest digit
const S_CELLS = S_N * S_N;
const S_REMOVE = 10; // cells to blank out, leaving ~6 givens
let sudoku = null;
let sudokuOpenedAt = 0; // timestamp the modal was opened; 0 when closed

function sudokuLoadStats() {
  try {
    const s = JSON.parse(localStorage.getItem(SUDOKU_STATS_KEY));
    if (s && typeof s.completed === "number" && typeof s.timeMs === "number") return s;
  } catch {}
  return { completed: 0, timeMs: 0 };
}
let sudokuStats = sudokuLoadStats();
function sudokuSaveStats() { try { localStorage.setItem(SUDOKU_STATS_KEY, JSON.stringify(sudokuStats)); } catch {} }

// Fold the time open so far into the lifetime total, without stopping the clock —
// safe to call repeatedly (on solve, on close, on page hide).
function sudokuAccrue() {
  if (!sudokuOpenedAt) return;
  const now = Date.now();
  sudokuStats.timeMs += now - sudokuOpenedAt;
  sudokuOpenedAt = now;
  sudokuSaveStats();
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

const sBox = (r, c) => Math.floor(r / S_BOX_R) * S_BOX_R + Math.floor(c / S_BOX_C);

// Count solutions of a grid (array of S_CELLS ints, 0 = empty), stopping at `limit`.
function sudokuSolveCount(grid, limit) {
  const g = grid.slice();
  const rows = new Array(S_N).fill(0), cols = new Array(S_N).fill(0), box = new Array(S_N).fill(0);
  for (let i = 0; i < S_CELLS; i++) {
    const v = g[i];
    if (v) { const r = (i / S_N) | 0, c = i % S_N, m = 1 << v; rows[r] |= m; cols[c] |= m; box[sBox(r, c)] |= m; }
  }
  let count = 0;
  (function rec(pos) {
    if (count >= limit) return;
    while (pos < S_CELLS && g[pos]) pos++;
    if (pos === S_CELLS) { count++; return; }
    const r = (pos / S_N) | 0, c = pos % S_N, b = sBox(r, c), used = rows[r] | cols[c] | box[b];
    for (let v = 1; v <= S_N; v++) {
      const m = 1 << v;
      if (used & m) continue;
      g[pos] = v; rows[r] |= m; cols[c] |= m; box[b] |= m;
      rec(pos + 1);
      g[pos] = 0; rows[r] &= ~m; cols[c] &= ~m; box[b] &= ~m;
      if (count >= limit) return;
    }
  })(0);
  return count;
}

// Fill an empty grid with a random complete, valid solution.
function sudokuSolution() {
  const g = new Array(S_CELLS).fill(0);
  const rows = new Array(S_N).fill(0), cols = new Array(S_N).fill(0), box = new Array(S_N).fill(0);
  (function rec(pos) {
    while (pos < S_CELLS && g[pos]) pos++;
    if (pos === S_CELLS) return true;
    const r = (pos / S_N) | 0, c = pos % S_N, b = sBox(r, c), used = rows[r] | cols[c] | box[b];
    const nums = Array.from({ length: S_N }, (_, i) => i + 1);
    for (let i = S_N - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [nums[i], nums[j]] = [nums[j], nums[i]]; }
    for (const v of nums) {
      const m = 1 << v;
      if (used & m) continue;
      g[pos] = v; rows[r] |= m; cols[c] |= m; box[b] |= m;
      if (rec(pos + 1)) return true;
      g[pos] = 0; rows[r] &= ~m; cols[c] &= ~m; box[b] &= ~m;
    }
    return false;
  })(0);
  return g;
}

// Carve a puzzle out of a full solution, keeping the solution unique.
function sudokuNew() {
  const solution = sudokuSolution();
  const puzzle = solution.slice();
  const order = [...Array(S_CELLS).keys()];
  for (let i = S_CELLS - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; }
  let removed = 0;
  for (const idx of order) {
    if (removed >= S_REMOVE) break;
    const keep = puzzle[idx];
    puzzle[idx] = 0;
    if (sudokuSolveCount(puzzle, 2) !== 1) puzzle[idx] = keep; // not unique → put it back
    else removed++;
  }
  const p = puzzle.join("");
  return { puzzle: p, solution: solution.join(""), entries: p };
}

function sudokuSave() { try { localStorage.setItem(SUDOKU_KEY, JSON.stringify(sudoku)); } catch {} }

function sudokuLoad() {
  try {
    const s = JSON.parse(localStorage.getItem(SUDOKU_KEY));
    if (s && s.puzzle?.length === S_CELLS && s.solution?.length === S_CELLS && s.entries?.length === S_CELLS) return s; // older sizes fall through to a new puzzle
  } catch {}
  return sudokuNew();
}

function openSudoku() {
  sudoku = sudokuLoad();
  sudokuSave();
  drawSudoku();
  sudokuOpenedAt = Date.now(); // start timing the session (no visible timer)
  $("#sudoku").showModal();
}

function drawSudoku() {
  const { puzzle, entries } = sudoku;
  let html = "";
  for (let i = 0; i < S_CELLS; i++) {
    const r = (i / S_N) | 0, c = i % S_N;
    const cls = ["scell"];
    if (c % S_BOX_C === S_BOX_C - 1 && c !== S_N - 1) cls.push("br"); // thick lines between the boxes
    if (r % S_BOX_R === S_BOX_R - 1 && r !== S_N - 1) cls.push("bb");
    if (puzzle[i] !== "0") {
      html += `<div class="${cls.join(" ")}"><span class="given">${puzzle[i]}</span></div>`;
    } else {
      const v = entries[i] === "0" ? "" : entries[i];
      html += `<div class="${cls.join(" ")}"><input inputmode="numeric" maxlength="1" data-i="${i}" value="${v}" aria-label="Row ${r + 1} column ${c + 1}"></div>`;
    }
  }
  $("#sudoku-grid").innerHTML = html;
  markSudoku();
  sudokuStatus();
}

// Flag any digit that repeats within its row, column, or box.
function markSudoku() {
  const grid = $("#sudoku-grid");
  const cells = grid.querySelectorAll(".scell");
  cells.forEach((el) => el.classList.remove("bad"));
  const e = sudoku.entries, bad = new Set();
  const scan = (idxs) => {
    const seen = {};
    for (const idx of idxs) {
      const d = e[idx];
      if (d === "0") continue;
      if (seen[d] !== undefined) { bad.add(idx); bad.add(seen[d]); } else seen[d] = idx;
    }
  };
  for (let r = 0; r < S_N; r++) scan([...Array(S_N)].map((_, c) => r * S_N + c));
  for (let c = 0; c < S_N; c++) scan([...Array(S_N)].map((_, r) => r * S_N + c));
  for (let b = 0; b < S_N; b++) {
    const r0 = Math.floor(b / S_BOX_R) * S_BOX_R, c0 = (b % S_BOX_R) * S_BOX_C, idxs = [];
    for (let dr = 0; dr < S_BOX_R; dr++) for (let dc = 0; dc < S_BOX_C; dc++) idxs.push((r0 + dr) * S_N + (c0 + dc));
    scan(idxs);
  }
  bad.forEach((idx) => cells[idx]?.classList.add("bad"));
}

function sudokuStatus(msg) {
  const el = $("#sudoku-status");
  if (!el) return;
  if (msg) { el.textContent = msg; return; }
  const left = [...sudoku.entries].filter((d) => d === "0").length;
  el.textContent = left ? `${left} square${left === 1 ? "" : "s"} left` : "Checking…";
}

function onSudokuInput(e) {
  const inp = e.target.closest("input[data-i]");
  if (!inp) return;
  inp.value = inp.value.replace(/[^1-4]/g, "").slice(-1); // last typed digit, 1–4 only
  const i = Number(inp.dataset.i);
  const entries = sudoku.entries.split("");
  entries[i] = inp.value === "" ? "0" : inp.value;
  sudoku.entries = entries.join("");
  sudokuSave();
  markSudoku();
  if (sudoku.entries === sudoku.solution) sudokuSolved();
  else sudokuStatus();
}

function sudokuSolved() {
  sudokuStats.completed += 1;
  sudokuSaveStats();
  sudokuAccrue(); // bank the time up to the solve
  sudokuStatus("Solved! 🎉 Fresh puzzle coming up…");
  const grid = $("#sudoku-grid");
  grid.querySelectorAll("input").forEach((el) => (el.disabled = true));
  grid.classList.add("solved");
  burstFrom(grid);
  setTimeout(() => burstFrom(grid), 180);
  setTimeout(() => {
    grid.classList.remove("solved");
    sudoku = sudokuNew();
    sudokuSave();
    drawSudoku();
    animateIn(grid);
    sudokuStatus("New puzzle ready.");
  }, 1300);
}

$("#sudoku-grid").addEventListener("input", onSudokuInput);
$("#sudoku").addEventListener("close", () => { sudokuAccrue(); sudokuOpenedAt = 0; });
$("#sudoku-close").addEventListener("click", () => $("#sudoku").close());
$("#sudoku-new").addEventListener("click", async () => {
  if (!(await askConfirm({ title: "Start a new puzzle?", message: "Your current progress will be lost.", confirmLabel: "New puzzle" }))) return;
  sudoku = sudokuNew();
  sudokuSave();
  drawSudoku();
});

/* ---------- meal tracker ---------- */

const MEAL_NAMES = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snacks" };
let mealDay = null; // day shown on the Meals screen, YYYY-MM-DD
let mealItems = [];
let foodMeal = "breakfast"; // meal the open food dialog adds to
let foodResults = [];
let foodPicked = null;
let foodQty = "1"; // amount field, as typed
let foodUnit = "g"; // a measure label, or g / ml / oz
let foodTouched = false; // the user has changed the amount or unit
let foodQtyTyped = false; // the user has typed in the amount field
let foodEditing = null; // the logged item being edited, if any
let foodEditingCustom = null; // the scanned food being edited, if any

const fmtKcal = (n) => Math.round(n || 0).toLocaleString("en-US");
const fmtGrams = (n) => `${Math.round((n || 0) * 10) / 10}g`;
const sumOf = (items, k) => items.reduce((t, it) => t + (it[k] || 0), 0);

// The meal most people are logging at this hour, used as the dialog's default.
function mealForNow() {
  const h = new Date().getHours();
  return h < 11 ? "breakfast" : h < 15 ? "lunch" : h < 21 ? "dinner" : "snack";
}

// "2 × large (100 g)" for household units, "5 oz" for weights and volumes.
function mealAmountText(it) {
  const grams = it.grams != null ? `${it.grams} g` : "";
  if (it.qty == null || !it.unit) return grams;
  if (["g", "ml", "oz"].includes(it.unit)) return `${it.qty} ${it.unit}`;
  return `${it.qty} × ${it.unit}${grams ? ` (${grams})` : ""}`;
}

const mealCache = new Map(); // day, to the items last seen: lets visited days appear instantly
let mealVersion = 0; // bumped on local changes, so a slower fetch can't overwrite them
let mealTotalsShown = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

function setMealItems(items, day = mealDay) {
  mealVersion++;
  mealCache.set(day, items);
  if (day === mealDay) mealItems = items;
}

const skeletons = (cls, n) => `<span class="skel ${cls}"></span>`.repeat(n);
const emptyHero = (text) => `<div class="empty-hero"><img src="/brand/mascot.png" width="253" height="224" alt=""><p>${esc(text)}</p></div>`;

const mealLogShown = () => current?.view === "meals" && !current.stats && !current.recipes;

const mealTabs = (on) => `
  <div class="tabs" role="tablist">
    <button role="tab" data-go="#/meals" aria-selected="${on === "log"}" class="${on === "log" ? "active" : ""}">Log</button>
    <button role="tab" data-go="#/meals/stats" aria-selected="${on === "stats"}" class="${on === "stats" ? "active" : ""}">Stats</button>
    <button role="tab" data-go="#/meals/recipes" aria-selected="${on === "recipes"}" class="${on === "recipes" ? "active" : ""}">Recipes</button>
  </div>`;

// Each macro's share of the calories it supplies, at 4 kcal per gram of protein or carbs and 9 of fat.
function macroShares({ protein, carbs, fat }) {
  const kcal = { protein: protein * 4, carbs: carbs * 4, fat: fat * 9 };
  const total = kcal.protein + kcal.carbs + kcal.fat;
  return Object.fromEntries(Object.entries(kcal).map(([k, v]) => [k, total ? (v / total) * 100 : 0]));
}

// The header and totals stay on screen while only the list below them changes.
function ensureMealShell() {
  if ($("#meal-sections")) return;
  mealTotalsShown = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const macro = (k, label, color) => `<div class="macro"><div class="n" id="total-${k}">0g</div><div class="l"><i class="key" style="background:var(${color})"></i>${label}</div></div>`;
  app.innerHTML = `
    ${topbar("Meals")}
    ${mealTabs("log")}
    <div class="cal-head meal-day">
      <button class="icon-btn" data-act="meal-day" data-d="-1" aria-label="Previous day">‹</button>
      <strong id="meal-day-label"></strong>
      <button class="icon-btn" data-act="meal-day" data-d="1" aria-label="Next day">›</button>
    </div>
    <div class="meal-total">
      <div class="kcal"><div class="n" id="total-kcal">0</div><div class="l">Calories</div></div>
      <div class="macros">${macro("protein", "Protein", "--viz-1")}${macro("carbs", "Carbs", "--viz-2")}${macro("fat", "Fat", "--viz-3")}</div>
      <div class="macro-bar" id="macro-bar" aria-hidden="true"><i style="background:var(--viz-1)"></i><i style="background:var(--viz-2)"></i><i style="background:var(--viz-3)"></i></div>
      <div class="goals" id="meal-goals"></div>
    </div>
    <div id="meal-sections"></div>`;
}

const showMealDay = () => ($("#meal-day-label").textContent = mealDayLabel(mealDay, localKey(new Date())));

// dir is -1 or 1 when stepping between days, which slides the list that way.
async function renderMeals(dir = 0) {
  mealDay = mealDay || localKey(new Date());
  const day = mealDay;
  const version = mealVersion;
  ensureMealShell();
  showMealDay();
  loadGoals().then(() => mealLogShown() && drawGoals());
  const cached = mealCache.get(day);
  const motion = dir ? "slide" : "fade";
  if (cached) {
    mealItems = cached;
    drawMeals(motion, dir);
  } else {
    $("#meal-sections").innerHTML = skeletons("skel-row", 4);
  }
  let data;
  try {
    data = await api(`meals?day=${day}`);
  } catch (ex) {
    if (mealLogShown() && mealDay === day && !cached) $("#meal-sections").innerHTML = `<div class="empty">${esc(ex.message)}</div>`;
    return;
  }
  if (!mealLogShown() || mealDay !== day || version !== mealVersion) return; // moved on, or changed locally meanwhile
  if (JSON.stringify(data.items) === JSON.stringify(cached)) return;
  mealCache.set(day, data.items);
  mealItems = data.items;
  drawMeals(cached ? "flip" : motion, dir);
}

function mealSectionsHtml() {
  if (!mealItems.length) {
    const blank = Object.entries(MEAL_NAMES).map(([meal, label]) => mealSectionHtml(meal, label, [])).join("");
    return `<div data-flip="hero">${emptyHero("Nothing logged yet. What's fueling you today?")}</div>${blank}`;
  }
  return Object.entries(MEAL_NAMES).map(([meal, label]) => mealSectionHtml(meal, label, mealItems.filter((it) => it.meal === meal))).join("");
}

function mealSectionHtml(meal, label, items) {
  const rows = items
    .map((it) => {
      const detail = [it.brand, mealAmountText(it)].filter(Boolean).join(" · ");
      return `<div class="food-row" data-flip="row:${it.id}">
        <button class="food-main food-edit" data-act="edit-food" data-id="${it.id}" aria-label="Edit ${esc(it.name)}"><span class="name">${esc(it.name)}</span>${detail ? `<span class="meta">${esc(detail)}</span>` : ""}</button>
        <div class="food-kcal">${fmtKcal(it.kcal)}<small> kcal</small></div>
        <button class="x" data-act="delete-food" data-id="${it.id}" aria-label="Remove ${esc(it.name)}">×</button>
      </div>`;
    })
    .join("");
  return `<h2 class="section meal-head" data-flip="head:${meal}"><span>${label}</span>${items.length ? `<span>${fmtKcal(sumOf(items, "kcal"))} kcal</span>` : ""}</h2>
    ${rows}<button class="ghost add-food" data-flip="add:${meal}" data-act="add-food" data-meal="${meal}">+ Add food</button>`;
}

function drawMeals(motion = "flip", dir = 0) {
  ensureMealShell();
  showMealDay();
  const sections = $("#meal-sections");
  const update = () => (sections.innerHTML = mealSectionsHtml());
  if (motion === "flip") flip(sections, "[data-flip]", update);
  else {
    update();
    if (motionOK()) {
      const from = motion === "slide" ? `translateX(${dir * 26}px)` : "translateY(6px)";
      sections.animate([{ opacity: 0, transform: from }, { opacity: 1, transform: "none" }], { duration: 220, easing: EASE_OUT });
    }
  }
  const totals = { kcal: sumOf(mealItems, "kcal"), protein: sumOf(mealItems, "protein"), carbs: sumOf(mealItems, "carbs"), fat: sumOf(mealItems, "fat") };
  countTo($("#total-kcal"), mealTotalsShown.kcal, totals.kcal, fmtKcal);
  for (const k of ["protein", "carbs", "fat"]) countTo($(`#total-${k}`), mealTotalsShown[k], totals[k], fmtGrams);
  mealTotalsShown = totals;
  const shares = macroShares(totals);
  const parts = $("#macro-bar").children;
  ["protein", "carbs", "fat"].forEach((k, i) => (parts[i].style.flexGrow = shares[k]));
  drawGoals();
}

function drawGoals() {
  const box = $("#meal-goals");
  if (box) box.innerHTML = goalMetersHtml(mealTotalsShown);
}

const mealDayLabel = (day, today) => (day === today || day === localKey(new Date(Date.now() - 864e5)) ? fmtShort(day) : fmtDay(keyToDate(day)));

// Removes a logged food right away and offers Undo. If the server refuses, the food comes back.
async function removeLoggedFood(id) {
  const day = mealDay;
  const item = mealItems.find((it) => it.id === id);
  if (!item) return;
  const restore = (saved) => {
    const items = [...(mealCache.get(day) || []), saved];
    setMealItems(items, day);
    if (mealLogShown() && mealDay === day) drawMeals();
  };
  setMealItems(mealItems.filter((it) => it.id !== id), day);
  drawMeals();
  try {
    await api(`meals/${id}`, { method: "DELETE" });
  } catch (ex) {
    restore(item);
    toast(ex.message, { error: true });
    return;
  }
  toast(`Removed ${item.name}`, {
    action: "Undo",
    onAction: async () => {
      try {
        const { id: _old, ...fields } = item;
        const { item: saved } = await api("meals", { body: { ...fields, day } });
        restore(saved);
      } catch (ex) {
        toast(ex.message, { error: true });
      }
    },
  });
}

Object.assign(actions, {
  "meal-day"(d) {
    const next = keyToDate(mealDay);
    next.setDate(next.getDate() + Number(d.d));
    mealDay = localKey(next);
    renderMeals(Number(d.d));
  },
  "add-food"(d) {
    openFood(d.meal);
  },
  "edit-food"(d) {
    const item = mealItems.find((it) => it.id === Number(d.id));
    if (item) openLoggedFood(item);
  },
  async "delete-food"(d, btn) {
    const row = btn.closest(".food-row");
    await collapseOut(row);
    await removeLoggedFood(Number(d.id));
  },
  "body-log"(d) {
    openBodyLog(d.day);
  },
  "body-range"(d) {
    setBodyRange(Number(d.days));
  },
  "open-plan"() {
    startPlan();
  },
  "edit-body-goals"() {
    drawBodyGoalsForm();
  },
  "edit-macro-goals"() {
    drawMacroGoalsForm();
  },
  "log-recipe"(d) {
    logRecipe(Number(d.id));
  },
  "recipe-add-ingredient"() {
    openFood();
  },
  "recipe-edit-ingredient"(d) {
    openLoggedFood(recipeDraft.ingredients[Number(d.i)]);
  },
  "recipe-remove-ingredient"(d) {
    removeIngredient(recipeDraft.ingredients[Number(d.i)]);
  },
  "recipe-save"(d, btn) {
    return saveRecipe(btn);
  },
  "recipe-back"() {
    return leaveRecipe();
  },
  "recipe-delete"() {
    return deleteRecipe();
  },
});

/* food dialog: search, then choose an amount (or enter a food by hand) */

// With a recipe open in the editor, this dialog picks ingredients rather than logging a meal.
const mealSelect = () =>
  recipeEditorOpen() ? "" : `<label>Meal <select id="food-meal">${Object.entries(MEAL_NAMES)
    .map(([k, v]) => `<option value="${k}"${k === foodMeal ? " selected" : ""}>${v}</option>`)
    .join("")}</select></label>`;

function openFood(meal) {
  foodEditing = null;
  foodMeal = meal || mealForNow();
  foodResults = [];
  foodPicked = null;
  drawFoodSearch();
  $("#food").showModal();
  $("#food-q").focus();
  loadFoodRecents();
  if (!recipeEditorOpen()) loadRecipes().catch(() => {}); // so recipes can be found and logged from here
}

function drawFoodSearch(q = "", message = "") {
  $("#food-title").textContent = recipeEditorOpen() ? "Add ingredient" : "Add food";
  $("#food-body").innerHTML = `
    <form id="food-search" class="food-form">
      ${mealSelect()}
      <div class="food-searchbar">
        <input id="food-q" type="search" enterkeyhint="search" autocomplete="off" maxlength="100" placeholder="Food name or barcode" aria-label="Food name or barcode" value="${esc(q)}">
        <button class="primary" type="submit">Search</button>
      </div>
    </form>
    <div id="food-results" class="food-results">${foodResultsHtml(message)}</div>
    <button type="button" class="ghost food-scan" data-food="camera">Scan a nutrition label</button>
    <button type="button" class="link food-manual" data-food="manual">Enter manually (only you will see it)</button>`;
}

const foodSourceLabel = (f) =>
  f.source === "recipe" && !f.recent ? "Your recipe" : f.recent ? "Added before" : f.source === "usda" ? "USDA" : f.source === "off" ? "Open Food Facts" : f.isPublic ? "Community" : "Only you";

function foodResultsHtml(message) {
  if (message) return `<p class="muted food-msg">${esc(message)}</p>`;
  return foodResults
    .map(
      (f, i) => `<button type="button" class="food-result" data-food="pick" data-i="${i}">
        <span class="food-main"><span class="name">${esc(f.name)}</span><span class="meta">${esc([f.brand, foodSourceLabel(f)].filter(Boolean).join(" · "))}</span></span>
        <span class="meta">${f.per100 ? `${fmtKcal(f.per100.kcal)} kcal/100g` : `${fmtKcal(f.kcal)} kcal`}</span>
      </button>`,
    )
    .join("");
}

async function runFoodSearch() {
  const q = $("#food-q").value.trim();
  if (!q) return;
  const box = $("#food-results");
  const btn = $("#food-search button.primary");
  box.innerHTML = `<span class="skel skel-result"></span>`.repeat(4);
  btn.disabled = true;
  try {
    if (/^\d{8,14}$/.test(q)) {
      const { food } = await api(`food/barcode/${q}`);
      foodResults = [food];
      foodTouched = foodQtyTyped = false;
      return drawFoodAmount(food);
    }
    const { foods } = await api(`food/search?q=${encodeURIComponent(q)}`);
    foodResults = withRecipes(foods, q);
    box.innerHTML = foodResultsHtml(foodResults.length ? "" : "No foods found. Try other words, or enter it manually.");
  } catch (ex) {
    foodResults = [];
    box.innerHTML = foodResultsHtml(ex.message);
  } finally {
    btn.disabled = false;
  }
}

// Recipes come first when logging. Their past logs would only repeat them, so those are dropped.
function withRecipes(foods, q = "") {
  if (recipeEditorOpen()) return foods;
  const known = new Set((recipes || []).map((r) => r.name.toLowerCase()));
  return [...recipeFoods(q), ...foods.filter((f) => !(f.recent && known.has(f.name.toLowerCase())))];
}

async function pickFood(food) {
  foodTouched = foodQtyTyped = false;
  drawFoodAmount(food);
  enrichFood(food);
}

// Search results and past logs can omit a food's household units, so fetch its full record when we can.
async function enrichFood(food) {
  const path =
    food.source === "usda" ? `food/usda/${food.id}`
    : food.source === "custom" ? `food/custom/${food.id}`
    : /^\d{8,14}$/.test(food.code) ? `food/barcode/${food.code}`
    : null;
  if (!path) return;
  try {
    const { food: full } = await api(path);
    if (foodPicked !== food || !$("#food").open) return;
    const known = new Set(full.measures.map((m) => m.label));
    food.measures = [...full.measures, ...food.measures.filter((m) => !known.has(m.label))]; // keep the unit last used
    if (full.densityKnown || !food.densityKnown) {
      food.gPerMl = full.gPerMl;
      food.densityKnown = full.densityKnown;
    }
    if (food.source === "custom") Object.assign(food, { isPublic: full.isPublic, mine: full.mine, verifiedScans: full.verifiedScans, scansToPublish: full.scansToPublish, serving: full.serving });
    if ($("#food-qty")) syncFoodAmount();
  } catch {
    /* extra units are optional; the ones already shown still work */
  }
}

const OZ_GRAMS = 28.3495;
const MANUAL_UNITS = ["g", "ml", "oz", "piece", "slice", "serving"];

// Convert an amount in any unit to grams. ml uses the food's density, or water's when it's unknown.
function foodGrams(food, qty, unit) {
  if (unit === "g") return qty;
  if (unit === "oz") return qty * OZ_GRAMS;
  if (unit === "ml") return qty * food.gPerMl;
  return qty * (food.measures.find((m) => m.label === unit)?.grams || 0);
}

// Totals for an amount of the picked food, rounded to what gets stored.
function foodTotals(food, grams) {
  const scale = (v) => (v == null ? null : Math.round((v * grams) / 10) / 10);
  return { kcal: scale(food.per100.kcal), protein: scale(food.per100.protein), carbs: scale(food.per100.carbs), fat: scale(food.per100.fat) };
}

// The sensible starting amount: what was logged last time, else one of the food's own units, else 100 g.
function defaultFoodAmount(food) {
  if (food.last) {
    foodUnit = food.last.unit;
    foodQty = String(food.last.qty);
    return;
  }
  const first = food.measures[0];
  foodUnit = first ? first.label : "g";
  foodQty = first ? "1" : "100";
}

const foodUnitOptions = (food) =>
  [...food.measures.map((m) => [m.label, `${m.label} (${m.grams} g)`]), ["g", "g"], ["ml", "ml"], ["oz", "oz"]]
    .map(([v, t]) => `<option value="${esc(v)}"${v === foodUnit ? " selected" : ""}>${esc(t)}</option>`)
    .join("");

function drawFoodAmount(food) {
  foodPicked = food;
  if (!foodTouched) defaultFoodAmount(food);
  $("#food-title").textContent = foodEditing ? (recipeEditorOpen() ? "Edit ingredient" : "Edit food") : "How much?";
  $("#food-body").innerHTML = `
    <form id="food-amount" class="food-form">
      <div><div class="name">${esc(food.name)}</div>${food.brand ? `<div class="meta muted">${esc(food.brand)}</div>` : ""}</div>
      ${mealSelect()}
      <div class="food-qty">
        <label>Amount <input id="food-qty" type="number" inputmode="decimal" min="0.01" max="10000" step="any" value="${esc(foodQty)}" required></label>
        <label>Unit <select id="food-unit">${foodUnitOptions(food)}</select></label>
      </div>
      <div id="food-preview" class="food-preview"></div>
      <div id="food-custom-note">${customFoodNote(food)}</div>
      <p id="food-note" class="food-note muted" hidden></p>
      <p class="error" role="alert"></p>
      ${foodFormButtons()}
    </form>`;
  drawFoodPreview();
}

// Back and Add when adding. Cancel, Save and Delete when editing something already logged.
const foodFormButtons = () => `
  <div class="dlg-actions">
    <button type="button" data-food="back">${foodEditing ? "Cancel" : "Back"}</button>
    <button class="primary" type="submit">${foodEditing ? "Save" : "Add"}</button>
  </div>
  ${foodEditing ? `<button type="button" class="link food-delete" data-food="delete-logged">${recipeEditorOpen() ? "Remove from this recipe" : "Delete from this meal"}</button>` : ""}`;

// Update the amount form in place after more units arrive, without disturbing what's being typed.
function syncFoodAmount() {
  if (!foodTouched) defaultFoodAmount(foodPicked);
  $("#food-unit").innerHTML = foodUnitOptions(foodPicked);
  if (!foodQtyTyped) $("#food-qty").value = foodQty;
  $("#food-custom-note").innerHTML = customFoodNote(foodPicked);
  drawFoodPreview();
}

function drawFoodPreview() {
  const f = foodPicked;
  const qty = Number(foodQty);
  const grams = qty > 0 ? foodGrams(f, qty, foodUnit) : 0;
  const t = foodTotals(f, grams);
  const macro = (v) => (v == null ? "–" : fmtGrams(v));
  $("#food-preview").innerHTML = `<strong>${fmtKcal(t.kcal)} kcal</strong><span>P ${macro(t.protein)}</span><span>C ${macro(t.carbs)}</span><span>F ${macro(t.fat)}</span><span>${Math.round(grams * 10) / 10} g</span>`;
  const note = $("#food-note");
  note.hidden = foodUnit !== "ml";
  note.textContent = f.densityKnown ? `Converted at ${f.gPerMl} g per ml.` : "Counted as 1 g per ml, so this is approximate for anything not water-like.";
}

/* label scanning: photo, then review what was read, then save and log */

const SCAN_MAX_EDGE = 1568; // larger photos only add cost, not legibility

// Shrink and re-encode on this device. Larger photos only add cost, not legibility.
function encodeLabelPhoto(source, width, height) {
  const scale = Math.min(1, SCAN_MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}

let foodStream = null;
let foodCameraToken = 0; // bumped whenever the camera or a pending scan stops being wanted

function stopFoodCamera() {
  foodCameraToken++;
  foodStream?.getTracks().forEach((t) => t.stop());
  foodStream = null;
}

// Live camera view. Without camera access, this falls back to the device's photo picker.
async function openFoodCamera(message = "") {
  stopFoodCamera();
  const token = foodCameraToken;
  $("#food-title").textContent = "Scan label";
  $("#food-body").innerHTML = `
    <video id="food-video" class="food-video" autoplay playsinline muted hidden></video>
    <p id="food-camera-msg" class="muted food-msg">${esc(message || "Opening camera…")}</p>
    <button type="button" id="food-shutter" class="primary food-shutter" data-food="shutter" hidden>Take photo</button>
    <label id="food-pick" class="ghost food-scan" hidden>Choose a photo<input id="food-photo" type="file" accept="image/*" capture="environment" hidden></label>
    <p class="food-note muted food-center">The photo goes to Anthropic to be read, and TorchRep doesn't keep it.</p>
    <div class="dlg-actions food-camera-back"><button type="button" data-food="back">Back</button></div>`;
  const fallback = (text) => {
    $("#food-camera-msg").textContent = message || text;
    $("#food-pick").hidden = false;
  };
  if (!navigator.mediaDevices?.getUserMedia) return fallback("The camera isn't available here. Choose a photo instead.");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (ex) {
    if (token !== foodCameraToken) return;
    return fallback(
      ex.name === "NotAllowedError"
        ? "Camera access is blocked. Allow it in your browser settings, or choose a photo."
        : "No camera was found. Choose a photo instead.",
    );
  }
  if (token !== foodCameraToken) return stream.getTracks().forEach((t) => t.stop()); // closed while waiting for permission
  foodStream = stream;
  const video = $("#food-video");
  video.srcObject = stream;
  video.hidden = false;
  await video.play().catch(() => {});
  if (token !== foodCameraToken) return;
  $("#food-camera-msg").textContent = message || "Fill the frame with the nutrition panel.";
  $("#food-shutter").hidden = false;
  $("#food-photo").removeAttribute("capture"); // the live camera is up, so this button means the photo library
  $("#food-pick").hidden = false;
}

function takeLabelPhoto() {
  const video = $("#food-video");
  if (!video.videoWidth) return; // the first frame hasn't arrived yet
  sendLabelPhoto(encodeLabelPhoto(video, video.videoWidth, video.videoHeight));
}

async function pickLabelPhoto(file) {
  let image;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    image = encodeLabelPhoto(bitmap, bitmap.width, bitmap.height);
    bitmap.close();
  } catch {
    return openFoodCamera("That photo couldn't be opened. Try a JPEG or PNG.");
  }
  sendLabelPhoto(image);
}

async function sendLabelPhoto(image) {
  stopFoodCamera();
  const token = foodCameraToken;
  $("#food-body").innerHTML = `<div class="food-reading"><img src="/brand/mascot.png" width="253" height="224" alt=""><p class="muted food-msg">Reading label…</p></div>`;
  try {
    const { scanId, reading } = await api("food/scan", { body: { image, mediaType: "image/jpeg" } });
    if (token === foodCameraToken) drawFoodScanReview(scanId, reading);
  } catch (ex) {
    if (token === foodCameraToken) openFoodCamera(ex.message);
  }
}

const customFoodFields = (v, note) => {
  const num = (id, label, value) =>
    `<label>${label} <input id="${id}" type="number" inputmode="decimal" min="0" max="5000" step="any" value="${value ?? ""}" required></label>`;
  return `
      <label>Item name <input id="scan-name" maxlength="80" autocomplete="off" required placeholder="Exactly as on the package" value="${esc(v.name ?? "")}"></label>
      <label>Brand <input id="scan-brand" maxlength="80" autocomplete="off" value="${esc(v.brand ?? "")}"></label>
      <label>Serving as printed <input id="scan-serving" maxlength="80" autocomplete="off" value="${esc(v.label ?? "")}"></label>
      <div class="row">${num("scan-grams", "Serving (g or ml)", v.grams)}${num("scan-kcal", "Calories", v.kcal)}</div>
      <div class="row">${num("scan-protein", "Protein (g)", v.protein)}${num("scan-carbs", "Carbs (g)", v.carbs)}</div>
      ${num("scan-fat", "Fat (g)", v.fat)}
      <p class="food-note muted">${note}</p>
      <p class="error" role="alert"></p>
      <div class="dlg-actions">
        <button type="button" data-food="${v.back}">Back</button>
        <button class="primary" type="submit">Save</button>
      </div>`;
};

function drawFoodScanReview(scanId, r) {
  foodPicked = null;
  $("#food-title").textContent = "Check the label";
  $("#food-body").innerHTML = `
    <form id="food-scan-review" class="food-form" data-scan="${esc(scanId)}">
      ${customFoodFields(
        { back: "back", label: r.serving_label, grams: r.serving_grams, kcal: r.calories, protein: r.protein_g, carbs: r.carbs_g, fat: r.fat_g },
        "Check these against the label. This food becomes public once 3 people scan the same label and enter the same name. If you change a number, it stays private to you.",
      )}
    </form>`;
  $("#scan-name").focus();
}

function drawCustomFoodEdit(food) {
  foodEditingCustom = food;
  $("#food-title").textContent = "Edit my food";
  $("#food-body").innerHTML = `
    <form id="food-custom-edit" class="food-form">
      ${customFoodFields(
        { back: "custom-cancel", name: food.name, brand: food.brand, ...food.serving },
        "Your edits are private to you, and they don't change what other people see or what you've already logged.",
      )}
    </form>`;
}

const customFoodBody = () => ({
  name: $("#scan-name").value,
  brand: $("#scan-brand").value,
  servingLabel: $("#scan-serving").value,
  servingGrams: $("#scan-grams").value,
  kcal: $("#scan-kcal").value,
  protein: $("#scan-protein").value,
  carbs: $("#scan-carbs").value,
  fat: $("#scan-fat").value,
});

// Shared by scanned foods and edits: on success, carry on to the amount screen with the saved food.
async function submitCustomFood(form, request) {
  const err = form.querySelector(".error");
  const btn = form.querySelector("button.primary");
  err.textContent = "";
  btn.disabled = true;
  try {
    const { food } = await request();
    foodEditingCustom = null;
    foodTouched = foodQtyTyped = false;
    drawFoodAmount(food);
  } catch (ex) {
    err.textContent = ex.message;
    btn.disabled = false;
  }
}

// Status line for a scanned food on the amount screen, with edit and remove for its owner.
function customFoodNote(food) {
  if (food.source !== "custom" || food.isPublic === undefined) return "";
  const status = food.isPublic
    ? `Community food from scanned labels.${foodEditing ? "" : ` <button type="button" class="link food-report" data-food="report">Report a problem</button>`}`
    : `Only you can see this. ${food.verifiedScans} of ${food.scansToPublish} matching scans so far.`;
  const manage = food.mine && !foodEditing
    ? ` <button type="button" class="link food-report" data-food="custom-edit">Edit</button> <button type="button" class="link food-report" data-food="custom-remove">Remove from my foods</button>`
    : "";
  return `<p class="food-note muted">${status}${manage}</p>`;
}

function drawFoodManual(v = {}) {
  foodPicked = null;
  $("#food-title").textContent = foodEditing ? "Edit food" : "Enter manually";
  const field = (id, label, value, required) =>
    `<label>${label} <input id="${id}" type="number" inputmode="decimal" min="0" max="100000" step="any" value="${value ?? ""}"${required ? " required" : ""}></label>`;
  const qty = v.qty ?? v.grams;
  const unit = v.qty != null && v.unit ? v.unit : "g";
  const units = MANUAL_UNITS.includes(unit) ? MANUAL_UNITS : [unit, ...MANUAL_UNITS];
  $("#food-body").innerHTML = `
    <form id="food-manual" class="food-form" data-brand="${esc(v.brand ?? "")}">
      <label>Name <input id="food-name" maxlength="80" autocomplete="off" required value="${esc(v.name ?? "")}"></label>
      ${mealSelect()}
      <div class="food-qty">
        ${field("food-manual-qty", recipeEditorOpen() ? "Amount used" : "Amount eaten", qty)}
        <label>Unit <select id="food-manual-unit">${units.map((u) => `<option${u === unit ? " selected" : ""}>${esc(u)}</option>`).join("")}</select></label>
      </div>
      ${field("food-kcal", "Total calories", v.kcal, true)}
      <div class="row">${field("food-protein", "Protein (g)", v.protein)}${field("food-carbs", "Carbs (g)", v.carbs)}</div>
      ${field("food-fat", "Fat (g)", v.fat)}
      <p class="error" role="alert"></p>
      ${foodFormButtons()}
    </form>`;
  $("#food-name").focus();
}

// Rebuilds a pickable food from a logged item, using what was saved with it.
function itemToFood(it) {
  const source = it.source || (it.code ? "off" : "");
  if (!source || !(it.grams > 0)) return null;
  const scale = (v) => (v == null ? null : (v / it.grams) * 100);
  const qty = it.qty > 0 && it.unit ? it.qty : null;
  const isHousehold = qty && !["g", "ml", "oz"].includes(it.unit);
  return {
    source,
    id: it.code,
    code: source === "off" ? it.code : "",
    name: it.name,
    brand: it.brand,
    per100: { kcal: scale(it.kcal), protein: scale(it.protein), carbs: scale(it.carbs), fat: scale(it.fat) },
    measures: isHousehold ? [{ label: it.unit, grams: Math.round((it.grams / qty) * 10) / 10 }] : [],
    gPerMl: qty && it.unit === "ml" ? it.grams / qty : 1,
    densityKnown: !!(qty && it.unit === "ml"),
    last: qty ? { qty, unit: it.unit } : { qty: it.grams, unit: "g" },
  };
}

function openLoggedFood(item) {
  foodEditing = item;
  foodMeal = item.meal;
  foodResults = [];
  foodTouched = foodQtyTyped = false;
  const food = itemToFood(item);
  if (food) drawFoodAmount(food);
  else drawFoodManual(item);
  $("#food").showModal();
  if (food) enrichFood(food);
}

async function loadFoodRecents() {
  try {
    const { foods } = await api("food/recent");
    const input = $("#food-q");
    if (!$("#food").open || !input || input.value.trim() || foodResults.length) return; // the user has moved on
    foodResults = withRecipes(foods);
    $("#food-results").innerHTML = foodResultsHtml();
  } catch {
    /* the list is a convenience; searching still works */
  }
}

async function saveFood(form, item) {
  if (recipeEditorOpen()) return saveIngredient(item, foodEditing);
  const err = form.querySelector(".error");
  const btn = form.querySelector("button.primary");
  err.textContent = "";
  btn.disabled = true;
  const onStats = current?.view === "meals" && current.stats;
  const day = mealLogShown() ? mealDay : localKey(new Date()); // Stats and Recipes have no day of their own, so food added there is today's
  const editing = foodEditing;
  try {
    const body = { ...item, day, meal: foodMeal };
    const { item: saved } = await (editing ? api(`meals/${editing.id}`, { method: "PUT", body }) : api("meals", { body }));
    if (mealLogShown() && mealDay === day) {
      setMealItems(editing ? mealItems.map((it) => (it.id === editing.id ? saved : it)) : [...mealItems, saved], day);
      drawMeals();
    } else {
      mealCache.delete(day);
      if (onStats) loadMealStats();
    }
    toast(editing ? "Saved" : `Added to ${MEAL_NAMES[saved.meal].toLowerCase()}`);
    $("#food").close();
  } catch (ex) {
    err.textContent = ex.message;
    btn.disabled = false;
  }
}

$("#food-close").addEventListener("click", () => $("#food").close());
watchDialogHeight($("#food"), $("#food-body"));
$("#food").addEventListener("close", () => {
  stopFoodCamera(); // also covers the Esc key
  foodEditing = null;
});
$("#food-body").addEventListener("change", (e) => {
  if (e.target.id === "food-meal") foodMeal = e.target.value;
  if (e.target.id === "body-day" && e.target.value) changeBodyDay(e.target.value);
  if (e.target.id === "goal-unit") bodyGoalHint();
  if (e.target.id === "goal-kcal") {
    settleMacroInputs(macroGoalInputs());
    drawMacroSum();
  }
  if (e.target.id === "food-photo" && e.target.files[0]) pickLabelPhoto(e.target.files[0]);
  if (e.target.id === "food-unit") {
    foodUnit = e.target.value;
    foodTouched = true;
    if (!foodQtyTyped) {
      foodQty = foodUnit === "g" || foodUnit === "ml" ? "100" : "1"; // a sensible amount for the new unit
      $("#food-qty").value = foodQty;
    }
    drawFoodPreview();
  }
});
$("#food-body").addEventListener("input", (e) => {
  if (e.target.id === "recipe-log-qty") drawRecipePreview();
  if ("macro" in e.target.dataset) {
    syncMacroInputs(macroGoalInputs(), e.target);
    drawMacroSum();
  }
  if (e.target.id === "goal-weight") bodyGoalHint();
  if (e.target.id === "food-qty") {
    foodQty = e.target.value;
    foodTouched = foodQtyTyped = true;
    drawFoodPreview();
  }
});
$("#food-body").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-food]");
  if (!btn) return;
  const act = btn.dataset.food;
  if (act === "pick") {
    const food = foodResults[Number(btn.dataset.i)];
    if (food.source === "manual") drawFoodManual(food);
    else if (food.recipe) drawRecipeLog(food.recipe);
    else pickFood(food);
  }
  else if (act === "close") $("#food").close();
  else if (act === "plan-open") {
    $("#food").close();
    startPlan();
  }
  else if (act === "body-delete") deleteBodyLog().catch((ex) => toast(ex.message, { error: true }));
  else if (act === "manual") drawFoodManual();
  else if (act === "camera") openFoodCamera();
  else if (act === "shutter") takeLabelPhoto();
  else if (act === "report") {
    btn.disabled = true;
    api(`food/custom/${foodPicked.id}/report`, { method: "POST" })
      .then(() => (btn.textContent = "Reported. Thanks."))
      .catch((ex) => {
        btn.disabled = false;
        btn.textContent = ex.message;
      });
  }
  else if (act === "delete-logged") {
    const item = foodEditing;
    $("#food").close();
    if (recipeEditorOpen()) removeIngredient(item);
    else removeLoggedFood(item.id);
  } else if (act === "custom-edit") drawCustomFoodEdit(foodPicked);
  else if (act === "custom-cancel") {
    const food = foodEditingCustom;
    foodEditingCustom = null;
    drawFoodAmount(food);
  } else if (act === "custom-remove") {
    const food = foodPicked;
    askConfirm({ title: `Remove "${food.name}"?`, message: "Anything you've already logged stays.", confirmLabel: "Remove" })
      .then((yes) => yes && api(`food/custom/${food.id}`, { method: "DELETE" }).then(() => {
        foodPicked = null;
        foodResults = [];
        drawFoodSearch();
        loadFoodRecents();
        toast(`Removed ${food.name}`);
      }))
      .catch((ex) => toast(ex.message, { error: true }));
  } else if (act === "back") {
    if (foodEditing) return $("#food").close();
    stopFoodCamera();
    foodPicked = null;
    drawFoodSearch();
  }
});
$("#food-body").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.id === "food-search") return runFoodSearch();
  if (!form.reportValidity()) return;
  if (form.id === "food-body-log") return saveBodyLog(form);
  if (form.id === "food-body-goals") return saveGoals(form, { weight: $("#goal-weight").value, weightUnit: $("#goal-unit").value, bodyFat: $("#goal-fat").value });
  if (form.id === "food-macro-goals") return saveGoals(form, { kcal: $("#goal-kcal").value, protein: $("#goal-protein").value, carbs: $("#goal-carbs").value, fat: $("#goal-macro-fat").value });
  if (form.id === "food-recipe-log") return saveFood(form, recipeLogItem(recipeLogging, Number($("#recipe-log-qty").value)));
  if (form.id === "food-scan-review") {
    return submitCustomFood(form, () => api("food/custom", { body: { ...customFoodBody(), scanId: form.dataset.scan } }));
  }
  if (form.id === "food-custom-edit") {
    return submitCustomFood(form, () => api(`food/custom/${foodEditingCustom.id}`, { method: "PUT", body: customFoodBody() }));
  }
  if (form.id === "food-amount") {
    const f = foodPicked;
    const qty = Number(foodQty);
    const grams = foodGrams(f, qty, foodUnit);
    return saveFood(form, { name: f.name, brand: f.brand, source: f.source, code: f.source === "off" ? f.code : f.id, qty, unit: foodUnit, grams, ...foodTotals(f, grams) });
  }
  if (form.id === "food-manual") {
    const qty = $("#food-manual-qty").value;
    const unit = $("#food-manual-unit").value;
    return saveFood(form, {
      name: $("#food-name").value,
      brand: form.dataset.brand,
      kcal: $("#food-kcal").value,
      protein: $("#food-protein").value,
      carbs: $("#food-carbs").value,
      fat: $("#food-fat").value,
      qty,
      unit,
      grams: qty === "" ? null : unit === "g" ? qty : unit === "ml" ? qty : unit === "oz" ? Number(qty) * OZ_GRAMS : null,
    });
  }
});

/* ---------- boot ---------- */

api("me")
  .then(({ user: u }) => start(u))
  .catch(signedOut);
