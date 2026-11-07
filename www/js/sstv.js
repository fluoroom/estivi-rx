import {
  MARTIN_GAP_MS,
  PD_PORCH_MS,
  SCOTTIE_GAP_MS,
  SCOTTIE_SYNC_MS,
  lineMs,
  lossTimeoutMs,
  modeByVis,
  openingSyncMs,
  yccToRgb,
} from "./modes.js";

class Ring {
  constructor(cap) {
    this.b = new Float32Array(cap);
    this.cap = cap;
    this.n = 0;
  }

  push(v) {
    this.b[this.n % this.cap] = v;
    return this.n++;
  }

  get(i) {
    i = Math.floor(i);
    if (i < 0 || i >= this.n || i < this.n - this.cap) return NaN;
    return this.b[i % this.cap];
  }

  avg(a, b) {
    const i0 = Math.ceil(a);
    const i1 = Math.floor(b);
    let s = 0;
    let k = 0;
    for (let i = i0; i < i1; i++) {
      const v = this.get(i);
      if (v >= 900 && v <= 2700) {
        s += v;
        k++;
      }
    }
    return k ? s / k : NaN;
  }
}

class VisHunter {
  constructor(fs) {
    this.fs = fs;
    this.reset();
  }

  ms(n) {
    return Math.round((n * this.fs) / 1000);
  }

  reset() {
    this.state = "seek";
    this.n = 0;
    this.bad = 0;
  }

  push(i, f) {
    const leader = f >= 1650 && f <= 2150;
    const sync = f >= 1000 && f <= 1400;
    if (this.state === "seek") {
      if (leader) {
        this.n++;
        this.bad = 0;
      } else if (this.n >= this.ms(70) && sync) {
        this.state = "brk";
        this.n = 1;
        this.bad = 0;
      } else {
        this.bad++;
        if (this.bad > this.ms(8)) {
          this.n = 0;
          this.bad = 0;
        }
      }
      return null;
    }
    if (this.state === "brk") {
      // The 10 ms break rings for a sample or two after AFSK, so a lone
      // out-of-band reading must not throw the header away.
      if (sync) {
        this.n++;
        this.bad = 0;
        if (this.n > this.ms(22)) {
          this.state = "seek";
          this.n = 0;
        }
      } else if (leader) {
        if (this.n >= this.ms(4) && this.n <= this.ms(20)) {
          this.state = "lead2";
          this.n = 1;
          this.bad = 0;
        } else {
          this.state = "seek";
          this.n = 1;
          this.bad = 0;
        }
      } else {
        this.bad++;
        if (this.bad > this.ms(2)) {
          this.state = "seek";
          this.n = 0;
          this.bad = 0;
        }
      }
      return null;
    }
    if (leader) {
      this.n++;
      this.bad = 0;
      if (this.n > this.ms(420)) {
        this.state = "seek";
        this.n = 0;
      }
    } else if (sync && this.n >= this.ms(190) && this.n <= this.ms(400)) {
      this.state = "seek";
      this.n = 0;
      this.bad = 0;
      return i;
    } else {
      this.bad++;
      if (this.bad > this.ms(12)) {
        this.state = "seek";
        this.n = 0;
        this.bad = 0;
      }
    }
    return null;
  }
}

// Finds the line sync of one known mode without a VIS header. Four pulses at
// the mode's line spacing are enough to know a picture is really there; a lone
// pulse in noise or AX.25 is not.
class SyncHunter {
  constructor(fs, mode) {
    this.fs = fs;
    this.mode = mode;
    this.reset();
  }

  ms(n) {
    return Math.round((n * this.fs) / 1000);
  }

  reset() {
    this.on = false;
    this.start = 0;
    this.pulses = [];
  }

  push(i, f) {
    const sync = f >= 1000 && f <= 1400;
    if (sync) {
      if (!this.on) {
        this.on = true;
        this.start = i;
      }
      return null;
    }
    if (!this.on) return null;
    this.on = false;
    const width = i - this.start;
    const want = this.ms(openingSyncMs(this.mode));
    const widthTol = Math.max(this.ms(1.5), want * 0.45);
    if (Math.abs(width - want) > widthTol) return null;
    this.pulses.push({ start: this.start, end: i });
    if (this.pulses.length > 5) this.pulses.shift();
    return this.detect();
  }

