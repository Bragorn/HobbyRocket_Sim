"use strict";

/* =====================================================================
   DATA AND SETTINGS  (js/data.js)
   Every number you will want to tune lives in this file.
   Units are SI everywhere: meters, kilograms, seconds, newtons.
   ===================================================================== */

/* ---- physics ---- */
const DT = 1 / 240;          // physics step, seconds
const MAX_STEPS = 10;        // most physics steps per drawn frame (stops the "spiral of death")
const G = 9.81;              // gravity, m/s^2
const RHO0 = 1.225;          // air density at sea level, kg/m^3
const SCALE_HEIGHT = 8500;   // air thins by a factor of e every 8500 m
const DRAG_TUNE = 1.0;       // multiplies airframe drag. Try 1.5 or 2 for a snappier slowdown.
const ROD_LENGTH = 1.0;                  // launch rod height, m. The rocket can't tilt until it clears this
const A_REF = Math.PI * 0.0125 * 0.0125; // body cross-section area, m^2 (25 mm tube)
const WINDS = [0, 2, 5, 8, 12, 20];      // wind speeds, m/s. W cycles them (20 is a storm, for stress tests)

/* ---- launch setup ---- */
const ANGLES = [-10, -5, 0, 5, 10];      // launch rod tilt in degrees (+ leans right). A cycles them
const ROD_ERROR_DEG = 0.7;               // random rod/rocket misalignment, up to +/- this many degrees
const launchOpts = { imperfect: true, seed: 0 };   // seed 0 = a new random one every launch. Tests set a fixed one

/* ---- landing verdicts (impact speed in m/s) ---- */
const SAFE_LANDING_SPEED = 8;    // at or below this: SAFE
const CRASH_SPEED = 15;          // above this: CRASH. In between: HARD

/* ---- parachute ---- */
const CHUTE_OPEN_TIME = 0.4;     // seconds from deployment to fully open
const CHUTE_ATTACH_AT = 0.36;   // where the shock cord ties on, m above the bottom (base of the nose cone)
const CHUTE_LINE = 0.35;        // drawn length of the lines, m (looks only, no physics)

/* ---- telemetry ---- */
const TELE_RATE = 60;            // samples per second of flight
const TELE_CAP = TELE_RATE * 300;// room for 5 minutes of flight


/* ---------------------------------------------------------------------
   MOTORS (our own numbers, tune freely)
   curve = list of [seconds after ignition, thrust in newtons].
   Same shape as real thrust-curve files, so real data could be dropped
   in later. Fuel mass burns off in proportion to the impulse delivered.
   --------------------------------------------------------------------- */
const MOTORS = [
  { name: "A", dryMass: 0.0127, propMass: 0.0033,
    curve: [[0, 0], [0.02, 10], [0.08, 9], [0.20, 6], [0.32, 5], [0.40, 0]] },
  { name: "C", dryMass: 0.0120, propMass: 0.0120,
    curve: [[0, 0], [0.05, 13], [0.15, 12], [0.40, 7], [1.00, 5.5], [1.50, 5], [1.65, 0]] },
  { name: "E", dryMass: 0.0320, propMass: 0.0250,
    curve: [[0, 0], [0.10, 22], [0.30, 16], [0.60, 11], [2.50, 8], [3.00, 6], [3.20, 0]] }
];

for (let i = 0; i < MOTORS.length; i++) {         // work out burn time and total impulse once
  const m = MOTORS[i];
  let imp = 0;
  for (let k = 1; k < m.curve.length; k++) {
    imp += (m.curve[k][1] + m.curve[k - 1][1]) / 2 * (m.curve[k][0] - m.curve[k - 1][0]);
  }
  m.totalImpulse = imp;                           // N*s
  m.burnTime = m.curve[m.curve.length - 1][0];    // s
}


/* ---------------------------------------------------------------------
   DELAY CHARGES
   A simple model rocket has no sensor. A delay charge fires this many
   seconds AFTER the motor burns out and pushes the parachute out.
   --------------------------------------------------------------------- */
const DELAYS = [3, 5, 7];


/* ---------------------------------------------------------------------
   PARACHUTES (first guesses, to be tested and then locked in)
   diameter in m, cd = drag coefficient of the canopy, mass in kg.
   The drag area (cdA) is worked out from the diameter.
   --------------------------------------------------------------------- */
const CHUTES = [
  { name: "S", diameter: 0.20, cd: 0.75, mass: 0.004, color: "#f5c542" },
  { name: "M", diameter: 0.30, cd: 0.75, mass: 0.006, color: "#f5c542" },
  { name: "L", diameter: 0.45, cd: 0.75, mass: 0.010, color: "#f5c542" }
];
for (let i = 0; i < CHUTES.length; i++) {
  const r = CHUTES[i].diameter / 2;
  CHUTES[i].cdA = CHUTES[i].cd * Math.PI * r * r; // m^2
}


/* ---------------------------------------------------------------------
   ROCKET
   A rocket is a LIST OF PARTS, bottom to top. Later, the joints between
   neighbouring parts are what will break.
   mass = kg. cdA = drag area in m^2 (drag coefficient x area).
   inside:true parts sit inside the stack and add no height.
   The motor and parachute masses depend on what you picked, so their
   mass here is 0 and sim.js fills it in.
   --------------------------------------------------------------------- */
const rocket = {
  parts: [
    { name: "Fins",      kind: "fins",  length: 0.06, width: 0.025, span: 0.060, mass: 0.008, cdA: 0.8e-4, cn: 6.0, cpAt: 0.01, maxSide: 8, maxQ: 30000, color: "#c0392b" },
    { name: "Body tube", kind: "tube",  length: 0.30, width: 0.025,              mass: 0.030, cdA: 0.8e-4, color: "#ecf0f1" },
    { name: "Nose cone", kind: "nose",  length: 0.08, width: 0.025,              mass: 0.010, cdA: 1.0e-4, cn: 2.0, cpAt: 0.40, maxSide: 6, color: "#e67e22" },
    { name: "Motor",     kind: "motor", length: 0.07, width: 0.018,              mass: 0,     cdA: 0,      at: 0.035, color: "#34495e", inside: true },
    { name: "Parachute", kind: "chute", length: 0,    width: 0,                  mass: 0,     cdA: 0,      at: 0.30,  maxPull: 22, color: "#f5c542", inside: true }
  ]
};

/* Strength limits (first guesses, tune from the peak loads shown in the HUD):
   maxSide = sideways air force the part can take (N)
   maxQ    = dynamic pressure where fins flutter apart (Pa)
   maxPull = pull the parachute cord can take (N) */
for (let i = 0; i < rocket.parts.length; i++) { rocket.parts[i].broken = false; rocket.parts[i].peak = 0; }
  
/* New part fields:
   at   = height of the part's own center above the bottom of the rocket (m).
          Worked out below for stacked parts; set by hand for inside parts.
   cn   = how hard the part pushes sideways when the air hits it at an angle
          (bigger = stronger). Nose and fins do almost all of it; a plain tube adds ~0.
   cpAt = height (m above the bottom) where that sideways push acts. */
{
  let up = 0;
  for (let i = 0; i < rocket.parts.length; i++) {
    const p = rocket.parts[i];
    if (!p.inside) { p.at = up + p.length / 2; up += p.length; }
  }
}
