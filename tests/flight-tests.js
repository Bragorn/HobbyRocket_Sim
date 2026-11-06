/* =====================================================================
   FLIGHT TESTS  (tests/flight-tests.js)
   Runs the real game files without a browser and checks them.
   Needs Node.js. From the project folder:   node tests/flight-tests.js

   1. Regression: with no parachute, motors A and E must match the flights
      you exported earlier, number for number (the first 8 CSV columns).
   2. A table of every motor x delay x parachute combination.
   3. A smoke test: runs the real frame loop and keyboard handlers.
   13. The builder: choosing parts rebuilds the rocket (js/ui.js, the
      sidebar itself, is not loaded here: it needs a real web page).
   ===================================================================== */
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..");
const FILES = ["data", "catalog", "telemetry", "sim", "camera", "fx", "render", "hud", "input", "main"];

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
  key("KeyR");
  sandbox.chooseMotor(2); sandbox.chooseDelay(1); sandbox.chooseRecovery("M");
  check(sel.motor === 2 && sel.delay === 1 && sel.chute === 1, `chose motor ${MOTORS[sel.motor].name}, ${DELAYS[sel.delay]} s delay, chute ${CHUTES[sel.chute].name}`);
  sandbox.chooseRecovery("none"); check(sel.chute === -1, "choosing no recovery removes the parachute");
  sandbox.chooseRecovery("M"); sandbox.chooseDelay(0); sandbox.chooseMotor(0);
  frames(5);                                                    // empty graphs must draw
  key("Space"); frames(60 * 40);
  check(sandbox.flightState() === "LANDED", `real frame loop flew to ${sandbox.flightState()} (apogee ${sim.apogee.toFixed(0)} m)`);
  sandbox.chooseMotor(2);                                       // must be ignored after launch
  check(sel.motor === 0, "the choosers are ignored after launch");
  key("KeyG"); frames(3); key("KeyG"); frames(3); key("KeyG"); frames(3);
  key("KeyD"); key("KeyH"); frames(3);
  key("KeyR"); frames(3);
  check(tele.n === 0 && sim.ignited === false, "reset clears the flight and telemetry");
  check(Math.abs(get("cam.zoom") - get("CAM_ROCKET_PX") / get("CAM_REF_H")) < 1e-9, `camera zoom is fixed by the reference height (${get("cam.zoom").toFixed(0)} px/m)`);
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
{
  fins.maxSide = 0.05; sel.motor = 1; sel.chute = -1; sandbox.resetAll(); sandbox.launch();       // stop the moment the fins come off
  let n = 0; while (!fins.broken && n < 240 * 20) { sandbox.step(DT); n++; }
  fins.maxSide = keep.finSide;
  check(fins.broken && sim.cg < get("rocketCP()"), "without fins the center of pressure is above the center of gravity: unstable");
}
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

/* ---- drawing: every look of every part must draw without errors ---- */
console.log("\n   Drawing every fin x nose x tube look (with markers on and off)");
{
  let drawn = 0, drawErr = null;
  try {
    for (const f of get("FIN_SHAPES")) for (const n of get("NOSES")) for (const t of get("TUBES")) {
      sandbox.resetAll();
      sandbox.chooseBuild("fins", f.id); sandbox.chooseBuild("nose", n.id); sandbox.chooseBuild("tube", t.id);
      get("showMarks = true"); frames(1); get("showMarks = false"); frames(1); drawn += 2;
    }
  } catch (e) { drawErr = e; }
  get("showMarks = true");
  for (const fld of ["tube", "fins", "nose"]) sandbox.chooseBuild(fld, get("DEFAULT_BUILD")[fld === "fins" ? "fins" : fld]);
  sandbox.resetAll();
  check(!drawErr && drawn === 96, drawErr ? "drawing failed: " + drawErr.stack : `${drawn} frames drawn with every part look`);
  const shapes = get("rocket.parts").map(p => p.shape).filter(Boolean);
  check(shapes.join() === "trapezoid,conical", "parts carry the shape the renderer needs (" + shapes.join(", ") + ")");
  key("KeyM"); check(get("showMarks") === false, "M hides the CG/CP markers"); key("KeyM");
}

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
{
  let err = null;
  try {
    for (const px of [4, 10, 21, 23, 40, 110, 500]) { sandbox.resetAll(); get(`setZoomPx(${px})`); get("cam.zoom = cam.target"); frames(1); }
  } catch (e) { err = e; }
  sandbox.resetAll();
  check(!err, err ? "drawing at some zoom failed: " + err.stack : "the rocket draws at every zoom from 4 to 500 px, arrow when tiny, markers too");
  get("setZoomPx(10)"); get("cam.zoom = cam.target"); const before = JSON.stringify(drawCalls);
  frames(1); check(JSON.stringify(drawCalls) !== before, "a tiny rocket is still drawn (as an arrow)");
  sandbox.resetAll();
}
key("KeyZ"); check(Math.abs(get("cam.target") * get("CAM_REF_H") - 240) < 1e-6, "Z jumps to the close preset");
frames(60); check(Math.abs(get("cam.zoom") - get("cam.target")) < 1e-6, "zoom eases to its target");
for (let i = 0; i < 100; i++) key("Equal");
check(get("cam.target") * get("CAM_REF_H") <= get("CAM_MAX_PX") + 1e-6, "zoom stops at the closest limit");
for (let i = 0; i < 100; i++) key("Minus");
check(get("cam.target") * get("CAM_REF_H") >= get("CAM_MIN_PX") - 1e-6, "zoom stops at the widest limit");
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