  detect() {
    if (this.pulses.length < 4) return null;
    const period = this.ms(lineMs(this.mode));
    const tol = Math.max(this.ms(1.5), period * 0.015);
    const p = this.pulses;
    const a = p[p.length - 4];
    const b = p[p.length - 3];
    const c = p[p.length - 2];
    const d = p[p.length - 1];
    if (Math.abs(b.start - a.start - period) > tol) return null;
    if (Math.abs(c.start - b.start - period) > tol) return null;
    if (Math.abs(d.start - c.start - period) > tol) return null;
    return { first: a, last: d };
  }
}

function parityMatches(mode, code, parity) {
  let ones = parity ? 1 : 0;
  for (let i = 0; i < 7; i++) if ((code >> i) & 1) ones++;
  const odd = ones % 2 === 1;
  return mode.visOdd ? odd : !odd;
}

function fToByte(f) {
  if (!(f > 0)) return 0;
  const v = ((f - 1500) * 255) / 800;
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.round(v);
}

export class Sstv {
  constructor(fs) {
    this.fs = fs;
    this.ring = new Ring(Math.ceil(fs * 8));
    this.hunter = new VisHunter(fs);
    this.phase = "hunt";
    this.forced = null;
    this.lastMode = null;
    this.emit = () => {};
    this.lastTones = null;
    this.started = false;
    this.mode = null;
    this.buf = null;
    this.line = 0;
    this.parity = 0;
    this.startedMid = false;
    this.now = 0;
    this.midMode = null;
    this.midHunter = null;
    this.syncHunter = null;
    this.lostAt = 0;
    this.lostLine = 0;
    this.lostExpect = 0;
    this.lossSamples = 0;
  }

  setForced(mode) {
    if (this.forced === mode) return;
    this.forced = mode;
    this.midMode = null;
    this.midHunter = null;
  }

  setLastMode(mode) {
    if (this.lastMode === mode) return;
    this.lastMode = mode;
    this.midMode = null;
    this.midHunter = null;
  }

  samp(ms) {
    return (ms * this.fs) / 1000;
  }

  sample(_t, f) {
    const i = this.ring.push(f);
    this.now = i;
    if (this.phase === "hold") {
      this.pumpHold(i, f);
      return;
    }
    if (this.startedMid && (this.phase === "body" || this.phase === "seek" || this.phase === "scottie")) {
      const edge = this.hunter.push(i, f);
      if (edge != null) {
        // A new picture replaces this partial one. Save it and go live.
        this.finish(false, true);
        this.visEdge = edge;
        this.phase = "vis";
        return;
      }
    }
    if (this.phase !== "hunt") return;
    const edge = this.hunter.push(i, f);
    if (edge != null) {
      this.visEdge = edge;
      this.phase = "vis";
      return;
    }
    const mode = this.forced || this.lastMode;
    if (!mode) {
      this.midMode = null;
      this.midHunter = null;
      return;
    }
    if (this.midMode !== mode) {
      this.midMode = mode;
      this.midHunter = new SyncHunter(this.fs, mode);
    }
    const found = this.midHunter.push(i, f);
    if (found) this.startMid(found.first);
  }

  endBlock() {
    for (let n = 0; n < 400; n++) {
      if (!this.pumpOne()) break;
    }
  }

  pumpOne() {
    if (this.phase === "hunt") return false;
    if (this.phase === "vis") return this.pumpVis();
    if (this.phase === "lock") return this.pumpLock();
    if (this.phase === "body") return this.pumpBody();
    if (this.phase === "seek") return this.pumpSeek();
    if (this.phase === "scottie") return this.pumpScottie();
    if (this.phase === "hold") return false;
    return false;
  }

  pumpVis() {
    if (this.ring.n < this.visEdge + this.samp(308)) return false;
    const got = this.readVis(this.visEdge);
    if (!got) return this.giveUp();
    const fromVis = modeByVis(got.code);
    let mode = null;
    if (this.forced) mode = this.forced;
    else if (fromVis && parityMatches(fromVis, got.code, got.parity)) mode = fromVis;
    if (!mode) return this.giveUp();
    this.mode = mode;
    this.lastMode = mode;
    this.line = 0;
    this.miss = 0;
    this.parity = 0;
    this.startedMid = false;
    this.hunter.reset();
    this.started = false;
    this.buf = new Uint8ClampedArray(mode.w * mode.h * 4);
    for (let p = 3; p < this.buf.length; p += 4) this.buf[p] = 255;
    this.cr = null;
    this.yEven = null;
    this.syncEnd = null;
    this.midMode = null;
    this.midHunter = null;
    this.visEnd = this.visEdge + this.samp(300);
    this.phase = "lock";
    return true;
  }

