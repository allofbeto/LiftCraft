// The goal planner: a full-screen flow that ends in calorie, macro and body goals.
// Each step has its own address (#/plan/2), so the device's back button walks back through it.

const PLAN_STEPS = ["welcome", "goal", "basics", "body", "activity", "target", "result"];
const LAST_QUESTION = PLAN_STEPS.length - 2;

let plan = null; // the answers so far, as typed

function resetPlan() {
  plan = null;
}

const planKg = () => (plan.unit === "lb" ? Number(plan.weight) / LB_PER_KG : Number(plan.weight));
const planCm = () => (plan.unit === "lb" ? (Number(plan.feet) * 12 + Number(plan.inches || 0)) * 2.54 : Number(plan.cm));
const planGoalKg = () => (goalHasWeight(plan.goal) ? fromPlanUnit(Number(plan.goalWeight)) : planKg());
const planAnswers = () => ({ sex: plan.sex, age: Number(plan.age), cm: planCm(), kg: planKg(), activity: plan.activity, goal: plan.goal, pace: plan.pace, goalKg: planGoalKg(), bodyFat: Number(plan.bodyFat) || 0 });
const toPlanUnit = (kg) => (plan.unit === "lb" ? kg * LB_PER_KG : kg);
const fromPlanUnit = (v) => (plan.unit === "lb" ? v / LB_PER_KG : v);
const planWeight = (kg) => `${fmtOne(toPlanUnit(kg))} ${plan.unit}`;
const round1 = (v) => String(Math.round(v * 10) / 10);

function setHeightFromCm(cm) {
  const totalIn = Math.round(cm / 2.54);
  plan.feet = String(Math.floor(totalIn / 12));
  plan.inches = String(totalIn % 12);
  plan.cm = String(Math.round(cm));
}

function newPlan() {
  const g = userGoals || {};
  const asc = [...(bodyLogs || [])].reverse();
  const latest = asc.filter((l) => l.weight != null).at(-1);
  const unit = bodyUnit();
  plan = {
    first: g.plan ? 1 : 0, // someone updating a plan has no need of the welcome
    at: null,
    unit,
    sex: g.sex || null,
    age: g.birthYear ? String(new Date().getFullYear() - g.birthYear) : "",
    feet: "",
    inches: "",
    cm: "",
    weight: latest ? round1(convertWeight(latest.weight, latest.unit, unit)) : "",
    bodyFat: asc.filter((l) => l.bodyFat != null).at(-1)?.bodyFat?.toString() ?? "",
    activity: g.activity || null,
    goal: g.plan || null,
    pace: g.pace || "steady",
    goalWeight: g.weight && goalHasWeight(g.plan) ? round1(convertWeight(g.weight, g.weightUnit, unit)) : "",
    goalFat: g.bodyFat?.toString() ?? "",
    style: "balanced",
    macros: null,
    macrosFor: null,
  };
  if (g.plan && !g.sex) plan.sex = "";
  if (g.heightCm) setHeightFromCm(g.heightCm);
}

function startPlan() {
  plan = null;
  location.hash = "#/plan/0";
}

/* ---------- moving between steps ---------- */

// Saves what's on screen, whichever way the user is leaving it.
function readPlanStep() {
  const checked = (name, fallback) => document.querySelector(`[name="${name}"]:checked`)?.value ?? fallback;
  const value = (id, fallback) => ($(id) ? $(id).value.trim() : fallback);
  if (plan?.at === "basics") {
    plan.age = value("#plan-age", plan.age);
    plan.sex = checked("plan-sex", plan.sex);
  } else if (plan?.at === "body") {
    plan.feet = value("#plan-feet", plan.feet);
    plan.inches = value("#plan-inches", plan.inches);
    plan.cm = value("#plan-cm", plan.cm);
    plan.weight = value("#plan-weight", plan.weight);
    plan.bodyFat = value("#plan-fat", plan.bodyFat);
  } else if (plan?.at === "activity") plan.activity = checked("plan-activity", plan.activity);
  else if (plan?.at === "goal") plan.goal = checked("plan-goal", plan.goal);
  else if (plan?.at === "target") {
    plan.pace = checked("plan-pace", plan.pace);
    plan.goalWeight = value("#plan-goal-weight", plan.goalWeight);
    plan.goalFat = value("#plan-goal-fat", plan.goalFat);
  } else if (plan?.at === "result" && $("#plan-kcal")) {
    plan.macros = { kcal: $("#plan-kcal").value, protein: $("#plan-protein").value, carbs: $("#plan-carbs").value, fat: $("#plan-macro-fat").value };
  }
}

