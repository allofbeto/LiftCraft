// The Stats views: one for meals, and one for each exercise.

const LB_PER_KG = 2.20462;

let mealStatsDays = 30;
let mealStatsData = null;
let mealStatsSeq = 0; // only the newest request may draw
let exerciseStatsDays = 90; // 0 means all time

// Reads a set line as written by commitSet: "9:14:02 AM · 135 lb × 8", "Bodyweight × L 5 / R 6".
// Anything else in a note is the user's own text and isn't counted.
const SET_LINE = /(?:^|·\s*)(?:(\d+(?:\.\d+)?)\s*(lb|kg)|bodyweight)\s*[×x]\s*(?:l\s*(\d+)\s*\/\s*r\s*(\d+)|(\d+))\s*$/i;

function parseSets(note) {
  const sets = [];
  for (const line of note.split("\n")) {
    const m = SET_LINE.exec(line.trim());
    if (!m) continue;
    const split = m[3] !== undefined;
    const left = Number(m[3]);
    const right = Number(m[4]);
    sets.push({
      weight: m[1] === undefined ? null : Number(m[1]),
      unit: m[2]?.toLowerCase() ?? null,
      reps: split ? left + right : Number(m[5]), // every rep moved, for volume
      best: split ? Math.max(left, right) : Number(m[5]), // what one side managed, for strength
      repsText: split ? `L ${left} / R ${right}` : m[5],
    });
  }
  return sets;
}

