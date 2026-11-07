"use strict";

/* =====================================================================
   SETTINGS  (js/settings.js)
   Every number you will want to tune. SI units: meters, kilograms,
   seconds, newtons.
   ===================================================================== */

/* ---- planet and physics ---- */
const R = 600000;                    // planet radius, m
const G0 = 9.81;                     // surface gravity, m/s2
const MU = G0 * R * R;               // gravity strength: force = m * MU / r^2
const DT = 1 / 60;                   // physics step, s
const VEL_IT = 16, POS_IT = 6;       // solver effort per step

/* ---- engine and steering ---- */
const MAX_THRUST = 50000;            // N at full throttle
const MIN_THROTTLE = 0.2;            // the lowest the engine can run once it is lit (fraction of max thrust)
const ISP = 300;                     // seconds. Fuel burned per second = thrust / (ISP * 9.81)
const GIMBAL_MAX = 6 * Math.PI / 180;// how far the engine can swivel, radians
const GIMBAL_RATE = 1.0;             // how fast it swivels, rad/s
const WHEEL_MAX = 6000;              // reaction wheel torque, N*m
const DAMP_K = 4000;                 // how hard "rotation damping" fights spin (N*m per rad/s)
const TANK_DRY = 400, FUEL_FULL = 1600;   // kg, kg

/* ---- display ---- */
const REF_OFFSET = 3.3;              // height of the tank's centre when the rocket stands on its legs. Altitudes
                                     // are shown minus this, so the pad reads 0

/* The engine's built-in speed cap (2 m per step) would hold everything below 120 m/s.
   Raising it is what lets orbits work. */
try {
  planck.Settings.maxTranslation = 1000;
  planck.Settings.maxTranslationSquared = 1e6;
} catch (e) { log("could not raise the speed cap: " + e.message); }
