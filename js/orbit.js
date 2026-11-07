"use strict";

/* =====================================================================
   ORBIT  (js/orbit.js)
   From a position and velocity (measured from the planet's center) work
   out the path it is on if nothing pushes it any more: how high and low
   it goes, and how long one lap takes.
   ===================================================================== */

function orbitInfo(p, v) {
  const r = Math.hypot(p.x, p.y), v2 = v.x * v.x + v.y * v.y, rv = p.x * v.x + p.y * v.y;
  const k = v2 - MU / r;
  let ex = (k * p.x - rv * v.x) / MU, ey = (k * p.y - rv * v.y) / MU;
  const e = Math.hypot(ex, ey), energy = v2 / 2 - MU / r, h = p.x * v.y - p.y * v.x;
  const bound = energy < 0, pLat = h * h / MU;
  if (e < 1e-9) { ex = p.x / r; ey = p.y / r; } else { ex /= e; ey /= e; }   // direction of the lowest point
  const a = bound ? -MU / (2 * energy) : Infinity;
  return { r: r, e: e, ex: ex, ey: ey, dir: h >= 0 ? 1 : -1, bound: bound, pLat: pLat,
           rp: pLat / (1 + e), ra: bound ? pLat / (1 - e) : Infinity,
           period: bound ? 2 * Math.PI * Math.sqrt(a * a * a / MU) : null };
}