  giveUp() {
    this.phase = "hunt";
    this.hunter.reset();
    this.mode = null;
    this.startedMid = false;
    this.midMode = null;
    this.midHunter = null;
    return false;
  }

  readVis(edge) {
    const bit = this.samp(30);
    const tones = [];
    for (let n = 0; n < 10; n++) {
      const c = edge + (n + 0.5) * bit;
      const w = bit * 0.22;
      tones.push(this.ring.avg(c - w, c + w));
    }
    this.lastTones = tones;
    if (!(Math.abs(tones[0] - 1200) < 180)) return null;
    if (!(Math.abs(tones[9] - 1200) < 180)) return null;
    let code = 0;
    for (let b = 0; b < 7; b++) if (tones[1 + b] < 1200) code |= 1 << b;
    const parity = tones[8] < 1200 ? 1 : 0;
    return { code, parity };
  }

  robotParity(syncEnd) {
    const r = this.mode.robot;
    const at = syncEnd + this.samp(r.porch + r.y + r.sep * 0.5);
    const f = this.ring.avg(at - this.samp(0.6), at + this.samp(0.6));
    return Number.isFinite(f) && f > 1900;
  }

  startMid(first) {
    const mode = this.midMode;
    if (!mode) return false;
    this.mode = mode;
    this.line = 0;
    this.miss = 0;
    this.parity = 0;
    this.started = false;
    this.startedMid = true;
    this.buf = new Uint8ClampedArray(mode.w * mode.h * 4);
    for (let p = 3; p < this.buf.length; p += 4) this.buf[p] = 255;
    this.cr = null;
    this.yEven = null;
    this.syncEnd = first.end;
    this.midMode = null;
    this.midHunter = null;
    this.hunter.reset();
    if (mode.family === "robot" && mode.robot.alternating) {
      this.parity = this.robotParity(first.end) ? 1 : 0;
    }
    if (mode.family === "scottie") {
      this.phase = "scottie";
      this.decodeScottie(first.end);
      this.line = 1;
      this.syncEnd = first.end;
    } else {
      this.phase = "body";
    }
    return true;
  }

  enterHold(expect) {
    const mode = this.mode;
    if (!mode) return this.giveUp();
    this.phase = "hold";
    // Time the lost picture from the first missing sync, not from the point
    // where the decoder has given up on it.
    this.lostAt = expect;
    this.lostLine = this.line;
    this.lostExpect = expect;
    this.lossSamples = this.samp(lossTimeoutMs(mode));
    if (!this.startedMid) this.hunter.reset();
    this.syncHunter = new SyncHunter(this.fs, mode);
    this.miss = 0;
    return false;
  }

  pumpHold(i, f) {
    const edge = this.hunter.push(i, f);
    if (edge != null) {
      // A new picture arrived while this one was lost. Save what was heard
      // and let the visor go back to live for the new one.
      this.finish(false, true);
      this.visEdge = edge;
      this.phase = "vis";
      return;
    }
    const found = this.syncHunter ? this.syncHunter.push(i, f) : null;
    if (found) {
      this.resumeFrom(found.first);
      return;
    }
    if (i - this.lostAt >= this.lossSamples) this.finish(false, true);
  }

  resumeFrom(first) {
    const mode = this.mode;
    if (!mode) {
      this.finish(false, true);
      return;
    }
    const period = this.samp(lineMs(mode));
    const skipped = Math.max(0, Math.round((first.end - this.lostExpect) / period));
    const line = this.lostLine + skipped;
    if (line >= mode.tx) {
      this.finish(false, true);
      return;
    }
    this.line = line;
    this.miss = 0;
    this.cr = null;
    this.yEven = null;
    this.syncEnd = first.end;
    this.syncHunter = null;
    if (mode.family === "scottie") {
      this.phase = "scottie";
      this.decodeScottie(first.end);
      this.line = line + 1;
      this.syncEnd = first.end;
    } else {
      this.phase = "body";
    }
  }

  pumpLock() {
    const expect = this.visEnd + this.samp(openingSyncMs(this.mode));
    const radius = this.samp(28);
    if (this.ring.n < expect + radius) return false;
    const edge = this.findRisingEdge(expect, radius);
    if (edge == null) return this.giveUp();
    if (this.mode.family === "scottie") {
      this.lineStart = edge;
      this.syncEnd = null;
      this.phase = "scottie";
    } else {
      this.syncEnd = edge;
      this.phase = "body";
    }
    return true;
  }

