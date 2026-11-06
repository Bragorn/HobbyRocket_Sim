"use strict";

/* =====================================================================
   RENDER  (js/render.js)
   Canvas setup and drawing the world: sky, ground, pad, rocket, chute.
   We draw in CSS pixels (Wc x Hc). By default the canvas has exactly that
   many real pixels ("fast"). Press H for "sharp" (full retina resolution).
   The builder sidebar (ui.js) sits on the right, so the canvas is that much narrower.
   ===================================================================== */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d", { alpha: false });
let Wc = 0, Hc = 0;
let sharp = false;
let showDebug = true;
let graphPage = 0;         // 0 and 1 = graph pages, -1 = graphs off
const ARROW_PX = 22;       // below this rocket height (in pixels) the rocket is drawn as an arrow instead
let showMarks = true;      // M: show the center of gravity (CG) and center of pressure (CP) on the rocket

function resize() {
  const side = typeof uiWidth === "function" ? uiWidth() : 0;   // width taken by the sidebar
  Wc = Math.max(200, window.innerWidth - side);
  Hc = window.innerHeight;
  const k = sharp ? (window.devicePixelRatio || 1) : 1;
  canvas.width = Math.floor(Wc * k);
  canvas.height = Math.floor(Hc * k);
  canvas.style.width = Wc + "px";
  canvas.style.height = Hc + "px";
  ctx.setTransform(k, 0, 0, k, 0, 0);
}

function drawSky() {
  const t = Math.min(1, Math.max(0, cam.y / 3000));      // sky darkens with altitude
  const r = Math.round(135 - 125 * t);
  const g = Math.round(190 - 175 * t);
  const b = Math.round(235 - 195 * t);
  ctx.fillStyle = "rgb(" + r + "," + g + "," + b + ")";
  ctx.fillRect(-30, -30, Wc + 60, Hc + 60);              // a bit oversized so shaking never shows an edge
}

