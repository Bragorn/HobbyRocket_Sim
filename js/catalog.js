"use strict";

/* =====================================================================
   PARTS CATALOG AND BUILD  (js/catalog.js)
   Everything you can pick for a rocket, as plain data, plus the build you
   are working on (`build`) and the functions the sidebar calls to change it.
   buildParts() turns a build into the same kind of part list as rocket.parts
   in data.js, and sim.js applyBuild() puts that list into the sim.
   A test checks that the default build gives back the original rocket.
   SI units, prices in dollars. Numbers marked (tune) are first guesses.

   Real-world rules this follows:
   - motors come in fixed diameters (18 mm: A-C, 24 mm: D-E); more power = longer
   - a tube is made for ONE motor diameter. A smaller motor needs an adapter.
   - the delay charge is part of the motor, so it is in the motor price
   Where the choices live:
   - tube, fins, fin material, nose: in `build` (this file)
   - motor, delay, recovery, wind, angle: in `sel` (sim.js). sel.chute is the
     index into CHUTES (data.js); recoveryForChute() finds its RECOVERY entry.
   ===================================================================== */

const MOTOR_PRICE = { A: 1.5, C: 3.0, E: 6.5 };   // per flight (single-use)
const ADAPTER_PRICE = 1.0;                        // 18 mm motor in a 24 mm tube
const TUBE_LENGTH = 0.30;                         // fixed for now

/* ---- tubes: size x wall. crushN = thrust it takes before crumpling,
        bendNm = sideways bending moment it takes (both: tune, not used yet) ---- */
const TUBES = [
  { id: "t24-thin",  name: "24 mm tube, thin wall",  diameter: 0.025, motorMm: 24, mass: 0.030, cdA: 0.8e-4, crushN: 35, bendNm: 1.5, price: 2.0, color: "#ecf0f1" },
  { id: "t24-thick", name: "24 mm tube, thick wall", diameter: 0.025, motorMm: 24, mass: 0.045, cdA: 0.8e-4, crushN: 90, bendNm: 3.5, price: 4.0, color: "#c4ced4" },
  { id: "t18-thin",  name: "18 mm tube, thin wall",  diameter: 0.019, motorMm: 18, mass: 0.020, cdA: 0.5e-4, crushN: 20, bendNm: 0.6, price: 1.5, color: "#f4d9a0" },
  { id: "t18-thick", name: "18 mm tube, thick wall", diameter: 0.019, motorMm: 18, mass: 0.030, cdA: 0.5e-4, crushN: 50, bendNm: 1.4, price: 3.0, color: "#d9a95a" }
];

/* ---- fins: shape x material. cpAt = height of the fins' sideways push above the rocket's
        bottom. stiff multiplies the flutter speed limit (long thin fins flutter sooner) ---- */
const FIN_SHAPES = [
  { id: "trapezoid", name: "Trapezoid",     length: 0.060, span: 0.060, mass: 0.008, cdA: 0.8e-4, cn: 6.0, cpAt: 0.010, maxSide: 8, stiff: 1.0, price: 2.0 },
  { id: "swept",     name: "Swept",         length: 0.070, span: 0.050, mass: 0.008, cdA: 0.7e-4, cn: 5.0, cpAt: 0.012, maxSide: 8, stiff: 1.3, price: 2.5 },
  { id: "delta",     name: "Clipped delta", length: 0.070, span: 0.045, mass: 0.008, cdA: 0.7e-4, cn: 4.5, cpAt: 0.012, maxSide: 9, stiff: 1.6, price: 3.0 },
  { id: "large",     name: "Large",         length: 0.070, span: 0.090, mass: 0.010, cdA: 1.3e-4, cn: 9.0, cpAt: 0.012, maxSide: 8, stiff: 0.6, price: 2.5 }
];
const FIN_MATERIALS = [
  { id: "balsa",   name: "Balsa",    mass: 1.0, strength: 1.0, priceMul: 1.0, color: "#c0392b" },
  { id: "plywood", name: "Plywood",  mass: 1.6, strength: 2.2, priceMul: 1.8, color: "#8e5a2b" },
  { id: "plastic", name: "Plastic",  mass: 1.3, strength: 1.8, priceMul: 1.6, color: "#2c82c9" }
];

/* ---- nose cones ---- */
const NOSES = [
  { id: "conical", name: "Conical", length: 0.080, mass: 0.010, cdA: 1.0e-4, cn: 2.0, maxSide: 6, price: 1.0 },
  { id: "ogive",   name: "Ogive",   length: 0.090, mass: 0.012, cdA: 0.8e-4, cn: 2.0, maxSide: 6, price: 2.0 },
  { id: "blunt",   name: "Blunt",   length: 0.050, mass: 0.008, cdA: 1.6e-4, cn: 1.8, maxSide: 7, price: 0.8 }
];

/* ---- recovery. chuteIdx = which entry of CHUTES (data.js) it uses (-1 = none): that is
        where the drag area and the mass come from.
        cordN = pull the cord takes before it snaps ---- */
const RECOVERY = [
  { id: "none",     name: "No recovery",  chuteIdx: -1, cordN: 22, price: 0 },
  { id: "streamer", name: "Streamer",     chuteIdx: 3,  cordN: 14, price: 0.5 },
  { id: "S",        name: "Small chute",  chuteIdx: 0,  cordN: 22, price: 1.0 },
  { id: "M",        name: "Medium chute", chuteIdx: 1,  cordN: 22, price: 1.5 },
  { id: "L",        name: "Large chute",  chuteIdx: 2,  cordN: 22, price: 2.5 }
];

