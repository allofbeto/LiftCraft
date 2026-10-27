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
  $("body > .card").hidden = false;
  $("#app").hidden = true;
  $("#tabbar").hidden = true;
}

// Bottom tab bar: Home / Progress / Add / Profile / Logout.
$("#tabbar").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-tab]");
  if (!btn) return;
  const tab = btn.dataset.tab;
  if (tab === "home") location.hash = "#/";
  else if (tab === "progress") location.hash = "#/progress";
  else if (tab === "profile") location.hash = "#/profile";
  else if (tab === "add") await addFlow().catch((ex) => alert(ex.message));
  else if (tab === "logout") await actions.logout();
});

function setActiveTab(view) {
  const map = { progress: "progress", profile: "profile" };
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
// so from an exercise we add into its parent folder; from progress/profile/home, top level.
function addContext() {
  let folderId = null;
  if (current?.view === "folder") folderId = current.id;
  else if (current?.view === "exercise") folderId = detail?.exercise?.folderId ?? null;
  const f = folders.find((x) => x.id === folderId);
  return { folderId, label: f ? f.name : "LiftCraft" };
}

// The bottom-bar "Add" button: choose a type, then create it in context.
async function addFlow() {
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
    </button>${grip}
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
    ${topbar(`Lift<span style="color:var(--accent)">Craft</span>`)}
    <p class="muted" style="margin:0">Hi ${esc(user.firstName)} 👋</p>
    <h2 class="section">Folders</h2>
    <div class="list" data-reorder="folders">${topFolders.length ? topFolders.map(folderItem).join("") : `<div class="empty">No folders yet</div>`}</div>
    <h2 class="section">Exercises</h2>
    <div class="list" data-reorder="exercises">${unfiled.length ? unfiled.map(exerciseItem).join("") : `<div class="empty">No loose exercises</div>`}</div>
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
    <div class="list" data-reorder="exercises">${list.length ? list.map(exerciseItem).join("") : `<div class="empty">No exercises in this folder</div>`}</div>
    <div class="actions">
      <button class="ghost" data-act="new-folder">+ Folder</button>
      <button class="primary" data-act="new-exercise">+ Exercise</button>
    </div>`;
}

async function renderProgress() {
  app.innerHTML = `${topbar("Progress")}<div class="empty">Loading…</div>`;
  let data;
  try {
    data = await api("progress");
  } catch {
    data = { days: [], exerciseCount: 0 };
  }
  if (current?.view !== "progress") return; // navigated away while loading
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

  app.innerHTML = `
    ${topbar("Progress")}
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
        : `<div class="empty">Log a set to start tracking your progress.</div>`
    }`;
}

function renderProfile() {
  const initials = ((user.firstName[0] || "") + (user.lastName[0] || "")).toUpperCase();
  app.innerHTML = `
    ${topbar("Profile")}
    <div class="avatar">${esc(initials)}</div>
    <div class="prof-card">
      <div class="prof-row"><span class="k">Name</span><span class="v">${esc(user.firstName)} ${esc(user.lastName)}</span></div>
      <div class="prof-row"><span class="k">Email</span><span class="v">${esc(user.email)}</span></div>
      <div class="prof-row"><span class="k">Exercises</span><span class="v">${exercises.length}</span></div>
      <div class="prof-row"><span class="k">Folders</span><span class="v">${folders.length}</span></div>
    </div>
    <div class="actions" style="grid-template-columns:1fr; margin-top:16px">
      <button class="ghost" data-act="logout">Log out</button>
    </div>`;
}

async function renderExercise(id) {
  app.innerHTML = topbar("", { back: "#/" });
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
  drawExercise();
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
    ? `<i class="dot"></i> Last entry ${fmtDay(keyToDate(last))}`
    : `<i class="dot"></i> No entries yet`;
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
      <div class="cal-foot"><span>${lastEntryLabel(recorded)}</span><button class="link" data-act="today">Today</button></div>
    </section>`;
}

const SAVE_ICON = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;

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
      right: `<button class="icon-btn" data-act="toggle-details" aria-label="Edit details">✏️</button>
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
            <input class="big" name="weight" type="number" inputmode="decimal" min="0" step="any" aria-label="Weight" value="${esc(lastWeight)}"></div>
          <div class="fld"><div class="lbl">Reps</div>
            <input class="big" name="reps" type="number" inputmode="numeric" min="0" step="1" aria-label="Reps" placeholder="0"></div>
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
}

/* ---------- routing ---------- */

function route() {
  if (!user) return;
  flushNote();
  flushExercise();
  const [, view, rawId] = location.hash.split("/");
  const id = Number(rawId);
  current = { view, id };
  setActiveTab(view);
  if (view === "folder") renderFolder(id);
  else if (view === "exercise") renderExercise(id);
  else if (view === "progress") renderProgress();
  else if (view === "profile") renderProfile();
  else renderHome();
  window.scrollTo(0, 0);
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
});

app.addEventListener("input", (e) => {
  const f = e.target.dataset.f;
  if (f === "note") return onNote(e.target.value);
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
  if (e.target.name === "reps") return commitSet(false);
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
  const reps = form.reps.value.trim();
  const weight = form.weight.value.trim();
  err.textContent = "";
  if (reps === "") {
    if (explicit) err.textContent = "Enter the number of reps.";
    return; // blur with nothing typed: stay quiet
  }
  if (!/^\d+$/.test(reps)) {
    if (explicit) err.textContent = "Reps must be a whole number.";
    return;
  }
  committing = true;
  lastWeight = weight; // carry the weight into the next set

  // The captured set lives only in the day's Workout Notes, as one appended line.
  const line = weight !== "" ? `${weight} ${unit} × ${reps}` : `Bodyweight × ${reps}`;
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
    else location.hash = "#/"; // from progress/profile, show the new top-level folder on Home
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
    if (!confirm("Delete this folder? Its contents will be kept.")) return;
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
    if (!confirm("Delete this exercise and everything logged on it?")) return;
    const x = detail.exercise;
    await api(`exercises/${x.id}`, { method: "DELETE" });
    exercises = exercises.filter((e) => e.id !== x.id);
    location.hash = x.folderId != null ? `#/folder/${x.folderId}` : "#/";
  },
  "pick-day"(d) {
    flushNote();
    selDay = d.day;
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
    drawExercise();
  },
  "toggle-unit"(d, btn) {
    unit = unit === "lb" ? "kg" : "lb";
    btn.textContent = unit === "lb" ? "Lb" : "Kg";
  },
  "toggle-details"() {
    detailsOpen = !detailsOpen;
    drawExercise();
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
    alert(ex.message);
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
    list.insertBefore(item, prev);
  } else if (next?.classList.contains("item") && mid > next.getBoundingClientRect().top + next.offsetHeight / 2) {
    list.insertBefore(next, item);
  }
}

async function onDragEnd() {
  if (!drag) return;
  const { item, list, moved, drop, type, id } = drag;
  document.removeEventListener("pointermove", onDragMove);
  item.style.transform = "";
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
  if (current?.view === "folder") renderFolder(current.id);
  else renderHome();
}

async function reload() {
  await loadLibrary();
  rerenderCurrent();
}

/* ---------- week carousel swipe ---------- */

function changeWeek(delta) {
  weekStart = new Date(weekStart);
  weekStart.setDate(weekStart.getDate() + 7 * delta);
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

/* ---------- boot ---------- */

api("me")
  .then(({ user: u }) => start(u))
  .catch(signedOut);
