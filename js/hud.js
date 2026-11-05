"use strict";

/* =====================================================================
   HUD  (js/hud.js)
   Text panels, the flight log, the telemetry graphs and the key hints.
   The text is rebuilt 10 times a second (not every frame) so it is
   readable and creates less garbage for the browser to clean up.
   ===================================================================== */

let hudLines = [];
let debugLines = [];
let logLines = [];
let textAge = 1;

function rebuildText() {
  const motor = MOTORS[sel.motor];
  const chute = sel.chute >= 0 ? CHUTES[sel.chute] : null;
  const state = flightState();

  hudLines = [
    "Motor      " + motor.name + "  " + motor.totalImpulse.toFixed(1) + " N*s  " + (motor.diameter * 1000).toFixed(0) + "x" + (motor.length * 1000).toFixed(0) + " mm",
    "Delay      " + (chute ? DELAYS[sel.delay] + " s  (T+" + (motor.burnTime + DELAYS[sel.delay]).toFixed(1) + ")" : "-"),
    "Chute      " + (chute ? chute.name + "  " + (chute.diameter * 100).toFixed(0) + " cm" + (sim.chuteDeployed ? "  OPEN" : "") : "none"),
    "State      " + state,
    "Wind       " + (WINDS[sel.wind] === 0 ? "calm" : WINDS[sel.wind] + " m/s " + (sel.windDir > 0 ? "->" : "<-")),
    "Launch ang " + ANGLES[sel.angle] + " deg",
    "Seed       " + (sim.ignited ? sim.seed : "-"),
    "Time warp  " + warp + "x",
    "Tilt       " + (sim.theta * 180 / Math.PI).toFixed(1) + " deg",
    "Stability  " + (rocketCal() === null ? "no fins/nose" : rocketCal().toFixed(1) + " cal"),
    "Altitude   " + sim.y.toFixed(1) + " m",
    "Speed      " + sim.vy.toFixed(1) + " m/s",
    "Accel      " + sim.ay.toFixed(1) + " m/s2",
    "Thrust     " + sim.thrust.toFixed(1) + " N",
    "Drag       " + sim.drag.toFixed(2) + " N",
    "Dyn press  " + (sim.q / 1000).toFixed(2) + " kPa",
    "Mass       " + (sim.mass * 1000).toFixed(1) + " g",
    "Flight t   " + sim.t.toFixed(1) + " s",
    "Apogee     " + sim.apogee.toFixed(1) + " m",
    "Max speed  " + sim.maxSpeed.toFixed(1) + " m/s",
    "Max accel  " + (sim.maxAccel / G).toFixed(1) + " g",
    "Max Q      " + (sim.maxQ / 1000).toFixed(2) + " kPa",
    "Chute peak " + (sim.maxShock / G).toFixed(1) + " g"
  ];

  for (let i = 0; i < rocket.parts.length; i++) {
    const p = rocket.parts[i], lim = p.maxSide || p.maxPull;
    if (lim) hudLines.push((p.name + "          ").slice(0, 10) + " " + p.peak.toFixed(1) + " / " + lim + " N" + (p.broken ? "  BROKEN" : ""));
  }

  if (state === "LANDED") {
    hudLines.push("Impact     " + sim.impact.toFixed(1) + " m/s");
    hudLines.push("Verdict    " + sim.verdict);
  }

  debugLines = [
    "FPS        " + (1000 / frameMs).toFixed(0),
    "Frame      " + frameMs.toFixed(1) + " ms",
    "Sim        " + simMs.toFixed(2) + " ms, " + stepsLast + " steps",
    "Draw       " + drawMs.toFixed(2) + " ms (CPU only)",
    "Zoom       " + cam.zoom.toFixed(1) + " px/m",
    "Air        " + airDensity(sim.y).toFixed(3) + " kg/m3",
    "Samples    " + tele.n + " / " + TELE_CAP,
    "Canvas     " + canvas.width + "x" + canvas.height + (sharp ? " sharp" : " fast")
  ];

  logLines = [];
  for (let i = 0; i < tele.events.length; i++) {
    logLines.push("T+" + tele.events[i].t.toFixed(2) + "  " + tele.events[i].label);
  }
}