/* ---- 12. parts catalog ---- */
console.log("\n12. Parts catalog");
sel.motor = 1; sandbox.resetAll();
const built = get("buildParts(DEFAULT_BUILD)"), liveParts = get("rocket.parts");
const cmpFields = ["name", "kind", "length", "width", "mass", "cdA", "cn", "cpAt", "maxSide", "maxQ", "maxPull", "at", "inside"];
const diffs = [];
liveParts.forEach((a, i) => cmpFields.forEach(f => {
  const x = a[f], y = built[i][f];
  if (typeof x === "number" && typeof y === "number" ? Math.abs(x - y) > 1e-9 : x !== y) diffs.push(`${a.name}.${f}: live ${x}, catalog ${y}`);
}));
check(diffs.length === 0, diffs.length === 0 ? "default catalog build matches today's rocket exactly" : "default build differs: " + diffs.join("; "));
const tubeById = (id) => get("TUBES").find(t => t.id === id);
check(get("motorFit")(tubeById("t24-thin"), MOTORS[2]) === "ok", "E motor fits a 24 mm tube");
check(get("motorFit")(tubeById("t18-thin"), MOTORS[2]) === "no", "E motor does not fit an 18 mm tube");
check(get("motorFit")(tubeById("t24-thin"), MOTORS[0]) === "adapter", "A motor in a 24 mm tube needs an adapter");
check(get("motorFit")(tubeById("t18-thin"), MOTORS[1]) === "ok", "C motor fits an 18 mm tube");
const allLists = ["TUBES", "FIN_SHAPES", "FIN_MATERIALS", "NOSES", "RECOVERY"];
check(allLists.every(n => { const ids = get(n).map(x => x.id); return new Set(ids).size === ids.length; }), "every catalog id is unique");
let combos = 0, badNum = 0;
for (const t of get("TUBES")) for (const f of get("FIN_SHAPES")) for (const m of get("FIN_MATERIALS")) for (const n of get("NOSES")) {
  combos++;
  for (const p of get("buildParts")({ tube: t.id, fins: f.id, finMat: m.id, nose: n.id, recovery: "M" }))
    for (const k of ["length", "width", "mass", "cdA", "at"]) if (!Number.isFinite(p[k]) || p[k] < 0) badNum++;
}
check(badNum === 0, `${combos} tube x fin x material x nose combinations all build with sensible numbers`);

/* ---- 13. the builder: choosing parts rebuilds the rocket ---- */
console.log("\n13. Builder: choosing parts rebuilds the rocket");
const DEFAULT = get("DEFAULT_BUILD"), buildNow = get("build");
const backToDefault = () => { for (const f of ["tube", "fins", "finMat", "nose"]) sandbox.chooseBuild(f, DEFAULT[f]); sandbox.chooseRecovery("M"); };
sel.wind = 0; sel.angle = 2; sandbox.chooseMotor(1); sandbox.chooseDelay(1);
backToDefault(); sandbox.resetAll();
const baseFlight = fly(1, 1, 1);
check(Math.abs(get("ROCKET_H") - 0.44) < 1e-9 && get("REF_AREA") === get("A_REF"), "default build: 44 cm tall, reference area unchanged");
sandbox.resetAll();                               // the choosers only work on the pad, never after ignition

