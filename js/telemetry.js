"use strict";

/* =====================================================================
   TELEMETRY  (js/telemetry.js)
   The recorder saves a sample 60 times a second during the flight into
   fixed arrays (no garbage created while flying). Graphs, the flight log
   and the CSV export all read from here.
   ===================================================================== */

const CHANNELS = [                     // index = position in tele.data
  { key: "t",      label: "Time",             csv: "t_s" },
  { key: "alt",    label: "Altitude",         csv: "altitude_m" },
  { key: "vy",     label: "Speed",            csv: "speed_ms" },
  { key: "ay",     label: "Acceleration",     csv: "accel_ms2" },
  { key: "thrust", label: "Thrust",           csv: "thrust_N" },
  { key: "drag",   label: "Drag",             csv: "drag_N" },
  { key: "mass",   label: "Mass",             csv: "mass_kg" },
  { key: "q",      label: "Dynamic pressure", csv: "dynpressure_Pa" },
  { key: "chute",  label: "Chute open",       csv: "chute_open" }
];

const tele = { n: 0, nextT: 0, done: false, data: [], lo: [], hi: [], events: [] };
for (let c = 0; c < CHANNELS.length; c++) {
  tele.data.push(new Float32Array(TELE_CAP));
  tele.lo.push(Infinity);
  tele.hi.push(-Infinity);
}

function teleReset() {
  tele.n = 0; tele.nextT = 0; tele.done = false; tele.events.length = 0;
  for (let c = 0; c < CHANNELS.length; c++) { tele.lo[c] = Infinity; tele.hi[c] = -Infinity; }
}

function teleEvent(label) {                       // a marked moment in the flight
  tele.events.push({ t: sim.t, label: label });
}

function teleSet(c, i, v) {
  tele.data[c][i] = v;
  if (v < tele.lo[c]) tele.lo[c] = v;
  if (v > tele.hi[c]) tele.hi[c] = v;
}

function teleRecord(force) {
  if (tele.n >= TELE_CAP) return;
  if (!force && sim.t < tele.nextT) return;
  tele.nextT += 1 / TELE_RATE;
  const i = tele.n++;
  teleSet(0, i, sim.t);
  teleSet(1, i, sim.y);
  teleSet(2, i, sim.vy);
  teleSet(3, i, sim.ay);
  teleSet(4, i, sim.thrust);
  teleSet(5, i, sim.drag);
  teleSet(6, i, sim.mass);
  teleSet(7, i, sim.q);
  teleSet(8, i, sim.chuteOpen);
}

function buildCsv() {
  const head = [];
  for (let c = 0; c < CHANNELS.length; c++) head.push(CHANNELS[c].csv);
  const lines = [head.join(",")];
  for (let i = 0; i < tele.n; i++) {
    const row = [];
    for (let c = 0; c < CHANNELS.length; c++) row.push(tele.data[c][i].toFixed(4));
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

function exportCsv() {
  if (tele.n === 0) return;
  const chuteName = sel.chute >= 0 ? CHUTES[sel.chute].name : "none";
  const blob = new Blob([buildCsv()], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "flight-motor-" + MOTORS[sel.motor].name + "-delay" + DELAYS[sel.delay] + "-chute" + chuteName + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}
