// Small chart kit for the Profile reports. Each function returns HTML, and one shared listener
// gives every chart its tooltip, so charts survive being redrawn with innerHTML.
// Colors come from the --viz-* tokens in style.css, which were checked against both themes.

const fmtNumber = (n) => Math.round(n).toLocaleString("en-US");

// 48,210 reads better as 48.2K once a number stops fitting comfortably.
const fmtCompact = (n) => (Math.abs(n) >= 10000 ? `${Math.round(n / 100) / 10}K` : fmtNumber(n));

// Round axis values covering min to max, in steps of 1, 2 or 5 times a power of ten.
function axisTicks(min, max, count = 3) {
  if (max <= min) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.floor(min / step) * step; ; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
    if (v >= max - step * 1e-6) return ticks;
  }
}

const slotAttrs = (r) => `data-label="${esc(r.label)}" data-text="${esc(r.text)}"`;

function chartFrame({ label, ticks, pct, plot, xLabels, table, slotLabels }) {
  return `
    <figure class="chart" tabindex="0" role="group" aria-label="${esc(label)}. Use the arrow keys to read each value.">
      <div class="plot">
        ${ticks.map((t) => `<div class="tick" style="bottom:${pct(t)}%"><span>${t >= 10000 ? fmtCompact(t) : t.toLocaleString("en-US", { maximumFractionDigits: 1 })}</span></div>`).join("")}
        ${plot}
      </div>
      <div class="x-axis${slotLabels ? " under-slots" : ""}"${slotLabels ? ` style="grid-template-columns:repeat(${xLabels.length},1fr)"` : ""}>${xLabels.map((l) => `<span>${esc(l)}</span>`).join("")}</div>
      <div class="chart-tip" hidden aria-live="polite"></div>
    </figure>
    ${table || ""}`;
}

// rows: { label, value, text }, one per slot, in time order. line draws a reference line.
function columnChart({ label, rows, xLabels, line, table }) {
  const ticks = axisTicks(0, Math.max(...rows.map((r) => r.value), line || 0));
  const top = ticks.at(-1);
  const pct = (v) => (v / top) * 100;
  const plot = `
    <div class="slots">
      ${rows.map((r) => `<div class="slot" ${slotAttrs(r)}>${r.value > 0 ? `<i class="bar" style="height:${pct(r.value)}%"></i>` : ""}</div>`).join("")}
    </div>
    ${line ? `<div class="ref-line" style="bottom:${pct(line)}%"></div>` : ""}`;
  // With a label for every bar, each one sits under its bar rather than along the axis.
  return chartFrame({ label, ticks, pct, plot, xLabels, table, slotLabels: xLabels.length === rows.length });
}

// rows: { x (0 to 1 along the range), value, label, text }, in time order.
function lineChart({ label, rows, xLabels, line, table }) {
  const values = [...rows.map((r) => r.value), ...(line ? [line] : [])];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = hi === lo ? Math.max(hi * 0.05, 1) : 0;
  const ticks = axisTicks(lo - pad, hi + pad);
  const pct = (v) => ((v - ticks[0]) / (ticks.at(-1) - ticks[0])) * 100;
  const points = rows.map((r) => `${r.x * 100},${100 - pct(r.value)}`).join(" ");
  const plot = `
    <svg class="line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}"/></svg>
    ${rows.map((r) => `<div class="slot point" style="left:${r.x * 100}%" ${slotAttrs(r)}><i class="line-dot" style="bottom:${pct(r.value)}%"></i></div>`).join("")}
    ${line ? `<div class="ref-line" style="bottom:${pct(line)}%"></div>` : ""}`;
  return chartFrame({ label, ticks, pct, plot, xLabels, table });
}