const zoomBefore = get("cam.target");
sandbox.chooseBuild("tube", "t18-thin"); sandbox.chooseBuild("fins", "swept"); sandbox.chooseBuild("nose", "ogive");
check(partNamed("Body tube").width === 0.019 && partNamed("Fins").span === 0.050 && partNamed("Nose cone").length === 0.090, "choosing tube, fins and nose swaps the real parts");
check(Math.abs(get("ROCKET_H") - (0.07 + 0.30 + 0.09)) < 1e-9 && get("ROCKET_H") === get("rocketHeight()"), `rocket height follows the build (${(get("ROCKET_H") * 100).toFixed(0)} cm)`);
check(get("REF_AREA") < get("A_REF"), "a thinner tube has a smaller reference area");
check(Math.abs(get("chuteAttachAt()") - 0.37) < 1e-9, "the shock cord ties on at fin length + tube length (swept fins: 37 cm)");
check(get("cam.target") === zoomBefore, "changing the build does not change the zoom, so parts keep their true size");
const changed = fly(1, 1, 1);
check(changed.apogee !== baseFlight.apogee && Number.isFinite(changed.apogee) && sandbox.flightState() === "LANDED", `a different build flies differently (apogee ${baseFlight.apogee.toFixed(0)} m -> ${changed.apogee.toFixed(0)} m)`);

sandbox.resetAll(); backToDefault(); sandbox.resetAll();
const again = fly(1, 1, 1);
check(again.apogee === baseFlight.apogee && again.impact === baseFlight.impact && again.flight === baseFlight.flight, "going back to the default build gives the identical flight");

sandbox.resetAll(); sel.motor = 2; sandbox.chooseBuild("tube", "t18-thin");
check(get("launchBlocked()") !== "", `E motor in an 18 mm tube cannot launch ("${get("launchBlocked()")}")`);
sandbox.resetAll(); key("Space");
check(sim.ignited === false, "Space does nothing while the motor does not fit");
sandbox.chooseMotor(1);
check(get("launchBlocked()") === "", "a motor that fits can launch");
backToDefault(); sandbox.chooseMotor(1);

sandbox.chooseRecovery("streamer");
check(sel.chute === 3 && partNamed("Parachute").maxPull === 14 && buildNow.recovery === "streamer", "streamer: its own chute entry and a weaker 14 N cord");
const str = fly(1, 1, 3);
check(str.impact > get("SAFE_LANDING_SPEED") && str.impact < get("CRASH_SPEED") && broken().length === 0, `streamer on a C motor lands hard but intact (${str.impact.toFixed(1)} m/s, ${str.verdict})`);
sandbox.resetAll(); backToDefault(); sandbox.chooseMotor(1);
check(partNamed("Parachute").maxPull === 22, "back to a chute: 22 N cord");

sandbox.chooseRecovery("none"); check(sel.chute === -1, "recovery none = no parachute");
backToDefault(); sandbox.chooseMotor(1);
const predicted = get("landingSpeed(1)"), actual = fly(1, 1, 1).impact;
check(Math.abs(predicted - actual) < 0.6, `sidebar landing-speed estimate for the M chute (${predicted.toFixed(1)} m/s) matches the flight (${actual.toFixed(1)} m/s)`);

sandbox.resetAll(); sandbox.launch();
sandbox.chooseBuild("nose", "blunt"); sandbox.chooseRecovery("L"); sandbox.chooseMotor(2);
check(buildNow.nose === "conical" && sel.chute === 1 && sel.motor === 1, "choices are locked after ignition");
sandbox.resetAll();

