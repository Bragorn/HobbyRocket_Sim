"use strict";

/* =====================================================================
   CONTROLS  (js/controls.js)
   The ONE place the sim reads its controls from:
     controls.throttle  0 to 1
     controls.steer     -1 to 1 (+1 turns the rocket counter-clockwise, nose to the left)
     controls.damping   true = the reaction wheel fights any spin
   updateControls() fills them in from the keyboard. An autopilot will
   fill them in instead (same three numbers), so sim.js never changes.
   ===================================================================== */

const controls = { throttle: 0, steer: 0, damping: true };
const keys = {};                     // which keys are held right now

function controlsReset() { controls.throttle = 0; controls.steer = 0; controls.damping = true; }

function updateControls(dt) {        // called once per physics step, before the forces are worked out
  if (keys.KeyW) controls.throttle = Math.min(1, controls.throttle + 0.5 * dt);
  if (keys.KeyS) controls.throttle = Math.max(0, controls.throttle - 0.5 * dt);
  controls.steer = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
}

window.addEventListener("keydown", function (e) {
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(e.code) >= 0) e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === "KeyZ") controls.throttle = 1;
  else if (e.code === "KeyX") controls.throttle = 0;
  else if (e.code === "KeyT") controls.damping = !controls.damping;
});
window.addEventListener("keyup", function (e) { keys[e.code] = false; });
