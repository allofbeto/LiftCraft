// Shared motion and feedback helpers. Timing lives here and in the --dur and --ease tokens in
// style.css, so everything moves alike. All of it respects the device's "reduce motion" setting.
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const motionOK = () => !reducedMotion.matches;
const EASE_OUT = "cubic-bezier(.2,.8,.2,1)";
const EASE_SPRING = "cubic-bezier(.34,1.4,.64,1)";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs a DOM update inside a View Transition when the browser has them. kind picks the CSS motion.
// Returns a promise for when the update has been applied.
function viewTransition(update, kind = "fade") {
  if (!document.startViewTransition || !motionOK()) return Promise.resolve(update());
  const root = document.documentElement;
  root.dataset.nav = kind;
  const t = document.startViewTransition(update);
  t.finished.catch(() => {}).finally(() => {
    if (root.dataset.nav === kind) delete root.dataset.nav;
  });
  t.ready.catch(() => {}); // a skipped transition isn't an error
  return t.updateCallbackDone;
}

// Without View Transitions, screens still ease in. Lists inside them stagger either way.
function markViewIn(el) {
  el.classList.remove("view-in");
  void el.offsetWidth; // restart the animation
  el.classList.add("view-in");
  clearTimeout(el._viewInTimer);
  el._viewInTimer = setTimeout(() => el.classList.remove("view-in"), 600);
}

const flipKey = (el) => el.dataset.flip || `${el.dataset.kind}:${el.dataset.id}`;

// Moves surviving elements smoothly to their new spots and eases new ones in.
function flip(root, selector, mutate) {
  if (!motionOK()) return mutate();
  const before = new Map();
  for (const el of root.querySelectorAll(selector)) before.set(flipKey(el), el.getBoundingClientRect());
  mutate();
  for (const el of root.querySelectorAll(selector)) {
    const was = before.get(flipKey(el));
    if (!was) {
      el.animate(
        [{ opacity: 0, transform: "translateY(10px) scale(.97)" }, { opacity: 1, transform: "none" }],
        { duration: 240, easing: EASE_SPRING },
      );
      continue;
    }
    const now = el.getBoundingClientRect();
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (dx || dy) el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 240, easing: EASE_OUT });
  }
}

// Eases one element from where it used to be, measured before a DOM move.
function slideFrom(el, topBefore) {
  if (!motionOK()) return;
  const dy = topBefore - el.getBoundingClientRect().top;
  if (dy) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 160, easing: EASE_OUT });
}

// Shrinks an element away, then resolves so the caller can remove it.
function collapseOut(el) {
  if (!el || !motionOK()) return Promise.resolve();
  const style = getComputedStyle(el);
  const a = el.animate(
    [
      { opacity: 1, height: `${el.offsetHeight}px`, marginBottom: style.marginBottom, transform: "none", overflow: "hidden" },
      { opacity: 0, height: "0px", marginBottom: "0px", paddingTop: "0px", paddingBottom: "0px", borderWidth: "0px", transform: "scale(.96)", overflow: "hidden" },
    ],
    { duration: 200, easing: EASE_OUT, fill: "forwards" },
  );
  return a.finished.catch(() => {});
}

// Counts a number up or down to its new value.
const counters = new WeakMap();
function countTo(el, from, to, format) {
  cancelAnimationFrame(counters.get(el));
  if (!motionOK() || from === to) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / 380);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = format(from + (to - from) * eased);
    if (t < 1) counters.set(el, requestAnimationFrame(tick));
  };
  counters.set(el, requestAnimationFrame(tick));
}

