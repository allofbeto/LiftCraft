// The numbers behind the goal planner. Weights here are kg and heights are cm.

const ACTIVITY_LEVELS = [
  { id: "sedentary", name: "Mostly sitting", detail: "Desk job, little or no exercise", factor: 1.2 },
  { id: "light", name: "Lightly active", detail: "Exercise 1–3 days a week", factor: 1.375 },
  { id: "moderate", name: "Moderately active", detail: "Exercise 3–5 days a week", factor: 1.55 },
  { id: "active", name: "Very active", detail: "Hard exercise 6–7 days a week", factor: 1.725 },
  { id: "extreme", name: "Extremely active", detail: "Physical job plus hard training", factor: 1.9 },
];

const PLAN_GOALS = {
  lose: { name: "Lose fat", detail: "Eat a little below what you burn, and keep your muscle", plan: "Losing fat", training: "Lift 3–4 days a week. It tells your body to hold on to muscle while the fat comes off." },
  tone: { name: "Tone up", detail: "Lose some fat and build muscle at the same time", plan: "Toning up", training: "Lift 3–4 days a week, aiming for 8–15 reps a set. Expect the mirror and your lifts to change before the scale does." },
  gain: { name: "Build muscle", detail: "Eat a little above what you burn, and train to grow", plan: "Building muscle", training: "Lift 4–5 days a week, aiming for 8–12 reps a set. Add weight or reps whenever you can." },
  strength: { name: "Get stronger", detail: "Fuel heavier lifts, with a small calorie surplus", plan: "Getting stronger", training: "Lift 3–4 days a week, built around big compound lifts for 3–6 reps a set." },
  maintain: { name: "Stay where I am", detail: "Eat what you burn, and keep what you've built", plan: "Maintaining", training: "Lift 2–3 days a week to keep your strength and muscle." },
};

// Goals with a goal weight and a pace. The others are measured by body fat and lifts instead.
const goalHasWeight = (goal) => goal === "lose" || goal === "gain";

// Share of body weight to change each week.
const PLAN_PACES = {
  lose: [{ id: "gentle", name: "Gentle", pct: 0.25 }, { id: "steady", name: "Steady", pct: 0.5 }, { id: "fast", name: "Faster", pct: 0.75 }],
  gain: [{ id: "gentle", name: "Gentle", pct: 0.1 }, { id: "steady", name: "Steady", pct: 0.25 }, { id: "fast", name: "Faster", pct: 0.5 }],
};

const TONE_DEFICIT = 0.1; // small enough to keep building muscle
const STRENGTH_SURPLUS = 0.05;

// proteinPerKg, by goal, and the share of calories from fat. Carbs take what's left.
const MACRO_STYLES = {
  balanced: { name: "Balanced", protein: { lose: 1.8, tone: 2.0, gain: 1.8, strength: 1.8, maintain: 1.6 }, fatShare: 0.27 },
  protein: { name: "High protein", protein: { lose: 2.2, tone: 2.2, gain: 2.2, strength: 2.2, maintain: 2.2 }, fatShare: 0.25 },
  lowcarb: { name: "Lower carb", protein: { lose: 1.8, tone: 2.0, gain: 1.8, strength: 1.8, maintain: 1.6 }, fatShare: 0.4 },
};

const KCAL_PER_KG = 7700; // the usual estimate for a kilogram of body weight
const MIN_FAT_PER_KG = 0.6;
const MAX_PROTEIN_SHARE = 0.35; // at large body sizes, per-kg protein would otherwise crowd out carbs
const MAX_PROTEIN_SHARE_HIGH = 0.4;
const CALORIE_FLOORS = { male: 1500, female: 1200, "": 1350 }; // common minimums for unsupervised dieting
const MIN_BODY_FAT = { male: 6, female: 14, "": 10 }; // essential fat, the level below which health suffers
const FIT_BODY_FAT = { male: "14–17%", female: "21–24%" };
const MIN_PLAN_AGE = 18; // these formulas are for adults

// A safety stop only, never a target or a score: the planner won't help anyone diet below this.
const lowestSafeWeight = (cm) => 18.5 * (cm / 100) ** 2;

// Mifflin-St Jeor. Without a stated sex, it uses the midpoint of the two formulas.
function basalCalories({ sex, age, cm, kg }) {
  const offset = sex === "male" ? 5 : sex === "female" ? -161 : -78;
  return 10 * kg + 6.25 * cm - 5 * age + offset;
}

function maintenanceCalories(p) {
  const level = ACTIVITY_LEVELS.find((a) => a.id === p.activity) || ACTIVITY_LEVELS[0];
  return basalCalories(p) * level.factor;
}

