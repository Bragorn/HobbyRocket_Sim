"use strict";

/* =====================================================================
   RENDER  (js/render.js)
   Drawing only: the flight view, the map view and the readouts.
   Reads `sim` and `controls`, never changes them. The zoom and the map
   toggle are view settings and live here.
   ===================================================================== */

const cv = document.getElementById("view"), c = cv.getContext("2d");
let W = 0, Hh = 0;
let S = 9;                           // flight view zoom, pixels per meter
let mapMode = false, mapS = 1e-4;    // M: the whole-planet view and its zoom

function resize() {
  W = Math.min(1100, window.innerWidth - 28);
  Hh = Math.min(640, window.innerHeight - 190);
  cv.width = W; cv.height = Hh;
}

function zoomBy(f) {
  if (mapMode) mapS = Math.min(1e-2, Math.max(1e-6, mapS * f));
  else S = Math.min(60, Math.max(0.2, S * f));
}

function toggleMap() {
  mapMode = !mapMode;
  if (mapMode) {                     // fit the whole orbit (or at least the planet) on screen
    const p = sim.hull.body.getPosition(), o = orbitInfo(p, sim.hull.body.getLinearVelocity());
    const far = Math.max(R * 1.15, Math.min(o.ra, 8 * R), o.r);
    mapS = 0.40 * Math.min(W, Hh) / far;
  }
}

