import { Ax25 } from "./ax25.js";
import { Demod } from "./dsp.js";
import { modeByShort } from "./modes.js";
import { Sstv } from "./sstv.js";

export function formatLabel(name, mark) {
  const nice =
    {
      WELCOME: "Welcome",
      BYE: "Bye",
      "BUMPER PRE": "Pre-bumper",
      "BUMPER POST": "Post-bumper",
    }[mark] || "";
  if (name && nice) return `${name} · ${nice}`;
  return name || nice || "";
}

export class Engine {
  constructor(fs, options = {}) {
    this.fs = fs;
    this.demod = options.demod === false ? null : new Demod(fs);
    this.sstv = new Sstv(fs);
    this.ax = new Ax25(fs);
    this.t = 0;
    this.onEvent = () => {};
    this.programName = "";
    this.call = "";
    this.pendingMark = "";
    this.pendingStamp = "";
    this.pendingAt = 0;
    this.imageMeta = null;
    this.sstv.emit = (ev) => this._sstv(ev);
    this.ax.onFrame = (parsed) => this._ax(parsed);
  }

  setMode(short) {
    this.sstv.setForced(!short || short === "auto" ? null : modeByShort(short));
  }

  push(samples) {
    let energy = 0;
    for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
    this.pushFreq(this.demod.processBlock(samples));
    return Math.sqrt(energy / Math.max(1, samples.length));
  }

  pushFreq(freq) {
    for (let i = 0; i < freq.length; i++) {
      const t = this.t++;
      this.ax.push(t, freq[i]);
      this.sstv.sample(t, freq[i]);
    }
    this.sstv.endBlock();
  }

  _ax(parsed) {
    if (parsed.kind === "mode") {
      this.pendingMark = parsed.mark || "";
      this.pendingStamp = parsed.stamp || "";
      this.pendingAt = Date.now();
      this.onEvent({ type: "mode", short: parsed.short, mark: parsed.mark || "", stamp: parsed.stamp || "" });
      return;
    }
    if (parsed.kind !== "info") return;
    if (parsed.call) this.call = parsed.call;
    if (parsed.name) this.programName = parsed.name;
    if (this.imageMeta) {
      this.imageMeta.name = formatLabel(this.programName, this.imageMeta.mark);
      this.imageMeta.call = this.call;
      this.onEvent({ type: "label", name: this.imageMeta.name });
    }
    this.onEvent({ type: "info", packet: parsed });
  }

  _sstv(ev) {
    if (ev.type === "rx") {
      let mark = "";
      let stamp = "";
      if (this.pendingAt && Date.now() - this.pendingAt < 20000) {
        mark = this.pendingMark || "";
        stamp = this.pendingStamp || "";
      }
      this.pendingMark = "";
      this.pendingStamp = "";
      this.pendingAt = 0;
      ev.mark = mark;
      ev.stamp = stamp;
      ev.call = this.call;
      ev.name = formatLabel(this.programName, mark);
      this.imageMeta = { name: ev.name, call: this.call, mode: ev.mode, mark, stamp };
    } else if (ev.type === "rx-end" && this.imageMeta) {
      ev.name = this.imageMeta.name;
      ev.call = this.imageMeta.call;
      ev.stamp = this.imageMeta.stamp || "";
      this.imageMeta = null;
    }
    this.onEvent(ev);
  }
}
