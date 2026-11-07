"use strict";

/* =====================================================================
   UTIL  (js/util.js)
   The on-screen log, a few tiny helpers, and the check that planck loaded.
   ===================================================================== */

const logEl = document.getElementById("log");
const logLines = [];
function log(s) { logLines.push(s); if (logLines.length > 7) logLines.shift(); logEl.textContent = logLines.join("\n"); }

if (typeof planck === "undefined") {
  log("planck was not found. Check that the file is at js/planck.min.js next to this page. Then reload.");
  throw new Error("planck missing");
}

const P = (x, y) => new planck.Vec2(x, y);
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