// Why a step's answers can't be used yet, or "" when they can.
function planProblem(step) {
  if (step === "basics") {
    const age = Number(plan.age);
    if (!Number.isInteger(age) || age < 1 || age > 120) return "Enter your age in years.";
    if (age < MIN_PLAN_AGE) return "These recommendations are only for adults. A doctor or registered dietitian can help you set goals for your age.";
    if (plan.sex === null) return "Choose one of the options, or “Prefer not to say”.";
  }
  if (step === "body") {
    const cm = planCm();
    if (!(cm >= 120 && cm <= 250)) return "Enter your height.";
    const kg = planKg();
    if (!(kg >= 30 && kg <= 350)) return "Enter your weight.";
    if (plan.bodyFat !== "" && !(Number(plan.bodyFat) >= 2 && Number(plan.bodyFat) <= 80)) return "Enter body fat as a percentage, or leave it empty.";
    if (plan.goal === "lose" && kg < lowestSafeWeight(cm)) return "Losing more isn't something we can plan for at this weight. Go back and choose another goal, or talk to a doctor or dietitian.";
  }
  if (step === "activity" && !plan.activity) return "Choose the closest match.";
  if (step === "goal" && !plan.goal) return "Choose your main goal.";
  if (step === "target") {
    const p = planAnswers();
    if (goalHasWeight(plan.goal)) {
      const goalKg = fromPlanUnit(Number(plan.goalWeight));
      if (!(goalKg > 0)) return "Enter a goal weight.";
      const problem = goalWeightProblem(p, goalKg);
      if (problem === "tooHigh") return "To lose weight, your goal needs to be below your current weight.";
      if (problem === "tooLow") return "To gain weight, your goal needs to be above your current weight.";
      if (problem === "tooLowForHeight") return `That's lower than we can safely plan for at your height. The lowest goal we can plan for is ${planWeight(lowestSafeWeight(p.cm))}.`;
    }
    if (plan.goalFat !== "") {
      const fat = Number(plan.goalFat);
      if (!(fat > 0 && fat <= 80)) return "Enter goal body fat as a percentage, or leave it empty.";
      if (fat < MIN_BODY_FAT[plan.sex]) return `We can't plan for under ${MIN_BODY_FAT[plan.sex]}% body fat, because going that low isn't healthy.`;
    }
  }
  return "";
}

async function renderPlan(rawStep) {
  if (!plan) {
    if (!bodyLogs) await loadBody();
    if (current?.view !== "plan") return; // navigated away while loading
    newPlan();
  }
  readPlanStep();
  const wanted = Number.isInteger(rawStep) && PLAN_STEPS[rawStep] ? rawStep : plan.first;
  // Nothing past an unanswered step can be shown, however the address was reached.
  let step = Math.max(wanted, plan.first);
  for (let i = 1; i < step; i++) {
    if (planProblem(PLAN_STEPS[i])) step = i;
  }
  if (step !== rawStep) history.replaceState(null, "", `#/plan/${step}`);
  plan.at = PLAN_STEPS[step];
  plan.step = step;
  if (plan.at === "target") planFitGoalWeight();
  ({ welcome: drawPlanWelcome, goal: drawPlanGoal, basics: drawPlanBasics, body: drawPlanBody, activity: drawPlanActivity, target: drawPlanTarget, result: drawPlanResult })[plan.at]();
}

// A goal weight carried over from before only stands if it still fits the chosen goal.
function planFitGoalWeight() {
  if (!goalHasWeight(plan.goal)) return;
  const p = planAnswers();
  if (plan.goalWeight === "" || goalWeightProblem(p, fromPlanUnit(Number(plan.goalWeight)))) plan.goalWeight = round1(toPlanUnit(suggestGoalWeight(p)));
}

function planNext() {
  readPlanStep();
  const problem = planProblem(plan.at);
  if (problem) {
    const err = $("#wiz-error");
    err.textContent = problem;
    err.closest(".wiz-foot").animate?.([{ transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "none" }], { duration: 180 });
    return;
  }
  if (plan.at === "result") return savePlan();
  location.hash = `#/plan/${plan.step + 1}`;
}

// The back arrow retraces history, so the device's back button agrees with it.
function planBack() {
  if (plan.step > plan.first) history.back();
  else planClose();
}

