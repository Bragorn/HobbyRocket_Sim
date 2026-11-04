"use strict";

/* =====================================================================
   CAMERA  (js/camera.js)
   The only place where meters turn into pixels.
   The camera stays locked on the rocket, up and sideways. Zoom is set by
   how tall the rocket is drawn (in pixels). Wheel, + / - and Z change it,
   and it eases toward the new value instead of jumping.
   ===================================================================== */

const CAM_ROCKET_PX = 110;              // default: how tall the rocket is drawn, in pixels
const CAM_PRESETS = [110, 240, 30, 6];  // Z cycles: normal, close, wide, far
const CAM_MIN_PX = 4, CAM_MAX_PX = 500; // zoom limits (rocket height in pixels)
const HORIZON = 0.62;                   // fraction of the screen height where the rocket sits
const cam = { x: 0, y: 0, zoom: 1, target: 1 };   // target = where zoom is heading

function setZoomPx(px) {                // ask for a rocket height in pixels
  cam.target = Math.min(CAM_MAX_PX, Math.max(CAM_MIN_PX, px)) / ROCKET_H;
}

function zoomBy(factor) { setZoomPx(cam.target * ROCKET_H * factor); }

function zoomPreset() {                 // jump to the next preset after the nearest one
  const cur = cam.target * ROCKET_H;
  let best = 0, bd = Infinity;
  for (let i = 0; i < CAM_PRESETS.length; i++) {
    const d = Math.abs(Math.log(CAM_PRESETS[i] / cur));
    if (d < bd) { bd = d; best = i; }
  }
  setZoomPx(CAM_PRESETS[(best + 1) % CAM_PRESETS.length]);
}

function resetCamera() {
  cam.target = CAM_ROCKET_PX / ROCKET_H;   // pixels per meter
  cam.zoom = cam.target;
  cam.x = 0;
  cam.y = 0;
}

function updateCamera() {
  cam.x = sim.x;                           // locked on the rocket
  cam.y = sim.y;
  const r = cam.target / cam.zoom;         // ease toward the target zoom
  cam.zoom = Math.abs(Math.log(r)) < 0.002 ? cam.target : cam.zoom * Math.pow(r, 0.2);
}

function sx(x) { return Wc / 2 + (x - cam.x) * cam.zoom; }
function sy(y) { return Hc * HORIZON - (y - cam.y) * cam.zoom; }