function niceStep(x) {
  const mag = Math.pow(10, Math.floor(Math.log(x) / Math.LN10)), r = x / mag;
  return (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * mag;
}

function fmtAlt(m) {
  if (!isFinite(m)) return "escape";
  return Math.abs(m) < 10000 ? m.toFixed(0) + " m" : (m / 1000).toFixed(1) + " km";
}
function fmtTime(s) {
  if (s === null) return "-";
  return s < 120 ? s.toFixed(0) + " s" : Math.floor(s / 60) + " min " + Math.round(s % 60) + " s";
}

function drawFlight(alt, phi) {
  const p = sim.hull.body.getPosition();
  const ux = Math.sin(phi), uy = Math.cos(phi), ex = Math.cos(phi), ey = -Math.sin(phi), HOR = 0.62;
  const T = (wp) => [W / 2 + ((wp.x - R * ux) * ex + (wp.y - R * uy) * ey) * S,
                     Hh * HOR - ((wp.x * ux + wp.y * uy - R) - alt) * S];

  const sky = clamp(alt / 70000, 0, 1);
  c.fillStyle = "rgb(" + Math.round(135 - 125 * sky) + "," + Math.round(190 - 175 * sky) + "," + Math.round(235 - 195 * sky) + ")";
  c.fillRect(0, 0, W, Hh);

  const stepY = Math.max(5, niceStep(120 / S));              // altitude lines
  const yTop = alt + Hh * HOR / S, yBottom = alt - Hh * (1 - HOR) / S;
  c.strokeStyle = "rgba(255,255,255,0.25)"; c.fillStyle = "rgba(255,255,255,0.8)";
  c.font = "11px monospace"; c.textAlign = "left"; c.textBaseline = "bottom"; c.lineWidth = 1;
  c.beginPath();
  for (let k = Math.max(1, Math.ceil(yBottom / stepY)), n = 0; k * stepY <= yTop && n < 60; k++, n++) {
    const Y = Math.round(Hh * HOR - (k * stepY - alt) * S) + 0.5;
    c.moveTo(0, Y); c.lineTo(W, Y);
    c.fillText(fmtAlt(k * stepY - REF_OFFSET * 0), 8, Y - 2);
  }
  c.stroke();

  const gyS = Hh * HOR + alt * S;                            // ground and its marks
  if (gyS < Hh) {
    const top = Math.max(0, gyS);
    c.fillStyle = "#3d5a2e"; c.fillRect(0, top, W, Hh - top);
    c.fillStyle = "#2c4321"; c.fillRect(0, gyS, W, 3);
    const stepX = Math.max(1, niceStep(140 / S)), sF = R * phi;
    c.strokeStyle = "rgba(255,255,255,0.45)"; c.fillStyle = "rgba(255,255,255,0.8)";
    c.textAlign = "center"; c.textBaseline = "top";
    c.beginPath();
    for (let k = Math.ceil((sF - W / 2 / S) / stepX), n = 0; k * stepX <= sF + W / 2 / S && n < 80; k++, n++) {
      const X = Math.round(W / 2 + (k * stepX - sF) * S) + 0.5;
      c.moveTo(X, gyS); c.lineTo(X, gyS + 8);
      c.fillText(fmtAlt(k * stepX), X, gyS + 11);
    }
    c.stroke();
    c.textAlign = "left";
  }

  for (const part of sim.parts) for (const f of part.forces) {   // a flame for every engine that is burning
    if (f.kind !== "thrust" || f.now <= 0) continue;
    const a = part.body.getAngle() + f.angle, dx = -Math.sin(a), dy = Math.cos(a);
    const n = part.body.getWorldPoint(P(f.at[0], f.at[1])), L = (1.2 + 4 * f.now / f.max) * (0.85 + Math.random() * 0.3);
    const a1 = T({ x: n.x + dy * 0.28, y: n.y - dx * 0.28 }), a2 = T({ x: n.x - dy * 0.28, y: n.y + dx * 0.28 });
    const tip = T({ x: n.x - dx * L, y: n.y - dy * L });
    c.fillStyle = "#f1c40f"; c.beginPath(); c.moveTo(a1[0], a1[1]); c.lineTo(tip[0], tip[1]); c.lineTo(a2[0], a2[1]); c.closePath(); c.fill();
  }

  if (S * 6.3 < 16) {                                        // too small to see: show a marker instead
    const m = T(p);
    c.fillStyle = "#e74c3c"; c.strokeStyle = "#fff"; c.lineWidth = 1.5;
    c.beginPath(); c.arc(m[0], m[1], 5, 0, 6.2832); c.fill(); c.stroke();
    return;
  }
  for (const part of sim.parts) {                            // the parts
    c.fillStyle = part.color; c.beginPath();
    part.verts.forEach(function (q, i) {
      const s = T(part.body.getWorldPoint(q));
      if (i === 0) c.moveTo(s[0], s[1]); else c.lineTo(s[0], s[1]);
    });
    c.closePath(); c.fill();
  }
}

function drawMap(o) {                                        // the whole planet, not rotating, orbit drawn on it
  const cx = W / 2, cy = Hh / 2, M = (x, y) => [cx + x * mapS, cy - y * mapS];
  c.fillStyle = "#05070a"; c.fillRect(0, 0, W, Hh);
  c.fillStyle = "#2f4a25"; c.strokeStyle = "#6f9a52"; c.lineWidth = 2;
  c.beginPath(); c.arc(cx, cy, R * mapS, 0, 6.2832); c.fill(); c.stroke();

  const pad = M(0, R);                                       // the launch pad
  c.fillStyle = "#e8eef2"; c.fillRect(pad[0] - 2, pad[1] - 2, 4, 4);

  const q = { x: -o.ey * o.dir, y: o.ex * o.dir };           // the path itself
  const nuMax = o.bound ? Math.PI : Math.acos(-1 / o.e) * 0.98;
  c.strokeStyle = o.rp - R > 0 ? "#4aa3ff" : "#ff9f43"; c.lineWidth = 1.5;   // blue = clears the ground, orange = hits it
  c.beginPath();
  for (let i = 0; i <= 240; i++) {
    const nu = -nuMax + 2 * nuMax * i / 240, rr = o.pLat / (1 + o.e * Math.cos(nu));
    const s = M(rr * (Math.cos(nu) * o.ex + Math.sin(nu) * q.x), rr * (Math.cos(nu) * o.ey + Math.sin(nu) * q.y));
    if (i === 0) c.moveTo(s[0], s[1]); else c.lineTo(s[0], s[1]);
  }
  c.stroke();

  c.font = "12px monospace"; c.textBaseline = "middle"; c.textAlign = "left";
  const pe = M(o.rp * o.ex, o.rp * o.ey);
  c.fillStyle = "#e8eef2"; c.beginPath(); c.arc(pe[0], pe[1], 3, 0, 6.2832); c.fill();
  c.fillText("Pe " + fmtAlt(o.rp - R - REF_OFFSET), pe[0] + 7, pe[1]);
  if (o.bound) {
    const ap = M(-o.ra * o.ex, -o.ra * o.ey);
    c.beginPath(); c.arc(ap[0], ap[1], 3, 0, 6.2832); c.fill();
    c.fillText("Ap " + fmtAlt(o.ra - R - REF_OFFSET), ap[0] + 7, ap[1]);
  }

  const p = sim.hull.body.getPosition(), a = sim.hull.body.getAngle();   // the rocket: an arrow pointing the way its nose points
  const m = M(p.x, p.y), dx = -Math.sin(a), dy = -Math.cos(a);
  c.fillStyle = "#e74c3c"; c.strokeStyle = "#fff"; c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(m[0] + dx * 11, m[1] + dy * 11);
  c.lineTo(m[0] - dx * 7 - dy * 6, m[1] - dy * 7 + dx * 6);
  c.lineTo(m[0] - dx * 7 + dy * 6, m[1] - dy * 7 - dx * 6);
  c.closePath(); c.fill(); c.stroke();
  c.textAlign = "left";
}

function bar2(x, y, w, h, frac, color, label, text) {        // a vertical gauge
  c.fillStyle = "rgba(10,14,18,0.6)"; c.fillRect(x - 6, y - 6, w + 12, h + 38);
  c.strokeStyle = "rgba(255,255,255,0.5)"; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w, h);
  c.fillStyle = color; c.fillRect(x + 1, y + h - Math.round((h - 1) * frac), w - 1, Math.round((h - 1) * frac));
  c.fillStyle = "#e8eef2"; c.font = "11px monospace"; c.textAlign = "center"; c.textBaseline = "top";
  c.fillText(label, x + w / 2, y + h + 3);
  c.fillText(text, x + w / 2, y + h + 16);
  c.textAlign = "left";
}

