"use strict";

/* =====================================================================
   BUILDER SIDEBAR  (js/ui.js)
   Plain HTML buttons on the right of the screen. Clicking one calls a
   choose...() function from catalog.js, which does the real work. This file
   only draws the choices and shows the current one. It is not loaded by the
   tests (they have no web page), so keep the game rules out of here.
   The panel is built once; uiRefresh() (called every frame from main.js)
   only touches the page when something actually changed.
   ===================================================================== */

const sideEl = document.getElementById("side");
let uiSig = "";
const uiParts = [];       // groups of part choices (the scrolling list)
const uiConds = [];       // groups of launch conditions (pinned at the bottom)
const uiBits = {};        // the few other elements that change: summary, buttons, message

function uiWidth() { return sideEl ? sideEl.offsetWidth : 0; }

function uiEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const uiMm = (m) => Math.round(m * 1000) + " mm";
const uiGr = (kg) => Math.round(kg * 1000) + " g";
const uiDrag = (cdA) => (cdA * 1e4).toFixed(1);
const uiMoney = (x) => "$" + x.toFixed(2);

/* ---- what to show for each choice. info() returns { price, stats, tone, swatch } ---- */
const UI_DELAYS = DELAYS.map((d, i) => ({ id: i, name: d + " s delay" }));
const UI_MOTORS = MOTORS.map((m, i) => ({ id: i, name: m.name + " motor" }));

const UI_PART_GROUPS = [
  { sec: "Airframe", title: "Body tube", items: TUBES, current: () => build.tube, pick: (it) => chooseBuild("tube", it.id),
    info: (t) => ({ price: t.price, stats: uiGr(t.mass) + " · " + uiMm(t.diameter) + " · fits " + t.motorMm + " mm motors" }) },
  { title: "Fins", items: FIN_SHAPES, current: () => build.fins, pick: (it) => chooseBuild("fins", it.id),
    info: (f) => ({ price: f.price, stats: "span " + uiMm(f.span) + " · " + uiGr(f.mass) + " · drag " + uiDrag(f.cdA) }) },
  { title: "Fin material", items: FIN_MATERIALS, current: () => build.finMat, pick: (it) => chooseBuild("finMat", it.id),
    info: (m) => ({ swatch: m.color, stats: "mass ×" + m.mass + " · strength ×" + m.strength + " · cost ×" + m.priceMul }) },
  { title: "Nose cone", items: NOSES, current: () => build.nose, pick: (it) => chooseBuild("nose", it.id),
    info: (n) => ({ price: n.price, stats: uiMm(n.length) + " · " + uiGr(n.mass) + " · drag " + uiDrag(n.cdA) }) },

  { sec: "Recovery", title: "Recovery", items: RECOVERY, current: () => recoveryForChute(sel.chute).id, pick: (it) => chooseRecovery(it.id),
    info: (r) => {
      if (r.chuteIdx < 0) return { price: 0, stats: "nothing opens: the rocket just falls", tone: "bad" };
      const c = CHUTES[r.chuteIdx], v = landingSpeed(r.chuteIdx);
      const tone = v <= SAFE_LANDING_SPEED ? "good" : v <= CRASH_SPEED ? "warn" : "bad";
      return { price: r.price, swatch: c.color, tone: tone,
               stats: (r.id === "streamer" ? "ribbon" : Math.round(c.diameter * 100) + " cm") + " · cord " + r.cordN + " N · lands ~" + v.toFixed(1) + " m/s" };
    } },
  { title: "Delay charge", items: UI_DELAYS, current: () => sel.delay, pick: (it) => chooseDelay(it.id), off: () => sel.chute < 0,
    info: (d) => ({ swatch: DELAY_COLORS[d.id], stats: "opens at T+" + (MOTORS[sel.motor].burnTime + DELAYS[d.id]).toFixed(1) + " s" }) },

  { sec: "Motor", title: "Motor", items: UI_MOTORS, current: () => sel.motor, pick: (it) => chooseMotor(it.id),
    info: (it) => {
      const m = MOTORS[it.id], fit = motorFit(catalogPick(TUBES, build.tube), m);
      const note = fit === "adapter" ? " · needs adapter" : fit === "no" ? " · too big for this tube" : "";
      return { swatch: m.color, price: MOTOR_PRICE[m.name] + (fit === "adapter" ? ADAPTER_PRICE : 0),
               tone: fit === "no" ? "bad" : fit === "adapter" ? "warn" : "",
               stats: m.totalImpulse.toFixed(1) + " N·s · " + uiMm(m.diameter) + " × " + uiMm(m.length) + " · burns " + m.burnTime.toFixed(1) + " s" + note };
    } }
];

const UI_COND_GROUPS = [
  { title: "Wind (m/s)", items: WINDS.map((w, i) => ({ id: i, name: w === 0 ? "calm" : String(w) })),
    current: () => sel.wind, pick: (it) => chooseWind(it.id) },
  { title: "Wind blows toward", items: [{ id: -1, name: "left" }, { id: 1, name: "right" }],
    current: () => sel.windDir, pick: (it) => chooseWindDir(it.id), off: () => WINDS[sel.wind] === 0 },
  { title: "Rod tilt (+ leans right)", items: ANGLES.map((a, i) => ({ id: i, name: (a > 0 ? "+" : "") + a + "°" })),
    current: () => sel.angle, pick: (it) => chooseAngle(it.id) }
];