const unstable = [];
for (const t of get("TUBES")) for (const f of get("FIN_SHAPES")) for (const n of get("NOSES")) {
  sandbox.chooseBuild("tube", t.id); sandbox.chooseBuild("fins", f.id); sandbox.chooseBuild("nose", n.id);
  const cal = get("rocketCal()");
  if (cal < 1) unstable.push(`${t.id}/${f.id}/${n.id} ${cal.toFixed(1)}`);
}
console.log(`  info    builds under 1 caliber with the C motor: ${unstable.length} of ${get("TUBES").length * get("FIN_SHAPES").length * get("NOSES").length}${unstable.length ? "  e.g. " + unstable.slice(0, 4).join(", ") : ""}`);
backToDefault(); sandbox.chooseMotor(1); sel.wind = 0; sandbox.resetAll();

/* ---- 14. placement: fin position, nose weight, and flights that differ from each other ---- */
console.log("\n14. Placement and variety");
const calNow = () => get("rocketCal()");
const resetBuild = () => { sandbox.resetAll(); backToDefault(); sandbox.chooseFinShift(0); sandbox.chooseBallast(0); sandbox.chooseMotor(1); sandbox.resetAll(); };
resetBuild();
const cal0 = calNow(), mass0 = sim.mass;
sandbox.chooseFinShift(60);
check(Math.abs(partNamed("Fins").shift - 0.06) < 1e-9 && Math.abs(partNamed("Fins").cpAt - (0.01 + 0.06)) < 1e-9, "fins 6 cm up the tube: their push point moves up 6 cm");
check(calNow() < cal0, `fins higher up the tube: less stable (${cal0.toFixed(1)} -> ${calNow().toFixed(1)} cal)`);
sandbox.chooseFinShift(-20);
check(calNow() > cal0, `fins hanging off the back: more stable (${calNow().toFixed(1)} cal)`);
check(partNamed("Fins").maxSide < 8, `fins hanging off the back are held on less well (limit ${partNamed("Fins").maxSide.toFixed(1)} N instead of 8)`);
sandbox.chooseFinShift(500); check(buildNow.finMm === get("FIN_MM_MAX"), "fin position stops at the top of its range");
sandbox.chooseFinShift(-500); check(buildNow.finMm === get("FIN_MM_MIN"), "fin position stops at the back of its range");
sandbox.chooseFinShift(34); check(buildNow.finMm === 30, "fin position snaps to whole centimeters");
sandbox.chooseFinShift(120);
check(calNow() < 0, `fins 12 cm up the tube: unstable (${calNow().toFixed(1)} cal)`);
sandbox.chooseBallast(30);
check(calNow() > 1 && Math.abs(sim.mass - mass0 - 0.030) < 1e-9, `30 g of nose weight makes it stable again (${calNow().toFixed(1)} cal) and adds exactly 30 g`);
const nw = partNamed("Nose weight"), noseP = partNamed("Nose cone");
check(nw.at > noseP.at - noseP.length / 2 && nw.at < noseP.at + noseP.length / 2, "the nose weight sits inside the nose cone");
sandbox.chooseBallast(7); check(buildNow.ballastG === 5, "nose weight snaps to 5 g steps");
sandbox.chooseBallast(99); check(buildNow.ballastG === get("BALLAST_MAX_G"), "nose weight stops at its maximum");
resetBuild();
check(get("buildPrice")(Object.assign({}, buildNow), MOTORS[1]) < get("buildPrice")(Object.assign({}, buildNow, { ballastG: 30 }), MOTORS[1]), "nose weight costs a little");

sandbox.chooseFinShift(120); sel.wind = 0; launchOpts.imperfect = false;
fly(1, 1, 1);
check(tele.hi[12] === 0 && sim.apogee > 390, "unstable, but perfectly aimed in still air with a perfect motor: nothing disturbs it, it balances on a knife edge");
launchOpts.imperfect = true; sel.wind = 2;
const wrong = [];
for (const seed of [1, 2, 3]) {
  launchOpts.seed = seed; fly(1, 1, 1);
  wrong.push({ ap: sim.apogee, lean: Math.max(Math.abs(tele.lo[10]), Math.abs(tele.hi[10])) * 180 / Math.PI });
}
check(wrong.every(r => r.ap < 340 || r.lean > 45), `unstable with a real motor and 5 m/s wind: all 3 flights go wrong (apogee ${wrong.map(r => r.ap.toFixed(0)).join(", ")} m instead of ~400)`);
launchOpts.imperfect = false; sel.wind = 0;
sandbox.resetAll(); sandbox.chooseFinShift(0); sandbox.resetAll();