async function planClose() {
  readPlanStep();
  const started = plan.step > plan.first;
  if (started && !(await askConfirm({ title: "Leave without saving?", message: "Your answers won't be kept.", confirmLabel: "Leave" }))) return;
  plan = null;
  location.hash = "#/profile";
}

/* ---------- shared pieces ---------- */

function wizFrame({ title, intro = "", body, next = "Continue" }) {
  const total = LAST_QUESTION;
  const done = Math.min(plan.step, total + 1);
  const pct = (done / (total + 1)) * 100;
  app.innerHTML = `
    <div class="wiz">
      <div class="wiz-top">
        <button class="icon-btn" type="button" data-plan="${plan.step > plan.first ? "back" : "close"}" aria-label="${plan.step > plan.first ? "Back" : "Close"}">${plan.step > plan.first ? "←" : "✕"}</button>
        <div class="wiz-progress" role="progressbar" aria-label="Your progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${pct}%"></i></div>
        ${plan.step > plan.first ? `<button class="icon-btn" type="button" data-plan="close" aria-label="Close">✕</button>` : ""}
      </div>
      <form id="wiz-form" class="wiz-form" novalidate>
        <div class="wiz-scroll">
          <div class="wiz-body">
            ${plan.at === "result" ? "" : plan.step > 0 ? `<div class="eyebrow">Step ${plan.step} of ${total}</div>` : ""}
            <h1 class="wiz-title">${title}</h1>
            ${intro ? `<p class="wiz-intro">${intro}</p>` : ""}
            ${body}
          </div>
        </div>
        <div class="wiz-foot">
          <div class="wiz-foot-inner">
            ${plan.at === "result" ? `<div id="plan-status" class="plan-status" aria-live="polite"></div>` : ""}
            <p class="error" id="wiz-error" role="alert"></p>
            <button class="primary wiz-next" type="submit">${next}</button>
          </div>
        </div>
      </form>
    </div>`;
}

const planChoices = (name, chosen, options) => `
  <div class="choices wiz-choices" role="radiogroup">
    ${options
      .map(
        (o) => `<label class="choice${o.disabled ? " disabled" : ""}">
          <input type="radio" name="${name}" value="${o.id}"${o.id === chosen ? " checked" : ""}${o.disabled ? " disabled" : ""}>
          <span><strong>${esc(o.name)}</strong>${o.detail ? `<small>${esc(o.detail)}</small>` : ""}</span>
        </label>`,
      )
      .join("")}
  </div>`;

const wizNumber = (id, label, value, suffix = "") => `
  <label class="wiz-field">${label}
    <span class="wiz-input"><input id="${id}" type="number" inputmode="decimal" step="any" value="${esc(value)}">${suffix ? `<em>${suffix}</em>` : ""}</span>
  </label>`;

/* ---------- the steps ---------- */

function drawPlanWelcome() {
  wizFrame({
    title: "Let's build your plan",
    intro: "Tell us what you want to achieve, and we'll recommend how to eat and train for it.",
    next: "Get started",
    body: `
      <img class="wiz-mascot" src="/brand/mascot.png" width="253" height="224" alt="">
      <ul class="wiz-list">
        <li><strong>Daily calories</strong><span>Based on your age, height, weight and activity</span></li>
        <li><strong>Protein, carbs and fat</strong><span>Split to suit how you like to eat</span></li>
        <li><strong>How to train for it</strong><span>Plus a realistic pace and an estimated date</span></li>
      </ul>
      <p class="wiz-note">Takes about a minute. You can change anything before saving.</p>`,
  });
}

function drawPlanBasics() {
  wizFrame({
    title: "First, the basics",
    intro: "Age and sex both change how many calories your body uses at rest.",
    body: `
      ${wizNumber("plan-age", "Your age", plan.age, "years")}
      <div class="plan-label wiz-label">Sex</div>
      ${planChoices("plan-sex", plan.sex, [
        { id: "female", name: "Female" },
        { id: "male", name: "Male" },
        { id: "", name: "Prefer not to say", detail: "We'll use the midpoint of both formulas, which is a little less precise" },
      ])}`,
  });
}