// Every day from start through today, as YYYY-MM-DD.
function daysSince(start) {
  const days = [];
  const today = localKey(new Date());
  const d = keyToDate(start);
  while (localKey(d) <= today) {
    days.push(localKey(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function lastDays(n) {
  const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  return daysSince(localKey(d));
}

const shortDay = (day) => keyToDate(day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const plural = (n, word) => `${fmtNumber(n)} ${word}${n === 1 ? "" : "s"}`;

// One bar per day, widening to weeks and then months as the range outgrows daily bars.
const bucketWord = (days) => (days.length <= 31 ? "day" : days.length <= 182 ? "week" : "month");

function statBuckets(days) {
  const word = bucketWord(days);
  if (word === "day") {
    return days.map((day) => ({ days: [day], label: keyToDate(day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) }));
  }
  const groups = new Map();
  for (const day of days) {
    const key = word === "week" ? localKey(startOfWeek(keyToDate(day))) : day.slice(0, 7);
    if (!groups.has(key)) {
      const label = word === "week" ? `Week of ${shortDay(key)}` : keyToDate(day).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      groups.set(key, { days: [], label });
    }
    groups.get(key).days.push(day);
  }
  return [...groups.values()];
}

const statAxis = (days) => (days.length === 1 ? [shortDay(days[0])] : [shortDay(days[0]), shortDay(days[Math.floor(days.length / 2)]), shortDay(days.at(-1))]);

const statCard = (title, note, body) => `
  <section class="panel report-card">
    <div class="chart-head"><h3>${esc(title)}</h3>${note ? `<span class="meta">${esc(note)}</span>` : ""}</div>
    ${body}
  </section>`;

const statTile = (value, label) => `<div class="stat"><div class="n">${esc(value)}</div><div class="l">${esc(label)}</div></div>`;

const rangePicker = (act, options, chosen) => `
  <div class="tabs range-picker" role="radiogroup" aria-label="Date range">
    ${options.map(([days, label]) => `<button role="radio" data-act="${act}" data-days="${days}" aria-checked="${days === chosen}" class="${days === chosen ? "active" : ""}">${label}</button>`).join("")}
  </div>`;

function markRange(days) {
  for (const b of document.querySelectorAll(".range-picker button")) {
    const on = Number(b.dataset.days) === days;
    b.classList.toggle("active", on);
    b.setAttribute("aria-checked", on);
  }
}

/* ---------- daily goals, set on the Profile screen ---------- */

let userGoals = null; // loaded once, then kept current by the forms in body.js

function resetGoals() {
  userGoals = null;
}

async function loadGoals() {
  if (userGoals) return userGoals;
  try {
    ({ goals: userGoals } = await api("goals"));
  } catch {
    /* goals are extra; the numbers beneath them still work */
  }
  return userGoals;
}

function goalMeter(label, have, goal, unit, status, over) {
  const pct = Math.min(100, (have / goal) * 100);
  return `<div class="goal">
    <div class="goal-head"><span>${label}</span><span class="meta">${fmtNumber(have)} / ${fmtNumber(goal)}${unit} · ${status}</span></div>
    <div class="meter${over ? " over" : ""}" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${Math.min(Math.round(have), goal)}"><i style="width:${pct}%"></i></div>
  </div>`;
}

// Protein is a minimum to reach, while the others are limits to stay within.
function goalMetersHtml(t) {
  const g = userGoals;
  if (!g) return "";
  const limit = (label, key, unit) => {
    if (!g[key]) return "";
    const left = Math.round(g[key] - t[key]);
    return goalMeter(label, t[key], g[key], unit, left >= 0 ? `${fmtNumber(left)}${unit} left` : `${fmtNumber(-left)}${unit} over`, left < 0);
  };
  const toGo = Math.round(g.protein - t.protein);
  const meters = [
    limit("Calories", "kcal", ""),
    g.protein ? goalMeter("Protein", t.protein, g.protein, " g", toGo > 0 ? `${fmtNumber(toGo)} g to go` : "✓ goal met", false) : "",
    limit("Carbs", "carbs", " g"),
    limit("Fat", "fat", " g"),
  ].join("");
  return `${meters}<button class="link goal-edit" data-go="#/profile">${meters ? "Edit goals in Profile" : "Get a calorie and macro plan in Profile"}</button>`;
}

/* ---------- meals ---------- */

const MEAL_RANGES = [[7, "7 days"], [30, "30 days"], [90, "90 days"]];

function dailyChartCard(title, days, byDay, key, unit, goal) {
  const logged = Object.values(byDay);
  const avg = sumOf(logged, key) / logged.length;
  const word = bucketWord(days);
  const rows = statBuckets(days).map((b) => {
    const hits = b.days.filter((d) => byDay[d]);
    const value = hits.length ? hits.reduce((t, d) => t + byDay[d][key], 0) / hits.length : 0;
    const text = !hits.length ? "Nothing logged" : word === "day" ? `${fmtNumber(value)} ${unit}` : `${fmtNumber(value)} ${unit} a day · ${plural(hits.length, "day")} logged`;
    return { label: b.label, value, text };
  });
  const table = chartTable("View as table", [word === "day" ? "Day" : "Week", title], rows.map((r) => [r.label, r.text]));
  const note = `Average ${fmtNumber(avg)} ${unit} a day${goal ? ` · line shows your ${fmtNumber(goal)} ${unit} goal` : ""}`;
  return statCard(title, note, columnChart({ label: `${title} per ${word}`, rows, xLabels: statAxis(days), line: goal || avg, table }));
}

function mealStatsHtml({ meals, foods }, days) {
  const byDay = {};
  const byMeal = {};
  for (const row of meals) {
    const day = (byDay[row.day] ??= { day: row.day, kcal: 0, protein: 0, carbs: 0, fat: 0 });
    for (const k of ["kcal", "protein", "carbs", "fat"]) day[k] += row[k] || 0;
    byMeal[row.meal] = (byMeal[row.meal] || 0) + (row.kcal || 0);
  }
  const logged = Object.values(byDay);
  if (!logged.length) return emptyHero("Nothing logged in this range. Log a meal to see your stats.");

  // Averages cover logged days only: a day with no entries is a gap in the log, not a fast.
  const avg = (k) => sumOf(logged, k) / logged.length;
  const top = logged.reduce((a, b) => (b.kcal > a.kcal ? b : a));

  const shares = macroShares({ protein: sumOf(logged, "protein"), carbs: sumOf(logged, "carbs"), fat: sumOf(logged, "fat") });
  const part = (k, name, color) => ({ name, color, share: shares[k], detail: `${fmtNumber(avg(k))} g${userGoals?.[k] ? ` of ${fmtNumber(userGoals[k])}` : ""}` });
  const hasMacros = shares.protein + shares.carbs + shares.fat > 0;

  const mealRows = Object.entries(MEAL_NAMES)
    .filter(([meal]) => byMeal[meal])
    .map(([meal, name]) => {
      const value = byMeal[meal] / logged.length;
      return { name, value, text: `${fmtNumber(value)} kcal` };
    });
  const goals = userGoals || {};
  // Calories count as on target within 10% either way, since the goal may be to gain or to lose.
  const kcalHits = goals.kcal ? logged.filter((d) => Math.abs(d.kcal - goals.kcal) <= goals.kcal * 0.1).length : 0;
  const proteinHits = goals.protein ? logged.filter((d) => d.protein >= goals.protein).length : 0;

  const foodRows = foods.map((f) => ({ name: f.name, value: f.kcal, text: `${fmtKcal(f.kcal)} kcal · ${f.times}×` }));

  return `
    <div class="stats">
      ${statTile(fmtNumber(avg("kcal")), "Average calories")}
      ${statTile(`${fmtNumber(avg("protein"))} g`, "Average protein")}
      ${statTile(`${logged.length} of ${days.length}`, "Days logged")}
      ${statTile(fmtNumber(top.kcal), `Highest day · ${shortDay(top.day)}`)}
      ${goals.kcal ? statTile(`${kcalHits} of ${logged.length}`, "Days within 10% of calorie goal") : ""}
      ${goals.protein ? statTile(`${proteinHits} of ${logged.length}`, "Days protein goal met") : ""}
    </div>
    ${hasMacros ? statCard("Macros", "Share of calories, with average grams a day", segmentedBar({ label: "Macros", parts: [part("protein", "Protein", "--viz-1"), part("carbs", "Carbs", "--viz-2"), part("fat", "Fat", "--viz-3")] })) : ""}
    ${dailyChartCard("Calories", days, byDay, "kcal", "kcal", goals.kcal)}
    ${dailyChartCard("Protein", days, byDay, "protein", "g", goals.protein)}
    ${statCard("Calories by meal", "Average on logged days", rankedBars(mealRows))}
    ${foodRows.length ? statCard("Top calorie sources", "Total calories, and times logged", rankedBars(foodRows)) : ""}`;
}

async function renderMealStats() {
  app.innerHTML = `
    ${topbar("Meals")}
    ${mealTabs("stats")}
    ${rangePicker("meal-range", MEAL_RANGES, mealStatsDays)}
    <div id="stats-body"><div class="stats">${skeletons("skel-stat", 4)}</div>${skeletons("skel-panel", 2)}</div>`;
  await loadMealStats();
}

// A range change keeps the old charts on screen, dimmed, until the new numbers arrive.
async function loadMealStats() {
  const seq = ++mealStatsSeq;
  const el = $("#stats-body");
  if (!el) return;
  const first = !!el.querySelector(".skel");
  el.classList.add("refreshing");
  try {
    const days = lastDays(mealStatsDays);
    const [data] = await Promise.all([api(`nutrition?from=${days[0]}&to=${days.at(-1)}`), loadGoals()]);
    if (seq !== mealStatsSeq || !$("#stats-body")) return;
    mealStatsData = data;
    clearChartTip();
    $("#stats-body").innerHTML = mealStatsHtml(mealStatsData, days);
    if (first) animateIn($("#stats-body"));
  } catch (ex) {
    if (seq !== mealStatsSeq || !$("#stats-body")) return;
    if (first) $("#stats-body").innerHTML = `<div class="empty">${esc(ex.message)}</div>`;
    else toast(ex.message, { error: true });
  } finally {
    if (seq === mealStatsSeq) $("#stats-body")?.classList.remove("refreshing");
  }
}

function setMealStatsRange(days) {
  mealStatsDays = days;
  markRange(days);
  return loadMealStats();
}

/* ---------- one exercise ---------- */

const EXERCISE_RANGES = [[30, "30 days"], [90, "90 days"], [365, "1 year"], [0, "All"]];

// Every set in an exercise's notes, with its weight in whichever unit the user mostly lifts in.
function exerciseSummary(notes) {
  const sets = Object.entries(notes).flatMap(([day, note]) => parseSets(note).map((s) => ({ ...s, day })));
  const kg = sets.filter((s) => s.unit === "kg").length;
  const lb = sets.filter((s) => s.unit === "lb").length;
  const unit = kg > lb ? "kg" : "lb";
  for (const s of sets) {
    s.load = s.weight === null ? null : s.unit === unit ? s.weight : unit === "lb" ? s.weight * LB_PER_KG : s.weight / LB_PER_KG;
    // Epley: puts a heavy triple and a lighter set of ten on the same scale.
    s.e1rm = s.load === null || s.best < 1 ? null : s.best === 1 ? s.load : s.load * (1 + s.best / 30);
    s.text = s.weight === null ? `Bodyweight × ${s.repsText}` : `${s.weight} ${s.unit} × ${s.repsText}`;
  }
  return { sets, unit, weighted: sets.some((s) => s.e1rm !== null) };
}

const volumeOf = (sets) => sets.reduce((t, s) => t + (s.load === null ? 0 : s.load * s.reps), 0);
const repsOf = (sets) => sets.reduce((t, s) => t + s.reps, 0);

function groupByDay(sets) {
  const groups = new Map();
  for (const s of sets) {
    if (!groups.has(s.day)) groups.set(s.day, []);
    groups.get(s.day).push(s);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

const bestBy = (sets, key) => sets.reduce((a, b) => (b[key] > (a?.[key] ?? -Infinity) ? b : a), null);

// All-time bests, so they stay put whichever range is chosen.
function exerciseRecordsHtml({ sets, unit, weighted }) {
  const sessions = groupByDay(sets);
  if (weighted) {
    const withLoad = sets.filter((s) => s.e1rm !== null);
    const strongest = bestBy(withLoad, "e1rm");
    const heaviest = bestBy(withLoad, "load");
    const biggest = sessions.reduce((a, b) => (volumeOf(b[1]) > volumeOf(a[1]) ? b : a));
    return `
      ${statTile(`${fmtNumber(strongest.e1rm)} ${unit}`, `Best est. 1RM · ${strongest.text}`)}
      ${statTile(`${fmtNumber(heaviest.load)} ${unit}`, `Heaviest set · × ${heaviest.repsText}, ${shortDay(heaviest.day)}`)}
      ${statTile(`${fmtCompact(volumeOf(biggest[1]))} ${unit}`, `Biggest session · ${shortDay(biggest[0])}`)}
      ${statTile(sessions.length, "Days trained")}`;
  }
  const most = bestBy(sets, "best");
  const biggest = sessions.reduce((a, b) => (repsOf(b[1]) > repsOf(a[1]) ? b : a));
  return `
    ${statTile(most.best, `Most reps in a set · ${shortDay(most.day)}`)}
    ${statTile(repsOf(biggest[1]), `Most reps in a day · ${shortDay(biggest[0])}`)}
    ${statTile(fmtNumber(repsOf(sets)), "Total reps")}
    ${statTile(sessions.length, "Days trained")}`;
}

function strengthCardHtml(sessions, days, { unit, weighted }) {
  const key = weighted ? "e1rm" : "best";
  const measure = weighted ? `${unit} est. 1RM` : "reps";
  const points = sessions
    .map(([day, sets]) => ({ day, set: bestBy(sets.filter((s) => s[key] !== null), key) }))
    .filter((p) => p.set && p.set[key] > 0)
    .map((p) => ({ ...p, score: p.set[key] }));
  if (!points.length) return "";
  const start = keyToDate(days[0]);
  const rows = points.map((p) => ({
    x: Math.round((keyToDate(p.day) - start) / 864e5) / Math.max(days.length - 1, 1),
    value: p.score,
    label: `${shortDay(p.day)} · ${p.set.text}`,
    text: `${fmtNumber(p.score)} ${measure}`,
  }));
  const change = Math.round(points.at(-1).score) - Math.round(points[0].score);
  const note = `Latest ${fmtNumber(points.at(-1).score)} ${measure}${points.length > 1 ? ` · ${change > 0 ? "+" : ""}${fmtNumber(change)} ${weighted ? unit : "reps"} over this range` : ""}`;
  const table = chartTable("View as table", ["Day", "Best set", weighted ? "Est. 1RM" : "Reps"], points.map((p) => [shortDay(p.day), p.set.text, fmtNumber(p.score)]));
  return statCard(weighted ? "Strength" : "Best set", note, lineChart({ label: `${weighted ? "Estimated one-rep max" : "Most reps in a set"} over time`, rows, xLabels: statAxis(days), table }));
}

function workloadCardHtml(sets, days, { unit, weighted }) {
  const word = bucketWord(days);
  const rows = statBuckets(days).map((b) => {
    const inBucket = sets.filter((s) => b.days.includes(s.day));
    const value = weighted ? volumeOf(inBucket) : repsOf(inBucket);
    const text = !inBucket.length ? "No sets" : `${fmtNumber(value)} ${weighted ? unit : "reps"} · ${plural(inBucket.length, "set")}`;
    return { label: b.label, value, text };
  });
  const title = weighted ? "Volume" : "Total reps";
  const table = chartTable("View as table", [word === "day" ? "Day" : word === "week" ? "Week" : "Month", title], rows.map((r) => [r.label, r.text]));
  return statCard(title, `${weighted ? "Weight × reps" : "Reps"} per ${word}`, columnChart({ label: `${title} per ${word}`, rows, xLabels: statAxis(days), table }));
}

function exerciseRangeHtml(summary) {
  const { sets, unit, weighted } = summary;
  const firstDay = sets.reduce((a, s) => (s.day < a ? s.day : a), localKey(new Date()));
  const days = exerciseStatsDays ? lastDays(exerciseStatsDays) : daysSince(firstDay);
  const inRange = sets.filter((s) => s.day >= days[0]);
  if (!inRange.length) return `<div class="empty">No sets in this range.</div>`;

  const sessions = groupByDay(inRange);
  const recent = sessions.slice(-10).reverse();
  const sessionRows = recent.map(([day, list]) => {
    const key = weighted ? "e1rm" : "best";
    const top = bestBy(list.filter((s) => s[key] !== null), key) || list[0];
    return [shortDay(day), top.text, list.length, weighted ? `${fmtNumber(volumeOf(list))} ${unit}` : fmtNumber(repsOf(list))];
  });
  return `
    <div class="stats">
      ${statTile(sessions.length, "Sessions")}
      ${statTile(fmtNumber(inRange.length), "Sets")}
      ${weighted ? statTile(`${fmtCompact(volumeOf(inRange))} ${unit}`, "Volume") : statTile(fmtNumber(repsOf(inRange)), "Total reps")}
      ${statTile(Math.round((inRange.length / sessions.length) * 10) / 10, "Sets per session")}
    </div>
    ${strengthCardHtml(sessions, days, summary)}
    ${workloadCardHtml(inRange, days, summary)}
    ${statCard("Recent sessions", sessions.length > 10 ? "Latest 10, with each day's best set" : "With each day's best set", `<div class="chart-table"><table>
        <thead><tr><th scope="col">Day</th><th scope="col">Best set</th><th scope="col">Sets</th><th scope="col">${weighted ? "Volume" : "Reps"}</th></tr></thead>
        <tbody>${sessionRows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>`)}`;
}

function drawExerciseStats() {
  const { exercise: x, notes } = detail;
  const summary = exerciseSummary(notes);
  const sub = [x.equipment, x.muscle].filter(Boolean).join(" · ");
  app.innerHTML = `
    ${topbar("", { back: `#/exercise/${x.id}` })}
    <header class="hdr">
      <div class="eyebrow">Exercise Stats</div>
      <h1>${esc(x.name)}</h1>
      ${sub ? `<div class="sub">${esc(sub)}</div>` : ""}
    </header>
    ${
      summary.sets.length
        ? `<h2 class="section">All time</h2>
           <div class="stats">${exerciseRecordsHtml(summary)}</div>
           <h2 class="section">Over time</h2>
           ${rangePicker("exercise-range", EXERCISE_RANGES, exerciseStatsDays)}
           <div id="stats-body">${exerciseRangeHtml(summary)}</div>`
        : emptyHero("Log a set to see stats for this exercise.")
    }`;
}

function setExerciseStatsRange(days) {
  exerciseStatsDays = days;
  markRange(days);
  clearChartTip();
  $("#stats-body").innerHTML = exerciseRangeHtml(exerciseSummary(detail.notes));
  animateIn($("#stats-body"));
}
