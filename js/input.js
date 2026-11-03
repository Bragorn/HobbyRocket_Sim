"use strict";

/* =====================================================================
   INPUT  (js/input.js)
   Keys 1-9 and 0 choose the setup, but only before launch.
   ===================================================================== */

window.addEventListener("keydown", function (e) {
  if (e.code === "Space") e.preventDefault();
  if (e.repeat) return;

  if (e.code === "Space") launch();
  else if (e.code === "KeyR") resetAll();
  else if (e.code === "KeyD") showDebug = !showDebug;
  else if (e.code === "KeyH") { sharp = !sharp; resize(); }
  else if (e.code === "KeyG") graphPage = (graphPage + 1 >= GRAPH_PAGES.length) ? -1 : graphPage + 1;
  else if (e.code === "KeyE") exportCsv();
  else if (e.code === "KeyW" && !sim.ignited) sel.wind = (sel.wind + 1) % WINDS.length;
  else if (!sim.ignited && e.code.indexOf("Digit") === 0) {
    const n = parseInt(e.code.slice(5), 10);
    if (n >= 1 && n <= 3 && n - 1 < MOTORS.length) sel.motor = n - 1;          // 1-3 motor
    else if (n >= 4 && n <= 6 && n - 4 < DELAYS.length) sel.delay = n - 4;     // 4-6 delay charge
    else if (n >= 7 && n <= 9 && n - 7 < CHUTES.length) sel.chute = n - 7;     // 7-9 parachute size
    else if (n === 0) sel.chute = -1;                                          // 0 = no parachute
    refreshLoadout();
  }
});

window.addEventListener("resize", resize);
