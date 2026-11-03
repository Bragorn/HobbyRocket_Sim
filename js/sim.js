"use strict";

/* =====================================================================
   SIMULATION  (js/sim.js)
   Physics only. Nothing in this file knows about pixels or the screen.
   World: x = right, y = up in meters, the ground is y = 0.
   The rocket can tilt: theta is the lean from vertical (+ = leaning
   right), omega is how fast it is turning. Parts can fail (broken).
   ===================================================================== */

const sel = { motor: 1, delay: 1, chute: 1, wind: 0, windDir: 1, angle: 2 };   // angle 2 = 0 degrees

const sim = {
  t: 0,                          // flight time: seconds since ignition
  y: 0, vy: 0, ay: 0,            // altitude, speed, acceleration
  x: 0, vx: 0,                   // sideways position and speed
  theta: 0, omega: 0,            // tilt (rad) and turn rate (rad/s)
  cg: 0, cg0: 0,                 // center of gravity now / at ignition (m above the bottom)
  offRod: false,                 // true once the rocket has cleared the launch rod
  chuteUx: 0, chuteUy: 1,        // direction from the rocket to the canopy (for drawing)
  thrust: 0, drag: 0, mass: 0,   // newtons, newtons, kg
  q: 0,                          // dynamic pressure, Pa (air pushing on the rocket)
  ignited: false, burnedOut: false,
  motorT: 0,                     // seconds the motor has been burning
  impulse: 0,                    // N*s delivered so far
  chuteDeployed: false, deployT: 0, chuteOpen: 0,   // chuteOpen goes 0 -> 1
  prevVy: 0, apogeeLogged: false,
  apogee: 0, maxSpeed: 0, maxAccel: 0, maxQ: 0, maxShock: 0,
  impact: 0, verdict: "", wind: 0, aoa: 0, chutePull: 0, seed: 0,
  gustP1: 0, gustP2: 0, rodErr: 0,
};

const chutePart = rocket.parts.find(function (p) { return p.kind === "chute"; });

function breakPart(p, why) {                      // a part fails: it stops counting from the next step on
  if (p.broken) return;
  p.broken = true;
  teleEvent(p.name + " " + why + "  " + sim.y.toFixed(0) + " m, " + Math.hypot(sim.vx, sim.vy).toFixed(0) + " m/s");
}

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

function chuteMass() { return sel.chute >= 0 && !chutePart.broken ? CHUTES[sel.chute].mass : 0; }
function chuteCdA()  { return sel.chute >= 0 && !chutePart.broken ? CHUTES[sel.chute].cdA : 0; }

function partMass(p) {
  if (p.broken) return 0;
  if (p.kind === "motor") return motorMass();
  if (p.kind === "chute") return chuteMass();
  return p.mass;
}

function rocketMass() {
  let total = 0;
  for (let i = 0; i < rocket.parts.length; i++) {
    const p = rocket.parts[i];
    if (p.broken) continue;
    if (p.kind === "motor") total += motorMass();
    else if (p.kind === "chute") total += chuteMass();
    else total += p.mass;
  }
  return total;
}

/* Center of gravity: the balance point, as a height above the bottom.
   It moves up the rocket as the motor burns its fuel. */
function rocketCG() {
  let m = 0, mx = 0;
  for (let i = 0; i < rocket.parts.length; i++) {
    const p = rocket.parts[i], pm = partMass(p);
    m += pm; mx += pm * p.at;
  }
  return mx / m;
}

/* Moment of inertia about the CG (kg*m^2): how hard the rocket is to spin.
   Each part counts by its distance from the CG, plus its own length. */
function rocketInertia(cg) {
  let I = 0;
  for (let i = 0; i < rocket.parts.length; i++) {
    const p = rocket.parts[i], d = p.at - cg;
    I += partMass(p) * (d * d + p.length * p.length / 12);
  }
  return I;
}

/* Center of pressure: where the sideways air force acts. If it is BELOW
   the CG the rocket is stable and swings back into the wind.
   Returns null when there is no nose or fins left. */
function rocketCP() {
  let cn = 0, cnx = 0;
  for (let i = 0; i < rocket.parts.length; i++) {
    const p = rocket.parts[i];
    if (p.cn && !p.broken) { cn += p.cn; cnx += p.cn * p.cpAt; }
  }
  return cn > 0 ? cnx / cn : null;
}
const ROCKET_CP = rocketCP();

