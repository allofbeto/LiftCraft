// The Profile screen's body tracking: weight and body fat over time, and the goals for them and for macros.

let bodyLogs = null; // every entry, newest first
let bodyDays = 90; // chart range, 0 means all time
const BODY_RANGES = [[30, "30 days"], [90, "90 days"], [365, "1 year"], [0, "All"]];

function resetBody() {
  bodyLogs = null;
}

const fmtOne = (n) => (Math.round(n * 10) / 10).toLocaleString("en-US");

// Show weights in the goal's unit, else in whichever unit was logged last.
const bodyUnit = () => (userGoals?.weight ? userGoals.weightUnit : bodyLogs?.find((l) => l.weight != null)?.unit || userGoals?.weightUnit || "lb");
const convertWeight = (w, from, to) => (from === to ? w : to === "lb" ? w * LB_PER_KG : w / LB_PER_KG);

// How far along from the first entry to the goal. Works whether the goal is above or below the start.
function bodyGoalMeter(label, start, now, goal, unit) {
  const dir = Math.sign(goal - start);
  const reached = dir === 0 ? Math.abs(now - goal) < 0.05 : (now - goal) * dir >= 0;
  const pct = reached ? 100 : dir === 0 ? 0 : Math.max(0, Math.min(100, ((now - start) / (goal - start)) * 100));
  const status = reached ? "✓ goal reached" : `${fmtOne(Math.abs(goal - now))}${unit} to go`;
  return `<div class="goal">
    <div class="goal-head"><span>${label}</span><span class="meta">${fmtOne(now)} → ${fmtOne(goal)}${unit} · ${status}</span></div>
    <div class="meter" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${pct}%"></i></div>
  </div>`;
}

function bodyChartCard(title, points, days, unitText, goal) {
  if (!points.length) return "";
  const start = keyToDate(days[0]);
  const rows = points.map((p) => ({
    x: Math.round((keyToDate(p.day) - start) / 864e5) / Math.max(days.length - 1, 1),
    value: p.value,
    label: shortDay(p.day),
    text: `${fmtOne(p.value)}${unitText}`,
  }));
  const change = points.at(-1).value - points[0].value;
  const note = [
    `Latest ${fmtOne(points.at(-1).value)}${unitText}`,
    points.length > 1 ? `${change > 0 ? "+" : ""}${fmtOne(change)}${unitText} over this range` : "",
    goal ? `line shows your ${fmtOne(goal)}${unitText} goal` : "",
  ].filter(Boolean).join(" · ");
  const table = chartTable("View as table", ["Day", title], [...points].reverse().map((p) => [shortDay(p.day), `${fmtOne(p.value)}${unitText}`]));
  return statCard(title, note, lineChart({ label: `${title} over time`, rows, xLabels: statAxis(days), line: goal, table }));
}

function bodyChartsHtml() {
  const unit = bodyUnit();
  const oldest = bodyLogs.at(-1).day;
  const days = bodyDays ? lastDays(bodyDays) : daysSince(oldest);
  const inRange = bodyLogs.filter((l) => l.day >= days[0]).reverse();
  if (!inRange.length) return `<div class="empty">No entries in this range.</div>`;
  const weights = inRange.filter((l) => l.weight != null).map((l) => ({ day: l.day, value: convertWeight(l.weight, l.unit, unit) }));
  const fats = inRange.filter((l) => l.bodyFat != null).map((l) => ({ day: l.day, value: l.bodyFat }));
  const g = userGoals || {};
  return `
    ${bodyChartCard("Weight", weights, days, ` ${unit}`, g.weight ? convertWeight(g.weight, g.weightUnit, unit) : null)}
    ${bodyChartCard("Body fat", fats, days, "%", g.bodyFat)}`;
}

// What the plan says today, or an invitation to make one.
function planCardHtml() {
  const g = userGoals || {};
  if (!g.plan) {
    return `<section class="panel report-card plan-card">
      <h3>Not sure what to aim for?</h3>
      <p class="meta">Answer a few questions and get recommended calories, macros and training, based on what you want to achieve.</p>
      <button class="primary" data-act="open-plan">Build my plan</button>
    </section>`;
  }
  const age = new Date().getFullYear() - g.birthYear;
  const level = ACTIVITY_LEVELS.find((a) => a.id === g.activity);
  const p = savedPlanAnswers();
  return `<section class="panel report-card plan-card">
    <div class="chart-head goals-head"><h3>Your plan: ${esc(PLAN_GOALS[g.plan].plan)}</h3><button class="link" data-act="open-plan">Update</button></div>
    <p class="meta">Age ${age} · ${esc(level?.name || "")}</p>
    ${p ? calorieBreakdownHtml(p, g.kcal || 0) : ""}
  </section>`;
}