function drawPlanBody() {
  const lb = plan.unit === "lb";
  wizFrame({
    title: "Your height and weight",
    intro: "A recent estimate is fine.",
    body: `
      <div class="tabs wiz-units" role="radiogroup" aria-label="Units">
        <button type="button" role="radio" data-plan="unit" data-unit="lb" aria-checked="${lb}" class="${lb ? "active" : ""}">lb, ft, in</button>
        <button type="button" role="radio" data-plan="unit" data-unit="kg" aria-checked="${!lb}" class="${lb ? "" : "active"}">kg, cm</button>
      </div>
      ${lb ? `<div class="row">${wizNumber("plan-feet", "Height", plan.feet, "ft")}${wizNumber("plan-inches", "&nbsp;", plan.inches, "in")}</div>` : wizNumber("plan-cm", "Height", plan.cm, "cm")}
      ${wizNumber("plan-weight", "Weight", plan.weight, plan.unit)}
      ${wizNumber("plan-fat", "Body fat (optional)", plan.bodyFat, "%")}
      <p class="wiz-note">Skip body fat if you don't know it. Your plan works without it.</p>`,
  });
}

function setPlanUnit(unit) {
  readPlanStep();
  const kg = plan.weight === "" ? null : planKg();
  const cm = planCm();
  const goalKg = plan.goalWeight === "" ? null : fromPlanUnit(Number(plan.goalWeight));
  plan.unit = unit;
  // Kilograms keep an extra digit, so switching units and back returns the number that was typed.
  const typed = (w) => (unit === "kg" ? String(Math.round(w * 100) / 100) : round1(toPlanUnit(w)));
  if (kg !== null) plan.weight = typed(kg);
  if (cm > 0) setHeightFromCm(cm);
  if (goalKg !== null) plan.goalWeight = typed(goalKg);
  drawPlanBody();
}

function drawPlanActivity() {
  wizFrame({
    title: "How active are you?",
    intro: "Your body burns calories even at rest, and movement adds to that. Think about a typical week, including your job. If you're between two, pick the lower one.",
    body: planChoices("plan-activity", plan.activity, ACTIVITY_LEVELS.map((a) => ({ ...a, detail: `${a.detail}. Adds about ${fmtNumber(Math.round((basalCalories(planAnswers()) * (a.factor - 1)) / 10) * 10)} calories a day` }))),
  });
}

function drawPlanGoal() {
  wizFrame({
    title: "What's your main goal?",
    intro: "Pick the one that matters most right now. You can change it any time.",
    body: planChoices("plan-goal", plan.goal, Object.entries(PLAN_GOALS).map(([id, g]) => ({ id, name: g.name, detail: g.detail }))),
  });
}

const TARGET_INTROS = {
  tone: "Your weight may barely move while you tone, so body fat and your lifts are better ways to see progress. A body fat goal is optional.",
  strength: "Your weight should climb slowly as your lifts go up. A body fat goal is optional.",
  maintain: "A body fat goal is optional.",
};

function drawPlanTarget() {
  const p = planAnswers();
  const unit = plan.unit;
  const weighted = goalHasWeight(plan.goal);
  const fit = FIT_BODY_FAT[plan.sex];
  const paces = weighted ? PLAN_PACES[plan.goal].map((x) => ({ id: x.id, name: x.name, detail: `About ${fmtOne(toPlanUnit((x.pct / 100) * p.kg))} ${unit} a week` })) : [];
  wizFrame({
    title: weighted ? "How much, and how fast?" : "Any body fat goal?",
    intro: weighted ? "We suggested a first milestone. You can always set a new one after you reach it." : TARGET_INTROS[plan.goal],
    next: "See my plan",
    body: `
      ${
        weighted
          ? `${wizNumber("plan-goal-weight", "Goal weight", plan.goalWeight, unit)}
             <div class="plan-label wiz-label">Pace</div>
             ${planChoices("plan-pace", plan.pace, paces)}
             <p id="plan-summary" class="plan-summary wiz-summary"></p>`
          : ""
      }
      ${wizNumber("plan-goal-fat", "Goal body fat (optional)", plan.goalFat, "%")}
      ${fit ? `<p class="wiz-note">A typical fit range is ${fit} for your sex.</p>` : ""}
      <div id="plan-fat-hint"></div>`,
  });
  drawPlanSummary();
  drawPlanFatHint();
}

// With both body fat numbers, the goal weight can come from keeping the muscle already there.
function drawPlanFatHint() {
  const box = $("#plan-fat-hint");
  if (!box) return;
  const now = Number(plan.bodyFat);
  const goal = Number($("#plan-goal-fat").value);
  if (!(now > 0 && goal > 0 && goal < 80)) return (box.innerHTML = "");
  const kg = weightAtBodyFat(planKg(), now, goal);
  const offer = plan.goal === "lose" && kg < planKg() ? `<button type="button" class="link" data-plan="use-weight" data-kg="${kg}">Use as goal weight</button>` : "";
  box.innerHTML = `<p class="wiz-note">Keeping the muscle you have now, ${fmtOne(goal)}% body fat is about <strong>${planWeight(kg)}</strong>. ${offer}</p>`;
}

