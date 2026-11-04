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
  else if (e.code === "KeyH") { sharp = !sharp; resize(); }
  else if (e.code === "KeyG") graphPage = (graphPage + 1 >= GRAPH_PAGES.length) ? -1 : graphPage + 1;
  else if (e.code === "KeyE") exportCsv();
  else if (e.code === "KeyW") chooseWind((sel.wind + 1) % WINDS.length);
  else if (e.code === "KeyQ") chooseWindDir(-sel.windDir);
  else if (e.code === "KeyA") chooseAngle((sel.angle + 1) % ANGLES.length);
  else if (e.code === "KeyT") warp = warp === 1 ? 4 : warp === 4 ? 16 : 1;
  else if (e.code === "KeyZ") zoomPreset();
});

window.addEventListener("resize", resize);
window.addEventListener("wheel", function (e) {
  if (e.target && e.target.closest && e.target.closest("#side")) return;   // let the sidebar scroll
  e.preventDefault();
  zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
}, { passive: false });
