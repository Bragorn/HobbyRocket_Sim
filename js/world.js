"use strict";

/* =====================================================================
   WORLD  (js/world.js)
   Turns the data in parts.js into a planck world: the planet, one body
   per part, weld joints, and gravity. `sim` is everything about the
   current flight; buildWorld() replaces it (that is what reset does).
   ===================================================================== */

let sim = null;

function polyArea(v) {
  let a = 0;
  for (let i = 0; i < v.length; i++) { const p = v[i], q = v[(i + 1) % v.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
}

function addGravity(world) {         // pull every dynamic body toward the planet's center (0, 0)
  for (let b = world.getBodyList(); b; b = b.getNext()) {
    if (!b.isDynamic()) continue;
    const p = b.getPosition(), r = Math.hypot(p.x, p.y), k = -b.getMass() * MU / (r * r * r);
    b.applyForceToCenter(P(p.x * k, p.y * k), true);
  }
}

function buildWorld() {
  const world = new planck.World({ gravity: P(0, 0) });
  const ground = world.createBody({ type: "static", position: P(0, 0) });
  ground.createFixture({ shape: new planck.Circle(R), friction: 0.8 });

  const base = R + PAD_CLEARANCE;     // the engine's bottom
  const parts = [], byId = {}, joints = [];

  for (const def of ROCKET.parts) {   // one body per part
    const verts = def.verts.map(function (v) { return P(v[0], v[1]); });
    const body = world.createBody({ type: "dynamic", position: P(def.at[0], base + def.at[1]) });
    body.createFixture({ shape: new planck.Polygon(verts), density: def.mass / polyArea(verts), friction: 0.8, restitution: 0 });
    const part = { def: def, name: def.name, color: def.color, body: body, verts: verts,
                   forces: (def.forces || []).map(function (f) { return Object.assign({ now: 0, angle: 0 }, f); }) };   // now = force this step, angle = gimbal
    parts.push(part);
    byId[def.id] = part;
  }

  for (const part of parts) {         // weld the parts together
    const jd = part.def.joint;
    if (!jd) continue;
    const j = world.createJoint(new planck.WeldJoint({ frequencyHz: 0, dampingRatio: 0 }, byId[jd.to].body, part.body, P(jd.at[0], base + jd.at[1])));
    joints.push({ name: part.name, j: j, force: 0, peak: 0 });
  }

  const hull = parts.find(function (p) { return p.def.hull; });
  sim = { world: world, ground: ground, parts: parts, joints: joints, hull: hull,
          hullFixture: hull.body.getFixtureList(), hullArea: polyArea(hull.verts),
          fuelDry: hull.def.fuel.dry, fuelFull: hull.def.fuel.full, fuel: hull.def.fuel.full,
          thrust: 0, airborne: false, t: 0, emptyLogged: false };

  world.on("begin-contact", function (ct) {          // the first touch after being in the air gets reported
    const A = ct.getFixtureA().getBody(), B = ct.getFixtureB().getBody();
    if (A !== ground && B !== ground) return;
    if (!sim.airborne) return;
    sim.airborne = false;
    const body = A === ground ? B : A, p = body.getPosition(), r = Math.hypot(p.x, p.y);
    const ux = p.x / r, uy = p.y / r, v = body.getLinearVelocity();
    const vert = v.x * ux + v.y * uy, side = v.x * uy - v.y * ux;
    const who = (parts.find(function (q) { return q.body === body; }) || { name: "?" }).name;
    log("T+" + sim.t.toFixed(1) + " s: touchdown, " + who + " first, " + Math.abs(vert).toFixed(1) + " m/s down, " + Math.abs(side).toFixed(1) + " m/s sideways");
  });
  log("new rocket on the pad. Throttle starts at 0: press W to light the engine.");
}

function totalMass() {
  return sim.parts.reduce(function (m, q) { return m + q.body.getMass(); }, 0);
}

function maxThrust() {               // thrust of all engines at full throttle, N
  let t = 0;
  for (const p of sim.parts) for (const f of p.forces) if (f.kind === "thrust") t += f.max;
  return t;
}
