/* =====================================================================
   FLIGHT TESTS  (tests/flight-tests.js)
   Runs the real game files without a browser and checks them.
   Needs Node.js. From the project folder:   node tests/flight-tests.js

   1. Regression: with no parachute, motors A and E must match the flights
      you exported earlier, number for number (the first 8 CSV columns).
   2. A table of every motor x delay x parachute combination.
   3. A smoke test: runs the real frame loop and keyboard handlers.
   ===================================================================== */
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..");
const FILES = ["data", "telemetry", "sim", "camera", "render", "hud", "input", "main"];

/* ---- a fake browser, just enough for the game files to load ---- */
const drawCalls = {};
const ctx = new Proxy({}, {
  get(t, k) {
    if (k === "measureText") return () => ({ width: 10 });
    return t[k] !== undefined ? t[k] : () => { drawCalls[k] = (drawCalls[k] || 0) + 1; };
  },
  set(t, k, v) { t[k] = v; return true; }
});
const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx };
const listeners = {};
let rafCallback = null;
const sandbox = {
  document: { getElementById: () => canvas },
  window: { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 2, addEventListener: (n, f) => { listeners[n] = f; } },
  performance: { now: () => Date.now() },
  requestAnimationFrame: (f) => { rafCallback = f; },
  console
};
const context = vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), context, { filename: f + ".js" });

const get = (expr) => vm.runInContext(expr, context);
const sel = get("sel"), sim = get("sim"), tele = get("tele"), DT = get("DT"), MOTORS = get("MOTORS"), DELAYS = get("DELAYS"), CHUTES = get("CHUTES");
const key = (code) => listeners.keydown({ code, repeat: false, preventDefault() {} });

function fly(motor, delay, chute) {
  sel.motor = motor; sel.delay = delay; sel.chute = chute;
  sandbox.resetAll();
  sandbox.launch();
  let n = 0;
  while (sandbox.flightState() !== "LANDED" && n < 240 * 600) { sandbox.step(DT); n++; }
  const ev = tele.events.find(e => e.label.indexOf("Chute out") === 0);
  return {
    apogee: sim.apogee, flight: sim.t, impact: sim.impact, verdict: sim.verdict,
    deployT: ev ? ev.t : null, deployText: ev ? ev.label.replace("Chute out  ", "") : "-",
    shockG: sim.maxShock / 9.81, samples: tele.n
  };
}

let failures = 0;
function check(ok, text) { console.log((ok ? "  PASS  " : "  FAIL  ") + text); if (!ok) failures++; }

/* ---- 1. regression against the earlier exports ---- */
console.log("\n1. Regression: no parachute must match your earlier exports");
for (const [name, idx] of [["A", 0], ["E", 2]]) {
  fly(idx, 1, -1);
  const mine = sandbox.buildCsv().split("\n").map(l => l.split(",").slice(0, 8).join(","));
  const base = fs.readFileSync(path.join(__dirname, "baseline", "flight-motor-" + name + ".csv"), "utf8").trim().split("\n").map(l => l.split(",").slice(0, 8).join(","));
  let bad = 0;
  for (let i = 0; i < Math.max(mine.length, base.length); i++) if (mine[i] !== base[i]) bad++;
  check(mine.length === base.length && bad === 0, `motor ${name}: ${mine.length - 1} rows, ${bad} rows differ from the earlier export`);
}

/* ---- 2. the full table ---- */
console.log("\n2. Every combination (delay = seconds after burnout, chute S/M/L or none)");
const lines = [];
lines.push("motor delay chute | apogee | chute out (T+ s, where)     | peak g | impact | verdict | flight");
for (let m = 0; m < MOTORS.length; m++) {
  for (let d = 0; d < DELAYS.length; d++) {
    for (const c of [-1, 0, 1, 2]) {
      if (c === -1 && d > 0) continue;                          // delay does not matter without a chute
      const r = fly(m, d, c);
      const name = c < 0 ? "none" : CHUTES[c].name;
      lines.push(
        `${MOTORS[m].name}     ${c < 0 ? "-" : DELAYS[d] + " s"}`.padEnd(14) + ` ${name}`.padEnd(7) + "| " +
        `${r.apogee.toFixed(0)} m`.padEnd(7) + "| " +
        (r.deployT === null ? "never".padEnd(28) : `${r.deployT.toFixed(1)} s  ${r.deployText}`.padEnd(28)) + "| " +
        `${r.shockG.toFixed(0)} g`.padEnd(7) + "| " +
        `${r.impact.toFixed(1)}`.padEnd(7) + "| " + r.verdict.padEnd(8) + "| " + r.flight.toFixed(1) + " s"
      );
    }
  }
}
console.log(lines.join("\n"));
fs.writeFileSync(path.join(__dirname, "last-results.txt"), lines.join("\n") + "\n");

/* ---- sanity checks on the model ---- */
console.log("\n3. Sanity checks");
const med = fly(1, 1, 1);
check(med.impact < SAFE(), `C motor, 5 s delay, M chute lands at ${med.impact.toFixed(1)} m/s (safe is up to 8)`);
const noChute = fly(1, 1, -1);
check(noChute.impact > 15 && noChute.verdict === "CRASH", `C motor with no chute impacts at ${noChute.impact.toFixed(0)} m/s: ${noChute.verdict}`);
function SAFE() { return get("SAFE_LANDING_SPEED") + 1e-9; }
const small = fly(1, 1, 0), large = fly(1, 1, 2);
check(large.impact < med.impact && med.impact < small.impact, `bigger chute lands softer (S ${small.impact.toFixed(1)}, M ${med.impact.toFixed(1)}, L ${large.impact.toFixed(1)} m/s)`);

/* ---- 4. smoke test: real frame loop, keys, graphs, reset ---- */
console.log("\n4. Smoke test: frame loop, keys, graphs, reset");
let now = 0;
const frames = (n) => { for (let i = 0; i < n; i++) { now += 16.7; rafCallback(now); } };
try {
  key("KeyR"); key("Digit3"); key("Digit5"); key("Digit8");
  check(sel.motor === 2 && sel.delay === 1 && sel.chute === 1, `keys 3, 5, 8 chose motor ${MOTORS[sel.motor].name}, ${DELAYS[sel.delay]} s delay, chute ${CHUTES[sel.chute].name}`);
  key("Digit0"); check(sel.chute === -1, "key 0 removes the parachute");
  key("Digit8"); key("Digit4"); key("Digit1");
  frames(5);                                                    // empty graphs must draw
  key("Space"); frames(60 * 40);
  check(sandbox.flightState() === "LANDED", `real frame loop flew to ${sandbox.flightState()} (apogee ${sim.apogee.toFixed(0)} m)`);
  key("Digit3");                                                // must be ignored after launch
  check(sel.motor === 0, "motor keys are ignored after launch");
  key("KeyG"); frames(3); key("KeyG"); frames(3); key("KeyG"); frames(3);
  key("KeyD"); key("KeyH"); frames(3);
  key("KeyR"); frames(3);
  check(tele.n === 0 && sim.ignited === false, "reset clears the flight and telemetry");
  check(Math.abs(get("cam.zoom") - 64 / get("ROCKET_H")) < 1e-9, `camera zoom is fixed by rocket size (${get("cam.zoom").toFixed(0)} px/m)`);
} catch (e) { check(false, "exception: " + e.stack); }

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
