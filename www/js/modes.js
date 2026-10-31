// SSTV mode table copied from estivi-tx crates/core/src/modes.rs and encoder.rs.
// Frequencies and line geometry are the ones that transmitter puts on the air.

export const SYNC_HZ = 1200;
export const BLACK_HZ = 1500;
export const WHITE_HZ = 2300;
export const LEADER_HZ = 1900;
export const VIS_ONE_HZ = 1100;
export const VIS_ZERO_HZ = 1300;

export const MARTIN_SYNC_MS = 4.862;
export const MARTIN_GAP_MS = 0.572;
export const SCOTTIE_SYNC_MS = 9;
export const SCOTTIE_GAP_MS = 1.5;
export const PD_SYNC_MS = 20;
export const PD_PORCH_MS = 2.08;
export const YONIQ_SCAN_MS = 130.88;
export const VIS_HEADER_MS = 300 + 10 + 300 + 30 * 10;

function robot(sync, porch, y, sep, sepPorch, c, alternating) {
  return { sync, porch, y, sep, sepPorch, c, alternating };
}

export const MODES = [
  { short: "M1", name: "Martin M1", family: "martin", vis: 0x2c, visOdd: false, w: 320, h: 256, tx: 256, scan: 146.432 },
  { short: "M2", name: "Martin M2", family: "martin", vis: 0x28, visOdd: false, w: 320, h: 256, tx: 256, scan: 73.216 },
  { short: "M3", name: "Martin M3", family: "martin", vis: 0x24, visOdd: false, w: 320, h: 256, tx: 128, scan: 146.432 },
  { short: "M4", name: "Martin M4", family: "martin", vis: 0x20, visOdd: false, w: 320, h: 256, tx: 128, scan: 73.216 },
  { short: "S1", name: "Scottie S1", family: "scottie", vis: 0x3c, visOdd: false, w: 320, h: 256, tx: 256, scan: 138.24 },
  { short: "S2", name: "Scottie S2", family: "scottie", vis: 0x38, visOdd: false, w: 320, h: 256, tx: 256, scan: 88.064 },
  { short: "SDX", name: "Scottie DX", family: "scottie", vis: 0x4c, visOdd: false, w: 320, h: 256, tx: 256, scan: 345.6 },
  { short: "R24", name: "Robot 24", family: "robot", vis: 0x04, visOdd: false, w: 160, h: 120, tx: 120, robot: robot(6, 2, 92, 3, 1, 46, false) },
  { short: "R36", name: "Robot 36", family: "robot", vis: 0x08, visOdd: false, w: 320, h: 240, tx: 240, robot: robot(9, 3, 88, 4.5, 1.5, 44, true) },
  { short: "R72", name: "Robot 72", family: "robot", vis: 0x0c, visOdd: false, w: 320, h: 240, tx: 240, robot: robot(9, 3, 138, 4.5, 1.5, 69, false) },
  { short: "R12", name: "Robot 12", family: "robot", vis: 0x00, visOdd: false, w: 160, h: 120, tx: 120, robot: robot(7, 3, 60, 2.7, 0.9, 26.4, true) },
  { short: "BW8", name: "Robot 8 B/N", family: "bw", vis: 0x02, visOdd: false, w: 160, h: 120, tx: 120, bw: { sync: 7, y: 59.9 } },
  { short: "BW12", name: "Robot 12 B/N", family: "bw", vis: 0x06, visOdd: false, w: 160, h: 120, tx: 120, bw: { sync: 7, y: 93 } },
  { short: "BW24", name: "Robot 24 B/N", family: "bw", vis: 0x0a, visOdd: false, w: 320, h: 240, tx: 240, bw: { sync: 7, y: 93 } },
  { short: "PD50", name: "PD 50", family: "pd", vis: 0x5d, visOdd: false, w: 320, h: 256, tx: 128, pixel: 0.286 },
  { short: "PD90", name: "PD 90", family: "pd", vis: 0x63, visOdd: false, w: 320, h: 256, tx: 128, pixel: 0.532 },
  { short: "PD120", name: "PD 120", family: "pd", vis: 0x5f, visOdd: false, w: 640, h: 496, tx: 248, pixel: 0.19 },
  { short: "PD160", name: "PD 160", family: "pd", vis: 0x62, visOdd: false, w: 512, h: 400, tx: 200, pixel: 0.382 },
  { short: "PD180", name: "PD 180", family: "pd", vis: 0x60, visOdd: false, w: 640, h: 496, tx: 248, pixel: 0.286 },
  { short: "PD240", name: "PD 240", family: "pd", vis: 0x61, visOdd: false, w: 640, h: 496, tx: 248, pixel: 0.382 },
  { short: "PD290", name: "PD 290", family: "pd", vis: 0x5e, visOdd: false, w: 800, h: 616, tx: 308, pixel: 0.286 },
  { short: "YQ", name: "YoniQ", family: "yoniq", vis: 0x73, visOdd: true, w: 320, h: 256, tx: 128, scan: YONIQ_SCAN_MS },
];

export function modeByShort(short) {
  if (!short) return null;
  const s = String(short).trim();
  return MODES.find((m) => m.short.toLowerCase() === s.toLowerCase()) || null;
}

export function modeByVis(code) {
  const c = code & 0x7f;
  return MODES.find((m) => m.vis === c) || null;
}

export function lineMs(m) {
  switch (m.family) {
    case "martin":
      return MARTIN_SYNC_MS + 4 * MARTIN_GAP_MS + 3 * m.scan;
    case "scottie":
      return SCOTTIE_SYNC_MS + 3 * SCOTTIE_GAP_MS + 3 * m.scan;
    case "robot": {
      const chroma = m.robot.sep + m.robot.sepPorch + m.robot.c;
      return m.robot.sync + m.robot.porch + m.robot.y + (m.robot.alternating ? chroma : 2 * chroma);
    }
    case "bw":
      return m.bw.sync + m.bw.y;
    case "pd":
      return PD_SYNC_MS + PD_PORCH_MS + 4 * m.pixel * m.w;
    case "yoniq":
      return PD_SYNC_MS + PD_PORCH_MS + 4 * m.scan;
    default:
      return 0;
  }
}

export function openingSyncMs(m) {
  switch (m.family) {
    case "martin":
      return MARTIN_SYNC_MS;
    case "scottie":
      return SCOTTIE_SYNC_MS;
    case "robot":
      return m.robot.sync;
    case "bw":
      return m.bw.sync;
    default:
      return PD_SYNC_MS;
  }
}

export function rgbToYcc(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return [y, cb, cr].map((v) => Math.round(Math.min(255, Math.max(0, v))));
}

export function yccToRgb(y, cb, cr) {
  const Cb = cb - 128;
  const Cr = cr - 128;
  let r = y + 1.402 * Cr;
  let g = y - 0.344136 * Cb - 0.714136 * Cr;
  let b = y + 1.772 * Cb;
  const c = (v) => Math.round(Math.min(255, Math.max(0, v)));
  return [c(r), c(g), c(b)];
}

export function pixelHz(v) {
  return BLACK_HZ + ((WHITE_HZ - BLACK_HZ) * v) / 255;
}

export function avgByte(a, b) {
  return Math.ceil((a + b) / 2);
}