function bodySectionHtml() {
  const g = userGoals || {};
  const unit = bodyUnit();
  const asc = [...bodyLogs].reverse();
  const weights = asc.filter((l) => l.weight != null);
  const fats = asc.filter((l) => l.bodyFat != null);
  const inUnit = (l) => convertWeight(l.weight, l.unit, unit);
  const weightNow = weights.at(-1);
  const fatNow = fats.at(-1);

  const meters = [
    g.weight && weightNow ? bodyGoalMeter("Weight goal", inUnit(weights[0]), inUnit(weightNow), convertWeight(g.weight, g.weightUnit, unit), ` ${unit}`) : "",
    g.bodyFat && fatNow ? bodyGoalMeter("Body fat goal", fats[0].bodyFat, fatNow.bodyFat, g.bodyFat, "%") : "",
  ].join("");
  const goalText = [g.weight ? `${fmtOne(g.weight)} ${g.weightUnit}` : "", g.bodyFat ? `${fmtOne(g.bodyFat)}% body fat` : ""].filter(Boolean).join(" · ");

  const recent = bodyLogs
    .slice(0, 5)
    .map((l) => {
      const values = [l.weight != null ? `${fmtOne(l.weight)} ${l.unit}` : "", l.bodyFat != null ? `${fmtOne(l.bodyFat)}%` : ""].filter(Boolean).join(" · ");
      return `<button class="act body-entry" data-act="body-log" data-day="${l.day}" aria-label="Edit ${shortDay(l.day)}"><span class="name">${shortDay(l.day)}</span><span class="meta">${values}</span></button>`;
    })
    .join("");

  return `
    <h2 class="section">Body</h2>
    ${planCardHtml()}
    ${
      bodyLogs.length
        ? `<div class="stats">
            ${statTile(weightNow ? `${fmtOne(inUnit(weightNow))} ${unit}` : "–", weightNow ? `Weight · ${shortDay(weightNow.day)}` : "Weight")}
            ${statTile(fatNow ? `${fmtOne(fatNow.bodyFat)}%` : "–", fatNow ? `Body fat · ${shortDay(fatNow.day)}` : "Body fat")}
          </div>`
        : emptyHero("Log your weight and body fat to track them over time.")
    }
    <button class="primary body-log-btn" data-act="body-log">Log weight or body fat</button>
    <section class="panel report-card goals-panel">
      <div class="chart-head goals-head"><h3>Body goals</h3><button class="link" data-act="edit-body-goals">${goalText ? "Edit" : "Set"}</button></div>
      ${meters ? `<div class="goals">${meters}</div>` : `<p class="meta goals-none">${goalText ? `Goal: ${esc(goalText)}. Log an entry to see your progress.` : "No goals set yet."}</p>`}
    </section>
    ${
      bodyLogs.length
        ? `${rangePicker("body-range", BODY_RANGES, bodyDays)}
           <div id="body-charts">${bodyChartsHtml()}</div>
           <h2 class="section">Recent entries</h2>
           ${recent}`
        : ""
    }
    <h2 class="section">Macro goals</h2>
    <section class="panel report-card goals-panel">
      <div class="chart-head goals-head"><h3>Daily targets</h3><button class="link" data-act="edit-macro-goals">${g.kcal || g.protein || g.carbs || g.fat ? "Edit" : "Set"}</button></div>
      <div class="macro-goals">
        ${[["Calories", g.kcal, ""], ["Protein", g.protein, " g"], ["Carbs", g.carbs, " g"], ["Fat", g.fat, " g"]]
          .map(([label, v, u]) => `<div class="macro-goal"><div class="n">${v ? `${fmtNumber(v)}${u}` : "–"}</div><div class="l">${label}</div></div>`)
          .join("")}
      </div>
    </section>`;
}

function drawBody() {
  const box = $("#profile-body");
  if (box && bodyLogs) box.innerHTML = bodySectionHtml();
}