function niceStep(x) {                                    // round to 1, 2, 5, 10 x 10^n
  const mag = Math.pow(10, Math.floor(Math.log(x) / Math.LN10));
  const r = x / mag;
  return (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * mag;
}

/* Altitude marks: a thin line every 5 m, labelled every 25 m. Kept wide
   apart on purpose so they do not flicker when the rocket is fast. */
function drawAltitudeLines() {
  const stepM = Math.max(5, niceStep(220 / cam.zoom));
  const labelEvery = Math.max(1, Math.round(25 / stepM));
  const yTop = cam.y + (Hc * HORIZON) / cam.zoom;
  const yBottom = cam.y - (Hc * (1 - HORIZON)) / cam.zoom;
  const first = Math.max(1, Math.ceil(yBottom / stepM));  // never draw on the ground itself

  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 1;
  ctx.font = "11px monospace";
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  ctx.beginPath();
  for (let k = first; k * stepM <= yTop && k - first < 40; k++) {
    const py = Math.round(sy(k * stepM)) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(Wc, py);
    if (k % labelEvery === 0) ctx.fillText(+(k * stepM).toFixed(2) + " m", 8, py - 2);
  }
  ctx.stroke();
}

function drawGround() {
  const gy = sy(0);
  if (gy > Hc) return;
  const top = Math.max(0, gy);
  ctx.fillStyle = "#3d5a2e";
  ctx.fillRect(0, top, Wc, Hc - top);
  ctx.fillStyle = "#2c4321";
  ctx.fillRect(0, gy, Wc, 3);
}

function drawGroundMarks() {                              // a tick and a label every few meters
  const gy = sy(0);
  if (gy > Hc - 4 || gy < 0) return;
  const stepM = Math.max(1, niceStep(160 / cam.zoom));
  const left = cam.x - (Wc / 2) / cam.zoom, right = cam.x + (Wc / 2) / cam.zoom;
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = "11px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.beginPath();
  for (let k = Math.ceil(left / stepM); k * stepM <= right; k++) {
    const px = Math.round(sx(k * stepM)) + 0.5;
    ctx.moveTo(px, gy);
    ctx.lineTo(px, gy + 8);
    ctx.fillText(k * stepM + " m", px, gy + 11);
  }
  ctx.stroke();
  ctx.textAlign = "left";
}

function drawPad() {
  const gy = sy(0);
  const z = cam.zoom;
  if (gy < 0 || gy - z > Hc) return;                      // pad and rod are off screen
  ctx.fillStyle = "#555e66";
  ctx.fillRect(sx(-0.15), gy - 0.03 * z, 0.30 * z, 0.03 * z);            // pad plate
  ctx.fillStyle = "#8a949c";
  ctx.fillRect(sx(0.03), gy - 1.0 * z, Math.max(1, 0.006 * z), 1.0 * z); // launch rod, 1 m tall
}

function drawFlame(cx, baseY, z) {
  const f = Math.min(2, Math.sqrt(sim.thrust / 6));       // bigger thrust, bigger flame
  const len = Math.max(6, 0.14 * z * f) * (0.8 + Math.random() * 0.4);
  const w = Math.max(2, 0.014 * z * f);
  ctx.fillStyle = "#f1c40f";
  ctx.beginPath();
  ctx.moveTo(cx - w, baseY);
  ctx.lineTo(cx, baseY + len);
  ctx.lineTo(cx + w, baseY);
  ctx.closePath();
  ctx.fill();
}

function drawChute() {                                    // drawn in world space, pointing where the pull goes
  if (!sim.chuteDeployed || sel.chute < 0 || chutePart.broken) return;
  if (sim.landed) {                                       // landed: the canopy lies collapsed beside the rocket
    const c = CHUTES[sel.chute], dir = sim.rest.theta >= 0 ? 1 : -1;
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.ellipse(sx(sim.rest.x + dir * (ROCKET_H - sim.cg0 + 0.1)), sy(0) - 1.5, Math.max(2, c.diameter * cam.zoom * 0.45), 2.5, 0, 0, 6.2832);
    ctx.fill();
    return;
  }
  const c = CHUTES[sel.chute], z = cam.zoom, open = sim.chuteOpen;
  const a = chuteAttachAt() - sim.cg0;
  const ax = sim.x + a * Math.sin(sim.theta);
  const ay = sim.y + sim.cg0 + a * Math.cos(sim.theta);   // tie-on point in meters
  const lineLen = CHUTE_LINE * (0.4 + 0.6 * open);
  const w = c.diameter * z * (0.25 + 0.75 * open);        // canopy width in pixels
  const ccx = sx(ax + sim.chuteUx * lineLen);
  const ccy = sy(ay + sim.chuteUy * lineLen);             // canopy center on screen
  ctx.save();
  ctx.translate(ccx, ccy);
  ctx.rotate(Math.atan2(sim.chuteUx, sim.chuteUy));       // dome faces away from the rocket
  ctx.strokeStyle = "rgba(20,20,20,0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0); ctx.lineTo(0, lineLen * z);
  ctx.moveTo(w / 2, 0);  ctx.lineTo(0, lineLen * z);
  ctx.stroke();
  ctx.fillStyle = c.color;
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2, w * 0.28, 0, Math.PI, 2 * Math.PI);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ---- the look of each part (looks only, no physics) ----
   A fin is drawn as an outline for one side, mirrored for the other.
   Each point is [out, up]: out = 0 at the tube wall and 1 at the fin tip,
   up = 0 at the bottom of the fin root and 1 at its top. Below 0 hangs off the back. */
const FIN_OUTLINES = {
  trapezoid: [[0, 0], [0, 1], [1, 0.45], [1, 0]],
  swept:     [[0, 0], [0, 1], [1, 0.40], [1, -0.20]],
  delta:     [[0, 0], [0, 1], [1, 0.45], [1, 0.20]],
  large:     [[0, 0], [0, 1], [0.9, 0.85], [1, 0.55], [1, 0]]
};

function bodyColor() {                                       // the tube's color (the aft end of the airframe matches it)
  for (let i = 0; i < rocket.parts.length; i++) if (rocket.parts[i].kind === "tube") return rocket.parts[i].color;
  return "#ecf0f1";
}

function drawFins(p, cx, bottom, z) {
  const w = p.width * z, h = p.length * z;
  const root = bottom - (p.shift || 0) * z;                  // the fins can be glued higher up the tube (or hang off the back)
  const half = Math.max(w / 2, p.span * z / 2);              // half of the fin span, in pixels
  const out = FIN_OUTLINES[p.shape] || FIN_OUTLINES.trapezoid;
  ctx.fillStyle = bodyColor();
  ctx.fillRect(cx - w / 2, bottom - h, w, h);                // the aft end of the airframe
  ctx.fillStyle = p.color;
  for (let side = -1; side <= 1; side += 2) {
    if (p.only && p.only !== side) continue;                 // a single loose fin
    if (p.fins && p.fins[side < 0 ? 0 : 1].gone) continue;   // this one has broken off
    ctx.beginPath();
    for (let i = 0; i < out.length; i++) {
      const X = cx + side * (w / 2 + (half - w / 2) * out[i][0]);
      const Y = root - h * out[i][1];
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.closePath();
    ctx.fill();
    if (z > 60) { ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1; ctx.stroke(); }
  }
}

function drawNose(p, cx, bottom, top, w) {
  const h = bottom - top;
  ctx.fillStyle = p.color;
  ctx.beginPath();
  if (p.shape === "ogive") {                                 // curved sides, sharp tip
    ctx.moveTo(cx - w / 2, bottom);
    ctx.bezierCurveTo(cx - w / 2, bottom - h * 0.55, cx - w * 0.2, top + h * 0.12, cx, top);
    ctx.bezierCurveTo(cx + w * 0.2, top + h * 0.12, cx + w / 2, bottom - h * 0.55, cx + w / 2, bottom);
  } else if (p.shape === "blunt") {                          // short and rounded
    ctx.moveTo(cx - w / 2, bottom);
    ctx.lineTo(cx - w / 2, top + h * 0.55);
    ctx.ellipse(cx, top + h * 0.55, w / 2, h * 0.55, 0, Math.PI, 2 * Math.PI);
    ctx.lineTo(cx + w / 2, bottom);
  } else {                                                   // conical: straight sides
    ctx.moveTo(cx - w / 2, bottom);
    ctx.lineTo(cx, top);
    ctx.lineTo(cx + w / 2, bottom);
  }
  ctx.closePath();
  ctx.fill();
}

/* CG (black and white circle) and CP (red circle) on the rocket's axis. The CP has to
   sit BELOW the CG, toward the fins, for the rocket to be stable. Labels stay upright. */
function drawMarkers(cx, baseY, z, theta) {
  const cp = rocketCP();
  if (cp === null) return;
  const tall = z * ROCKET_H;                      // the rocket's height on screen, px
  if (tall < 30) return;                          // too small: the dots would cover the rocket
  const r = Math.max(2, Math.min(5, tall * 0.045)), labels = tall > 60;   // the dots shrink as you zoom out
  const spots = [[sim.cg, "CG", -1], [cp, "CP", 1]];
  for (let i = 0; i < spots.length; i++) {
    const y = baseY - spots[i][0] * z;
    ctx.save();
    ctx.translate(cx, y);
    ctx.lineWidth = 1.5;
    if (i === 0) {
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.2832); ctx.fill();
      ctx.fillStyle = "#111";
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, 0, Math.PI / 2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, Math.PI, Math.PI * 1.5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#111";
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.2832); ctx.stroke();
    } else {
      ctx.fillStyle = "#e74c3c";
      ctx.strokeStyle = "#fff";
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.2832); ctx.fill(); ctx.stroke();
    }
    if (labels) {
      ctx.rotate(-theta);
      ctx.font = "11px monospace";
      ctx.textBaseline = "middle";
      ctx.textAlign = spots[i][2] < 0 ? "right" : "left";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.strokeText(spots[i][1], spots[i][2] * (r + 6), 0);
      ctx.fillStyle = "#fff";
      ctx.fillText(spots[i][1], spots[i][2] * (r + 6), 0);
    }
    ctx.restore();
  }
}