const planDate = (weeks) => {
  const d = new Date();
  d.setDate(d.getDate() + Math.ceil(weeks * 7));
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
};

function drawPlanSummary() {
  const box = $("#plan-summary");
  if (!box) return;
  const p = { ...planAnswers(), pace: document.querySelector('[name="plan-pace"]:checked')?.value ?? plan.pace };
  const goalKg = fromPlanUnit(Number($("#plan-goal-weight").value));
  if (!(goalKg > 0) || goalWeightProblem(p, goalKg)) return (box.textContent = "");
  const { weeklyKg } = planCalories(p);
  const weeks = weeklyKg > 0 ? Math.abs(goalKg - p.kg) / weeklyKg : 0;
  box.textContent = weeks ? `About ${Math.ceil(weeks)} weeks to ${planWeight(goalKg)}, around ${planDate(weeks)}.` : "";
}

function drawPlanResult() {
  const p = planAnswers();
  const c = planCalories(p);
  // Answers changed since these were worked out, so anything typed over them no longer applies.
  const key = JSON.stringify([p, plan.goalWeight, plan.style]);
  if (plan.macrosFor !== key) {
    plan.macros = planMacros(c.target, p, plan.style);
    plan.macrosFor = key;
    plan.recommended = plan.macros.kcal;
    plan.flooredAt = c.floored ? c.target : null;
  }
  const m = plan.macros;
  const field = (id, label, value, color, unit) => `
    <label class="macro-card">
      <span class="macro-card-name">${color ? `<i class="key" style="background:var(${color})"></i>` : ""}${label}</span>
      <span class="wiz-input"><input id="${id}" data-plan-macro type="number" inputmode="numeric" min="1" step="1" value="${esc(value)}"><em>${unit}</em></span>
    </label>`;
  wizFrame({
    title: "Your plan is ready",
    next: "Use this plan",
    body: `
      <div class="plan-target wiz-target">
        <div class="n" id="plan-hero">0</div>
        <div class="l">calories a day</div>
      </div>
      <div id="plan-breakdown"></div>
      <p class="plan-why wiz-center" id="plan-why"></p>
      <p class="plan-warn" id="plan-floored" hidden></p>
      <div class="plan-label wiz-label">How do you like to eat?</div>
      <div class="tabs plan-styles" role="radiogroup" aria-label="Macro style">
        ${Object.entries(MACRO_STYLES).map(([id, s]) => `<button type="button" role="radio" data-plan="style" data-style="${id}" aria-checked="${id === plan.style}" class="${id === plan.style ? "active" : ""}">${s.name}</button>`).join("")}
      </div>
      <div class="macro-bar wiz-bar" id="plan-bar" aria-hidden="true"><i style="background:var(--viz-1)"></i><i style="background:var(--viz-2)"></i><i style="background:var(--viz-3)"></i></div>
      <div class="macro-cards">
        ${field("plan-protein", "Protein", m.protein, "--viz-1", "g")}
        ${field("plan-carbs", "Carbs", m.carbs, "--viz-2", "g")}
        ${field("plan-macro-fat", "Fat", m.fat, "--viz-3", "g")}
        ${field("plan-kcal", "Calories", m.kcal, "", "kcal")}
      </div>
      <p class="wiz-note">Change any number. Calories follow your macros, and changing calories adjusts carbs.</p>
      <div id="plan-review"></div>
      <div class="plan-train"><strong>How to train</strong><span>${PLAN_GOALS[plan.goal].training}</span></div>
      <p class="wiz-note">These are estimates to start from, not medical advice. If you're pregnant, nursing, or managing a health condition or a history of disordered eating, check with a doctor or dietitian first. After 2–3 weeks, adjust based on how your weight actually changes.</p>`,
  });
  const target = Number(m.kcal);
  drawPlanLive(false);
  countTo($("#plan-hero"), plan.heroShown ?? 0, target, fmtNumber); // only the first reveal counts up
  plan.heroShown = target;
}

