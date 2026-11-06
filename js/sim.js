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
  misalign: 0,                   // this flight's motor misalignment, rad (0 unless imperfections are on)
  thrustScale: 1,                // this flight's motor strength compared with rated
  gustAmp: 0.3,                  // how hard the gusts swing the wind speed
  landed: false,                 // true from touchdown on: the rocket then tips over and settles (sim.rest)
  rest: { x: 0, y: 0, theta: 0, omega: 0, baseX: 0, lying: false, vx: 0 },   // where the rocket sits after landing
  debris: [],                    // pieces that broke off and now fall on their own
  fx: [],                        // things that just happened (a break, an impact) for fx.js to turn into sparks and smoke
};

/* The motor and chute parts are looked up by kind. applyBuild() swaps the whole
   part list, so it calls bindParts() again to find the new ones. */
let chutePart = null, motorPart = null, tubePart = null, finsPart = null;
function bindParts() {
  chutePart = rocket.parts.find(function (p) { return p.kind === "chute"; });
  motorPart = rocket.parts.find(function (p) { return p.kind === "motor"; });
  tubePart = rocket.parts.find(function (p) { return p.kind === "tube"; });
  finsPart = rocket.parts.find(function (p) { return p.kind === "fins"; });
}
bindParts();

/* ---- breaking ---- */
let drngState = 1;
function drand() {                               // its own seeded random numbers for the pieces, so they never disturb the flight's
  drngState = (drngState + 0x6D2B79F5) | 0;
  let t = Math.imul(drngState ^ (drngState >>> 15), 1 | drngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* A part fails: it stops counting from the next step on and, if it is something you could see, it
   flies off as its own piece. If the tube folds, everything above it comes off too.
   hit = the landing speed when it broke on impact (the pieces then scatter). */
function breakPart(p, why, hit) {
  if (p.broken) return;
  p.broken = true;
  teleEvent(p.name + " " + why + "  " + sim.y.toFixed(0) + " m, " + Math.hypot(sim.vx, sim.vy).toFixed(0) + " m/s");
  if (p.kind === "chute") sim.chuteOpen = 0;
  fxBreakAt(p, why, hit);
  spawnDebris(p, hit);
  if (p.kind === "tube") {
    for (let i = 0; i < rocket.parts.length; i++) {
      const q = rocket.parts[i];
      if (q.kind === "nose" || q.kind === "chute" || q.kind === "ballast") breakPart(q, "torn off", hit);
    }
  }
}

function fxEmit(e) { if (sim.fx.length < 60) sim.fx.push(e); }

function breakLabel(p, why) {                      // the shout that pops up where something breaks
  if (why === "torn off") return "";
  if (p.kind === "fins") return why === "fluttered apart" ? "FIN FLUTTER!" : why === "broke on impact" ? "FIN CRACKED!" : "FIN SNAPPED!";
  if (p.kind === "nose") return why === "broke on impact" ? "NOSE CRACKED!" : "NOSE SNAPPED!";
  if (p.kind === "tube") return why === "zippered by the chute" ? "ZIPPERED!" : why === "folded in half" ? "TUBE FOLDED!" : "TUBE CRUMPLED!";
  if (p.kind === "chute") return "CORD SNAPPED!";
  return "";
}

function fxBreakAt(p, why, hit) {
  const a = p.at - sim.cg0;
  fxEmit({ kind: "break", text: breakLabel(p, why), color: p.color, power: hit || 0,
           x: sim.x + a * Math.sin(sim.theta), y: sim.y + sim.cg0 + a * Math.cos(sim.theta) });
}

function weakestFin(p) {                           // how strong the weakest fin still on is (compared with the part's limit)
  let v = Infinity;
  for (let i = 0; i < p.fins.length; i++) if (!p.fins[i].gone && p.fins[i].v < v) v = p.fins[i].v;
  return v;
}

/* One fin lets go (the weakest one still on). The rocket keeps flying with fewer fins. */
function breakFin(p, why, hit) {
  if (!p.fins) { breakPart(p, why, hit); return; }
  let k = -1;
  for (let i = 0; i < p.fins.length; i++) if (!p.fins[i].gone && (k < 0 || p.fins[i].v < p.fins[k].v)) k = i;
  if (k < 0) return;
  p.fins[k].gone = true;
  let left = 0;
  for (let i = 0; i < p.fins.length; i++) if (!p.fins[i].gone) left++;
  p.alive = left / p.fins.length;
  teleEvent(p.name + " " + why + "  " + sim.y.toFixed(0) + " m, " + Math.hypot(sim.vx, sim.vy).toFixed(0) + " m/s  (" + left + " of " + p.fins.length + " left)");
  fxBreakAt(p, why, hit);
  spawnDebris(p, hit, k);
  if (left === 0) p.broken = true;
}

function spawnDebris(p, hit, finIdx) {
  if (p.kind === "motor") return;
  if (p.kind === "chute" && sel.chute < 0) return;
  if (p.kind === "ballast" && p.mass <= 0) return;
  const a = p.at - sim.cg0, sn = Math.sin(sim.theta), cs = Math.cos(sim.theta);
  const oneFin = p.kind === "fins" && finIdx !== undefined;
  const side = finIdx % 2 === 0 ? -1 : 1;           // the in-view fins are 0 (left) and 1 (right); the others hide behind
  const off = oneFin ? side * p.span * 0.25 : 0;    // a fin sits out to the side of the tube
  const d = { kind: oneFin ? "fin" : p.kind, side: side, bounces: 0, shape: p.shape, color: p.color, w: p.width, h: p.length, span: p.span, landed: false,
              x: sim.x + a * sn + off * cs, y: sim.y + sim.cg0 + a * cs - off * sn,
              vx: sim.vx + sim.omega * a * cs, vy: sim.vy - sim.omega * a * sn,
              theta: sim.theta, omega: sim.omega + (drand() * 2 - 1) * 8 };
  if (p.kind === "chute") {                       // the canopy: big and light, so it drifts down slowly
    const c = CHUTES[sel.chute];
    d.mass = c.mass; d.cdA = c.cdA * 0.6; d.w = c.diameter; d.h = 0.02; d.color = c.color;
  } else if (oneFin) {
    d.mass = Math.max(p.mass / p.fins.length, 0.001);
    d.cdA = Math.max(p.cdA / p.fins.length, 0.3e-4) * 6;
  } else {
    d.mass = Math.max(p.mass, 0.003);
    d.cdA = Math.max(p.cdA, 0.5e-4) * (p.kind === "tube" ? 5 : 3);     // tumbling pieces catch more air
  }
  d.rad = Math.max(0.003, Math.min(d.w, d.h) / 2);   // how high its center sits when it lies on the ground
  if (hit !== undefined) {                         // broke on landing: bits bounce and scatter
    d.vx = sim.vx * 0.5 + (drand() * 2 - 1) * Math.min(8, 0.25 * hit);
    d.vy = Math.min(12, hit * 0.25 * (0.3 + drand()));
  } else {                                         // broke in flight: it just gets a shove
    d.vx += (drand() * 2 - 1) * 2;
    d.vy += (drand() * 2 - 1) * 1.5;
  }
  sim.debris.push(d);
}

function stepDebris(dt) {
  const wind = windNow();
  for (let i = 0; i < sim.debris.length; i++) {
    const d = sim.debris[i];
    if (d.landed) continue;
    const rx = d.vx - wind, ry = d.vy, V = Math.sqrt(rx * rx + ry * ry);
    if (V > 0) {                                   // drag, kept from ever reversing the motion in one step
      const drag = 0.5 * airDensity(d.y) * V * V * d.cdA;
      const f = Math.min(1, drag * dt / (d.mass * V));
      d.vx -= rx * f; d.vy -= ry * f;
    }
    d.vy -= G * dt;
    d.x += d.vx * dt; d.y += d.vy * dt; d.theta += d.omega * dt;
    if (d.y <= d.rad) {                            // on the ground: bounces while it falls fast, then skids to a stop
      d.y = d.rad;
      if (d.vy < -1.2) {
        d.vy = -d.vy * 0.3; d.vx *= 0.75; d.omega = d.omega * 0.6 + (drand() * 2 - 1) * 3; d.bounces++;
      } else {
        d.vy = 0;
        const fr = 6 * dt;
        d.vx = Math.abs(d.vx) <= fr ? 0 : d.vx - Math.sign(d.vx) * fr;
        d.omega *= 1 - 4 * dt;
        if (d.vx === 0 && Math.abs(d.omega) < 0.3) {
          d.omega = 0; d.landed = true;             // and lies on its side
          d.theta = Math.round((d.theta - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
        }
      }
    }
  }
}

/* ---- landing: damage, then the rocket tips over about its base ---- */
function applyLandingDamage(speed) {
  for (let i = 0; i < rocket.parts.length; i++) {
    const p = rocket.parts[i];
    if (p.broken || !p.maxImpact) continue;
    if (p.kind === "fins" && p.fins) {             // each fin has its own breaking speed
      while (!p.broken && speed > p.maxImpact * weakestFin(p)) breakFin(p, "broke on impact", speed);
    } else if (speed > p.maxImpact) {
      breakPart(p, "broke on impact", speed);
    }
  }
}

function wrapAngle(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

function startSettle(vx0, omega0) {
  let th = wrapAngle(sim.theta);
  if (Math.abs(th) < 0.03) th = (vx0 !== 0 ? Math.sign(vx0) : (windNow() >= 0 ? 1 : -1)) * 0.03;   // balanced on its tail: a nudge tips it
  const r = sim.rest;
  r.baseX = sim.x - sim.cg0 * Math.sin(th);        // the bottom of the rocket stays where it touched down
  r.theta = th; r.omega = omega0; r.lying = false;
  r.vx = vx0 * 0.6;                                // it skids a little as it tips
  settleStep(0);
}

function settleStep(dt) {                          // an upside-down pendulum about the base falls over and lies flat
  const r = sim.rest;
  if (r.vx) {
    r.baseX += r.vx * dt;
    r.vx *= Math.max(0, 1 - 3 * dt);
    if (Math.abs(r.vx) < 0.02) r.vx = 0;
  }
  if (!r.lying) {
    const target = (r.theta >= 0 ? 1 : -1) * Math.PI / 2;
    if (Math.abs(r.theta) > Math.PI / 2) {         // it hit sideways or nose-down: just flop onto its side
      r.theta += (target - r.theta) * Math.min(1, dt * 10);
      if (Math.abs(target - r.theta) < 0.01) { r.theta = target; r.lying = true; }
    } else if (dt > 0) {
      const cg = rocketCG(), m = rocketMass();
      const I = rocketInertia(cg) + m * sim.cg0 * sim.cg0;     // about the base
      r.omega += (m * G * sim.cg0 * Math.sin(r.theta) / I) * dt;
      r.omega *= 1 - 1.5 * dt;
      r.theta += r.omega * dt;
      if (Math.abs(r.theta) >= Math.PI / 2) { r.theta = target; r.omega = 0; r.lying = true; }
    }
  }
  r.x = r.baseX + sim.cg0 * Math.sin(r.theta);
  r.y = sim.cg0 * Math.cos(r.theta) + (bodyDiameter() / 2) * Math.abs(Math.sin(r.theta));
}

function rocketPose() {                            // where to draw the rocket: x, height of the balance point, tilt
  if (sim.landed) return { x: sim.rest.x, yc: sim.rest.y, theta: sim.rest.theta };
  return { x: sim.x, yc: sim.y + sim.cg0, theta: sim.theta };
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

function live(p) { return p.alive === undefined ? 1 : p.alive; }   // fraction of a part still attached (fins break one by one)

function partMass(p) {
  if (p.broken) return 0;
  if (p.kind === "motor") return motorMass();
  if (p.kind === "chute") return chuteMass();
  return p.mass * live(p);
}

function rocketMass() {
  let total = 0;
  for (let i = 0; i < rocket.parts.length; i++) {
    const p = rocket.parts[i];
    if (p.broken) continue;
    if (p.kind === "motor") total += motorMass();
    else if (p.kind === "chute") total += chuteMass();
    else total += p.mass * live(p);
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
    if (p.cn && !p.broken) { const c = p.cn * live(p); cn += c; cnx += c * p.cpAt; }
  }
  return cn > 0 ? cnx / cn : null;
}

function bodyDiameter() {                         // width of the body tube, m
  for (let i = 0; i < rocket.parts.length; i++) if (rocket.parts[i].kind === "tube") return rocket.parts[i].width;
  return 0.025;
}

/* Stability in calibers: how far the CG sits ahead of the CP, in body widths.
   Below 0 is unstable, about 1 to 2 is the usual goal. null = no nose or fins. */
function rocketCal() {
  const cp = rocketCP();
  return cp === null ? null : (sim.cg - cp) / bodyDiameter();
}

function rocketCdA() {                            // drag area of the airframe
  let total = 0;
  for (let i = 0; i < rocket.parts.length; i++) {
    if (rocket.parts[i].broken) continue;
    total += rocket.parts[i].cdA * live(rocket.parts[i]);
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

let ROCKET_H = rocketHeight();                    // changes when the build changes
let REF_AREA = A_REF;                             // body cross-section area, m^2 (set from the tube by applyBuild)

function chuteAttachAt() {                        // height above the bottom where the shock cord ties on, m
  return chutePart.attach !== undefined ? chutePart.attach : CHUTE_ATTACH_AT;
}

/* Rough speed under a fully open chute (the choice at index idx of CHUTES), for the
   rocket as it sits on the pad with the fuel gone. Handy for the sidebar. null = no chute. */
function landingSpeed(idx) {
  if (idx < 0) return null;
  const c = CHUTES[idx];
  const m = rocketMass() - MOTORS[sel.motor].propMass - chuteMass() + c.mass;
  return Math.sqrt(2 * m * G / (RHO0 * c.cdA));
}

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
  return base * (1 + sim.gustAmp * g);            // gusts swing the speed by gustAmp (20 to 45% when imperfect)
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

/* Put the chosen build into the sim: swap the part list, find the motor and
   chute parts again, and work out the numbers that depend on the tube and the
   height. Only for the pad. main.js applyLoadout() calls this, then refreshLoadout(). */
function applyBuild() {
  build.recovery = recoveryForChute(sel.chute).id;      // sel.chute is the one that counts
  const parts = buildParts(build);
  rocket.parts.length = 0;
  for (let i = 0; i < parts.length; i++) rocket.parts.push(parts[i]);
  bindParts();
  ROCKET_H = rocketHeight();
  const r = bodyDiameter() / 2;
  REF_AREA = Math.PI * r * r;
}

function refreshLoadout() {                       // call whenever motor/chute choice changes
  const mo = MOTORS[sel.motor];                   // the motor part takes the size of the chosen motor
  motorPart.length = mo.length;
  motorPart.width = mo.diameter;
  motorPart.at = mo.length / 2;                   // sits flush with the bottom of the rocket
  chutePart.maxPull = recoveryForChute(sel.chute).cordN;   // a streamer's cord is weaker than a chute's
  sim.mass = rocketMass();
  sim.cg = rocketCG();
  sim.cg0 = sim.cg;                               // the rocket is drawn turning about this point
  if (!sim.ignited) sim.theta = ANGLES[sel.angle] * Math.PI / 180;   // the rod tilt shows on the pad
}

function step(dt) {
  const motor = MOTORS[sel.motor];

  // after touchdown only the tipping over and the loose pieces still move
  if (sim.landed) { settleStep(dt); stepDebris(dt); return; }
  if (sim.debris.length > 0) stepDebris(dt);

  // 0) the flight clock runs from ignition until touchdown
  const active = sim.ignited && !(sim.burnedOut && sim.y <= 0);
  if (active) sim.t += dt;

  // 1) motor
  let thrust = 0;
  if (sim.ignited && !sim.burnedOut) {
    const raw = curveValue(motor.curve, sim.motorT);
    sim.impulse += raw * dt;                      // the fuel burns at the rated rate...
    thrust = raw * sim.thrustScale;               // ...but this motor pushes a little harder or softer
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
  const k = 0.5 * rho * REF_AREA * V;
  let sideF = 0, torque = 0, momAbove = 0, momBelow = 0;
  for (let i = 0; i < rocket.parts.length; i++) {
    const p = rocket.parts[i];
    if (!p.cn || p.broken) continue;
    const r = p.cpAt - cg;
    const f = -k * (p.cn * live(p)) * (vn + sim.omega * r);
    sideF += f;
    torque += f * r;
    if (r > 0) momAbove += f * r; else momBelow += f * r;     // for the bending check below
    const load = Math.abs(f);                     // how hard the air pushes this part sideways
    if (load > p.peak) p.peak = load;
    if (p.kind === "fins") {                      // fins let go one at a time, the weakest first
      if (p.maxSide && load > p.maxSide * weakestFin(p)) breakFin(p, "snapped off");
      else if (p.maxQ && qNow > p.maxQ) breakFin(p, "fluttered apart");
    } else {
      if (p.maxSide && load > p.maxSide) breakPart(p, "snapped off");
      if (p.maxQ && qNow > p.maxQ) breakPart(p, "fluttered apart");
    }
  }

  // a fin gone from one side leaves the others pushing unevenly: the rocket veers off to that side
  if (finsPart.fins && !finsPart.broken) {
    const bias = (finsPart.fins[0].gone ? 1 : 0) - (finsPart.fins[1].gone ? 1 : 0);
    if (bias !== 0) {
      const fb = bias * qNow * REF_AREA * FIN_BIAS;
      sideF += fb;
      torque += fb * (finsPart.cpAt - cg);
    }
  }

  // bending: the sideways air loads above and below the CG try to fold the tube in half
  if (!tubePart.broken) {
    const bend = Math.max(Math.abs(momAbove), Math.abs(momBelow));
    if (bend > tubePart.peak) tubePart.peak = bend;
    if (tubePart.maxBend && bend > tubePart.maxBend) breakPart(tubePart, "folded in half");
  }

  // parachute: drag from the air moving past the tie-on point (which moves
  // with the rocket's spin too). The pull goes through that point, so a pull
  // above the CG swings the rocket round to hang from it.
  let chuteFx = 0, chuteFy = 0;
  sim.chutePull = 0;
  const chuteArea = chuteCdA() * sim.chuteOpen;
  if (chuteArea > 0) {
    const a = chuteAttachAt() - cg;               // tie-on point, height above the CG
    const px = rx + sim.omega * a * cs;
    const py = ry - sim.omega * a * sn;
    const Vp = Math.sqrt(px * px + py * py);
    if (Vp > 0) {
      const mag = 0.5 * rho * Vp * Vp * chuteArea;
      if (mag > chutePart.peak) chutePart.peak = mag;
      if (!tubePart.broken && tubePart.maxZip && mag > tubePart.maxZip) {
        breakPart(tubePart, "zippered by the chute");   // the shock tears the tube; the nose and the canopy come away with it
      }
      if (chutePart.broken) {
        // the chute is gone with the tube
      } else if (mag > chutePart.maxPull) {
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

  // a motor that points slightly off the rocket's axis pushes sideways too, and since the
  // nozzle is far below the CG that turns the rocket (tilt = sim.misalign, 0 for a perfect motor)
  const latF = thrust * Math.sin(sim.misalign);   // sideways part of the thrust (along "across")
  const thrustAx = thrust * Math.cos(sim.misalign);
  torque -= latF * cg;

  const net  = thrustAx * cs - latF * sn - m * G + dragY - sideF * sn + chuteFy;   // up
  const netX = thrustAx * sn + latF * cs + dragX + sideF * cs + chuteFx;           // right

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
      const vx0 = sim.vx, omega0 = sim.omega;
      sim.y = 0; sim.vy = 0;
      sim.vx = 0; sim.omega = 0;
      sim.burnedOut = true;
      teleEvent("Touchdown  " + sim.impact.toFixed(1) + " m/s  " + sim.verdict);
      fxEmit({ kind: "impact", x: sim.x, y: 0, power: sim.impact });
      applyLandingDamage(sim.impact);            // fast landings snap fins, nose and tube
      sim.landed = true;
      startSettle(vx0, omega0);
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
  const adapter = motorFit(catalogPick(TUBES, build.tube), MOTORS[sel.motor]) === "adapter";   // a small motor in a big tube sits loose
  const mis = (rand() * 2 - 1) * THRUST_MISALIGN_DEG * (adapter ? ADAPTER_MISALIGN_MULT : 1) * Math.PI / 180;     // drawn after the old numbers, so old seeds keep their rod error
  const vary = 1 + (rand() * 2 - 1) * THRUST_VARY;
  const gust = GUST_AMP_MIN + (GUST_AMP_MAX - GUST_AMP_MIN) * rand();
  if (launchOpts.imperfect) { sim.theta += sim.rodErr; sim.misalign = mis; sim.thrustScale = vary; sim.gustAmp = gust; }   // a crooked rod and a not-quite-perfect motor
  drngState = (sim.seed ^ 0x5bd1e995) | 0;       // the loose pieces get their own random numbers from the same seed
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
  sim.misalign = 0; sim.thrustScale = 1; sim.gustAmp = 0.3;
  sim.landed = false; sim.debris.length = 0; sim.fx.length = 0; drngState = 1;
  sim.rest.x = 0; sim.rest.y = 0; sim.rest.theta = 0; sim.rest.omega = 0; sim.rest.baseX = 0; sim.rest.lying = false; sim.rest.vx = 0;
  sim.wind = 0; sim.aoa = 0; sim.chutePull = 0; sim.seed = 0;
  for (let i = 0; i < rocket.parts.length; i++) {
    const p = rocket.parts[i];
    p.broken = false; p.peak = 0;
    if (p.fins) { p.alive = 1; for (let k = 0; k < p.fins.length; k++) p.fins[k].gone = false; }
  }
  refreshLoadout();
  teleReset();
}
