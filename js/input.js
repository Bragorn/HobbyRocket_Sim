"use strict";

/* =====================================================================
   INPUT  (js/input.js)
   Keyboard shortcuts and the mouse wheel. The rocket parts, motor, delay
   and parachute are chosen with the mouse in the sidebar (ui.js).
   ===================================================================== */

window.addEventListener("keydown", function (e) {
  if (e.code === "Space") e.preventDefault();
  if (e.code === "Equal" || e.code === "NumpadAdd") { zoomBy(1.15); return; }
  if (e.code === "Minus" || e.code === "NumpadSubtract") { zoomBy(1 / 1.15); return; }
  if (e.repeat) return;

  if (e.code === "Space") { if (launchBlocked() === "") launch(); }
  else if (e.code === "KeyR") resetAll();
  else if (e.code === "KeyD") showDebug = !showDebug;
  else if (e.code === "KeyM") showMarks = !showMarks;
  else if (e.code === "KeyH") { sharp = !sharp; resize(); }
  else if (e.code === "KeyG") graphPage = (graphPage + 1 >= GRAPH_PAGES.length) ? -1 : graphPage + 1;
  else if (e.code === "KeyE") exportCsv();
  else if (e.code === "KeyW") chooseWind((sel.wind + 1) % WINDS.length);
  else if (e.code === "KeyQ") chooseWindDir(-sel.windDir);
  else if (e.code === "KeyA") chooseAngle((sel.angle + 1) % ANGLES.length);
  else if (e.code === "KeyT") warp = warp === 1 ? 4 : warp === 4 ? 16 : 1;
  else if (e.code === "KeyZ") zoomPreset();
});

/* Drag the fins up and down the tube with the mouse (only on the pad). The mouse position is
   turned into the rocket's own measurements: x across it, h = height above its bottom, in meters. */
let finDrag = null;

function mouseOnRocket(e) {
  const z = cam.zoom;
  const dx = (e.clientX - sx(sim.x)) / z;                       // meters from the balance point, x right
  const dy = (sy(sim.y + sim.cg0) - e.clientY) / z;             // meters from the balance point, y up
  const c = Math.cos(sim.theta), s = Math.sin(sim.theta);       // the rocket's axis is (s, c), "across" is (c, -s)
  return { x: dx * c - dy * s, h: sim.cg0 + dx * s + dy * c };
}

function overFins(e) {
  const fins = rocket.parts[0], m = mouseOnRocket(e);
  return fins.kind === "fins" && Math.abs(m.x) <= fins.span / 2 + 0.005 &&
         m.h >= fins.shift - fins.length * 0.25 && m.h <= fins.shift + fins.length;
}

window.addEventListener("mousedown", function (e) {
  if (e.target !== canvas || sim.ignited || !overFins(e)) return;
  finDrag = { grab: mouseOnRocket(e).h - rocket.parts[0].shift };   // remember where on the fin it was grabbed
});
window.addEventListener("mousemove", function (e) {
  if (finDrag) {
    if (sim.ignited) { finDrag = null; return; }
    chooseFinShift((mouseOnRocket(e).h - finDrag.grab) * 1000);
  } else if (e.target === canvas) {
    canvas.style.cursor = !sim.ignited && overFins(e) ? "ns-resize" : "default";
  }
});
window.addEventListener("mouseup", function () { finDrag = null; });

window.addEventListener("resize", resize);
window.addEventListener("wheel", function (e) {
  if (e.target && e.target.closest && e.target.closest("#side")) return;   // let the sidebar scroll
  e.preventDefault();
  zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
}, { passive: false });