// Everything on the plan screen that depends on the numbers being edited.
function drawPlanLive(setHero = true) {
  const p = planAnswers();
  const v = (id) => ($(id).value.trim() === "" ? null : Number($(id).value) || 0);
  const m = { kcal: v("#plan-kcal"), protein: v("#plan-protein"), carbs: v("#plan-carbs"), fat: v("#plan-macro-fat") };
  if (setHero) {
    $("#plan-hero").textContent = fmtNumber(m.kcal);
    plan.heroShown = m.kcal;
  }
  // Editing mustn't collapse the math if it's open.
  const box = $("#plan-breakdown");
  const open = !!box.querySelector("details[open]");
  box.innerHTML = calorieBreakdownHtml(p, m.kcal);
  if (open) box.querySelector("details").open = true;

  const weeks = planWeeksAt(m.kcal, p);
  const why = $("#plan-why");
  why.hidden = !weeks;
  if (weeks) {
    why.innerHTML = `About ${fmtOne(toPlanUnit(Math.abs(p.goalKg - p.kg) / weeks))} ${plan.unit} a week, reaching <strong>${planWeight(p.goalKg)}</strong> around <strong>${planDate(weeks)}</strong>.`;
  }

  const floored = $("#plan-floored");
  floored.hidden = !(plan.flooredAt && m.kcal === plan.recommended);
  if (!floored.hidden) floored.textContent = `We stopped at ${fmtNumber(plan.flooredAt)} calories, since eating less is hard to do safely on your own. That makes progress slower than the pace you picked.`;

  const shares = macroShares(m);
  const parts = $("#plan-bar").children;
  ["protein", "carbs", "fat"].forEach((k, i) => (parts[i].style.flexGrow = shares[k]));
  const review = reviewMacros(m, p, planWeight);
  $("#plan-review").innerHTML = macroReviewHtml(review);
  drawPlanStatus(review);
}

// The numbers being edited push the details off screen, so the one that matters most stays pinned.
function drawPlanStatus(review) {
  const box = $("#plan-status");
  const worst = review.find((i) => i.level === "stop") || review.find((i) => i.level === "warn");
  const others = review.filter((i) => i.level !== "ok").length - 1;
  box.innerHTML = worst
    ? macroReviewHtml([{ ...worst, text: `${worst.text}${others > 0 ? ` (+${others} more below)` : ""}` }])
    : macroReviewHtml([{ name: "Looks good", level: "ok", text: "for your goal." }]);
}

// How long the goal weight takes at these calories, or null if they don't head toward it.
function planWeeksAt(kcal, p) {
  if (!goalHasWeight(p.goal)) return null;
  const change = kcal - maintenanceCalories(p);
  const towardGoal = p.goal === "lose" ? -change : change;
  return towardGoal > 0 ? Math.abs(p.goalKg - p.kg) / ((towardGoal * 7) / KCAL_PER_KG) : null;
}

// Explains the day's calories: what the body uses at rest, what movement adds, and the goal's adjustment.
function calorieBreakdownHtml(p, target) {
  const b = calorieBreakdown(p, target);
  const pct = (b.bmr / b.burn) * 100;
  const offset = p.sex === "male" ? "+ 5" : p.sex === "female" ? "− 161" : "− 78";
  const offsetNote = p.sex ? "" : " (the midpoint of the male and female formulas)";
  const line = (label, value, detail, color, extraClass = "") => `
    <div class="cal-line ${extraClass}">
      <div class="cal-line-head"><span>${color ? `<i class="key" style="background:var(${color})"></i>` : ""}${label}</span><b>${value}</b></div>
      ${detail ? `<p>${detail}</p>` : ""}
    </div>`;
  const hasTarget = target > 0;
  const even = Math.abs(b.change) <= 25; // macros round to 5 g, so "maintain" rarely lands exactly on the number
  return `<section class="cal-breakdown">
    <h3>Your calories a day</h3>
    <div class="macro-bar wiz-bar" aria-hidden="true"><i style="background:var(--viz-1);flex-grow:${pct}"></i><i style="background:var(--viz-2);flex-grow:${100 - pct}"></i></div>
    ${line("BMR (basal metabolic rate)", fmtNumber(b.bmr), "What your body burns at complete rest, just to stay alive: breathing, heartbeat, brain and body temperature. It depends on your age, height, weight and sex.", "--viz-1")}
    ${line("Physical activity", `+${fmtNumber(b.activity)}`, `Everything on top of that: workouts, walking, your job and daily movement, plus digesting food. This comes from choosing “${esc(b.level.name)}”.`, "--viz-2")}
    ${line("What you burn", fmtNumber(b.burn), "", "", "cal-total")}
    ${
      hasTarget
        ? `${line(even ? "About even" : b.change > 0 ? "Surplus" : "Deficit", `${b.change > 0 ? "+" : b.change < 0 ? "−" : "±"}${fmtNumber(Math.abs(b.change))}`, even ? "Eating what you burn keeps your weight steady." : b.change > 0 ? "Eating more than you burn gives your body extra to build with." : "Eating less than you burn makes your body use stored energy.")}
           ${line("Your target", fmtNumber(target), "", "", "cal-total")}`
        : ""
    }
    <details class="cal-math">
      <summary>See the math</summary>
      <p><strong>BMR</strong> uses the Mifflin-St Jeor formula: 10 × ${fmtOne(p.kg)} kg + 6.25 × ${fmtNumber(p.cm)} cm − 5 × ${p.age} years ${offset}${offsetNote} = about ${fmtNumber(b.bmr)}.</p>
      <p><strong>What you burn</strong> is your BMR × ${b.level.factor} for “${esc(b.level.name)}”, or about ${fmtNumber(b.burn)}.</p>
      <p>These are estimates, and real numbers vary from person to person. Your weight over 2–3 weeks is the best check on them.</p>
    </details>
  </section>`;
}