async function loadBody() {
  try {
    const [{ logs }] = await Promise.all([api("body"), loadGoals()]);
    bodyLogs = logs;
    if (current?.view === "profile") {
      drawBody();
      animateIn($("#profile-body"));
    }
  } catch (ex) {
    if ($("#profile-body")) $("#profile-body").innerHTML = `<h2 class="section">Body</h2><div class="empty">${esc(ex.message)}</div>`;
  }
}

function setBodyRange(days) {
  bodyDays = days;
  markRange(days);
  clearChartTip();
  $("#body-charts").innerHTML = bodyChartsHtml();
  animateIn($("#body-charts"));
}

/* ---------- forms, shown in the food dialog ---------- */

const dialogButtons = `
  <div class="dlg-actions">
    <button type="button" data-food="close">Cancel</button>
    <button class="primary" type="submit">Save</button>
  </div>`;

const unitSelect = (id, chosen) => `<label>Unit <select id="${id}">${["lb", "kg"].map((u) => `<option${u === chosen ? " selected" : ""}>${u}</option>`).join("")}</select></label>`;

function drawBodyLog(day) {
  const entry = bodyLogs.find((l) => l.day === day);
  $("#food-title").textContent = entry ? "Edit entry" : "Log weight or body fat";
  $("#food-body").innerHTML = `
    <form id="food-body-log" class="food-form">
      <label>Date <input id="body-day" type="date" max="${localKey(new Date())}" value="${day}" required></label>
      <div class="food-qty">
        <label>Weight <input id="body-weight" type="number" inputmode="decimal" min="1" max="1500" step="any" value="${entry?.weight ?? ""}"></label>
        ${unitSelect("body-unit", entry?.unit || bodyUnit())}
      </div>
      <label>Body fat % <input id="body-fat" type="number" inputmode="decimal" min="1" max="80" step="any" value="${entry?.bodyFat ?? ""}"></label>
      <p class="error" role="alert"></p>
      ${dialogButtons}
      ${entry ? `<button type="button" class="link food-delete" data-food="body-delete">Delete this entry</button>` : ""}
    </form>`;
}

// Picking a date shows that day's entry. With none to show, what's been typed carries over.
function changeBodyDay(day) {
  const typed = [$("#body-weight").value, $("#body-unit").value, $("#body-fat").value];
  drawBodyLog(day);
  if (bodyLogs.some((l) => l.day === day)) return;
  [$("#body-weight").value, $("#body-unit").value, $("#body-fat").value] = typed;
}

function openBodyLog(day = localKey(new Date())) {
  drawBodyLog(day);
  $("#food").showModal();
}

async function sendBodyLog(form, body) {
  const btn = form.querySelector("button.primary");
  btn.disabled = true;
  try {
    ({ logs: bodyLogs } = await api("body", { body }));
    $("#food").close();
    toast(body.weight === "" && body.bodyFat === "" ? "Entry deleted" : "Saved");
    drawBody();
  } catch (ex) {
    form.querySelector(".error").textContent = ex.message;
    btn.disabled = false;
  }
}

function saveBodyLog(form) {
  const weight = $("#body-weight").value;
  const bodyFat = $("#body-fat").value;
  if (weight === "" && bodyFat === "") return (form.querySelector(".error").textContent = "Enter your weight or body fat.");
  return sendBodyLog(form, { day: $("#body-day").value, weight, unit: $("#body-unit").value, bodyFat });
}

async function deleteBodyLog() {
  const yes = await askConfirm({ title: "Delete this entry?" });
  if (!yes) return;
  await sendBodyLog($("#food-body-log"), { day: $("#body-day").value, weight: "", unit: "lb", bodyFat: "" });
}

// A hand-entered goal is the user's call, but a dangerously low one gets a word of caution.
function bodyGoalHint() {
  const box = $("#goal-hint");
  const cm = userGoals?.heightCm;
  if (!box || !cm) return;
  const goal = Number($("#goal-weight").value);
  const kg = $("#goal-unit").value === "lb" ? goal / LB_PER_KG : goal;
  box.textContent = goal > 0 && kg < lowestSafeWeight(cm) ? "This is very low for your height, so please talk to a doctor before aiming for it." : "";
}

