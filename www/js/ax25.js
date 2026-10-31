// 1200 baud Bell 202 UI frames, the way estivi-tx sends them.
// Mark 1200 Hz, space 2200 Hz, NRZI, LSB first, stuffed after five ones.
// A good frame, FCS included, leaves CRC residue 0xF0B8.

const MARKS = new Set(["", "WELCOME", "BUMPER PRE", "BUMPER POST", "BYE"]);

export function residue(data) {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let b = 0; b < 8; b++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
    }
    crc &= 0xffff;
  }
  return crc;
}

function readCall(bytes, off) {
  let s = "";
  for (let i = 0; i < 6; i++) s += String.fromCharCode(bytes[off + i] >> 1);
  const ssid = (bytes[off + 6] >> 1) & 0x0f;
  return { call: s.trim(), ssid };
}

export function parseFrame(bytes) {
  if (bytes.length < 16) return null;
  if (residue(bytes) !== 0xf0b8) return null;
  if ((bytes[13] & 0x01) !== 0x01) return null;
  if (bytes[14] !== 0x03 || bytes[15] !== 0xf0) return null;
  const dest = readCall(bytes, 0);
  if (dest.call !== "ESTIVI") return null;
  const src = readCall(bytes, 7);
  const info = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(16, bytes.length - 2));
  return { dest, src, info };
}

function clip(s, n) {
  s = String(s).replace(/[\r\n]+/g, " ").trim();
  return s.length > n ? s.slice(0, n) : s;
}

function parseDays(s) {
  if (!s) return [];
  return s.split(",").map((d) => d.trim()).filter(Boolean);
}

export function parseEstivi(text) {
  if (!text || !text.startsWith("ESTIVI ")) return null;
  const lines = text.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.length);
  if (!lines.length) return null;
  const head = lines[0];
  if (head.startsWith("ESTIVI MODE ")) {
    const rest = head.slice("ESTIVI MODE ".length).trim();
    const parts = rest.split(/\s+/).filter(Boolean);
    const short = parts[0] || "";
    let mark = "";
    let stamp = "";
    for (const part of parts.slice(1)) {
      if (/^\d{14}$/.test(part)) stamp = part;
      else if (!mark) mark = part;
    }
    return { kind: "mode", short: clip(short, 8), mark: MARKS.has(mark) ? mark : "", stamp };
  }
  if (head !== "ESTIVI 1") return null;
  const out = {
    kind: "info",
    call: "",
    freq: null,
    name: "",
    range: "",
    days: null,
    daysleft: null,
    next: [],
    comment: "",
  };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const sp = line.indexOf(" ");
    const key = sp < 0 ? line : line.slice(0, sp);
    const val = sp < 0 ? "" : line.slice(sp + 1);
    if (key === "FREQ") {
      const n = Number(val);
      if (Number.isFinite(n)) out.freq = n;
    } else if (key === "CALL") out.call = clip(val, 32);
    else if (key === "NAME") out.name = clip(val, 80);
    else if (key === "RANGE") out.range = clip(val, 16);
    else if (key === "DAYS") out.days = parseDays(val);
    else if (key === "DAYSLEFT") {
      const n = Number(val);
      if (Number.isFinite(n)) out.daysleft = n;
    } else if (key === "NEXT") {
      const parts = val.split("|");
      if (parts.length >= 4) {
        const left = Number(parts[3]);
        out.next.push({
          name: clip(parts[0], 80),
          range: clip(parts[1], 16),
          days: parseDays(parts[2]),
          daysleft: Number.isFinite(left) ? left : 0,
        });
      }
    } else if (key === "COMMENT") out.comment = clip(val, 160);
  }
  return out;
}

function destuff(bits) {
  const out = [];
  let ones = 0;
  for (let i = 0; i < bits.length; i++) {
    const b = bits[i];
    if (ones >= 5 && b === 0) {
      ones = 0;
      continue;
    }
    out.push(b);
    ones = b ? ones + 1 : 0;
    if (ones > 6) return null;
  }
  return out;
}

export class Ax25 {
  constructor(fs) {
    this.fs = fs;
    this.spb = fs / 1200;
    this.need = Math.max(3, Math.round(this.spb * 0.18));
    this.onFrame = () => {};
    this.reset();
  }

  reset() {
    this.mark = null;
    this.want = null;
    this.hold = 0;
    this.holdAt = 0;
    this.seen = false;
    this.lastIx = 0;
    this.inFrame = false;
    this.bits = [];
    this.sr = 0;
    this.bad = 0;
  }

  push(sampleIndex, freq) {
    if (!(freq > 0)) {
      this.bad++;
      if (this.bad > this.spb * 3) this.reset();
      return;
    }
    this.bad = 0;
    let mark;
    if (this.mark === null) mark = freq < 1700;
    else if (this.mark) mark = freq < 1780;
    else mark = freq < 1620;
    if (this.mark === null) {
      this.mark = mark;
      this.want = mark;
      this.hold = 1;
      this.holdAt = sampleIndex;
      return;
    }
    if (mark !== this.want) {
      this.want = mark;
      this.hold = 0;
      this.holdAt = sampleIndex;
    }
    this.hold++;
    if (this.hold === this.need && mark !== this.mark) {
      this.mark = mark;
      this._transition(this.holdAt);
    }
  }

  _transition(sampleIndex) {
    if (!this.seen) {
      this.seen = true;
      this.lastIx = sampleIndex;
      this._bit(0);
      return;
    }
    const dt = sampleIndex - this.lastIx;
    this.lastIx = sampleIndex;
    const exact = dt / this.spb;
    const n = Math.round(exact);
    if (n < 1 || n > 14 || Math.abs(exact - n) > 0.42) {
      this.seen = false;
      this.inFrame = false;
      this.bits = [];
      this.sr = 0;
      return;
    }
    for (let i = 0; i < n - 1; i++) this._bit(1);
    this._bit(0);
  }

  _bit(bit) {
    const b = bit ? 1 : 0;
    this.sr = ((this.sr << 1) | b) & 0xff;
    if (this.sr === 0x7e) {
      if (this.inFrame) this._finish(this.bits);
      this.inFrame = true;
      this.bits = [];
      this.sr = 0;
      return;
    }
    if (!this.inFrame) return;
    this.bits.push(b);
  }

  _finish(bits) {
    if (!bits || bits.length <= 7) return;
    const raw = bits.slice(0, bits.length - 7);
    const data = destuff(raw);
    if (!data || data.length < 16 * 8 || data.length % 8 !== 0) return;
    const bytes = new Uint8Array(data.length / 8);
    for (let i = 0; i < bytes.length; i++) {
      let v = 0;
      for (let b = 0; b < 8; b++) if (data[i * 8 + b]) v |= 1 << b;
      bytes[i] = v;
    }
    const frame = parseFrame(bytes);
    if (!frame) return;
    const parsed = parseEstivi(frame.info);
    if (!parsed) return;
    if (!parsed.call && frame.src.call) {
      parsed.call = frame.src.ssid ? `${frame.src.call}-${frame.src.ssid}` : frame.src.call;
    }
    parsed.src = frame.src;
    this.onFrame(parsed);
  }
}
