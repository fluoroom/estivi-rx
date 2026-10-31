import {
  BLACK_HZ,
  LEADER_HZ,
  MARTIN_GAP_MS,
  MARTIN_SYNC_MS,
  PD_PORCH_MS,
  PD_SYNC_MS,
  SCOTTIE_GAP_MS,
  SCOTTIE_SYNC_MS,
  SYNC_HZ,
  VIS_ONE_HZ,
  VIS_ZERO_HZ,
  WHITE_HZ,
  avgByte,
  pixelHz,
  rgbToYcc,
} from "../www/js/modes.js";
import { residue } from "../www/js/ax25.js";

export function tone(hz, ms) {
  return { hz, ms };
}

export function render(segs, fs, amp = 0.55) {
  let tEnd = 0;
  let n = 0;
  let phase = 0;
  const totalMs = segs.reduce((sum, seg) => sum + seg.ms, 0);
  const total = Math.round((totalMs * fs) / 1000);
  const out = new Float32Array(total);
  for (const seg of segs) {
    tEnd += seg.ms / 1000;
    const segEnd = Math.min(total, Math.round(tEnd * fs));
    if (!(seg.hz > 0)) {
      while (n < segEnd) out[n++] = 0;
      continue;
    }
    const d = (2 * Math.PI * seg.hz) / fs;
    while (n < segEnd) {
      out[n++] = Math.sin(phase) * amp;
      phase += d;
      if (phase > 1e6) phase %= 2 * Math.PI;
    }
  }
  return out;
}

function scan(segs, values, totalMs) {
  const px = totalMs / values.length;
  for (const v of values) segs.push(tone(pixelHz(v), px));
}

function rowRgb(sample, y, w) {
  const row = [];
  for (let x = 0; x < w; x++) row.push(sample(x, y));
  return row;
}

function rowYcc(sample, y, w) {
  return rowRgb(sample, y, w).map(([r, g, b]) => rgbToYcc(r, g, b));
}

export function visSegments(mode) {
  const segs = [
    tone(LEADER_HZ, 300),
    tone(SYNC_HZ, 10),
    tone(LEADER_HZ, 300),
    tone(SYNC_HZ, 30),
  ];
  let ones = 0;
  for (let bit = 0; bit < 7; bit++) {
    const one = ((mode.vis >> bit) & 1) === 1;
    if (one) ones++;
    segs.push(tone(one ? VIS_ONE_HZ : VIS_ZERO_HZ, 30));
  }
  const parityOne = mode.visOdd ? ones % 2 === 0 : ones % 2 === 1;
  segs.push(tone(parityOne ? VIS_ONE_HZ : VIS_ZERO_HZ, 30));
  segs.push(tone(SYNC_HZ, 30));
  return segs;
}

function lineSegs(mode, sample, line) {
  const w = mode.w;
  const segs = [];
  if (mode.family === "martin" || mode.family === "scottie") {
    let row;
    if (mode.tx === mode.h) row = rowRgb(sample, line, w);
    else {
      const a = rowRgb(sample, 2 * line, w);
      const b = rowRgb(sample, 2 * line + 1, w);
      row = a.map((p, i) => [avgByte(p[0], b[i][0]), avgByte(p[1], b[i][1]), avgByte(p[2], b[i][2])]);
    }
    const ch = (c) => row.map((p) => p[c]);
    if (mode.family === "martin") {
      segs.push(tone(SYNC_HZ, MARTIN_SYNC_MS));
      segs.push(tone(BLACK_HZ, MARTIN_GAP_MS));
      for (const c of [1, 2, 0]) {
        scan(segs, ch(c), mode.scan);
        segs.push(tone(BLACK_HZ, MARTIN_GAP_MS));
      }
    } else {
      segs.push(tone(BLACK_HZ, SCOTTIE_GAP_MS));
      scan(segs, ch(1), mode.scan);
      segs.push(tone(BLACK_HZ, SCOTTIE_GAP_MS));
      scan(segs, ch(2), mode.scan);
      segs.push(tone(SYNC_HZ, SCOTTIE_SYNC_MS));
      segs.push(tone(BLACK_HZ, SCOTTIE_GAP_MS));
      scan(segs, ch(0), mode.scan);
    }
    return segs;
  }
  if (mode.family === "bw") {
    const row = rowYcc(sample, line, w);
    segs.push(tone(SYNC_HZ, mode.bw.sync));
    scan(segs, row.map((p) => p[0]), mode.bw.y);
    return segs;
  }
  if (mode.family === "robot") {
    const r = mode.robot;
    const row = rowYcc(sample, line, w);
    segs.push(tone(SYNC_HZ, r.sync));
    segs.push(tone(BLACK_HZ, r.porch));
    scan(segs, row.map((p) => p[0]), r.y);
    if (r.alternating) {
      const a = rowYcc(sample, line & ~1, w);
      const b = rowYcc(sample, Math.min(mode.h - 1, line | 1), w);
      const c = line % 2 === 0 ? 2 : 1;
      segs.push(tone(line % 2 === 0 ? BLACK_HZ : WHITE_HZ, r.sep));
      segs.push(tone(LEADER_HZ, r.sepPorch));
      scan(segs, a.map((p, i) => avgByte(p[c], b[i][c])), r.c);
    } else {
      segs.push(tone(BLACK_HZ, r.sep));
      segs.push(tone(LEADER_HZ, r.sepPorch));
      scan(segs, row.map((p) => p[2]), r.c);
      segs.push(tone(WHITE_HZ, r.sep));
      segs.push(tone(LEADER_HZ, r.sepPorch));
      scan(segs, row.map((p) => p[1]), r.c);
    }
    return segs;
  }
  const comp = mode.family === "pd" ? mode.pixel * w : mode.scan;
  const a = rowYcc(sample, 2 * line, w);
  const b = rowYcc(sample, 2 * line + 1, w);
  segs.push(tone(SYNC_HZ, PD_SYNC_MS));
  segs.push(tone(BLACK_HZ, PD_PORCH_MS));
  scan(segs, a.map((p) => p[0]), comp);
  if (mode.family === "yoniq") {
    scan(segs, a.map((p) => p[2]), comp);
    scan(segs, a.map((p) => p[1]), comp);
  } else {
    scan(segs, a.map((p, i) => avgByte(p[2], b[i][2])), comp);
    scan(segs, a.map((p, i) => avgByte(p[1], b[i][1])), comp);
  }
  scan(segs, b.map((p) => p[0]), comp);
  return segs;
}