  pumpBody() {
    const period = this.samp(lineMs(this.mode));
    const sync = this.samp(openingSyncMs(this.mode));
    if (this.ring.n < this.syncEnd + (period - sync)) return false;
    this.decodeFromSync(this.syncEnd);
    this.line++;
    if (this.line >= this.mode.tx) {
      this.finish(true);
      return false;
    }
    this.expect = this.syncEnd + period;
    this.phase = "seek";
    return true;
  }

  pumpSeek() {
    const radius = this.samp(14);
    const tail = this.samp(36);
    if (this.ring.n < this.expect + tail) return false;
    if (this.mostlyClosed(this.expect + this.samp(4), this.expect + tail)) {
      return this.enterHold(this.expect);
    }
    const edge = this.findRisingEdge(this.expect, radius);
    if (edge == null) {
      this.miss++;
      this.syncEnd = this.expect;
      if (this.miss >= 2) return this.enterHold(this.expect);
    } else {
      this.miss = 0;
      this.syncEnd = edge;
    }
    this.phase = "body";
    return true;
  }

  pumpScottie() {
    const scan = this.samp(this.mode.scan);
    const gap = this.samp(SCOTTIE_GAP_MS);
    const sync = this.samp(SCOTTIE_SYNC_MS);
    const period = this.samp(lineMs(this.mode));
    const expect = this.syncEnd == null ? this.lineStart + gap + scan + gap + scan + sync : this.syncEnd + period;
    const radius = this.samp(16);
    if (this.ring.n < expect + radius + gap + scan) return false;
    if (this.line > 0 && this.mostlyClosed(expect + this.samp(4), expect + this.samp(30))) {
      return this.enterHold(expect);
    }
    let edge = this.findRisingEdge(expect, radius);
    if (edge == null) {
      if (this.line === 0) return this.giveUp();
      this.miss++;
      edge = expect;
      if (this.miss >= 2) return this.enterHold(expect);
    } else this.miss = 0;
    this.decodeScottie(edge);
    this.syncEnd = edge;
    this.line++;
    if (this.line >= this.mode.tx) {
      this.finish(true);
      return false;
    }
    return true;
  }