/* today's rocket */
const DEFAULT_BUILD = { tube: "t24-thin", fins: "trapezoid", finMat: "balsa", nose: "conical", recovery: "M" };

/* The rocket being built. The sidebar changes this (through chooseBuild below).
   build.recovery is kept in step with sel.chute by applyBuild(); sel.chute is the one that counts. */
const build = Object.assign({}, DEFAULT_BUILD);

function catalogPick(list, id) { return list.find(function (x) { return x.id === id; }); }

function recoveryForChute(idx) { return RECOVERY.find(function (r) { return r.chuteIdx === idx; }) || RECOVERY[0]; }

function motorFit(tube, motor) {                  // "ok", "adapter" (smaller motor) or "no" (too big)
  const mm = Math.round(motor.diameter * 1000) > 18 ? 24 : 18;
  if (mm === tube.motorMm) return "ok";
  return mm < tube.motorMm ? "adapter" : "no";
}

function buildPrice(b, motor) {                   // what one rocket costs to build and fly once
  const tube = catalogPick(TUBES, b.tube), shape = catalogPick(FIN_SHAPES, b.fins);
  const mat = catalogPick(FIN_MATERIALS, b.finMat), nose = catalogPick(NOSES, b.nose);
  let total = tube.price + shape.price * mat.priceMul + nose.price + catalogPick(RECOVERY, b.recovery).price + MOTOR_PRICE[motor.name];
  if (motorFit(tube, motor) === "adapter") total += ADAPTER_PRICE;
  return total;
}

/* Build a part list (bottom to top) in the same shape as rocket.parts. */
function buildParts(b) {
  const tube = catalogPick(TUBES, b.tube), shape = catalogPick(FIN_SHAPES, b.fins);
  const mat = catalogPick(FIN_MATERIALS, b.finMat), nose = catalogPick(NOSES, b.nose);
  const rec = catalogPick(RECOVERY, b.recovery), d = tube.diameter;
  const parts = [
    { name: "Fins", kind: "fins", length: shape.length, width: d, span: shape.span, mass: shape.mass * mat.mass, cdA: shape.cdA,
      cn: shape.cn, cpAt: shape.cpAt, maxSide: shape.maxSide * mat.strength, maxQ: 30000 * shape.stiff * mat.strength, color: mat.color, shape: shape.id },
    { name: "Body tube", kind: "tube", length: TUBE_LENGTH, width: d, mass: tube.mass, cdA: tube.cdA,
      crushN: tube.crushN, bendNm: tube.bendNm, color: tube.color },
    { name: "Nose cone", kind: "nose", length: nose.length, width: d, mass: nose.mass, cdA: nose.cdA,
      cn: nose.cn, cpAt: shape.length + TUBE_LENGTH + nose.length * 0.5, maxSide: nose.maxSide, color: "#e67e22", shape: nose.id },
    { name: "Motor", kind: "motor", length: 0.07, width: 0.018, mass: 0, cdA: 0, at: 0.035, color: "#34495e", inside: true },
    { name: "Parachute", kind: "chute", length: 0, width: 0, mass: 0, cdA: 0, at: 0.30, maxPull: rec.cordN, color: "#f5c542", inside: true,
      attach: shape.length + TUBE_LENGTH }          // the shock cord ties on at the base of the nose cone
  ];
  let up = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    p.broken = false; p.peak = 0;
    if (!p.inside) { p.at = up + p.length / 2; up += p.length; }
  }
  return parts;
}


/* ---------------------------------------------------------------------
   CHANGING THE BUILD (the sidebar and the keyboard both call these)
   Everything is locked once the rocket is lit: press R to reset first.
   applyLoadout() is in main.js: it rebuilds the rocket and the camera.
   --------------------------------------------------------------------- */
const BUILD_LISTS = { tube: TUBES, fins: FIN_SHAPES, finMat: FIN_MATERIALS, nose: NOSES };

function chooseBuild(field, id) {                 // field: "tube", "fins", "finMat" or "nose"
  if (sim.ignited || !BUILD_LISTS[field] || !catalogPick(BUILD_LISTS[field], id)) return;
  build[field] = id;
  applyLoadout();
}

function chooseRecovery(id) {                     // "none", "streamer", "S", "M" or "L"
  const r = catalogPick(RECOVERY, id);
  if (sim.ignited || !r) return;
  sel.chute = r.chuteIdx;
  applyLoadout();
}

function chooseMotor(i) {
  if (sim.ignited || !MOTORS[i]) return;
  sel.motor = i;
  applyLoadout();
}

function chooseDelay(i) {
  if (sim.ignited || DELAYS[i] === undefined) return;
  sel.delay = i;
}

function chooseWind(i) {
  if (sim.ignited || WINDS[i] === undefined) return;
  sel.wind = i;
}

function chooseWindDir(dir) {                     // -1 = blows toward the left, 1 = toward the right
  if (sim.ignited || (dir !== -1 && dir !== 1)) return;
  sel.windDir = dir;
}

function chooseAngle(i) {
  if (sim.ignited || ANGLES[i] === undefined) return;
  sel.angle = i;
  refreshLoadout();                               // the rod tilt shows on the pad straight away
}

function launchBlocked() {                        // "" when it can launch, otherwise the reason why not
  const tube = catalogPick(TUBES, build.tube), motor = MOTORS[sel.motor];
  if (motorFit(tube, motor) === "no") return "The " + motor.name + " motor is too big for this tube";
  return "";
}