// Calories for a goal, with the weekly change they really deliver once the floor has applied.
function planCalories(p) {
  const maintenance = maintenanceCalories(p);
  const floor = Math.min(CALORIE_FLOORS[p.sex] ?? CALORIE_FLOORS[""], maintenance);
  const atOrAboveFloor = (want) => ({ target: Math.max(want, floor), floored: want < floor });
  if (p.goal === "maintain") return { maintenance, target: maintenance, weeklyKg: 0, floored: false };
  if (p.goal === "strength") return { maintenance, target: maintenance * (1 + STRENGTH_SURPLUS), weeklyKg: 0, floored: false };
  if (p.goal === "tone") {
    if (p.kg < lowestSafeWeight(p.cm)) return { maintenance, target: maintenance, weeklyKg: 0, floored: false };
    return { maintenance, ...atOrAboveFloor(maintenance * (1 - TONE_DEFICIT)), weeklyKg: 0 };
  }
  const pct = (PLAN_PACES[p.goal].find((x) => x.id === p.pace) || PLAN_PACES[p.goal][1]).pct;
  const daily = ((pct / 100) * p.kg * KCAL_PER_KG) / 7;
  if (p.goal === "gain") return { maintenance, target: maintenance + daily, weeklyKg: (daily * 7) / KCAL_PER_KG, floored: false };
  const { target, floored } = atOrAboveFloor(maintenance - daily);
  return { maintenance, target, floored, weeklyKg: ((maintenance - target) * 7) / KCAL_PER_KG };
}

// Protein follows muscle, not stored fat: use lean mass when it's known, and the goal weight when losing.
function proteinReference(p) {
  let reference = p.kg;
  if (p.goal === "lose" && p.goalKg > 0) reference = Math.min(reference, p.goalKg);
  if (p.bodyFat > 0) reference = Math.min(reference, (p.kg * (1 - p.bodyFat / 100)) / 0.8);
  return reference;
}

function planMacros(kcal, p, styleId) {
  const style = MACRO_STYLES[styleId] || MACRO_STYLES.balanced;
  const reference = proteinReference(p);
  const protein = Math.min(reference * style.protein[p.goal], (kcal * (styleId === "protein" ? MAX_PROTEIN_SHARE_HIGH : MAX_PROTEIN_SHARE)) / 4);
  const fat = Math.max((kcal * style.fatShare) / 9, reference * MIN_FAT_PER_KG);
  const carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
  const m = { protein: to5(protein), carbs: to5(carbs), fat: to5(fat) };
  return { ...m, kcal: macroCalories(m) }; // always exactly what the macros add up to
}

// A starting suggestion: a first milestone rather than a distant end point.
function suggestGoalWeight(p) {
  if (p.goal === "lose") return Math.max(p.kg * 0.9, Math.min(lowestSafeWeight(p.cm), p.kg - 0.5));
  if (p.goal === "gain") return p.kg * 1.05;
  return p.kg;
}

// What someone would weigh at a body fat goal if they kept the muscle they have now.
const weightAtBodyFat = (kg, bodyFat, goalFat) => (kg * (1 - bodyFat / 100)) / (1 - goalFat / 100);

// Returns why a goal can't be planned, or "" when it can.
function goalWeightProblem(p, goalKg) {
  if (p.goal === "lose") {
    if (goalKg >= p.kg) return "tooHigh";
    if (goalKg < lowestSafeWeight(p.cm)) return "tooLowForHeight";
  }
  if (p.goal === "gain" && goalKg <= p.kg) return "tooLow";
  return "";
}

/* ---------- reviewing macros someone has chosen against their goal ---------- */

const macroCalories = ({ protein, carbs, fat }) => protein * 4 + carbs * 4 + fat * 9;

// Grams per kg of reference weight: the range that serves each goal, and the carbs hard training needs.
const PROTEIN_RANGES = { lose: [1.6, 2.4], tone: [1.6, 2.4], gain: [1.6, 2.2], strength: [1.6, 2.2], maintain: [1.2, 2.2] };
const MIN_CARBS_PER_KG = { lose: 0.75, tone: 1, gain: 1.5, strength: 1.5, maintain: 1 };
const MIN_CARB_SHARE = 0.18; // at large body sizes, the per-kg figure alone would ask for too much
const MIN_FAT_SHARE = 0.2;
const MAX_FAT_SHARE = 0.45;
const FLOOR_MARGIN = 25; // rounding macros to 5 g can land just under the floor
const PROTEIN_REASONS = {
  lose: "keep your muscle while you lose fat",
  tone: "build muscle while you lose fat",
  gain: "build muscle",
  strength: "recover and get stronger",
  maintain: "keep the muscle you have",
};

const to5 = (g) => Math.round(g / 5) * 5;

