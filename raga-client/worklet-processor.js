class MicCaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); }
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch0 = input[0];
    if (ch0 && ch0.length > 0) {
      const samples = new Float32Array(ch0.length);
      samples.set(ch0);
      this.port.postMessage({ samples }, [samples.buffer]);
    }
    return true;
  }
}
registerProcessor('mic-capture-processor', MicCaptureProcessor);