const REVIEW_ICONS = { ok: "✓", warn: "!", stop: "✕" };

function macroReviewHtml(items) {
  if (!items.length) return "";
  return `<ul class="macro-review">
    ${items.map((i) => `<li class="${i.level}"><span class="mark" aria-hidden="true">${REVIEW_ICONS[i.level]}</span><span><strong>${i.name}</strong> ${esc(i.text)}</span></li>`).join("")}
  </ul>`;
}

// Calories follow the macros, and an edit to calories lands on carbs. Only with all three
// macros filled in: until then, there's nothing complete to add up.
function syncMacroInputs(f, edited) {
  const filled = [f.protein, f.carbs, f.fat].every((el) => el.value.trim() !== "");
  if (!filled) return;
  const g = (el) => Number(el.value) || 0;
  if (edited !== f.kcal) f.kcal.value = g(f.protein) * 4 + g(f.carbs) * 4 + g(f.fat) * 9;
  else if (f.kcal.value.trim() !== "") f.carbs.value = Math.max(0, Math.round((g(f.kcal) - g(f.protein) * 4 - g(f.fat) * 9) / 4));
}

// Carbs move in whole grams, and can't go below zero, so calories settle once typing stops.
function settleMacroInputs(f) {
  if ([f.protein, f.carbs, f.fat].every((el) => el.value.trim() !== "")) {
    f.kcal.value = (Number(f.protein.value) || 0) * 4 + (Number(f.carbs.value) || 0) * 4 + (Number(f.fat.value) || 0) * 9;
  }
}

const planMacroInputs = () => ({ kcal: $("#plan-kcal"), protein: $("#plan-protein"), carbs: $("#plan-carbs"), fat: $("#plan-macro-fat") });

function setPlanStyle(style) {
  plan.style = style;
  const y = $(".wiz-scroll").scrollTop;
  drawPlanResult();
  $(".wiz-scroll").scrollTop = y;
}

/* ---------- saving ---------- */

async function savePlan() {
  const p = planAnswers();
  const m = plan.macros;
  const err = $("#wiz-error");
  const numbers = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Number(v)]));
  const stopped = reviewMacros(numbers, p, planWeight).find((i) => i.level === "stop");
  if (stopped) return (err.textContent = stopped.text);
  if (Object.values(numbers).some((v) => !(v > 0))) return (err.textContent = "Calories, protein, carbs and fat each need to be above 0.");
  const logs = bodyLogs || [];
  const today = localKey(new Date());
  const entry = logs.find((l) => l.day === today);
  const lastWeight = logs.find((l) => l.weight != null);
  const lastFat = logs.find((l) => l.bodyFat != null);
  const weightChanged = !lastWeight || Math.abs(convertWeight(lastWeight.weight, lastWeight.unit, plan.unit) - Number(plan.weight)) >= 0.1;
  const fatChanged = plan.bodyFat !== "" && (!lastFat || lastFat.bodyFat !== Number(plan.bodyFat));
  const btn = $(".wiz-next");
  btn.disabled = true;
  try {
    // New numbers typed here become today's entry, so the charts and the plan agree.
    if (weightChanged || fatChanged) {
      ({ logs: bodyLogs } = await api("body", {
        body: {
          day: today,
          weight: weightChanged ? plan.weight : (entry?.weight ?? ""),
          unit: weightChanged ? plan.unit : (entry?.unit ?? plan.unit),
          bodyFat: fatChanged ? plan.bodyFat : (entry?.bodyFat ?? ""),
        },
      }));
    }
    ({ goals: userGoals } = await api("goals", {
      method: "PUT",
      body: {
        sex: plan.sex,
        birthYear: new Date().getFullYear() - p.age,
        heightCm: p.cm,
        activity: plan.activity,
        plan: plan.goal,
        pace: goalHasWeight(plan.goal) ? plan.pace : "",
        weight: goalHasWeight(plan.goal) ? plan.goalWeight : plan.goal === "maintain" ? plan.weight : "",
        weightUnit: plan.unit,
        bodyFat: plan.goalFat,
        kcal: m.kcal,
        protein: m.protein,
        carbs: m.carbs,
        fat: m.fat,
      },
    }));
    drawPlanDone(p);
  } catch (ex) {
    err.textContent = ex.message;
    btn.disabled = false;
  }
}