function draw() {
  const fb = sim.hull.body, p = fb.getPosition(), v = fb.getLinearVelocity();
  const r = Math.hypot(p.x, p.y), phi = Math.atan2(p.x, p.y);
  const ux = Math.sin(phi), uy = Math.cos(phi), ex = Math.cos(phi), ey = -Math.sin(phi);
  const alt = r - R, o = orbitInfo(p, v);

  if (mapMode) drawMap(o); else drawFlight(alt, phi);

  const speed = Math.hypot(v.x, v.y), vert = v.x * ux + v.y * uy, side = v.x * ex + v.y * ey;
  let tilt = (fb.getAngle() + phi) * 180 / Math.PI; tilt = ((tilt + 180) % 360 + 360) % 360 - 180;
  const mass = totalMass();
  const dv = ISP * G0 * Math.log(mass / Math.max(1, mass - sim.fuel));
  const twr = maxThrust() / (mass * MU / (r * r));
  const peAlt = o.rp - R - REF_OFFSET;
  const lines = [
    "Altitude    " + fmtAlt(alt - REF_OFFSET),
    "Speed       " + speed.toFixed(0) + " m/s   (up " + vert.toFixed(0) + ", along " + side.toFixed(0) + ")",
    "Apoapsis    " + fmtAlt(o.ra - R - REF_OFFSET),
    "Periapsis   " + fmtAlt(peAlt) + (o.bound && peAlt > 0 ? "   IN ORBIT" : ""),
    "Period      " + fmtTime(o.period),
    "Delta-v     " + dv.toFixed(0) + " m/s   thrust/weight " + twr.toFixed(2),
    "Tilt        " + tilt.toFixed(1) + " deg   damping " + (controls.damping ? "ON" : "off"),
    "Time        " + sim.t.toFixed(1) + " s   view: " + (mapMode ? "MAP (M to return)" : "flight (M for map)")
  ];
  c.fillStyle = "rgba(10,14,18,0.55)"; c.fillRect(8, 8, 480, lines.length * 17 + 14);
  c.fillStyle = "#e8eef2"; c.font = "13px monospace"; c.textAlign = "left"; c.textBaseline = "top";
  for (let i = 0; i < lines.length; i++) c.fillText(lines[i], 16, 14 + i * 17);

  bar2(W - 118, 20, 22, 110, sim.fuel / sim.fuelFull, sim.fuel / sim.fuelFull > 0.2 ? "#e0b030" : "#e74c3c", "FUEL", sim.fuel.toFixed(0) + " kg");
  bar2(W - 56, 20, 22, 110, controls.throttle, "#4aa3ff", "THROT", Math.round(controls.throttle * 100) + "%");
}
