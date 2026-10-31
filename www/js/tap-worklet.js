class TapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.demod = new Demod(sampleRate);
    this.channel = "mono";
    this.size = 2048;
    this.n = 0;
    this.freq = new Float32Array(this.size);
    this.energy = 0;
    this.port.onmessage = (event) => {
      const mode = event.data && event.data.channel;
      if (mode === "left" || mode === "right" || mode === "mono") this.channel = mode;
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const left = input[0];
    const right = input[1] || left;
    const channel = this.channel;
    for (let i = 0; i < left.length; i++) {
      const l = left[i];
      const r = right[i] || 0;
      const x = channel === "left" ? l : channel === "right" ? r : (l + r) * 0.5;
      this.energy += x * x;
      this.freq[this.n++] = this.demod._sample(x);
      if (this.n === this.size) this.flush();
    }
    return true;
  }

  flush() {
    const freq = this.freq.slice(0, this.n);
    const rms = Math.sqrt(this.energy / this.n);
    this.n = 0;
    this.energy = 0;
    this.port.postMessage({ freq, rms }, [freq.buffer]);
  }
}

registerProcessor("tap", TapProcessor);