/* variety: imperfections on gives each seed its own motor and gusts */
launchOpts.imperfect = true;
const seen = [];
for (const seed of [1, 2, 3, 4, 5]) { launchOpts.seed = seed; fly(1, 1, 1); seen.push({ mis: sim.misalign, ts: sim.thrustScale, ga: sim.gustAmp, ap: sim.apogee, x: sim.x }); }
check(seen.every(r => Math.abs(r.mis) <= get("THRUST_MISALIGN_DEG") * get("ADAPTER_MISALIGN_MULT") * Math.PI / 180 + 1e-12 && Math.abs(r.ts - 1) <= get("THRUST_VARY") + 1e-12 && r.ga >= get("GUST_AMP_MIN") && r.ga <= get("GUST_AMP_MAX")), "each flight's misalignment, motor strength and gust size stay inside their limits");
check(new Set(seen.map(r => r.ap.toFixed(3))).size === 5 && new Set(seen.map(r => r.x.toFixed(2))).size === 5, `5 seeds, 5 different flights, even in calm air (apogee ${Math.min(...seen.map(r => r.ap)).toFixed(0)}-${Math.max(...seen.map(r => r.ap)).toFixed(0)} m, landing ${Math.min(...seen.map(r => r.x)).toFixed(0)} to ${Math.max(...seen.map(r => r.x)).toFixed(0)} m)`);
{
  const base = get("THRUST_MISALIGN_DEG") * Math.PI / 180, mult = get("ADAPTER_MISALIGN_MULT");
  const worst = (tubeId) => { sandbox.resetAll(); sandbox.chooseBuild("tube", tubeId); let w = 0;
    for (let seed = 1; seed <= 40; seed++) { launchOpts.seed = seed; sandbox.resetAll(); sandbox.launch(); w = Math.max(w, Math.abs(sim.misalign)); }
    sandbox.resetAll(); return w; };
  const wAdapter = worst("t24-thin"), wFit = worst("t18-thin");      // the C motor: adapter in 24 mm, snug in 18 mm
  check(wFit <= base + 1e-12, `C motor snug in an 18 mm tube: misalignment stays within ${get("THRUST_MISALIGN_DEG")} deg`);
  check(wAdapter > base && wAdapter <= base * mult + 1e-12, `C motor in an adapter in a 24 mm tube: looser, up to ${(wAdapter * 180 / Math.PI).toFixed(2)} deg (limit ${(get("THRUST_MISALIGN_DEG") * mult).toFixed(2)})`);
  sandbox.chooseBuild("tube", "t24-thin"); sandbox.resetAll();
}
launchOpts.seed = 3; fly(1, 1, 1); const s3a = { ap: sim.apogee, x: sim.x }; fly(1, 1, 1);
check(sim.apogee === s3a.ap && sim.x === s3a.x, "the same seed still repeats the same flight exactly");
launchOpts.imperfect = false; fly(1, 1, 1);
check(sim.misalign === 0 && sim.thrustScale === 1, "imperfections off: a perfect motor");

/* dragging the fins with the mouse */
resetBuild(); frames(2);
const px = (xm, hm) => ({ clientX: get(`sx(${xm})`), clientY: get(`sy(${hm})`), target: canvas });
listeners.mousedown(px(0.02, 0.02));
listeners.mousemove(px(0.02, 0.071));
listeners.mouseup({});
check(buildNow.finMm === 50, `dragging the fins up 5 cm with the mouse moves them 5 cm (${buildNow.finMm} mm)`);
listeners.mousemove(px(0.02, 0.2)); check(buildNow.finMm === 50, "the mouse does nothing once the button is released");
listeners.mousedown(px(0.2, 0.05)); listeners.mousemove(px(0.2, 0.3)); listeners.mouseup({});
check(buildNow.finMm === 50, "grabbing empty space does not move the fins");
sandbox.chooseFinShift(0); sandbox.launch();
listeners.mousedown(px(0.02, 0.02)); listeners.mousemove(px(0.02, 0.09)); listeners.mouseup({});
check(buildNow.finMm === 0, "the fins cannot be dragged once the rocket is lit");
resetBuild();

