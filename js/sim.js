"use strict";

/* =====================================================================
   SIM  (js/sim.js)
   One physics step. Order: gravity, controls, forces from the parts
   (fuel burn included), steering torque, planck's step, then
   bookkeeping. Nothing here knows about pixels.
   ===================================================================== */

/* Every part can carry a list of forces (see parts.js). Today: "thrust".
   Wings, fins, parachutes and wheels become more kinds in the loop below. */
function applyPartForces(dt) {
  let want = 0;                                       // total thrust asked for this step
  const lit = controls.throttle > 0 && sim.fuel > 0;
  for (const p of sim.parts) for (const f of p.forces) {
    if (f.kind !== "thrust") continue;
    f.now = lit ? f.max * (f.minThrottle + (1 - f.minThrottle) * controls.throttle) : 0;
    want += f.now;
  }

  if (want > 0) {                                     // burn fuel, and make the tank lighter
    sim.fuel = Math.max(0, sim.fuel - want / (ISP * G0) * dt);
    sim.hullFixture.setDensity((sim.fuelDry + sim.fuel) / sim.hullArea);
    sim.hull.body.resetMassData();
    if (sim.fuel === 0 && !sim.emptyLogged) {
      sim.emptyLogged = true;
      log("T+" + sim.t.toFixed(1) + " s: out of fuel");
      want = 0;
      for (const p of sim.parts) for (const f of p.forces) if (f.kind === "thrust") f.now = 0;
    }
  }
  sim.thrust = want;

  for (const p of sim.parts) for (const f of p.forces) {
    if (f.kind !== "thrust") continue;
    const target = -controls.steer * f.gimbalMax;     // swivel so the thrust turns the rocket the way you steer
    f.angle += clamp(target - f.angle, -f.gimbalRate * dt, f.gimbalRate * dt);
    if (f.now > 0) {                                  // a force at the nozzle, along the part's axis tilted by the gimbal
      const a = p.body.getAngle() + f.angle;
      p.body.applyForce(P(-Math.sin(a) * f.now, Math.cos(a) * f.now), p.body.getWorldPoint(P(f.at[0], f.at[1])), true);
    }
  }
}

function stepSim() {
  const w = sim.world;
  addGravity(w);
  updateControls(DT);
  applyPartForces(DT);

  // reaction wheel, with optional damping of any spin
  let tq = controls.steer * WHEEL_MAX;
  if (controls.damping) tq -= DAMP_K * sim.hull.body.getAngularVelocity();
  sim.hull.body.applyTorque(clamp(tq, -WHEEL_MAX, WHEEL_MAX), true);

  w.step(DT, VEL_IT, POS_IT);
  sim.t += DT;

  const inv = 1 / DT;                                 // joint loads are tracked for later (not shown right now)
  for (const j of sim.joints) {
    const f = j.j.getReactionForce(inv);
    j.force = Math.hypot(f.x, f.y);
    if (j.force > j.peak) j.peak = j.force;
  }
  const p = sim.hull.body.getPosition();
  if (Math.hypot(p.x, p.y) - R > 5.5) sim.airborne = true;
}