function rocketCdA() {                            // drag area of the airframe
  let total = 0;
  for (let i = 0; i < rocket.parts.length; i++) {
    if (rocket.parts[i].broken) continue;
    total += rocket.parts[i].cdA;
  }
  return total * DRAG_TUNE;
}

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

let rngState = 1;
function rand() {                                 // small seeded random numbers (same seed = same flight)
  rngState = (rngState + 0x6D2B79F5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function windNow() {                              // wind speed toward +x right now, with gusts
  const base = WINDS[sel.wind] * sel.windDir;
  if (!launchOpts.imperfect || base === 0) return base;
  const g = (Math.sin(sim.t * 0.9 + sim.gustP1) + 0.6 * Math.sin(sim.t * 2.3 + sim.gustP2)) / 1.6;
  return base * (1 + 0.3 * g);                    // gusts swing the speed by up to 30%
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

function refreshLoadout() {                       // call whenever motor/chute choice changes
  sim.mass = rocketMass();
  sim.cg = rocketCG();
  sim.cg0 = sim.cg;                               // the rocket is drawn turning about this point
  if (!sim.ignited) sim.theta = ANGLES[sel.angle] * Math.PI / 180;   // the rod tilt shows on the pad
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
  if (sim.chuteDeployed && !chutePart.broken) sim.chuteOpen = Math.min(1, (sim.t - sim.deployT) / CHUTE_OPEN_TIME);

  // 3) forces (newtons, up and right are positive)
  const m = rocketMass();
  sim.mass = m;
  const cg = rocketCG();
  sim.cg = cg;
  const rho = airDensity(sim.y);
  const cdA = rocketCdA();                        // airframe only. The chute is handled below

  // the rocket's velocity relative to the air (the wind blows toward +x)
  const wind = windNow();
  sim.wind = wind;
  const rx = sim.vx - wind;
  const ry = sim.vy;
  const V2 = rx * rx + ry * ry;
  const V = Math.sqrt(V2);
  const qNow = 0.5 * rho * V2;                    // dynamic pressure right now

  // airframe drag: pushes against the motion through the air
  const dragMag = 0.5 * rho * V2 * cdA;
  sim.drag = dragMag;
  const dragX = V > 0 ? -dragMag * (rx / V) : 0;
  const dragY = V > 0 ? -dragMag * (ry / V) : 0;

  // sideways air force on the nose and fins. The rocket points along
  // b = (sin, cos); "across" is n = (cos, -sin). The spin term makes
  // surfaces far from the CG resist turning (this is the damping).
  const sn = Math.sin(sim.theta), cs = Math.cos(sim.theta);
  const vn = rx * cs - ry * sn;                   // air speed across the rocket
  sim.aoa = Math.atan2(Math.abs(vn), Math.abs(rx * sn + ry * cs));   // angle between the rocket's axis and the airflow, 0 to 90 deg
  const k = 0.5 * rho * A_REF * V;
  let sideF = 0, torque = 0;
  for (let i = 0; i < rocket.parts.length; i++) {
    const p = rocket.parts[i];
    if (!p.cn || p.broken) continue;
    const r = p.cpAt - cg;
    const f = -k * p.cn * (vn + sim.omega * r);
    sideF += f;
    torque += f * r;
    const load = Math.abs(f);                     // how hard the air pushes this part sideways
    if (load > p.peak) p.peak = load;
    if (p.maxSide && load > p.maxSide) breakPart(p, "snapped off");
    if (p.maxQ && qNow > p.maxQ) breakPart(p, "fluttered apart");
  }

  // parachute: drag from the air moving past the tie-on point (which moves
  // with the rocket's spin too). The pull goes through that point, so a pull
  // above the CG swings the rocket round to hang from it.
  let chuteFx = 0, chuteFy = 0;
  sim.chutePull = 0;
  const chuteArea = chuteCdA() * sim.chuteOpen;
  if (chuteArea > 0) {
    const a = CHUTE_ATTACH_AT - cg;               // tie-on point, height above the CG
    const px = rx + sim.omega * a * cs;
    const py = ry - sim.omega * a * sn;
    const Vp = Math.sqrt(px * px + py * py);
    if (Vp > 0) {
      const mag = 0.5 * rho * Vp * Vp * chuteArea;
      if (mag > chutePart.peak) chutePart.peak = mag;
      if (mag > chutePart.maxPull) {
        breakPart(chutePart, "cord snapped");     // the canopy is gone
        sim.chuteOpen = 0;
      } else {
        sim.chutePull = mag;
        chuteFx = -mag * (px / Vp);
        chuteFy = -mag * (py / Vp);
        sim.chuteUx = -px / Vp;
        sim.chuteUy = -py / Vp;
        sim.drag += mag;
        torque += a * (chuteFx * cs - chuteFy * sn);
      }
    }
  }

  const net  = thrust * cs - m * G + dragY - sideF * sn + chuteFy;   // up
  const netX = thrust * sn + dragX + sideF * cs + chuteFx;           // right

  // 4) move
  if (sim.y <= 0 && net <= 0) {
    sim.y = 0; sim.vy = 0; sim.ay = 0;            // sitting on the pad
    sim.vx = 0; sim.omega = 0;
  } else if (!sim.offRod) {
    // on the launch rod: it can only slide along the rod's own tilt
    const aAlong = (thrust - m * G * cs + dragX * sn + dragY * cs) / m;
    const va = Math.max(0, sim.vx * sn + sim.vy * cs) + aAlong * dt;
    sim.vx = va * sn;
    sim.vy = va * cs;
    sim.ay = aAlong * cs;
    sim.y += sim.vy * dt;
    sim.x += sim.vx * dt;
    if (sim.y >= ROD_LENGTH) sim.offRod = true;   // free flight from the next step
  } else {
    sim.ay = net / m;
    sim.vy += sim.ay * dt;                        // velocity first...
    sim.y  += sim.vy * dt;                        // ...then position (semi-implicit Euler)
    sim.vx    += (netX / m) * dt;
    sim.omega += (torque / rocketInertia(cg)) * dt;
    sim.x     += sim.vx * dt;
    sim.theta += sim.omega * dt;
    if (sim.y < 0) {                              // touchdown
      sim.impact = -sim.vy;
      sim.verdict = landingVerdict(sim.impact);
      sim.y = 0; sim.vy = 0;
      sim.vx = 0; sim.omega = 0;
      sim.burnedOut = true;
      teleEvent("Touchdown  " + sim.impact.toFixed(1) + " m/s  " + sim.verdict);
    }
  }

  // 5) flight stats and events
  const qx = sim.vx - wind;
  sim.q = 0.5 * airDensity(sim.y) * (qx * qx + sim.vy * sim.vy);
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
  sim.seed = launchOpts.seed || ((Math.random() * 4294967296) >>> 0) || 1;
  rngState = sim.seed;
  sim.gustP1 = rand() * 6.2832;
  sim.gustP2 = rand() * 6.2832;
  sim.rodErr = (rand() * 2 - 1) * ROD_ERROR_DEG * Math.PI / 180;
  if (launchOpts.imperfect) sim.theta += sim.rodErr;   // a slightly crooked rod
  teleEvent("Ignition");
}

function resetSim() {
  sim.t = 0; sim.y = 0; sim.vy = 0; sim.ay = 0;
  sim.x = 0; sim.vx = 0; sim.theta = 0; sim.omega = 0; sim.offRod = false;
  sim.chuteUx = 0; sim.chuteUy = 1;
  sim.thrust = 0; sim.drag = 0; sim.q = 0;
  sim.ignited = false; sim.burnedOut = false;
  sim.motorT = 0; sim.impulse = 0;
  sim.chuteDeployed = false; sim.deployT = 0; sim.chuteOpen = 0;
  sim.prevVy = 0; sim.apogeeLogged = false;
  sim.apogee = 0; sim.maxSpeed = 0; sim.maxAccel = 0; sim.maxQ = 0; sim.maxShock = 0;
  sim.impact = 0; sim.verdict = "";
  sim.gustP1 = 0; sim.gustP2 = 0; sim.rodErr = 0;
  sim.wind = 0; sim.aoa = 0; sim.chutePull = 0; sim.seed = 0;
  for (let i = 0; i < rocket.parts.length; i++) { rocket.parts[i].broken = false; rocket.parts[i].peak = 0; }
  refreshLoadout();
  teleReset();
}