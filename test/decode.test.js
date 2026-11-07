import assert from "node:assert/strict";
import test from "node:test";
import { residue } from "../www/js/ax25.js";
import { Engine } from "../www/js/engine.js";
import { Demod } from "../www/js/dsp.js";
import { BLACK_HZ, lineMs, lossTimeoutMs, modeByShort, rgbToYcc } from "../www/js/modes.js";
import {
  ax25Segments,
  bars,
  frameBytes,
  noise,
  pictureSegments,
  render,
  sstv,
  visSegments,
} from "./synth.js";

function pixel(rgba, w, x, y) {
  const i = (y * w + x) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2]];
}

function rowRgba(ev, y) {
  for (const e of ev) {
    if (e.type !== "rows" || y < e.y || y >= e.y + e.count) continue;
    const off = (y - e.y) * e.width * 4;
    return e.rgba.subarray(off, off + e.width * 4);
  }
  return null;
}

// A synthetic picture is usually shorter than the mode's full frame. Give
// the decoder its lost-signal time with -1 (no tone) so the short picture
// still ends and can be checked.
function quiet(eng, fs, ms) {
  const n = Math.round((ms * fs) / 1000);
  const chunk = new Float32Array(Math.min(4096, Math.max(1, n))).fill(-1);
  for (let i = 0; i < n; i += chunk.length) {
    eng.pushFreq(chunk.subarray(0, Math.min(chunk.length, n - i)));
  }
}

function settle(eng, fs) {
  const mode = eng.sstv.mode;
  if (!mode) return;
  quiet(eng, fs, lossTimeoutMs(mode) + 200);
}

function feed(fs, audio, opts = {}) {
  const eng = new Engine(fs);
  if (opts.lastMode) eng.setLastMode(opts.lastMode);
  if (opts.mode) eng.setMode(opts.mode);
  const ev = [];
  eng.onEvent = (e) => {
    if (e.type !== "rows" || opts.rows) ev.push(e);
  };
  const chunk = 4096;
  for (let i = 0; i < audio.length; i += chunk) eng.push(audio.subarray(i, Math.min(audio.length, i + chunk)));
  eng.push(new Float32Array(Math.round(fs * 0.35)));
  if (opts.settle !== false) settle(eng, fs);
  return { ev, eng };
}

function run(fs, segs, opts = {}) {
  return feed(fs, render(segs, fs, opts.amp), opts);
}

test("demod recovers the SSTV and AFSK tones", () => {
  const fs = 48000;
  const tones = [1100, 1200, 1300, 1500, 1900, 2200, 2300];
  const segs = [{ hz: 0, ms: 30 }];
  for (const hz of tones) segs.push({ hz, ms: 80 });
  const audio = render(segs, fs, 0.5);
  const demod = new Demod(fs);
  const freq = demod.processBlock(audio);
  for (let i = 0; i < tones.length; i++) {
    const center = Math.round(((30 + i * 80 + 40) * fs) / 1000);
    let s = 0;
    let n = 0;
    for (let k = center - 200; k < center + 200; k++) {
      if (freq[k] > 0) {
        s += freq[k];
        n++;
      }
    }
    const got = s / n;
    assert.ok(Math.abs(got - tones[i]) < 25, `${tones[i]} Hz decoded as ${got.toFixed(1)} (${n} samples)`);
  }
});

test("published line times", () => {
  const cases = [
    ["M1", 446.446],
    ["M2", 226.798],
    ["S1", 428.22],
    ["S2", 277.692],
    ["SDX", 1050.3],
    ["R36", 150],
    ["R72", 300],
    ["R24", 200],
    ["BW8", 66.9],
    ["BW12", 100],
    ["PD50", 388.16],
    ["PD90", 703.04],
    ["PD120", 508.48],
    ["PD160", 804.416],
    ["PD180", 754.24],
    ["PD240", 1000],
    ["PD290", 937.28],
    ["YQ", 545.6],
  ];
  for (const [short, expected] of cases) {
    const got = lineMs(modeByShort(short));
    assert.ok(Math.abs(got - expected) < 1e-3, `${short}: ${got} != ${expected}`);
  }
});

function checkBars(mode, rgba, y, tol) {
  const sample = bars(mode.w);
  for (let q = 0; q < 4; q++) {
    const x = Math.floor(((q + 0.5) * mode.w) / 4);
    const wantRgb = sample(x);
    let want = wantRgb;
    if (mode.family === "bw") {
      const yv = rgbToYcc(wantRgb[0], wantRgb[1], wantRgb[2])[0];
      want = [yv, yv, yv];
    }
    const got = pixel(rgba, mode.w, x, y);
    for (let c = 0; c < 3; c++) {
      assert.ok(
        Math.abs(got[c] - want[c]) <= tol,
        `${mode.short} y${y} x${x} ch${c}: got ${got.join(",")} want ${want.join(",")}`,
      );
    }
  }
}

