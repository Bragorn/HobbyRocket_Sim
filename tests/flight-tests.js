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
const launchOpts = get("launchOpts");
launchOpts.imperfect = false;                     // tests stay exact unless a section turns this on
launchOpts.seed = 12345;

function fly(motor, delay, chute) {
  sel.motor = motor; sel.delay = delay; sel.chute = chute;
  sandbox.resetAll();
  sandbox.launch();
  let n = 0;
  while (sandbox.flightState() !== "LANDED" && n < 240 * 600) { sandbox.step(DT); n++; }
  const ev = tele.events.find(e => e.label.indexOf("Chute out") === 0);
  let worstPct = 0, worstName = "-";              // how close the most loaded part came to breaking
  for (const p of get("rocket.parts")) {
    const lim = p.maxSide || p.maxPull;
    let pct = lim ? p.peak / lim : 0;
    if (p.maxQ) pct = Math.max(pct, sim.maxQ / p.maxQ);
    if (pct * 100 > worstPct) { worstPct = pct * 100; worstName = p.name; }
  }  
  return {
    apogee: sim.apogee, flight: sim.t, impact: sim.impact, verdict: sim.verdict,
    deployT: ev ? ev.t : null, deployText: ev ? ev.label.replace("Chute out  ", "") : "-",
    shockG: sim.maxShock / 9.81, samples: tele.n, worstPct, worstName,
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
lines.push("motor delay chute | apogee | chute out (T+ s, where)     | peak g | impact | verdict | flight | most loaded part");
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
        `${r.impact.toFixed(1)}`.padEnd(7) + "| " + r.verdict.padEnd(8) + "| " + (r.flight.toFixed(1) + " s").padEnd(8) + "| " + r.worstName + " " + r.worstPct.toFixed(0) + "%"
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
  check(Math.abs(get("cam.zoom") - get("CAM_ROCKET_PX") / get("ROCKET_H")) < 1e-9, `camera zoom is fixed by rocket size (${get("cam.zoom").toFixed(0)} px/m)`);
} catch (e) { check(false, "exception: " + e.stack); }

/* ---- 5. rotation ---- */
console.log("\n5. Rotation");
sel.wind = 0; fly(1, 1, 1);
check(tele.hi[12] === 0, "no wind, no tilt: angle of attack stays exactly 0");
check(tele.lo[10] === 0 && tele.hi[10] === 0 && sim.x === 0, "no wind: the rocket stays perfectly vertical");
sel.wind = 2; fly(1, 1, -1);
check(tele.lo[10] < -0.01, `5 m/s wind: the rocket leans into the wind (max lean ${(tele.lo[10] * 180 / Math.PI).toFixed(1)} deg)`);
check(Number.isFinite(sim.x) && Number.isFinite(sim.theta), "numbers stay finite while tilted");
sel.wind = 2; fly(1, 1, 1);
check(Math.cos(sim.theta) > 0.7, `under the chute the rocket hangs nose-up (tilt at landing ${(sim.theta * 180 / Math.PI).toFixed(0)} deg)`);
sel.wind = 0;

/* ---- 6. part failures ---- */
console.log("\n6. Part failures");
const broken = () => get("rocket.parts").filter(p => p.broken).map(p => p.name);
sel.wind = 0;
fly(2, 0, 1);
check(broken().includes("Parachute") && sim.verdict !== "SAFE", `E motor, 3 s delay, M chute: the cord snaps (${broken().join(", ")}) and it lands ${sim.verdict}`);
fly(1, 1, 1);
check(broken().length === 0, "C motor, 5 s delay, M chute: nothing breaks");

/* ---- 7. forced failures: weaken one limit on purpose, check that it breaks ---- */
console.log("\n7. Forced failures (a limit is weakened on purpose, then put back)");
const partNamed = (n) => get("rocket.parts").find(p => p.name === n);
const fins = partNamed("Fins"), nose = partNamed("Nose cone");
const keep = { finSide: fins.maxSide, finQ: fins.maxQ, noseSide: nose.maxSide };
sel.wind = 2;
fins.maxSide = 0.05; fly(1, 1, -1); fins.maxSide = keep.finSide;
check(broken().includes("Fins"), `fins with a 0.05 N limit snap off in 5 m/s wind (peak ${fins.peak.toFixed(2)} N)`);
check(sim.cg < get("rocketCP()"), "without fins the center of pressure is above the center of gravity: unstable");
sel.wind = 0;
fins.maxQ = 5000; fly(2, 1, -1); fins.maxQ = keep.finQ;
check(broken().includes("Fins") && tele.events.some(e => e.label.indexOf("fluttered apart") >= 0), `E motor with a 5 kPa flutter limit: fins flutter apart (max Q ${(sim.maxQ / 1000).toFixed(1)} kPa)`);
sel.wind = 2;
nose.maxSide = 0.05; fly(1, 1, -1); nose.maxSide = keep.noseSide;
check(broken().includes("Nose cone"), "nose cone with a 0.05 N limit snaps off in 5 m/s wind");
fly(1, 1, 1);
check(broken().length === 0, "real limits restored: nothing breaks on a normal C flight");
check(tele.hi[13] > 0 && tele.hi[13] <= partNamed("Parachute").maxPull, `chute pull peaks at ${tele.hi[13].toFixed(1)} N, under the cord limit`);
sel.wind = 0;

/* ---- 8. launch setup ---- */
console.log("\n8. Launch setup: angle, wind direction, imperfections");
sel.angle = 4; fly(1, 1, -1);
check(sim.x > 5, `rod tilted +10 deg: lands downrange to the right (${sim.x.toFixed(0)} m)`);
sel.angle = 0; fly(1, 1, -1);
check(sim.x < -5, `rod tilted -10 deg: lands to the left (${sim.x.toFixed(0)} m)`);
sel.angle = 2;
sel.wind = 2; sel.windDir = -1; fly(1, 1, -1);
check(tele.hi[10] > 0.01, `wind blowing toward -x: the rocket leans right, into it (max lean ${(tele.hi[10] * 180 / Math.PI).toFixed(1)} deg)`);
check(tele.lo[11] === -5 && tele.hi[11] === -5, "wind channel records 5 m/s toward -x");
sel.windDir = 1; sel.wind = 2;
launchOpts.imperfect = true; launchOpts.seed = 777;
fly(1, 1, -1); const a1 = { x: sim.x, ap: sim.apogee };
fly(1, 1, -1); const a2 = { x: sim.x, ap: sim.apogee };
check(a1.x === a2.x && a1.ap === a2.ap, "imperfections on, same seed: identical flight");
launchOpts.seed = 778; fly(1, 1, -1);
check(sim.x !== a1.x, "a different seed gives a different flight");
sel.wind = 0; launchOpts.seed = 777; fly(1, 1, -1);
check(tele.lo[10] !== 0 || tele.hi[10] !== 0, "imperfections on, no wind: the crooked rod still starts a lean");
const lean = Math.max(Math.abs(tele.lo[10]), Math.abs(tele.hi[10]));
console.log(`  info    max lean with no wind, no chute: ${(lean * 180 / Math.PI).toFixed(0)} deg (a tumble would show 90 or more)`);
launchOpts.imperfect = false;

/* ---- 9. keys for the new options ---- */
console.log("\n9. Keys");
sandbox.resetAll();
key("KeyA");
check(sel.angle === 3 && Math.abs(sim.theta - 5 * Math.PI / 180) < 1e-9, "A tilts the rocket on the pad to 5 deg");
key("KeyQ"); check(sel.windDir === -1, "Q flips the wind direction"); key("KeyQ");
sel.angle = 2; sandbox.resetAll();

/* ---- information only: how close do parts get to their limits? ---- */
console.log("\n   Stress table (most loaded part, as % of its limit; nothing here is a pass/fail)");
for (const w of [0, 2, 3, 4, 5]) {
  sel.wind = w;
  for (const mi of [1, 2]) {
    const r = fly(mi, 1, 1);
    console.log(`   wind ${String(WINDS_()[w]).padStart(2)} m/s  motor ${MOTORS[mi].name}  ${r.worstName} ${r.worstPct.toFixed(0)}%  ${r.verdict}`);
  }
}
sel.wind = 0;
function WINDS_() { return get("WINDS"); }

/* ---- 10. camera zoom ---- */
console.log("\n10. Camera zoom");
sandbox.resetAll();
const z0 = get("cam.target");
key("Equal"); check(get("cam.target") > z0, "+ zooms in");
key("Minus"); key("Minus"); check(get("cam.target") < z0, "- zooms out");
listeners.wheel({ deltaY: -100, preventDefault() {} });
check(get("cam.target") > z0 * 0.8, "mouse wheel up zooms in");
sandbox.resetAll();
key("KeyZ"); check(Math.abs(get("cam.target") * get("ROCKET_H") - 240) < 1e-6, "Z jumps to the close preset");
frames(60); check(Math.abs(get("cam.zoom") - get("cam.target")) < 1e-6, "zoom eases to its target");
for (let i = 0; i < 100; i++) key("Equal");
check(get("cam.target") * get("ROCKET_H") <= get("CAM_MAX_PX") + 1e-6, "zoom stops at the closest limit");
for (let i = 0; i < 100; i++) key("Minus");
check(get("cam.target") * get("ROCKET_H") >= get("CAM_MIN_PX") - 1e-6, "zoom stops at the widest limit");
sandbox.resetAll();

/* ---- 11. motor sizes ---- */
console.log("\n11. Motor sizes");
for (let mi = 0; mi < MOTORS.length; mi++) {
  sel.motor = mi; sandbox.resetAll();
  const mp = partNamed("Motor");
  check(mp.length === MOTORS[mi].length && mp.width === MOTORS[mi].diameter, `motor ${MOTORS[mi].name} part is ${(MOTORS[mi].diameter * 1000).toFixed(0)}x${(MOTORS[mi].length * 1000).toFixed(0)} mm`);
  check(MOTORS[mi].length <= 0.30 && MOTORS[mi].diameter <= 0.025, `motor ${MOTORS[mi].name} fits inside the body tube`);
  const cal = (sim.cg - get("rocketCP()")) / 0.025;
  check(cal > 0, `motor ${MOTORS[mi].name}: rocket is stable on the pad (${cal.toFixed(1)} cal)`);
}
sel.motor = 1; sandbox.resetAll();

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