/* every look still draws with the new parts */
{
  let err = null, n = 0;
  try {
    for (const mm of [-20, 0, 60, 120]) for (const g of [0, 30]) for (const f of get("FIN_SHAPES")) {
      sandbox.resetAll(); sandbox.chooseFinShift(mm); sandbox.chooseBallast(g); sandbox.chooseBuild("fins", f.id); frames(1); n++;
    }
  } catch (e) { err = e; }
  resetBuild();
  check(!err && n === 32, err ? "drawing failed: " + err.stack : `${n} frames drawn with moved fins and nose weight`);
}

/* ---- 15. breaking: loose pieces, landing damage, tipping over, a folding tube ---- */
console.log("\n15. Breaking apart");
const names = () => get("rocket.parts").filter(p => p.broken).map(p => p.name);
const debris = () => get("sim.debris");
const settle = (secs) => { for (let i = 0; i < 240 * secs; i++) sandbox.step(DT); };
resetBuild(); sel.wind = 0; launchOpts.imperfect = false;

fly(0, 1, -1);                                    // A motor, no parachute: 32 m/s
check(names().join() === "Fins,Nose cone" && sim.impact > 30 && sim.impact < 35, `A motor, no chute (${sim.impact.toFixed(0)} m/s): the fins and nose snap off, the tube holds (${names().join(", ")})`);
check(debris().length === 5 && debris().map(d => d.kind).sort().join() === "fin,fin,fin,fin,nose", "each broken part becomes its own loose piece (every fin separately)");
settle(10);
check(debris().every(d => d.landed && d.y > 0 && d.y < 0.05), "the pieces fall and come to rest on the ground");
check(Math.abs(Math.abs(sim.rest.theta) - Math.PI / 2) < 1e-9 && sim.rest.lying, "the rocket tips over and lies on its side after landing");
check(sim.landed && sandbox.flightState() === "LANDED" && Number.isFinite(sim.rest.x), "the flight still counts as landed while it settles");
const restX = sim.rest.x; settle(3); check(sim.rest.x === restX, "once it lies flat it stays put");

fly(1, 1, -1);                                    // C motor, no parachute: 58 m/s
check(names().includes("Body tube") && names().includes("Fins") && names().includes("Nose cone"), `C motor, no chute (${sim.impact.toFixed(0)} m/s): the tube crumples too (${names().join(", ")})`);
sandbox.chooseBuild; resetBuild(); sandbox.chooseBuild("tube", "t24-thick"); fly(1, 1, -1);
check(!names().includes("Body tube") && names().includes("Fins"), "a thick-walled tube survives the same landing that crumples a thin one");
resetBuild();

fly(1, 1, 1);                                     // gentle landing
check(names().length === 0 && debris().length === 0, `C motor, M chute (${sim.impact.toFixed(1)} m/s): nothing breaks, no loose pieces`);
settle(5);
check(sim.rest.lying && Math.abs(Math.abs(sim.rest.theta) - Math.PI / 2) < 1e-9, "a gentle landing still tips over and lies down");
check(Math.cos(sim.theta) > 0.7, "the flight's own landing tilt is untouched by the tipping over (it is kept separately)");

sel.wind = 2; launchOpts.imperfect = true; launchOpts.seed = 9;                   // the same seed repeats the same breakage
fly(1, 1, -1); const d1 = debris().map(d => [d.kind, d.x.toFixed(4), d.y.toFixed(4), d.theta.toFixed(3)].join());
settle(10); const d1b = debris().map(d => [d.kind, d.x.toFixed(4), d.theta.toFixed(3)].join());
fly(1, 1, -1); settle(10); const d2b = debris().map(d => [d.kind, d.x.toFixed(4), d.theta.toFixed(3)].join());
check(d1b.join("|") === d2b.join("|") && d1b.length >= 2, "same seed: the pieces scatter and land in exactly the same places");
launchOpts.imperfect = false; sel.wind = 0;

/* the chute canopy comes loose when the cord snaps, and drifts down slowly */
fly(2, 0, 1);
const canopy = debris().find(d => d.kind === "chute");
check(names().includes("Parachute") && canopy !== undefined, "E motor, 3 s delay: the cord snaps and the canopy flies off as a loose piece");