/* The pieces that broke off, each drawn the way the part looks. They lie on their sides once they land. */
function drawDebris() {
  const z = cam.zoom;
  for (let i = 0; i < sim.debris.length; i++) {
    const d = sim.debris[i];
    const X = sx(d.x), Y = sy(d.y);
    if (X < -100 || X > Wc + 100 || Y < -100 || Y > Hc + 100) continue;
    const w = Math.max(2, d.w * z), h = Math.max(2, d.h * z);
    ctx.save();
    ctx.translate(X, Y);
    ctx.rotate(d.theta);
    if (d.kind === "fin") {
      drawFins({ width: d.w, length: d.h, span: d.span, shape: d.shape, color: d.color, shift: 0, only: d.side }, 0, h / 2, z);
    } else if (d.kind === "fins") {
      drawFins({ width: d.w, length: d.h, span: d.span, shape: d.shape, color: d.color, shift: 0 }, 0, h / 2, z);
    } else if (d.kind === "nose") {
      drawNose({ shape: d.shape, color: d.color }, 0, h / 2, -h / 2, w);
    } else if (d.kind === "chute") {
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, Math.max(2, w * 0.28), 0, Math.PI, 2 * Math.PI);
      ctx.closePath();
      ctx.fill();
    } else {                                              // tube and nose weight: a plain block
      ctx.fillStyle = d.color;
      ctx.fillRect(-w / 2, -h / 2, w, Math.max(2, h));
    }
    ctx.restore();
  }
}

