"use strict";

/* =====================================================================
   SIMULATION  (js/sim.js)
   Physics only. Nothing in this file knows about pixels or the screen.
   World: y = up in meters, the ground is y = 0 (vertical flight for now).
   ===================================================================== */

/* What the player picked before launch (index into MOTORS, DELAYS, CHUTES).
   chute = -1 means no parachute. */
const sel = { motor: 1, delay: 1, chute: 1 };

const sim = {
  t: 0,                          // flight time: seconds since ignition
  y: 0, vy: 0, ay: 0,            // altitude, speed, acceleration
  thrust: 0, drag: 0, mass: 0,   // newtons, newtons, kg
  q: 0,                          // dynamic pressure, Pa (air pushing on the rocket)
  ignited: false, burnedOut: false,
  motorT: 0,                     // seconds the motor has been burning
  impulse: 0,                    // N*s delivered so far
  chuteDeployed: false, deployT: 0, chuteOpen: 0,   // chuteOpen goes 0 -> 1
  prevVy: 0, apogeeLogged: false,
  apogee: 0, maxSpeed: 0, maxAccel: 0, maxQ: 0, maxShock: 0,
  impact: 0, verdict: ""
};

function curveValue(c, t) {                       // linear interpolation along the thrust curve
  if (t <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (t <= c[i][0]) {
      const a = c[i - 1], b = c[i];
      return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]);
    }
  }
  return 0;
}

function motorMass() {                            // dry case + the fuel that is left
  const m = MOTORS[sel.motor];
  if (sim.burnedOut) return m.dryMass;
  const used = Math.min(1, sim.impulse / m.totalImpulse);
  return m.dryMass + m.propMass * (1 - used);
}

function chuteMass() { return sel.chute >= 0 ? CHUTES[sel.chute].mass : 0; }

function rocketMass() {
  let total = 0;
  for (let i = 0; i < rocket.parts.length; i++) {
    const p = rocket.parts[i];
    if (p.kind === "motor") total += motorMass();
    else if (p.kind === "chute") total += chuteMass();
    else total += p.mass;
  }
  return total;
}

function rocketCdA() {                            // drag area of the airframe
  let total = 0;
  for (let i = 0; i < rocket.parts.length; i++) total += rocket.parts[i].cdA;
  return total * DRAG_TUNE;
}

function chuteCdA() { return sel.chute >= 0 ? CHUTES[sel.chute].cdA : 0; }

function rocketHeight() {
  let h = 0;
  for (let i = 0; i < rocket.parts.length; i++) {
    if (!rocket.parts[i].inside) h += rocket.parts[i].length;
  }
  return h;
}

const ROCKET_H = rocketHeight();

function airDensity(y) {
  return RHO0 * Math.exp(-Math.max(0, y) / SCALE_HEIGHT);
}

function landingVerdict(speed) {
  if (speed <= SAFE_LANDING_SPEED) return "SAFE";
  return speed <= CRASH_SPEED ? "HARD" : "CRASH";
}

function flightState() {
  if (!sim.ignited) return "READY";
  if (sim.burnedOut && sim.y <= 0) return "LANDED";
  if (!sim.burnedOut) return "BURN";
  if (sim.vy > 0) return "COAST";
  return sim.chuteDeployed ? "CHUTE" : "FALL";
}

