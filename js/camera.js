"use strict";

/* =====================================================================
   CAMERA  (js/camera.js)
   The only place where meters turn into pixels.
   The camera stays locked on the rocket, up and sideways. The zoom is
   fixed by the size of the rocket, not by how high it flies.
   ===================================================================== */

const CAM_ROCKET_PX = 64;   // how tall the rocket is drawn on screen, in pixels
const HORIZON = 0.62;       // fraction of the screen height where the rocket sits
const cam = { x: 0, y: 0, zoom: 1 };

function resetCamera() {
  cam.zoom = CAM_ROCKET_PX / ROCKET_H;     // pixels per meter
  cam.x = 0;
  cam.y = 0;
}

function updateCamera() {
  cam.x = sim.x;                           // locked on the rocket
  cam.y = sim.y;
}

function sx(x) { return Wc / 2 + (x - cam.x) * cam.zoom; }
function sy(y) { return Hc * HORIZON - (y - cam.y) * cam.zoom; }