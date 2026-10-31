// Instantaneous frequency of a pure SSTV / AFSK tone.
// Analytic signal via a windowed Hilbert FIR, then a one-sample phase difference.
// The tone is then smoothed so a signal around -35 dB does not jitter off the decoder.

function hilbertTaps(n) {
  const h = new Float64Array(n);
  const m = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const k = i - m;
    if (k !== 0 && Math.abs(k) % 2 === 1) h[i] = 2 / (Math.PI * k);
    const w =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) +
      0.08 * Math.cos((4 * Math.PI * i) / (n - 1));
    h[i] *= w;
  }
  return h;
}

function responseGain(taps, fs, freq) {
  const m = (taps.length - 1) / 2;
  let re = 0;
  let im = 0;
  for (let i = 0; i < taps.length; i++) {
    const w = (-2 * Math.PI * freq * (i - m)) / fs;
    re += taps[i] * Math.cos(w);
    im += taps[i] * Math.sin(w);
  }
  return Math.hypot(re, im) || 1;
}

export class Demod {
  constructor(fs) {
    this.fs = fs;
    this.nTaps = 127;
    this.taps = hilbertTaps(this.nTaps);
    const g = responseGain(this.taps, fs, 1900);
    for (let i = 0; i < this.taps.length; i++) this.taps[i] /= g;
    this.m = (this.nTaps - 1) >> 1;
    this.hist = new Float64Array(this.nTaps);
    this.pos = 0;
    this.r = Math.exp((-2 * Math.PI * 40) / fs);
    this.xPrev = 0;
    this.yPrev = 0;
    this.prevI = 0;
    this.prevQ = 0;
    this.lpA = 1 - Math.exp((-2 * Math.PI * 1500) / fs);
    this.iLp = 0;
    this.qLp = 0;
    this.prevIf = 0;
    this.prevQf = 0;
    this.fLp = 0;
    this.fA = 1 - Math.exp(-1 / (fs * 0.0005));
    this.primed = 0;
    this.sign = 1;
    this.env = 0;
    this.noise = 0.001;
    this.open = false;
    this.above = 0;
    this.below = 0;
    this.needOpen = Math.max(8, Math.round((fs * 6) / 1000));
    this.needClose = Math.max(16, Math.round((fs * 40) / 1000));
    this._probeSign();
  }

  _probeSign() {
    const n = this.nTaps + Math.round(this.fs * 0.05);
    const hz = 1900;
    let phase = 0;
    const step = (2 * Math.PI * hz) / this.fs;
    let sum = 0;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const f = this._stepRaw(Math.sin(phase));
      phase += step;
      if (i > this.nTaps + 20 && Number.isFinite(f)) {
        sum += f;
        k++;
      }
    }
    if (k && sum / k < 0) this.sign = -1;
    this.hist.fill(0);
    this.pos = 0;
    this.xPrev = 0;
    this.yPrev = 0;
    this.prevI = 0;
    this.prevQ = 0;
    this.iLp = 0;
    this.qLp = 0;
    this.prevIf = 0;
    this.prevQf = 0;
    this.fLp = 0;
    this.primed = 0;
    this.env = 0;
    this.open = false;
    this.above = 0;
    this.below = 0;
  }

  _stepRaw(x0) {
    const y = x0 - this.xPrev + this.r * this.yPrev;
    this.xPrev = x0;
    this.yPrev = y;
    const n = this.nTaps;
    const pos = this.pos;
    this.hist[pos] = y;
    const taps = this.taps;
    const hist = this.hist;
    let q = 0;
    for (let i = 0; i < n; i++) {
      const idx = pos - i;
      q += taps[i] * hist[idx < 0 ? idx + n : idx];
    }
    const iIdx = pos - this.m;
    const I = hist[iIdx < 0 ? iIdx + n : iIdx];
    this.pos = pos + 1 === n ? 0 : pos + 1;
    this.prevI = I;
    this.prevQ = q;
    this.iLp += this.lpA * (I - this.iLp);
    this.qLp += this.lpA * (q - this.qLp);
    const d = Math.atan2(
      this.qLp * this.prevIf - this.iLp * this.prevQf,
      this.iLp * this.prevIf + this.qLp * this.prevQf,
    );
    this.prevIf = this.iLp;
    this.prevQf = this.qLp;
    this.primed++;
    if (this.primed <= n + 2) return NaN;
    return (d * this.fs) / (2 * Math.PI);
  }

  processBlock(input) {
    const freq = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) freq[i] = this._sample(input[i]);
    return freq;
  }

  _sample(x) {
    let f = this._stepRaw(x);
    if (Number.isFinite(f)) {
      f *= this.sign;
      this.fLp += this.fA * (f - this.fLp);
      f = this.fLp;
    }
    const e = Math.hypot(this.prevI, this.prevQ);
    this.env += 0.2 * (e - this.env);
    if (!this.open) {
      if (this.env < this.noise) this.noise = this.env;
      else this.noise += (this.env - this.noise) * 0.00002;
      if (this.env > Math.max(0.01, this.noise * 6)) this.above++;
      else this.above = 0;
      if (this.above >= this.needOpen) this.open = true;
    } else if (this.env < Math.max(0.006, this.noise * 2.5)) {
      this.below++;
      if (this.below >= this.needClose) {
        this.open = false;
        this.above = 0;
        this.below = 0;
      }
    } else this.below = 0;
    if (!this.open || !Number.isFinite(f) || f < 700 || f > 3200) return -1;
    return f;
  }
}
