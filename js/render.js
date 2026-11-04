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
  ctx.fillRect(0, 0, Wc, Hc);
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

function drawRocket() {
  const z = cam.zoom;
  ctx.save();
  ctx.translate(sx(sim.x), sy(sim.y + sim.cg0));   // origin = the balance point
  ctx.rotate(sim.theta);
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
    } else if (p.kind === "nose") {
      ctx.beginPath();
      ctx.moveTo(cx - w / 2, bottom);
      ctx.lineTo(cx, top);
      ctx.lineTo(cx + w / 2, bottom);
      ctx.closePath();
      ctx.fill();
    } else if (p.kind === "fins") {
      const s = (p.span * z) / 2;                         // half of the fin span in pixels
      ctx.fillRect(cx - w / 2, top, w, h);
      ctx.beginPath();
      ctx.moveTo(cx - w / 2, top + h * 0.15);
      ctx.lineTo(cx - s, bottom);
      ctx.lineTo(cx - w / 2, bottom);
      ctx.moveTo(cx + w / 2, top + h * 0.15);
      ctx.lineTo(cx + s, bottom);
      ctx.lineTo(cx + w / 2, bottom);
      ctx.fill();
    }
    up += p.length;
  }
  ctx.restore();

  if (z * ROCKET_H < 8) {                                 // too small to see: draw a dot
    ctx.fillStyle = "#e74c3c";
    ctx.beginPath();
    ctx.arc(sx(sim.x), sy(sim.y + sim.cg0), 4, 0, 6.2832);
    ctx.fill();
  }
}

/* One full frame. The text and graphs live in hud.js. */
function render(dtFrame) {
  drawSky();
  drawAltitudeLines();
  drawGround();
  drawGroundMarks();
  drawPad();
  drawRocket();
  drawChute();
  drawHud(dtFrame);
}