function panelWidth(lines) {
  let chars = 0;
  for (let i = 0; i < lines.length; i++) chars = Math.max(chars, lines[i].length);
  return chars * 7.9 + 16;
}
function panelHeight(lines) { return lines.length * 17 + 16; }

function drawPanel(x, y, lines) {
  ctx.fillStyle = "rgba(10,14,18,0.55)";
  ctx.fillRect(x, y, panelWidth(lines), panelHeight(lines));
  ctx.fillStyle = "#e8eef2";
  ctx.font = "13px monospace";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], x + 8, y + 8 + i * 17);
}

/* Graph pages. ch = channel numbers from CHANNELS, mul converts units
   for display (for example m/s2 into g). */
const GRAPH_PAGES = [
  [ { title: "Altitude (m)",      ch: [1],    mul: 1,     unit: "m" },
    { title: "Speed (m/s)",       ch: [2],    mul: 1,     unit: "m/s" },
    { title: "Acceleration (g)",  ch: [3],    mul: 1 / G, unit: "g" },
    { title: "Thrust / Drag (N)", ch: [4, 5], mul: 1,     unit: "N" } ],
  [ { title: "Mass (g)",                ch: [6], mul: 1000,  unit: "g" },
    { title: "Dynamic pressure (kPa)",  ch: [7], mul: 0.001, unit: "kPa" },
    { title: "Drag (N)",                ch: [5], mul: 1,     unit: "N" },
    { title: "Chute open (%)",          ch: [8], mul: 100,   unit: "%" } ],
  [ { title: "Tilt (deg)",              ch: [10], mul: 180 / Math.PI, unit: "deg" },
    { title: "Angle of attack (deg)",   ch: [12], mul: 180 / Math.PI, unit: "deg" },
    { title: "Wind (m/s)",              ch: [11], mul: 1,             unit: "m/s" },
    { title: "Chute pull (N)",          ch: [13], mul: 1,             unit: "N" } ]
];
const SERIES_COLORS = ["#4aa3ff", "#ff9f43"];

function fmt(v) {
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : (a >= 10 ? v.toFixed(1) : v.toFixed(2));
}

function drawGraph(x, y, w, h, g) {
  const L = 8, R = 8, T = 24, B = 18;
  const px = x + L, py = y + T, pw = w - L - R, ph = h - T - B;
  const n = tele.n;
  const tt = tele.data[0];
  const tMax = Math.max(5, n > 0 ? tt[n - 1] : 0);

  // vertical range: always includes zero, with a little headroom
  let lo = 0, hi = 1;
  if (n > 0) {
    lo = Infinity; hi = -Infinity;
    for (let k = 0; k < g.ch.length; k++) {
      lo = Math.min(lo, tele.lo[g.ch[k]] * g.mul);
      hi = Math.max(hi, tele.hi[g.ch[k]] * g.mul);
    }
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
    if (hi - lo < 1e-9) hi = lo + 1;
    hi += (hi - lo) * 0.06;
  }
  const span = hi - lo;

  ctx.fillStyle = "rgba(10,14,18,0.6)";
  ctx.fillRect(x, y, w, h);
  ctx.lineWidth = 1;

  // zero line
  if (lo < 0 && hi > 0) {
    const zy = Math.round(py + ph - (0 - lo) / span * ph) + 0.5;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath(); ctx.moveTo(px, zy); ctx.lineTo(px + pw, zy); ctx.stroke();
  }
  // flight events as faint vertical lines
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  for (let i = 0; i < tele.events.length; i++) {
    const ex = Math.round(px + tele.events[i].t / tMax * pw) + 0.5;
    ctx.moveTo(ex, py);
    ctx.lineTo(ex, py + ph);
  }
  ctx.stroke();
  // bottom axis
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.moveTo(px, py + ph + 0.5);
  ctx.lineTo(px + pw, py + ph + 0.5);
  ctx.stroke();

  // data lines (at most one point per pixel column, so it stays cheap)
  if (n > 1) {
    const stride = Math.max(1, Math.floor(n / pw));
    for (let k = 0; k < g.ch.length; k++) {
      const arr = tele.data[g.ch[k]];
      ctx.strokeStyle = SERIES_COLORS[k];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < n; i += stride) {
        const X = px + tt[i] / tMax * pw;
        const Y = py + ph - (arr[i] * g.mul - lo) / span * ph;
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      const X2 = px + tt[n - 1] / tMax * pw;
      const Y2 = py + ph - (arr[n - 1] * g.mul - lo) / span * ph;
      ctx.lineTo(X2, Y2);
      ctx.stroke();
      ctx.fillStyle = SERIES_COLORS[k];
      ctx.fillRect(X2 - 2, Y2 - 2, 4, 4);                 // dot at the latest value
    }
    ctx.lineWidth = 1;
  }

  // title (several channels get their own colours)
  ctx.font = "12px monospace";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  if (g.ch.length === 1) {
    ctx.fillStyle = "#e8eef2";
    ctx.fillText(g.title, x + L, y + 6);
  } else {
    let tx = x + L;
    const names = g.title.split(" / ");
    for (let k = 0; k < names.length; k++) {
      ctx.fillStyle = SERIES_COLORS[k];
      ctx.fillText(names[k], tx, y + 6);
      tx += (names[k].length + 3) * 7.2;
    }
  }

  if (n > 0) {
    let cur = "", peak = "";
    for (let k = 0; k < g.ch.length; k++) {
      cur += (k ? " / " : "") + fmt(tele.data[g.ch[k]][n - 1] * g.mul);
      peak += (k ? " / " : "") + fmt(tele.hi[g.ch[k]] * g.mul);
    }
    ctx.fillStyle = "#e8eef2";
    ctx.textAlign = "right";
    ctx.fillText(cur, x + w - R, y + 6);
    ctx.font = "10px monospace";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.textAlign = "center";
    ctx.fillText("peak " + peak, x + w / 2, y + h - 3);
    ctx.textAlign = "right";
    ctx.fillText(Math.round(tMax) + " s", x + w - R, y + h - 3);
    ctx.textAlign = "left";
    ctx.fillText("0 s", x + L, y + h - 3);
  }
  ctx.textAlign = "left";
}