export function sstv(mode, sample, nLines, leadMs = 250) {
  const segs = [tone(0, leadMs), ...visSegments(mode)];
  if (mode.family === "scottie") segs.push(tone(SYNC_HZ, SCOTTIE_SYNC_MS));
  for (let line = 0; line < nLines; line++) segs.push(...lineSegs(mode, sample, line));
  segs.push(tone(0, 500));
  return segs;
}

export function bars(w) {
  const colors = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
  ];
  return (x) => colors[Math.min(3, Math.floor((x * 4) / w))];
}

function address(call, ssid, last, command) {
  const out = [0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0];
  const chars = call.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  for (let i = 0; i < chars.length; i++) out[i] = chars.charCodeAt(i) << 1;
  let b = 0x60 | ((ssid & 0x0f) << 1);
  if (command) b |= 0x80;
  if (last) b |= 0x01;
  out[6] = b;
  return out;
}

function splitCall(call) {
  call = call.trim();
  if (!call) return ["NOCALL", 0];
  const i = call.lastIndexOf("-");
  if (i > 0) {
    const n = Number(call.slice(i + 1));
    const base = call.slice(0, i);
    if (Number.isInteger(n) && n >= 0 && n <= 15 && base.length) {
      const clean = base.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      return [clean || "NOCALL", n];
    }
  }
  const clean = call.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return [clean || "NOCALL", 0];
}

export function frameBytes(info, call) {
  const [base, ssid] = splitCall(call);
  const body = [...address("ESTIVI", 0, false, true), ...address(base, ssid, true, false), 0x03, 0xf0];
  for (const byte of new TextEncoder().encode(info)) body.push(byte);
  const crc = (~residue(body)) & 0xffff;
  body.push(crc & 0xff, (crc >> 8) & 0xff);
  return body;
}

export function ax25Bits(info, call) {
  const bits = [];
  const flag = () => {
    for (let i = 0; i < 8; i++) bits.push(((0x7e >> i) & 1) === 1);
  };
  for (let i = 0; i < 24; i++) flag();
  let ones = 0;
  for (const byte of frameBytes(info, call)) {
    for (let i = 0; i < 8; i++) {
      const one = ((byte >> i) & 1) === 1;
      bits.push(one);
      if (one) {
        ones++;
        if (ones === 5) {
          bits.push(false);
          ones = 0;
        }
      } else ones = 0;
    }
  }
  flag();
  flag();
  flag();
  return bits;
}

export function ax25Segments(info, call) {
  const segs = [];
  let hz = 1200;
  for (const bit of ax25Bits(info, call)) {
    if (!bit) hz = Math.abs(hz - 1200) < 1 ? 2200 : 1200;
    segs.push(tone(hz, 1000 / 1200));
  }
  segs.push(tone(0, 100));
  return segs;
}