function step(dt) {
  const motor = MOTORS[sel.motor];

  // 0) the flight clock runs from ignition until touchdown
  const active = sim.ignited && !(sim.burnedOut && sim.y <= 0);
  if (active) sim.t += dt;

  // 1) motor
  let thrust = 0;
  if (sim.ignited && !sim.burnedOut) {
    thrust = curveValue(motor.curve, sim.motorT);
    sim.impulse += thrust * dt;
    sim.motorT += dt;
    if (sim.motorT >= motor.burnTime) {
      sim.burnedOut = true;
      thrust = 0;
      teleEvent("Burnout  " + sim.y.toFixed(0) + " m, " + sim.vy.toFixed(0) + " m/s");
    }
  }
  sim.thrust = thrust;

  // 2) delay charge: fires a set time after burnout and pushes the chute out
  if (!sim.chuteDeployed && sel.chute >= 0 && sim.burnedOut && sim.y > 0 &&
      sim.t >= motor.burnTime + DELAYS[sel.delay]) {
    sim.chuteDeployed = true;
    sim.deployT = sim.t;
    teleEvent("Chute out  " + sim.y.toFixed(0) + " m, " + sim.vy.toFixed(0) + " m/s");
  }
  if (sim.chuteDeployed) sim.chuteOpen = Math.min(1, (sim.t - sim.deployT) / CHUTE_OPEN_TIME);

  // 3) forces (newtons, up is positive)
  const m = rocketMass();
  sim.mass = m;
  const rho = airDensity(sim.y);
  const cdA = rocketCdA() + chuteCdA() * sim.chuteOpen;
  const dragMag = 0.5 * rho * sim.vy * sim.vy * cdA;
  const dragForce = sim.vy > 0 ? -dragMag : (sim.vy < 0 ? dragMag : 0);   // always opposes motion
  sim.drag = dragMag;
  const net = thrust - m * G + dragForce;

  // 4) move
  if (sim.y <= 0 && net <= 0) {
    sim.y = 0; sim.vy = 0; sim.ay = 0;            // sitting on the pad
  } else {
    sim.ay = net / m;
    sim.vy += sim.ay * dt;                        // velocity first...
    sim.y  += sim.vy * dt;                        // ...then position (semi-implicit Euler)
    if (sim.y < 0) {                              // touchdown
      sim.impact = -sim.vy;
      sim.verdict = landingVerdict(sim.impact);
      sim.y = 0; sim.vy = 0;
      sim.burnedOut = true;
      teleEvent("Touchdown  " + sim.impact.toFixed(1) + " m/s  " + sim.verdict);
    }
  }

  // 5) flight stats and events
  sim.q = 0.5 * airDensity(sim.y) * sim.vy * sim.vy;
  if (sim.y > sim.apogee) sim.apogee = sim.y;
  if (Math.abs(sim.vy) > sim.maxSpeed) sim.maxSpeed = Math.abs(sim.vy);
  if (sim.ay > sim.maxAccel) sim.maxAccel = sim.ay;
  if (sim.q > sim.maxQ) sim.maxQ = sim.q;
  if (sim.chuteDeployed && Math.abs(sim.ay) > sim.maxShock) sim.maxShock = Math.abs(sim.ay);
  if (!sim.apogeeLogged && sim.prevVy > 0 && sim.vy <= 0 && sim.y > 0) {
    sim.apogeeLogged = true;
    teleEvent("Apogee  " + sim.y.toFixed(0) + " m");
  }
  sim.prevVy = sim.vy;

  // 6) telemetry (the last sample is forced at touchdown)
  if (sim.ignited && !tele.done) {
    const landed = sim.burnedOut && sim.y <= 0;
    teleRecord(landed);
    if (landed) tele.done = true;
  }
}

function launch() {
  if (sim.ignited) return;
  sim.ignited = true;
  teleEvent("Ignition");
}

function resetSim() {
  sim.t = 0; sim.y = 0; sim.vy = 0; sim.ay = 0;
  sim.thrust = 0; sim.drag = 0; sim.q = 0;
  sim.ignited = false; sim.burnedOut = false;
  sim.motorT = 0; sim.impulse = 0;
  sim.chuteDeployed = false; sim.deployT = 0; sim.chuteOpen = 0;
  sim.prevVy = 0; sim.apogeeLogged = false;
  sim.apogee = 0; sim.maxSpeed = 0; sim.maxAccel = 0; sim.maxQ = 0; sim.maxShock = 0;
  sim.impact = 0; sim.verdict = "";
  sim.mass = rocketMass();
  teleReset();
}