const pictureCases = [
  ["M1", 48000],
  ["M1", 44100],
  ["M3", 48000],
  ["S1", 48000],
  ["R36", 48000],
  ["R72", 48000],
  ["R12", 48000],
  ["BW8", 48000],
  ["BW8", 44100],
  ["PD50", 48000],
  ["YQ", 48000],
];

for (const [short, fs] of pictureCases) {
  test(`${short} at ${fs}`, () => {
    const mode = modeByShort(short);
    const { ev, eng } = run(fs, sstv(mode, bars(mode.w), 4));
    const rx = ev.find((e) => e.type === "rx");
    const end = ev.find((e) => e.type === "rx-end");
    if (!rx || !end) {
      assert.fail(`no picture. phase=${eng.sstv.phase} tones=${JSON.stringify(eng.sstv.lastTones)} events=${ev.map((e) => e.type).join(",")}`);
    }
    assert.equal(rx.mode, short);
    assert.equal(end.width, mode.w);
    assert.equal(end.height, mode.h);
    const y = mode.family === "pd" || mode.family === "yoniq" ? 2 : mode.family === "martin" && mode.tx !== mode.h ? 2 : 2;
    checkBars(mode, end.rgba, y, 16);
    if (mode.short === "M3") {
      const a = pixel(end.rgba, mode.w, 40, 2);
      const b = pixel(end.rgba, mode.w, 40, 3);
      assert.deepEqual(a, b);
    }
  });
}

test("AX.25 frame bytes match the FCS residue", () => {
  const info = "ESTIVI 1\nCALL LU1ABC\nNAME ~~~~Test\n";
  const frame = frameBytes(info, "LU1ABC-7");
  assert.equal(residue(frame), 0xf0b8);
  const dest = String.fromCharCode(...frame.slice(0, 6).map((b) => b >> 1)).trim();
  assert.equal(dest, "ESTIVI");
  assert.equal(frame[14], 0x03);
  assert.equal(frame[15], 0xf0);
  assert.equal(frame[13] & 0x1f, (7 << 1) | 0x01);
});

function feedPacket(fs, info, call) {
  const segs = [{ hz: 0, ms: 200 }, ...ax25Segments(info, call), { hz: 0, ms: 80 }];
  return run(fs, segs);
}

test("AX.25 info and mode frames decode at 48000 and 44100", () => {
  const info =
    "ESTIVI 1\nFREQ 145825000\nCALL LU1ABC\nNAME Noticias\nRANGE 14:00-14:30\nDAYS Mon,Tue,Wed,Thu,Fri\nDAYSLEFT 12\n" +
    "NEXT Noticias|14:00-14:30|Mon,Tue,Wed,Thu,Fri|12\nNEXT Clima|18:00-18:15|Sat,Sun|0\nNEXT Noche en 80 m|21:00-23:30||0\n";
  for (const fs of [48000, 44100]) {
    const { ev } = feedPacket(fs, info, "LU1ABC-7");
    const pkt = ev.find((e) => e.type === "info");
    assert.ok(pkt, `no info frame at ${fs}: ${ev.map((e) => e.type).join(",")}`);
    assert.equal(pkt.packet.call, "LU1ABC");
    assert.equal(pkt.packet.name, "Noticias");
    assert.equal(pkt.packet.daysleft, 12);
    assert.equal(pkt.packet.next.length, 3);
    assert.equal(pkt.packet.next[2].name, "Noche en 80 m");
    assert.deepEqual(pkt.packet.next[2].days, []);
    assert.equal(pkt.packet.next[2].daysleft, 0);
  }
  const stuffed = feedPacket(48000, "ESTIVI 1\nCALL LU1ABC\nNAME ~~~~Test\n", "LU1ABC");
  const name = stuffed.ev.find((e) => e.type === "info");
  assert.ok(name, "stuffed frame dropped");
  assert.equal(name.packet.name, "~~~~Test");
  const mode = feedPacket(48000, "ESTIVI MODE R36 WELCOME\n", "LU1ABC");
  const mark = mode.ev.find((e) => e.type === "mode");
  assert.ok(mark, "mode frame dropped");
  assert.equal(mark.short, "R36");
  assert.equal(mark.mark, "WELCOME");
});