/* a tube that folds in flight takes everything above it along */
resetBuild(); sel.wind = 2; launchOpts.imperfect = true; launchOpts.seed = 4;
partNamed("Body tube").maxBend = 0.02;
fly(1, 1, 1);
check(names().includes("Body tube") && names().includes("Nose cone") && names().includes("Parachute"), `a tube with a 0.02 N*m limit folds in 5 m/s wind and the nose and chute go with it (${names().join(", ")})`);
check(tele.events.some(e => e.label.indexOf("folded in half") >= 0) && debris().length >= 2 && Number.isFinite(sim.apogee) && sandbox.flightState() === "LANDED", "the folded rocket still flies on to a landing, with pieces falling separately");
check(sim.mass < 0.1, `the rest of the rocket is lighter (${(sim.mass * 1000).toFixed(0)} g)`);
launchOpts.imperfect = false; sel.wind = 0; resetBuild();
check(partNamed("Body tube").maxBend === 1.5 && partNamed("Body tube").broken === false, "a fresh reset brings back an unbroken tube with its real limit");
sel.wind = 4; launchOpts.imperfect = true; launchOpts.seed = 2; fly(2, 1, 1);
check(!partNamed("Body tube").broken && partNamed("Body tube").peak > 0 && partNamed("Body tube").peak < 1.5 / 3, `an E flight in 8 m/s wind loads the tube to only ${(partNamed("Body tube").peak / 1.5 * 100).toFixed(0)}% of its bending limit`);
launchOpts.imperfect = false; sel.wind = 0;

/* the real frame loop and the drawing, through a crash, the tipping over and the loose pieces */
{
  let err = null;
  try {
    sandbox.resetAll(); sandbox.chooseRecovery("none"); sandbox.chooseMotor(1); key("Space");
    frames(60 * 40); frames(120);
    check(sim.landed && debris().length >= 3 && sandbox.flightState() === "LANDED", "real frame loop: a no-chute C flight crashes, scatters pieces and settles");
    get("setZoomPx(10)"); get("cam.zoom = cam.target"); frames(2); get("setZoomPx(110)"); get("cam.zoom = cam.target"); frames(2);
    sandbox.resetAll(); sandbox.chooseRecovery("M"); key("Space"); frames(60 * 40); frames(120);
  } catch (e) { err = e; }
  sandbox.resetAll(); backToDefault(); sandbox.chooseMotor(1);
  check(!err, err ? "drawing failed: " + err.stack : "the crash, the pieces, the tipped rocket and the collapsed canopy all draw without errors");
  check(debris().length === 0 && !sim.landed, "reset clears the pieces and the landing");
}

/* ---- 16. breaking, part two: single fins, veering, zippering, effects ---- */
console.log("\n16. Fins one at a time, zippering, effects");
resetBuild(); sel.wind = 0; launchOpts.imperfect = false;
{
  const f = partNamed("Fins"), calBefore = calNow(), massBefore = get("rocketMass()");
  check(f.fins.length === 4 && f.alive === 1, "the fins are four separate fins, all on");
  get("applyLandingDamage(13.2)");                  // a hard landing: only the weakest fins let go
  check(f.fins[0].gone && f.fins[1].gone && !f.fins[2].gone && !f.fins[3].gone && f.alive === 0.5 && !f.broken, "a 13 m/s landing snaps the two weakest fins and the other two hold");
  check(debris().length === 2 && debris().every(d => d.kind === "fin"), "each lost fin is its own loose piece");
  check(Math.abs((massBefore - get("rocketMass()")) - f.mass / 2) < 1e-12, "half the fins gone: half the fin weight gone");
  check(calNow() < calBefore, `fewer fins, less stable (${calBefore.toFixed(1)} -> ${calNow().toFixed(1)} cal)`);
  resetBuild();
  check(partNamed("Fins").alive === 1 && partNamed("Fins").fins.every(x => !x.gone), "reset puts all four fins back");
}