/* ---- building the page (once) ---- */
function uiLocked() { return sim.ignited; }

function uiMakeGroup(g, parent, chip) {
  const box = uiEl("div", chip ? "grp" : "grp");
  box.appendChild(uiEl("div", "gt", g.title));
  const row = uiEl("div", chip ? "chips" : "col");
  box.appendChild(row);
  g.btns = [];
  for (const it of g.items) {
    const b = uiEl("button", chip ? "chip" : "opt");
    b.type = "button";
    b.tabIndex = -1;                                          // so Space still launches instead of "clicking" a button
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });   // and clicking never takes the keyboard focus
    b.addEventListener("click", function () { if (!uiLocked()) g.pick(it); });
    const o = { it: it, b: b };
    if (chip) {
      b.textContent = it.name;
    } else {
      const top = uiEl("span", "n");
      o.dot = uiEl("i", "dot");
      top.appendChild(o.dot);
      top.appendChild(uiEl("span", "", it.name));
      o.price = uiEl("span", "p");
      o.stats = uiEl("span", "s");
      b.appendChild(top); b.appendChild(o.price); b.appendChild(o.stats);
    }
    g.btns.push(o);
    row.appendChild(b);
  }
  parent.appendChild(box);
}

function uiBuild() {
  const head = uiEl("div", "head");
  uiBits.sum = uiEl("div", "sum");
  const actions = uiEl("div", "actions");
  uiBits.launch = uiEl("button", "act go", "Launch");
  uiBits.reset = uiEl("button", "act", "Reset");
  for (const b of [uiBits.launch, uiBits.reset]) {
    b.type = "button"; b.tabIndex = -1;
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
  }
  uiBits.launch.addEventListener("click", function () { if (!uiLocked() && launchBlocked() === "") launch(); });
  uiBits.reset.addEventListener("click", function () { resetAll(); });
  actions.appendChild(uiBits.launch); actions.appendChild(uiBits.reset);
  uiBits.msg = uiEl("div", "msg");
  head.appendChild(uiBits.sum); head.appendChild(actions); head.appendChild(uiBits.msg);

  const parts = uiEl("div", "parts");
  for (const g of UI_PART_GROUPS) {
    if (g.sec) parts.appendChild(uiEl("div", "sec", g.sec));
    uiMakeGroup(g, parts, false);
    uiParts.push(g);
  }

  const cond = uiEl("div", "cond");
  cond.appendChild(uiEl("div", "sec", "Launch conditions"));
  for (const g of UI_COND_GROUPS) { uiMakeGroup(g, cond, true); uiConds.push(g); }

  sideEl.appendChild(head); sideEl.appendChild(parts); sideEl.appendChild(cond);
}

/* ---- keeping it up to date ---- */
function uiUpdateGroup(g) {
  const cur = g.current(), off = g.off ? g.off() : false;
  for (const o of g.btns) {
    o.b.classList.toggle("on", o.it.id === cur);
    o.b.classList.toggle("off", off);
    if (!o.stats) continue;
    const info = g.info(o.it);
    o.price.textContent = info.price === undefined ? "" : uiMoney(info.price);
    o.stats.textContent = info.stats;
    o.stats.className = "s" + (info.tone ? " " + info.tone : "");
    o.dot.style.display = info.swatch ? "" : "none";
    o.dot.style.background = info.swatch || "transparent";
  }
}

function uiUpdateSummary() {
  const price = buildPrice(Object.assign({}, build, { recovery: recoveryForChute(sel.chute).id }), MOTORS[sel.motor]);
  const cal = rocketCal();
  let stab = "no fins or nose", tone = "bad";
  if (cal !== null) {
    stab = cal.toFixed(1) + " cal, " + (cal < 0 ? "unstable" : cal < 1 ? "marginal" : "stable");
    tone = cal < 0 ? "bad" : cal < 1 ? "warn" : "good";
  }
  uiBits.sum.textContent = "";
  const rows = [["Liftoff mass", uiGr(sim.mass), ""], ["Height", Math.round(ROCKET_H * 100) + " cm", ""],
                ["Stability", stab, tone], ["Cost per flight", uiMoney(price), ""]];
  for (const r of rows) {
    const row = uiEl("div", "row");
    row.appendChild(uiEl("span", "k", r[0]));
    row.appendChild(uiEl("span", "v " + r[2], r[1]));
    uiBits.sum.appendChild(row);
  }
}

function uiSignature() {
  return [build.tube, build.fins, build.finMat, build.nose, sel.motor, sel.delay, sel.chute,
          sel.wind, sel.windDir, sel.angle, sim.ignited ? 1 : 0].join("|");
}

function uiRefresh() {
  const s = uiSignature();
  if (s === uiSig) return;
  uiSig = s;
  const locked = uiLocked(), blocked = locked ? "" : launchBlocked();
  sideEl.classList.toggle("locked", locked);
  for (const g of uiParts) uiUpdateGroup(g);
  for (const g of uiConds) uiUpdateGroup(g);
  uiUpdateSummary();
  uiBits.launch.disabled = locked || blocked !== "";
  uiBits.msg.textContent = locked ? "Locked while the rocket is lit. Press Reset (R) to change it." : blocked;
  uiBits.msg.className = "msg" + (blocked ? " bad" : "");
}

if (sideEl) uiBuild();
