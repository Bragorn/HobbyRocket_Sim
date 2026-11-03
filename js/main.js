"use strict";

/* =====================================================================
   MAIN LOOP  (js/main.js)
   Physics runs in fixed slices of DT. The screen is drawn once per frame
   at whatever speed the computer manages. If the computer falls behind,
   the sim slows down instead of freezing (MAX_STEPS).
   ===================================================================== */

let last = performance.now();
let acc = 0;
let frameMs = 16.7, simMs = 0, drawMs = 0, stepsLast = 0;   // smoothed numbers for the debug panel
let warp = 1;

function resetAll() {
  resetSim();
  resetCamera();
}

function frame(now) {
  const rawMs = Math.max(0, now - last);
  last = now;
  const dtFrame = Math.min(rawMs / 1000, 0.1);          // ignore huge gaps (hidden tab etc.)
  frameMs += (Math.min(rawMs, 100) - frameMs) * 0.05;

  acc += dtFrame * warp;
  const maxSteps = MAX_STEPS * warp;
  const t0 = performance.now();
  let steps = 0;
  while (acc >= DT && steps < maxSteps) {
    step(DT);
    acc -= DT;
    steps++;
  }
  if (steps === maxSteps) acc = 0;                      // drop the backlog instead of spiralling
  const t1 = performance.now();

  updateCamera();
  render(dtFrame);
  const t2 = performance.now();

  simMs += ((t1 - t0) - simMs) * 0.05;
  drawMs += ((t2 - t1) - drawMs) * 0.05;
  stepsLast = steps;

  requestAnimationFrame(frame);
}

resize();
resetAll();
requestAnimationFrame(frame);