function drawPlanDone(p) {
  const g = userGoals;
  const goalName = PLAN_GOALS[plan.goal].name;
  const weeks = planWeeksAt(g.kcal, p);
  const row = (k, v) => `<div class="prof-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  plan = null; // it's saved; back from here starts fresh
  app.innerHTML = `
    <div class="wiz wiz-done">
      <div class="wiz-scroll">
        <div class="wiz-body">
          <img class="wiz-mascot" src="/brand/mascot.png" width="253" height="224" alt="">
          <h1 class="wiz-title">You're all set</h1>
          <p class="wiz-intro">Meals now tracks your day against these targets. You can update them any time from Profile.</p>
          <div class="prof-card">
            ${row("Goal", goalName)}
            ${row("Calories", `${fmtNumber(g.kcal)} a day`)}
            ${row("Protein", `${fmtNumber(g.protein)} g`)}
            ${row("Carbs", `${fmtNumber(g.carbs)} g`)}
            ${row("Fat", `${fmtNumber(g.fat)} g`)}
            ${g.weight ? row("Goal weight", `${fmtOne(g.weight)} ${g.weightUnit}`) : ""}
            ${g.bodyFat ? row("Goal body fat", `${fmtOne(g.bodyFat)}%`) : ""}
            ${weeks ? row("Estimated", planDate(weeks)) : ""}
          </div>
        </div>
      </div>
      <div class="wiz-foot"><div class="wiz-foot-inner wiz-done-actions">
        <button class="primary wiz-next" type="button" data-go="#/meals">Log a meal</button>
        <button class="ghost" type="button" data-go="#/profile">Back to Profile</button>
      </div></div>
    </div>`;
  burstFrom($(".wiz-mascot"));
}

/* ---------- wiring ---------- */

document.addEventListener("submit", (e) => {
  if (e.target.id !== "wiz-form") return;
  e.preventDefault();
  planNext();
});

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-plan]");
  if (!btn || !plan) return;
  const act = btn.dataset.plan;
  if (act === "back") planBack();
  else if (act === "close") planClose();
  else if (act === "unit") setPlanUnit(btn.dataset.unit);
  else if (act === "style") setPlanStyle(btn.dataset.style);
  else if (act === "use-weight") {
    $("#plan-goal-weight").value = round1(toPlanUnit(Number(btn.dataset.kg)));
    drawPlanSummary();
  }
});

document.addEventListener("input", (e) => {
  if (!e.target.closest?.("#wiz-form")) return;
  $("#wiz-error").textContent = "";
  if (e.target.id === "plan-goal-weight") drawPlanSummary();
  if (e.target.id === "plan-goal-fat") drawPlanFatHint();
  if ("planMacro" in e.target.dataset) {
    syncMacroInputs(planMacroInputs(), e.target);
    readPlanStep();
    drawPlanLive();
  }
});

document.addEventListener("change", (e) => {
  if (!e.target.closest?.("#wiz-form")) return;
  $("#wiz-error").textContent = "";
  if (e.target.name === "plan-pace") drawPlanSummary();
  if (e.target.id === "plan-kcal") {
    settleMacroInputs(planMacroInputs());
    readPlanStep();
    drawPlanLive();
  }
  // A different goal needs a different suggestion, so the last one isn't carried over.
  if (e.target.name === "plan-goal") {
    plan.goal = e.target.value;
    plan.goalWeight = "";
  }
});