/* a fin lost in flight makes the rocket veer; the control flight stays dead straight */
const flyLosingFin = (lose) => {
  sandbox.resetAll(); sandbox.launch(); let n = 0, done = false;
  while (sandbox.flightState() !== "LANDED" && n < 240 * 400) { if (lose && !done && sim.t >= 1.0) { get("breakFin(finsPart, 'snapped off')"); done = true; } sandbox.step(DT); n++; }
  return { x: sim.x, apogee: sim.apogee };
};
resetBuild();
const straight = flyLosingFin(false), veer = flyLosingFin(true);
check(straight.x === 0 && Math.abs(veer.x) > 5 && Number.isFinite(veer.x), `losing one fin at T+1 s: the rocket veers ${Math.abs(veer.x).toFixed(0)} m off line (the intact one lands at ${straight.x})`);
check(veer.apogee !== straight.apogee && Math.abs(veer.apogee - straight.apogee) < 60, `and the climb changes a little (${veer.apogee.toFixed(0)} m instead of ${straight.apogee.toFixed(0)} m)`);

/* in flight the fins come off one by one, weakest first */
resetBuild(); sel.wind = 2;
partNamed("Fins").maxSide = 0.05; fly(1, 1, 1);
const finEvents = tele.events.map(e => e.label).filter(l => l.indexOf("Fins snapped off") === 0);
resetBuild(); sel.wind = 0;
check(finEvents.length === 4 && finEvents[0].indexOf("3 of 4 left") > 0 && finEvents[3].indexOf("0 of 4 left") > 0, `fins snapped off one at a time: ${finEvents.map(l => l.slice(-12)).join(" | ")}`);
sandbox.resetAll();
check(tele.events.length === 0, "(the flight log was cleared)");

/* zippering: a fast deployment tears a thin tube; a thick one holds */
resetBuild(); fly(2, 0, 1);                                         // E motor, 3 s delay: opens at 75 m/s
check(tele.events.some(e => e.label.indexOf("zippered by the chute") >= 0) && names().includes("Body tube") && names().includes("Nose cone"), `E motor, 3 s delay, thin tube: the chute zippers the tube (${names().join(", ")})`);
check(debris().some(d => d.kind === "chute") && debris().some(d => d.kind === "tube"), "the tube, the nose and the canopy all come away as loose pieces");
sandbox.resetAll(); sandbox.chooseBuild("tube", "t24-thick"); fly(2, 1, 1);                    // E motor, 5 s delay, thick tube
check(names().length === 0 && sim.impact < 8, `E motor, 5 s delay, thick tube: the same kind of deployment holds (${sim.impact.toFixed(1)} m/s, nothing broken)`);
resetBuild(); fly(1, 0, 1);
check(names().length === 0, "C motor, 3 s delay, thin tube: gentle enough, nothing breaks");
resetBuild();

/* pieces bounce and skid before they stop */
launchOpts.imperfect = false; sel.wind = 0; fly(1, 1, -1); settle(10);
check(debris().reduce((n, d) => n + d.bounces, 0) >= 1 && debris().every(d => d.landed), `the pieces bounce (${debris().reduce((n, d) => n + d.bounces, 0)} bounces) and then lie still`);
resetBuild();

/* effects: sparks, smoke, dust and shake appear at a crash and are gone after a reset */
{
  let err = null;
  try {
    sandbox.resetAll(); sandbox.chooseRecovery("none"); sandbox.chooseMotor(1); key("Space");
    let n = 0; while (sandbox.flightState() !== "LANDED" && n < 60 * 60) { frames(1); n++; }
    frames(1);
    check(get("fx.chips.length") > 0 && get("fx.puffs.length") > 0 && get("fx.labels.length") > 0, `a crash throws chips (${get("fx.chips.length")}), dust/smoke (${get("fx.puffs.length")}) and callouts (${get("fx.labels.length")})`);
    check(get("fx.shake") > 0, `and shakes the picture (${get("fx.shake").toFixed(1)} px)`);
    check(get("fx.labels").some(l => /SNAPPED|CRACKED|CRUMPLED|FOLDED/.test(l.text)), `callouts say what broke ("${get("fx.labels")[0].text}")`);
    frames(60 * 6);
    check(get("fx.chips.length") === 0 && get("fx.labels.length") === 0 && get("fx.shake") === 0, "the effects die away on their own");
  } catch (e) { err = e; }
  sandbox.resetAll();
  check(!err, err ? "effects failed: " + err.stack : "effects draw without errors");
  check(get("fx.chips.length") === 0 && get("fx.puffs.length") === 0 && get("sim.fx.length") === 0, "reset clears every effect");
  backToDefault(); sandbox.chooseMotor(1);
}

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
