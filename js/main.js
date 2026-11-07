"use strict";

/* =====================================================================
   MAIN  (js/main.js)
   The game loop, the view keys (zoom, map, reset), and the start-up.
   Flight keys (W S A D Z X T) live in controls.js.
   Physics runs in fixed slices of DT; if the computer falls behind, the
   sim slows down instead of freezing (at most 10 steps per drawn frame).
   ===================================================================== */

function resetAll() {
  buildWorld();
  controlsReset();
}

window.addEventListener("keydown", function (e) {
  if (e.code === "Equal" || e.code === "NumpadAdd") zoomBy(1.15);
  if (e.code === "Minus" || e.code === "NumpadSubtract") zoomBy(1 / 1.15);
  if (e.repeat) return;
  if (e.code === "KeyR") resetAll();
  else if (e.code === "KeyM") toggleMap();
});
window.addEventListener("wheel", function (e) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });
window.addEventListener("resize", resize);

let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  let n = 0;
  while (acc >= DT && n < 10) { stepSim(); acc -= DT; n++; }
  if (n === 10) acc = 0;
  draw();
  requestAnimationFrame(frame);
}

resize();
resetAll();
requestAnimationFrame(frame);