test("a mode frame names the following picture", () => {
  const mode = modeByShort("BW8");
  const segs = [
    { hz: 0, ms: 150 },
    ...ax25Segments("ESTIVI 1\nCALL LU1AQY\nNAME Noticias\nRANGE 21:00-22:00\nDAYS Fri\nDAYSLEFT 4\n", "LU1AQY"),
    { hz: 0, ms: 40 },
    ...ax25Segments("ESTIVI MODE BW8 WELCOME\n", "LU1AQY"),
    { hz: 0, ms: 40 },
    ...sstv(mode, bars(mode.w), 3, 40),
  ];
  const { ev } = run(48000, segs);
  const end = ev.find((e) => e.type === "rx-end");
  assert.ok(end, `events ${ev.map((e) => e.type).join(",")}`);
  assert.equal(end.name, "Noticias · Welcome");
  assert.equal(end.mode, "BW8");
});

test("a -35 dB signal keeps the packet and the picture", () => {
  const fs = 48000;
  const mode = modeByShort("BW8");
  const segs = [
    { hz: 0, ms: 200 },
    ...ax25Segments("ESTIVI 1\nCALL LU1ABC\nNAME Noticias\nRANGE 14:00-14:30\nDAYS Mon\nDAYSLEFT 4\n", "LU1ABC"),
    { hz: 0, ms: 40 },
    ...ax25Segments("ESTIVI MODE BW8 WELCOME\n", "LU1ABC"),
    { hz: 0, ms: 40 },
    ...sstv(mode, bars(mode.w), 3, 40),
  ];
  const clean = render(segs, fs, 10 ** (-35 / 20) * Math.SQRT2);
  let state = 7;
  const rnd = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
  const gauss = () => {
    const u = Math.max(1e-12, rnd());
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const noise = 10 ** (-55 / 20);
  const audio = Float32Array.from(clean, (x) => x + gauss() * noise);
  const { ev } = feed(fs, audio);
  const info = ev.find((e) => e.type === "info");
  const end = ev.find((e) => e.type === "rx-end");
  assert.ok(info, `events ${ev.map((e) => e.type).join(",")}`);
  assert.equal(info.packet.name, "Noticias");
  assert.ok(end, "picture dropped");
  assert.equal(end.name, "Noticias · Welcome");
  checkBars(mode, end.rgba, 2, 16);
});

test("a manual mode starts a picture mid-image without a VIS", () => {
  const fs = 48000;
  const mode = modeByShort("BW8");
  const segs = [
    { hz: 0, ms: 250 },
    ...pictureSegments(mode, bars(mode.w), 40, 12),
    { hz: 0, ms: 500 },
  ];
  const { ev, eng } = run(fs, segs, { mode: "BW8", rows: true, settle: false });
  const rx = ev.find((e) => e.type === "rx");
  assert.ok(rx, `no mid-image picture: phase=${eng.sstv.phase}`);
  assert.equal(rx.mode, "BW8");
  const row = ev.find((e) => e.type === "rows" && e.y === 0);
  assert.ok(row, "row 0 was not decoded");
  checkBars(mode, row.rgba, 0, 16);
});

test("auto starts mid-image only when a last mode is remembered", () => {
  const fs = 48000;
  const mode = modeByShort("BW8");
  const segs = [
    { hz: 0, ms: 250 },
    ...pictureSegments(mode, bars(mode.w), 40, 12),
    { hz: 0, ms: 500 },
  ];
  const none = run(fs, segs, { rows: true, settle: false });
  assert.equal(none.ev.find((e) => e.type === "rx"), undefined, "started with no mode");
  const some = run(fs, segs, { lastMode: "BW8", rows: true, settle: false });
  assert.ok(some.ev.find((e) => e.type === "rx"), "remembered mode did not start");
});

test("a short loss resumes the picture at its true row", () => {
  const fs = 48000;
  const mode = modeByShort("BW8");
  const gapLines = 10;
  const segs = [
    { hz: 0, ms: 250 },
    ...visSegments(mode),
    ...pictureSegments(mode, bars(mode.w), 0, 30),
    { hz: BLACK_HZ, ms: gapLines * lineMs(mode) },
    ...pictureSegments(mode, bars(mode.w), 40, 20),
    { hz: 0, ms: 500 },
  ];
  const { ev, eng } = run(fs, segs, { rows: true, settle: false });
  assert.ok(ev.find((e) => e.type === "rx"), "picture did not start");
  assert.equal(ev.find((e) => e.type === "rx-end"), undefined, "short loss ended the picture");
  const row = ev.find((e) => e.type === "rows" && e.y === 40);
  assert.ok(row, `row 40 missing: phase=${eng.sstv.phase} line=${eng.sstv.line}`);
  checkBars(mode, row.rgba, 0, 16);
});

test("a long loss ends the partial picture and flags it", () => {
  const fs = 48000;
  const mode = modeByShort("BW8");
  const segs = [
    { hz: 0, ms: 250 },
    ...visSegments(mode),
    ...pictureSegments(mode, bars(mode.w), 0, 5),
    { hz: BLACK_HZ, ms: lossTimeoutMs(mode) + 1000 },
  ];
  const { ev, eng } = run(fs, segs, { rows: true, settle: false });
  const end = ev.find((e) => e.type === "rx-end");
  assert.ok(end, `no timeout end: phase=${eng.sstv.phase}`);
  assert.equal(end.lost, true);
  assert.equal(end.complete, false);
  assert.ok(end.lines >= 5, `only ${end.lines} lines`);
  checkBars(mode, end.rgba, 0, 16);
});

test("a VIS during a loss ends the partial picture and starts the next one", () => {
  const fs = 48000;
  const mode = modeByShort("BW8");
  const segs = [
    { hz: 0, ms: 250 },
    ...visSegments(mode),
    ...pictureSegments(mode, bars(mode.w), 0, 5),
    { hz: BLACK_HZ, ms: 800 },
    ...visSegments(mode),
    ...pictureSegments(mode, bars(mode.w), 0, 5),
    { hz: 0, ms: 500 },
  ];
  const { ev, eng } = run(fs, segs, { rows: true, settle: false });
  const ends = ev.filter((e) => e.type === "rx-end");
  const rxs = ev.filter((e) => e.type === "rx");
  assert.equal(ends.length, 1, `ends=${ends.length} rxs=${rxs.length} phase=${eng.sstv.phase}`);
  assert.equal(ends[0].lost, true);
  assert.equal(rxs.length, 2, `rxs=${rxs.length}`);
  assert.ok(ev.indexOf(ends[0]) < ev.indexOf(rxs[1]), "new picture did not follow the partial");
});

test("Scottie and Robot modes also start a picture mid-image", () => {
  const fs = 48000;
  const cases = [
    ["S1", 20, 0],
    ["R36", 21, 2],
    ["M1", 20, 0],
    ["PD50", 20, 0],
  ];
  for (const [short, from, checkRow] of cases) {
    const mode = modeByShort(short);
    const segs = [
      { hz: 0, ms: 250 },
      { hz: BLACK_HZ, ms: 120 },
      ...pictureSegments(mode, bars(mode.w), from, 6),
      { hz: 0, ms: 500 },
    ];
    const { ev, eng } = run(fs, segs, { mode: short, rows: true, settle: false });
    const rx = ev.find((e) => e.type === "rx");
    assert.ok(rx, `${short} did not start mid-image: phase=${eng.sstv.phase}`);
    const row = rowRgba(ev, checkRow);
    assert.ok(row, `${short} row ${checkRow} missing`);
    checkBars(mode, row, 0, 16);
  }
});

test("a wrong manual mode does not start a mid-image picture", () => {
  const fs = 48000;
  const mode = modeByShort("BW8");
  const segs = [
    { hz: 0, ms: 250 },
    ...pictureSegments(mode, bars(mode.w), 40, 12),
    { hz: 0, ms: 500 },
  ];
  const { ev } = run(fs, segs, { mode: "R36", rows: true, settle: false });
  assert.equal(ev.find((e) => e.type === "rx"), undefined);
});

test("a picture started mid-image accepts the next VIS", () => {
  const fs = 48000;
  const mode = modeByShort("R36");
  const segs = [
    { hz: 0, ms: 250 },
    { hz: BLACK_HZ, ms: 120 },
    ...pictureSegments(mode, bars(mode.w), 200, 40),
    ...visSegments(mode),
    ...pictureSegments(mode, bars(mode.w), 0, 5),
    { hz: 0, ms: 500 },
  ];
  const { ev, eng } = run(fs, segs, { mode: "R36", rows: true, settle: false });
  const ends = ev.filter((e) => e.type === "rx-end");
  const rxs = ev.filter((e) => e.type === "rx");
  assert.equal(rxs.length, 2, `rxs=${rxs.length} ends=${ends.length} phase=${eng.sstv.phase}`);
  assert.equal(ends.length, 1, `ends=${ends.length}`);
  assert.ok(ev.indexOf(ends[0]) < ev.indexOf(rxs[1]), "new VIS did not replace the partial picture");
  assert.equal(rxs[1].mode, "R36");
});

test("noise without SSTV does not fill the rest of the picture", () => {
  const fs = 48000;
  const mode = modeByShort("BW8");
  const segs = [
    { hz: 0, ms: 250 },
    ...visSegments(mode),
    ...pictureSegments(mode, bars(mode.w), 0, 30),
    noise(5000, 0.08),
  ];
  const { ev, eng } = run(fs, segs, { rows: true, settle: false });
  const end = ev.find((e) => e.type === "rx-end");
  assert.ok(end, `no timeout end: phase=${eng.sstv.phase} line=${eng.sstv.line}`);
  assert.equal(end.lost, true);
  assert.ok(end.lines <= 32, `noise was decoded as ${end.lines} lines`);
  checkBars(mode, end.rgba, 0, 16);
});