// One whole split into parts: { name, share (0 to 100), detail, color }.
function segmentedBar({ label, parts }) {
  const shown = parts.filter((p) => p.share > 0);
  return `
    <figure class="chart seg-chart" tabindex="0" role="group" aria-label="${esc(label)}: ${esc(shown.map((p) => `${p.name} ${Math.round(p.share)}%`).join(", "))}">
      <div class="segbar">
        ${shown
          .map(
            (p) => `<div class="slot seg" style="flex-grow:${p.share};background:var(${p.color})" data-label="${esc(p.name)}" data-text="${Math.round(p.share)}% · ${esc(p.detail)}">${
              p.share >= 12 ? `${Math.round(p.share)}%` : ""
            }</div>`,
          )
          .join("")}
      </div>
      <div class="legend">
        ${parts.map((p) => `<span><i style="background:var(${p.color})"></i>${esc(p.name)} <b>${esc(p.detail)}</b></span>`).join("")}
      </div>
      <div class="chart-tip" hidden aria-live="polite"></div>
    </figure>`;
}

// Labeled horizontal bars. Every value is printed, so these need no tooltip or table.
function rankedBars(rows) {
  const top = Math.max(...rows.map((r) => r.value), 1);
  return `
    <div class="ranked">
      ${rows
        .map(
          (r) => `<div class="rank-row">
            <span class="rank-name">${esc(r.name)}</span>
            <span class="rank-value">${esc(r.text)}</span>
            <span class="rank-track"><i style="width:${(r.value / top) * 100}%"></i></span>
          </div>`,
        )
        .join("")}
    </div>`;
}

function chartTable(summary, headers, rows) {
  return `
    <details class="chart-table">
      <summary>${esc(summary)}</summary>
      <table>
        <thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </details>`;
}

/* ---------- tooltip ---------- */

let activeChart = null;

function clearChartTip() {
  if (!activeChart) return;
  activeChart.querySelector(".slot.on")?.classList.remove("on");
  activeChart.querySelector(".chart-tip").hidden = true;
  activeChart = null;
}

function showChartTip(chart, slot) {
  if (activeChart !== chart) clearChartTip();
  activeChart = chart;
  chart.querySelector(".slot.on")?.classList.remove("on");
  slot.classList.add("on");
  const tip = chart.querySelector(".chart-tip");
  // Names come from the user's own data, so they go in as text, never as HTML.
  const value = document.createElement("strong");
  value.textContent = slot.dataset.text;
  const name = document.createElement("span");
  name.textContent = slot.dataset.label;
  tip.replaceChildren(value, name);
  tip.hidden = false;
  const box = chart.getBoundingClientRect();
  const mark = slot.getBoundingClientRect();
  const center = mark.left + mark.width / 2 - box.left;
  tip.style.left = `${Math.max(0, Math.min(center - tip.offsetWidth / 2, box.width - tip.offsetWidth))}px`;
}

// Readers aim at a date, not a thin mark, so the slot nearest the pointer always wins.
function nearestSlot(chart, x) {
  let best = null;
  let bestGap = Infinity;
  for (const slot of chart.querySelectorAll(".slot")) {
    const r = slot.getBoundingClientRect();
    const gap = Math.abs(r.left + r.width / 2 - x);
    if (gap < bestGap) [best, bestGap] = [slot, gap];
  }
  return best;
}

document.addEventListener("pointermove", (e) => {
  const chart = e.target.closest?.(".chart");
  if (chart && e.target.closest(".plot, .segbar")) showChartTip(chart, nearestSlot(chart, e.clientX));
  else if (e.pointerType === "mouse") clearChartTip();
});
document.addEventListener("pointerdown", (e) => {
  const chart = e.target.closest?.(".chart");
  if (chart && e.target.closest(".plot, .segbar")) showChartTip(chart, nearestSlot(chart, e.clientX));
  else clearChartTip();
});
document.addEventListener("focusin", (e) => {
  if (e.target.matches?.(".chart:focus-visible")) {
    const slots = e.target.querySelectorAll(".slot");
    if (slots.length) showChartTip(e.target, slots[slots.length - 1]);
  }
});
document.addEventListener("focusout", (e) => {
  if (e.target === activeChart) clearChartTip();
});
document.addEventListener("keydown", (e) => {
  const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
  if (!step || !e.target.matches?.(".chart")) return;
  e.preventDefault();
  const slots = [...e.target.querySelectorAll(".slot")];
  const at = slots.findIndex((s) => s.classList.contains("on"));
  const next = slots[Math.max(0, Math.min((at < 0 ? slots.length : at) + step, slots.length - 1))];
  if (next) showChartTip(e.target, next);
});