function drawArrow() {                                    // far away: just show where it is and which way it points
  const pose = rocketPose();
  ctx.save();
  ctx.translate(sx(pose.x), sy(pose.yc));
  ctx.rotate(pose.theta);
  ctx.fillStyle = "#e74c3c";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawRocket() {
  const z = cam.zoom;
  if (z * ROCKET_H < ARROW_PX) { drawArrow(); return; }
  const pose = rocketPose();                       // in flight: the sim's position and tilt. After landing: tipped over and settled
  ctx.save();
  ctx.translate(sx(pose.x), sy(pose.yc));          // origin = the balance point
  ctx.rotate(pose.theta);
  const cx = 0;
  const baseY = sim.cg0 * z;                       // the bottom of the rocket hangs this far below it

  if (sim.thrust > 0) drawFlame(cx, baseY, z);

  let up = 0;                                             // meters up the stack
  for (let i = 0; i < rocket.parts.length; i++) {
    const p = rocket.parts[i];
    const w = p.width * z;

    if (p.inside) {                                       // motor and chute: show what you picked
      if (p.kind === "motor") {
        const mh = p.length * z, mw = p.width * z, mc = MOTORS[sel.motor];
        ctx.globalAlpha = 0.65;
        ctx.fillStyle = mc.color;
        ctx.fillRect(cx - mw / 2, baseY - mh, mw, mh);                              // casing, seen through the tube
        ctx.globalAlpha = 1;
        ctx.fillStyle = sel.chute >= 0 ? DELAY_COLORS[sel.delay] : "#7f8c8d";
        ctx.fillRect(cx - mw / 2, baseY - mh, mw, Math.max(3, 0.012 * z));         // delay band at the forward end
        ctx.fillStyle = "#34495e";
        ctx.fillRect(cx - mw * 0.4, baseY, mw * 0.8, Math.max(2, 0.01 * z));       // nozzle
      } else if (p.kind === "ballast" && p.mass > 0) {        // the weight in the nose: bigger for more grams
        const bh = Math.max(2, (0.004 + p.mass * 0.6) * z);
        ctx.fillStyle = "rgba(90,98,105,0.95)";
        ctx.fillRect(cx - bodyDiameter() * z * 0.22, baseY - p.at * z - bh / 2, bodyDiameter() * z * 0.44, bh);
      } else if (p.kind === "chute" && sel.chute >= 0 && !sim.chuteDeployed) {
        const c = CHUTES[sel.chute], bh = Math.max(2, c.diameter * 0.1 * z);
        ctx.fillStyle = c.color;
        ctx.fillRect(cx - bodyDiameter() * z / 2, baseY - p.at * z - bh / 2, bodyDiameter() * z, bh);   // packed chute, as wide as the tube
      }
      continue;
    }

    if (p.broken) { up += p.length; continue; }   // this part is gone, but the others stay where they are

    const h = p.length * z;
    const bottom = baseY - up * z;
    const top = bottom - h;
    ctx.fillStyle = p.color;

    if (p.kind === "tube") {
      ctx.fillRect(cx - w / 2, top, w, h);
      ctx.fillStyle = "rgba(0,0,0,0.14)";                 // a little shading down the right side
      ctx.fillRect(cx + w * 0.2, top, w * 0.3, h);
    } else if (p.kind === "nose") {
      drawNose(p, cx, bottom, top, w);
    } else if (p.kind === "fins") {
      drawFins(p, cx, bottom, z);
    }
    up += p.length;
  }
  if (showMarks) drawMarkers(cx, baseY, z, pose.theta);
  ctx.restore();
}

/* One full frame. The text and graphs live in hud.js. */
function render(dtFrame) {
  fxUpdate(dtFrame);
  ctx.save();
  if (fx.shake > 0) ctx.translate((Math.random() * 2 - 1) * fx.shake, (Math.random() * 2 - 1) * fx.shake);   // a hard hit shakes the picture (not the text)
  drawSky();
  drawAltitudeLines();
  drawGround();
  drawGroundMarks();
  drawPad();
  drawRocket();
  drawDebris();
  drawChute();
  fxDraw();
  ctx.restore();
  drawHud(dtFrame);
}
