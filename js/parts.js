"use strict";

/* =====================================================================
   PARTS  (js/parts.js)
   The rocket as plain data. Nothing here touches planck.
   Each part has:
     id, name, color
     at     = [x, y] where the part's centre sits, in meters above the rocket's bottom (engine bottom)
     verts  = its shape, [x, y] points around its centre
     mass   = kg
     joint  = { to: id of another part, at: [x, y] } weld it to that part at that point (same units as "at")
     forces = a list of forces the part produces. Each has a kind and a position on the part ("at", relative to
              the part's centre). Today only kind "thrust" is used. Wings, fins, parachutes and wheels will be
              more kinds, added in sim.js without changing this format.
   Special flags: hull (the body that steering torque turns and the camera follows),
                  fuel (the part that holds fuel: dry and full mass, kg).
   ===================================================================== */

const PAD_CLEARANCE = 0.5 + 0.02;    // the engine's bottom starts this high: feet hang 0.5 m lower and start 2 cm off the ground

function bar(end, th) {              // a thin straight bar from (0,0) to end, th thick
  const L = Math.hypot(end[0], end[1]), nx = -end[1] / L * th / 2, ny = end[0] / L * th / 2;
  return [[nx, ny], [end[0] + nx, end[1] + ny], [end[0] - nx, end[1] - ny], [-nx, -ny]];
}

const ROCKET = {
  parts: [
    { id: "engine", name: "engine", color: "#7f8c8d", at: [0, 0.4], mass: 300,
      verts: [[-0.5, -0.4], [0.5, -0.4], [0.6, 0.4], [-0.6, 0.4]],
      joint: { to: "tank", at: [0, 0.8] },
      forces: [{ kind: "thrust", at: [0, -0.4], max: MAX_THRUST, minThrottle: MIN_THROTTLE, gimbalMax: GIMBAL_MAX, gimbalRate: GIMBAL_RATE }] },

    { id: "tank", name: "tank", color: "#ecf0f1", at: [0, 2.8], mass: TANK_DRY + FUEL_FULL,
      verts: [[-1, -2], [1, -2], [1, 2], [-1, 2]],
      hull: true, fuel: { dry: TANK_DRY, full: FUEL_FULL } },

    { id: "nose", name: "nose", color: "#e67e22", at: [0, 5.55], mass: 150,
      verts: [[-1, -0.75], [1, -0.75], [0.2, 0.75], [-0.2, 0.75]],
      joint: { to: "tank", at: [0, 4.8] } },

    { id: "legL", name: "left leg", color: "#95a5a6", at: [-1, 1.2], mass: 50,
      verts: bar([-1.5, -1.7], 0.2),
      joint: { to: "tank", at: [-1, 1.2] } },

    { id: "legR", name: "right leg", color: "#95a5a6", at: [1, 1.2], mass: 50,
      verts: bar([1.5, -1.7], 0.2),
      joint: { to: "tank", at: [1, 1.2] } }
  ]
};