function drawBodyGoalsForm() {
  const g = userGoals || {};
  $("#food-title").textContent = "Body goals";
  $("#food-body").innerHTML = `
    <form id="food-body-goals" class="food-form">
      <div class="food-qty">
        <label>Goal weight <input id="goal-weight" type="number" inputmode="decimal" min="1" max="1500" step="any" value="${g.weight ?? ""}"></label>
        ${unitSelect("goal-unit", g.weight ? g.weightUnit : bodyUnit())}
      </div>
      <p id="goal-hint" class="food-note muted"></p>
      <label>Goal body fat % <input id="goal-fat" type="number" inputmode="decimal" min="1" max="80" step="any" value="${g.bodyFat ?? ""}"></label>
      <p class="food-note muted">Leave a box empty for no goal.</p>
      <p class="error" role="alert"></p>
      ${dialogButtons}
      <button type="button" class="link food-delete" data-food="plan-open">Help me choose</button>
    </form>`;
  bodyGoalHint();
  $("#food").showModal();
}

const macroGoalInputs = () => ({ kcal: $("#goal-kcal"), protein: $("#goal-protein"), carbs: $("#goal-carbs"), fat: $("#goal-macro-fat") });

// The planner's answers, so a hand-entered target can be judged against the goal they're for.
function savedPlanAnswers() {
  const g = userGoals;
  if (!g?.plan || !g.heightCm || !g.birthYear) return null;
  const latest = bodyLogs?.find((l) => l.weight != null);
  if (!latest) return null;
  const kg = latest.unit === "kg" ? latest.weight : latest.weight / LB_PER_KG;
  const goalKg = g.weight ? (g.weightUnit === "kg" ? g.weight : g.weight / LB_PER_KG) : kg;
  const bodyFat = bodyLogs.find((l) => l.bodyFat != null)?.bodyFat || 0;
  return { sex: g.sex, age: new Date().getFullYear() - g.birthYear, cm: g.heightCm, kg, activity: g.activity, goal: g.plan, pace: g.pace, goalKg, bodyFat };
}

function drawMacroSum() {
  const f = macroGoalInputs();
  const m = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim() === "" ? null : Number(el.value) || 0]));
  const p = savedPlanAnswers();
  if (p) {
    const unit = bodyUnit();
    $("#macro-sum").textContent = "Calories follow your macros, and changing calories adjusts carbs.";
    $("#macro-review").innerHTML = macroReviewHtml(reviewMacros(m, p, (kg) => `${fmtOne(unit === "lb" ? kg * LB_PER_KG : kg)} ${unit}`));
    return;
  }
  $("#macro-review").innerHTML = "";
  $("#macro-sum").textContent = m.protein && m.carbs && m.fat ? "Calories follow your macros, and changing calories adjusts carbs. Build a plan to see how these suit your goal." : "Leave a box empty for no goal.";
}

function drawMacroGoalsForm() {
  const g = userGoals || {};
  const field = (id, label, value, max) => `<label>${label} <input id="${id}" data-macro type="number" inputmode="numeric" min="1" max="${max}" step="1" value="${value ?? ""}"></label>`;
  $("#food-title").textContent = "Macro goals";
  $("#food-body").innerHTML = `
    <form id="food-macro-goals" class="food-form">
      ${field("goal-kcal", "Calories", g.kcal, 20000)}
      <div class="row">${field("goal-protein", "Protein (g)", g.protein, 2000)}${field("goal-carbs", "Carbs (g)", g.carbs, 2000)}</div>
      ${field("goal-macro-fat", "Fat (g)", g.fat, 2000)}
      <p id="macro-sum" class="food-note muted"></p>
      <div id="macro-review" aria-live="polite"></div>
      <p class="error" role="alert"></p>
      ${dialogButtons}
      <button type="button" class="link food-delete" data-food="plan-open">Recommend for me</button>
    </form>`;
  drawMacroSum();
  $("#food").showModal();
}

// One goals record covers everything, so each form sends its own fields over the current values.
async function saveGoals(form, changes) {
  const btn = form.querySelector("button.primary");
  btn.disabled = true;
  try {
    ({ goals: userGoals } = await api("goals", { method: "PUT", body: { ...userGoals, ...changes } }));
    $("#food").close();
    toast("Goals saved");
    drawBody();
  } catch (ex) {
    form.querySelector(".error").textContent = ex.message;
    btn.disabled = false;
  }
}