  findRisingEdge(expect, radius) {
    const from = Math.floor(expect - radius);
    const to = Math.floor(expect + radius);
    const win = Math.max(2, Math.round(this.fs * 0.0007));
    const sync = this.samp(openingSyncMs(this.mode));
    const guard = Math.max(2, Math.round(this.fs * 0.0005));
    let best = null;
    let bestDist = Infinity;
    for (let i = from; i <= to; i += 2) {
      const before = this.ring.avg(i - win * 2, i - 1);
      const after = this.ring.avg(i + 1, i + win);
      if (!(before < 1420 && after > 1465)) continue;
      // The edge must end a real 1200 Hz sync pulse, not just any step in noise.
      const pulse = this.ring.avg(i - sync + guard, i - guard);
      if (!(pulse >= 1000 && pulse <= 1400)) continue;
      const dist = Math.abs(i - expect);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  mostlyClosed(a, b) {
    let bad = 0;
    let n = 0;
    const step = Math.max(1, Math.round(this.fs / 3000));
    for (let i = Math.floor(a); i < b; i += step) {
      n++;
      if (!(this.ring.get(i) >= 900)) bad++;
    }
    return n > 0 && bad / n > 0.65;
  }

  readLevels(start, durMs) {
    const w = this.mode.w;
    const n = this.samp(durMs);
    const out = new Uint8Array(w);
    for (let x = 0; x < w; x++) {
      const a = start + (x / w) * n;
      const b = start + ((x + 1) / w) * n;
      const trim = (b - a) * 0.12;
      let a2 = a + trim;
      let b2 = b - trim;
      if (b2 - a2 < 2) {
        a2 = a;
        b2 = b;
      }
      out[x] = fToByte(this.ring.avg(a2, b2));
    }
    return out;
  }

  decodeFromSync(syncEnd) {
    const m = this.mode;
    if (m.family === "martin") {
      const gap = this.samp(MARTIN_GAP_MS);
      let t = syncEnd + gap;
      const G = this.readLevels(t, m.scan);
      t += this.samp(m.scan) + gap;
      const B = this.readLevels(t, m.scan);
      t += this.samp(m.scan) + gap;
      const R = this.readLevels(t, m.scan);
      this.paintRgb(this.line, R, G, B);
      return;
    }
    if (m.family === "bw") {
      const Y = this.readLevels(syncEnd, m.bw.y);
      this.paintGray(this.line, Y);
      return;
    }
    if (m.family === "robot") {
      const r = m.robot;
      let t = syncEnd + this.samp(r.porch);
      const Y = this.readLevels(t, r.y);
      t += this.samp(r.y + r.sep + r.sepPorch);
      const c0 = this.readLevels(t, r.c);
      if (r.alternating) {
        if (((this.line + this.parity) & 1) === 0) {
          this.cr = c0;
          this.yEven = Y;
          this.paintGray(this.line, Y);
        } else if (this.cr && this.yEven) {
          this.paintYcc(this.line - 1, this.yEven, c0, this.cr);
          this.paintYcc(this.line, Y, c0, this.cr);
          this.emitRows(this.line - 1, 2);
        } else this.paintGray(this.line, Y);
      } else {
        t += this.samp(r.c + r.sep + r.sepPorch);
        const cb = this.readLevels(t, r.c);
        this.paintYcc(this.line, Y, cb, c0);
        this.emitRows(this.line, 1);
      }
      return;
    }
    const compMs = m.family === "pd" ? m.pixel * m.w : m.scan;
    let t = syncEnd + this.samp(PD_PORCH_MS);
    const y0 = this.readLevels(t, compMs);
    t += this.samp(compMs);
    const cr = this.readLevels(t, compMs);
    t += this.samp(compMs);
    const cb = this.readLevels(t, compMs);
    t += this.samp(compMs);
    const y1 = this.readLevels(t, compMs);
    const row = this.line * 2;
    this.paintYcc(row, y0, cb, cr);
    this.paintYcc(row + 1, y1, cb, cr);
    this.emitRows(row, 2);
  }

  decodeScottie(edge) {
    const scan = this.mode.scan;
    const gap = this.samp(SCOTTIE_GAP_MS);
    const sync = this.samp(SCOTTIE_SYNC_MS);
    const scanS = this.samp(scan);
    const syncStart = edge - sync;
    const bStart = syncStart - scanS;
    const gStart = bStart - gap - scanS;
    const rStart = edge + gap;
    const G = this.readLevels(gStart, scan);
    const B = this.readLevels(bStart, scan);
    const R = this.readLevels(rStart, scan);
    this.paintRgb(this.line, R, G, B);
  }

  paintRgb(txLine, R, G, B) {
    const rep = this.mode.h / this.mode.tx;
    const y0 = txLine * rep;
    const w = this.mode.w;
    for (let k = 0; k < rep; k++) {
      const row = (y0 + k) * w * 4;
      for (let x = 0; x < w; x++) {
        const o = row + x * 4;
        this.buf[o] = R[x];
        this.buf[o + 1] = G[x];
        this.buf[o + 2] = B[x];
      }
    }
    this.emitRows(y0, rep);
  }

  paintGray(y, Y) {
    const w = this.mode.w;
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      const o = row + x * 4;
      this.buf[o] = this.buf[o + 1] = this.buf[o + 2] = Y[x];
    }
    this.emitRows(y, 1);
  }

  paintYcc(y, Y, Cb, Cr) {
    const w = this.mode.w;
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = yccToRgb(Y[x], Cb[x], Cr[x]);
      const o = row + x * 4;
      this.buf[o] = r;
      this.buf[o + 1] = g;
      this.buf[o + 2] = b;
    }
  }

  emitRows(y, count) {
    if (!this.started) {
      this.started = true;
      this.emit({
        type: "rx",
        mode: this.mode.short,
        modeName: this.mode.name,
        width: this.mode.w,
        height: this.mode.h,
      });
    }
    const w = this.mode.w;
    const bytes = w * 4;
    this.emit({
      type: "rows",
      y,
      count,
      width: w,
      rgba: this.buf.slice(y * bytes, (y + count) * bytes),
    });
  }

  finish(complete, lost = false) {
    const started = this.started;
    const buf = this.buf;
    const mode = this.mode;
    const lines = this.line;
    const timedOut = Boolean(lost);
    this.phase = "hunt";
    this.hunter.reset();
    this.started = false;
    this.mode = null;
    this.buf = null;
    this.parity = 0;
    this.startedMid = false;
    this.midMode = null;
    this.midHunter = null;
    this.syncHunter = null;
    this.miss = 0;
    if (!started || !buf || !mode) return;
    this.emit({
      type: "rx-end",
      complete: Boolean(complete) && lines >= mode.tx,
      lost: timedOut,
      width: mode.w,
      height: mode.h,
      mode: mode.short,
      modeName: mode.name,
      rgba: buf,
      lines,
    });
  }
}