function drawGraphs() {
  if (graphPage < 0) return;
  const page = GRAPH_PAGES[graphPage];
  const gap = 10, h = 150;
  const w = (Wc - gap * (page.length + 1)) / page.length;
  const y = Hc - 48 - h;
  for (let i = 0; i < page.length; i++) drawGraph(gap + i * (w + gap), y, w, h, page[i]);
}

function drawWindArrow(x, y) {                    // live wind, gusts included
  const w = windNow();
  ctx.fillStyle = "rgba(10,14,18,0.55)";
  ctx.fillRect(x, y, 150, 30);
  ctx.fillStyle = "#e8eef2";
  ctx.font = "13px monospace";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("Wind", x + 8, y + 15);
  const len = Math.min(56, Math.abs(w) * 5);
  if (len < 3) { ctx.fillText("calm", x + 70, y + 15); return; }
  const d = w > 0 ? 1 : -1, cx = x + 104, tail = cx - d * len / 2, head = cx + d * len / 2;
  ctx.strokeStyle = "#e8eef2";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(tail, y + 15); ctx.lineTo(head, y + 15); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(head, y + 15); ctx.lineTo(head - d * 8, y + 10); ctx.lineTo(head - d * 8, y + 20); ctx.closePath(); ctx.fill();
  ctx.lineWidth = 1;
}

function drawHud(dtFrame) {
  textAge += dtFrame;
  if (textAge > 0.1) { rebuildText(); textAge = 0; }

  drawPanel(12, 12, hudLines);
  drawWindArrow(12, 12 + panelHeight(hudLines) + 8);
  let rightY = 12;
  if (showDebug) {
    drawPanel(Wc - panelWidth(debugLines) - 12, rightY, debugLines);
    rightY += panelHeight(debugLines) + 8;
  }
  if (logLines.length > 0) drawPanel(Wc - panelWidth(logLines) - 12, rightY, logLines);

  drawGraphs();

  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "12px monospace";
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  ctx.fillText("Space: launch  R: reset  Z / + / - / wheel: zoom   (rocket parts: sidebar)", 12, Hc - 26);
  ctx.fillText("W: wind speed  Q: wind direction  A: launch angle  G: graphs  M: CG/CP  E: export  D: debug  H: sharp  T: time warp", 12, Hc - 10);
}