// Flame sparks from a point on screen, for logging a set or solving a puzzle.
function flameBurst(x, y) {
  if (!motionOK()) return;
  const layer = document.createElement("div");
  layer.className = "burst";
  layer.setAttribute("aria-hidden", "true");
  // Inside an open dialog, because a modal paints above everything outside it.
  ([...document.querySelectorAll("dialog[open]")].pop() || document.body).append(layer);
  const sparks = [];
  for (let i = 0; i < 18; i++) {
    const spark = document.createElement("i");
    const size = 7 + Math.random() * 11;
    spark.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px`;
    layer.append(spark);
    const angle = Math.random() * Math.PI * 2;
    const reach = 40 + Math.random() * 80;
    const dx = Math.cos(angle) * reach;
    const dy = Math.sin(angle) * reach - 44; // flames rise
    sparks.push(
      spark.animate(
        [
          { transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
          { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(0)`, opacity: 0 },
        ],
        { duration: 500 + Math.random() * 350, easing: EASE_OUT, fill: "forwards" },
      ).finished,
    );
  }
  Promise.allSettled(sparks).then(() => layer.remove());
}

function burstFrom(el) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  flameBurst(r.left + r.width / 2, r.top + r.height / 2);
}

/* toast: short messages, with an optional Undo */

let toastTimer = null;

function hideToast() {
  const el = document.querySelector("#toast");
  clearTimeout(toastTimer);
  if (!el.classList.contains("open")) return;
  const finish = () => {
    el.classList.remove("open");
    if (el.showPopover && el.matches(":popover-open")) el.hidePopover();
  };
  if (!motionOK()) return finish();
  el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(10px)" }], { duration: 140, easing: EASE_OUT }).finished.then(finish, finish);
}

function toast(message, { action, onAction, error = false } = {}) {
  const el = document.querySelector("#toast");
  clearTimeout(toastTimer);
  el.classList.toggle("error-toast", error);
  el.innerHTML = "";
  const text = document.createElement("span");
  text.textContent = message;
  el.append(text);
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action;
    btn.onclick = () => {
      hideToast();
      onAction?.();
    };
    el.append(btn);
  }
  // A popover sits above open dialogs. Re-showing it keeps it on top of a newer one.
  if (el.showPopover) {
    if (el.matches(":popover-open")) el.hidePopover();
    el.showPopover();
  }
  el.classList.add("open");
  if (motionOK()) el.animate([{ opacity: 0, transform: "translateY(14px) scale(.97)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: EASE_SPRING });
  toastTimer = setTimeout(hideToast, action ? 6000 : error ? 5000 : 2600);
}

/* branded replacement for the browser's confirm() */

function askConfirm({ title, message = "", confirmLabel = "Delete" }) {
  const dlg = document.querySelector("#confirm");
  document.querySelector("#confirm-title").textContent = title;
  const msg = document.querySelector("#confirm-msg");
  msg.textContent = message;
  msg.hidden = !message;
  document.querySelector("#confirm-yes").textContent = confirmLabel;
  return new Promise((resolve) => {
    let answer = false;
    document.querySelector("#confirm-no").onclick = () => dlg.close();
    document.querySelector("#confirm-yes").onclick = () => {
      answer = true;
      dlg.close();
    };
    dlg.onclose = () => resolve(answer);
    dlg.showModal();
    document.querySelector("#confirm-no").focus();
  });
}

// Eases the food dialog's height as its contents change, and slides in each new step.
function watchDialogHeight(dialog, body) {
  let last = 0;
  new MutationObserver((records) => {
    if (!dialog.open) {
      last = 0;
      return;
    }
    const height = body.offsetHeight;
    if (motionOK()) {
      if (records.some((r) => r.target === body && r.addedNodes.length)) {
        body.firstElementChild?.animate(
          [{ opacity: 0, transform: "translateX(14px)" }, { opacity: 1, transform: "none" }],
          { duration: 200, easing: EASE_OUT },
        );
      }
      if (last && last !== height) {
        body.animate([{ height: `${last}px`, overflow: "hidden" }, { height: `${height}px`, overflow: "hidden" }], { duration: 220, easing: EASE_OUT });
      }
    }
    last = height;
  }).observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
}

// Keeps bottom sheets above the on-screen keyboard, which phones don't always do on their own.
if (window.visualViewport) {
  const syncKeyboard = () => {
    const covered = Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop);
    document.documentElement.style.setProperty("--kb", `${Math.round(covered)}px`);
  };
  visualViewport.addEventListener("resize", syncKeyboard);
  visualViewport.addEventListener("scroll", syncKeyboard);
}