function reviewCalories(kcal, p, weight) {
  const maintenance = maintenanceCalories(p);
  const floor = Math.min(CALORIE_FLOORS[p.sex] ?? CALORIE_FLOORS[""], maintenance);
  const burn = fmtPlanNumber(Math.round(maintenance / 10) * 10);
  const change = kcal - maintenance;
  const weeklyKg = (Math.abs(change) * 7) / KCAL_PER_KG;
  const pct = (weeklyKg / p.kg) * 100;
  const share = change / maintenance;
  const rate = `about ${weight(weeklyKg)} a week`;
  if (kcal < floor - FLOOR_MARGIN) return { level: "stop", text: `Too low. ${fmtPlanNumber(floor)} is the least we can recommend, since eating less is hard to do safely on your own.` };
  if (p.goal === "lose") {
    if (change >= 0) return { level: "warn", text: `Too high. You burn about ${burn}, so you won't lose fat at this level.` };
    if (pct > 1) return { level: "warn", text: `Quite low. That's ${rate}, which is hard to sustain and can cost you muscle.` };
    if (pct < 0.1) return { level: "warn", text: `Barely under the ${burn} you burn, so fat loss would be very slow.` };
    return { level: "ok", text: `Good for losing fat, at ${rate}.` };
  }
  if (p.goal === "gain") {
    if (change <= 0) return { level: "warn", text: `Too low. You burn about ${burn}, so you'd struggle to build muscle at this level.` };
    if (pct > 0.75) return { level: "warn", text: `Quite high. That's ${rate}, and more of it is likely to be fat than muscle.` };
    if (pct < 0.05) return { level: "warn", text: `Barely over the ${burn} you burn, so muscle would come very slowly.` };
    return { level: "ok", text: `Good for building muscle, at ${rate}.` };
  }
  if (p.goal === "tone") {
    if (change > 0) return { level: "warn", text: `Too high for toning. You burn about ${burn}, so a small deficit works better.` };
    if (share < -0.2) return { level: "warn", text: `Too low for toning. A deficit this big makes it hard to build muscle.` };
    return { level: "ok", text: "Good for toning, with a small deficit." };
  }
  if (p.goal === "strength") {
    if (share < -0.05) return { level: "warn", text: `Too low. You burn about ${burn}, and under-eating holds back your lifts.` };
    if (share > 0.15) return { level: "warn", text: "Higher than strength needs, so the extra is likely to be fat." };
    return { level: "ok", text: "Good for getting stronger, with enough fuel to lift heavy." };
  }
  if (Math.abs(share) > 0.05) return { level: "warn", text: `${change < 0 ? "Too low" : "Too high"} to hold steady. You'd slowly ${change < 0 ? "lose" : "gain"} ${rate}.` };
  return { level: "ok", text: "Good for staying where you are." };
}

// One finding per value, in the order they appear on screen. Values left empty (null) are skipped.
function reviewMacros(m, p, weight) {
  const reference = proteinReference(p);
  const out = [];
  if (m.kcal > 0) out.push({ name: "Calories", ...reviewCalories(m.kcal, p, weight) });
  if (m.protein > 0) {
    const [low, high] = PROTEIN_RANGES[p.goal].map((k) => to5(reference * k));
    const floor = m.kcal > 0 ? Math.min(low, to5((m.kcal * MAX_PROTEIN_SHARE) / 4)) : low;
    if (m.protein < floor) out.push({ name: "Protein", level: "warn", text: `Too low. Aim for at least ${floor} g to ${PROTEIN_REASONS[p.goal]}.` });
    else if (m.protein > high) out.push({ name: "Protein", level: "warn", text: `More than you need. Past ${high} g adds little, and those calories could go to carbs or fat.` });
    else out.push({ name: "Protein", level: "ok", text: `Good. ${floor}–${high} g suits your goal.` });
  }
  if (m.carbs != null) {
    const perKg = to5(reference * MIN_CARBS_PER_KG[p.goal]);
    const low = m.kcal > 0 ? Math.min(perKg, to5((m.kcal * MIN_CARB_SHARE) / 4)) : perKg;
    if (m.carbs < low) out.push({ name: "Carbs", level: "warn", text: `On the low side. Under ${low} g, hard training can start to feel flat.` });
    else out.push({ name: "Carbs", level: "ok", text: "Enough to fuel your training." });
  }
  if (m.fat > 0) {
    const total = m.kcal > 0 ? m.kcal : macroCalories(m);
    const low = to5(Math.max(reference * MIN_FAT_PER_KG, (total * MIN_FAT_SHARE) / 9));
    if (m.fat < low) out.push({ name: "Fat", level: "warn", text: `Too low. Aim for at least ${low} g, since your body needs some fat to work well.` });
    else if ((m.fat * 9) / total > MAX_FAT_SHARE) out.push({ name: "Fat", level: "warn", text: `On the high side, at ${Math.round(((m.fat * 9) / total) * 100)}% of your calories. That leaves little room for carbs.` });
    else out.push({ name: "Fat", level: "ok", text: "A healthy amount." });
  }
  return out;
}

const fmtPlanNumber = (n) => Math.round(n).toLocaleString("en-US");

// Where a day's calories go. Rounded together, so the lines always add up on screen.
function calorieBreakdown(p, target) {
  const level = ACTIVITY_LEVELS.find((a) => a.id === p.activity) || ACTIVITY_LEVELS[0];
  const to10 = (n) => Math.round(n / 10) * 10;
  const bmr = to10(basalCalories(p));
  const burn = to10(basalCalories(p) * level.factor);
  return { level, bmr, activity: burn - bmr, burn, target, change: target - burn };
}
