"use strict";

/* =====================================================================
   EFFECTS  (js/fx.js)
   Looks only, nothing here changes the flight. The sim reports what just
   happened (sim.fx: a part broke, the rocket hit the ground) and this file
   turns it into flying chips, smoke, dust, a flash, a callout like "FIN
   SNAPPED!" and a bit of screen shake. Positions are in meters, like the
   world; sizes of chips and text are in pixels. These use Math.random on
   purpose: it never touches the flight's own seeded random numbers.
   ===================================================================== */

const fx = { chips: [], puffs: [], rings: [], labels: [], shake: 0 };
const FX_MAX = 220;                                       // never more than this many particles of a kind

function fxClear() {
  fx.chips.length = 0; fx.puffs.length = 0; fx.rings.length = 0; fx.labels.length = 0; fx.shake = 0;
}

function fxRand(a, b) { return a + Math.random() * (b - a); }

function fxChips(x, y, n, speed, color, up) {
  for (let i = 0; i < n && fx.chips.length < FX_MAX; i++) {
    fx.chips.push({ x: x, y: y, vx: fxRand(-speed, speed), vy: fxRand(0, speed) * up + 0.5,
                    life: fxRand(0.6, 1.4), color: color, size: fxRand(2, 4) });
  }
}

function fxPuffs(x, y, n, spread, rise, color, size) {
  for (let i = 0; i < n && fx.puffs.length < FX_MAX; i++) {
    const life = fxRand(0.7, 1.4);
    fx.puffs.push({ x: x + fxRand(-spread, spread) * 0.2, y: y, vx: fxRand(-spread, spread), vy: fxRand(0, rise),
                    r: size * fxRand(0.6, 1), life: life, max: life, color: color });
  }
}

function fxBreak(e) {                                     // something snapped in flight or on landing
  const big = Math.min(1, 0.3 + e.power / 40);
  fxChips(e.x, e.y, Math.round(8 + 10 * big), 3 + 6 * big, e.color || "#dddddd", 1);
  fxChips(e.x, e.y, 4, 4, "#ffffff", 1);
  fxPuffs(e.x, e.y, 3, 0.8, 0.5, "210,210,210", 0.05);
  fx.rings.push({ x: e.x, y: e.y, life: 0.2, max: 0.2 });
  if (e.text) fx.labels.push({ x: e.x, y: e.y, text: e.text, life: 1.7, max: 1.7 });
  fx.shake = Math.max(fx.shake, 3 + 5 * big);
}

function fxImpact(e) {                                    // the rocket hits the ground: dust and a thump
  const p = e.power;
  fxPuffs(e.x, 0.02, Math.min(26, 6 + Math.round(p * 0.6)), Math.min(7, 1 + p * 0.12), Math.min(2, 0.3 + p * 0.03), "176,150,110", 0.1);
  if (p > 12) fxChips(e.x, 0.02, Math.min(14, Math.round(p * 0.3)), Math.min(8, 2 + p * 0.1), "#8a7a62", 1);
  fx.shake = Math.max(fx.shake, Math.min(14, p * 0.25));
}

function fxUpdate(dt) {                                   // take in what the sim reported, then move everything along
  for (let i = 0; i < sim.fx.length; i++) {
    if (sim.fx[i].kind === "impact") fxImpact(sim.fx[i]); else fxBreak(sim.fx[i]);
  }
  sim.fx.length = 0;

  for (let i = fx.chips.length - 1; i >= 0; i--) {
    const c = fx.chips[i];
    c.vy -= G * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.life -= dt;
    if (c.y < 0) { c.y = 0; c.vy *= -0.3; c.vx *= 0.6; }
    if (c.life <= 0) fx.chips.splice(i, 1);
  }
  for (let i = fx.puffs.length - 1; i >= 0; i--) {
    const p = fx.puffs[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - 1.5 * dt; p.vy *= 1 - 1.5 * dt;
    p.r += dt * 0.25; p.life -= dt;
    if (p.life <= 0) fx.puffs.splice(i, 1);
  }
  for (let i = fx.rings.length - 1; i >= 0; i--) { fx.rings[i].life -= dt; if (fx.rings[i].life <= 0) fx.rings.splice(i, 1); }
  for (let i = fx.labels.length - 1; i >= 0; i--) { fx.labels[i].life -= dt; if (fx.labels[i].life <= 0) fx.labels.splice(i, 1); }
  fx.shake *= Math.exp(-9 * dt);
  if (fx.shake < 0.3) fx.shake = 0;
}

function fxDraw() {
  const z = cam.zoom;
  for (let i = 0; i < fx.puffs.length; i++) {             // smoke and dust, fading as they age
    const p = fx.puffs[i];
    ctx.fillStyle = "rgba(" + p.color + "," + (0.45 * p.life / p.max).toFixed(3) + ")";
    ctx.beginPath();
    ctx.arc(sx(p.x), sy(p.y), Math.max(2, p.r * z), 0, 6.2832);
    ctx.fill();
  }
  for (let i = 0; i < fx.rings.length; i++) {             // a quick flash ring where it broke
    const r = fx.rings[i], t = 1 - r.life / r.max;
    ctx.strokeStyle = "rgba(255,255,255," + (1 - t).toFixed(3) + ")";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx(r.x), sy(r.y), 4 + t * 26, 0, 6.2832);
    ctx.stroke();
  }
  for (let i = 0; i < fx.chips.length; i++) {
    const c = fx.chips[i];
    ctx.globalAlpha = Math.min(1, c.life * 2);
    ctx.fillStyle = c.color;
    ctx.fillRect(sx(c.x), sy(c.y), c.size, c.size);
  }
  ctx.globalAlpha = 1;
  ctx.font = "bold 15px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < fx.labels.length; i++) {            // the callout floats up and fades
    const l = fx.labels[i], t = 1 - l.life / l.max;
    const a = Math.min(1, l.life / 0.5).toFixed(3);
    const X = sx(l.x), Y = sy(l.y) - 24 - t * 34;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0," + (0.7 * a).toFixed(3) + ")";
    ctx.strokeText(l.text, X, Y);
    ctx.fillStyle = "rgba(255,235,120," + a + ")";
    ctx.fillText(l.text, X, Y);
  }
  ctx.textAlign = "left";
}
