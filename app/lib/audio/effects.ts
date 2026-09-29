import type { StemName } from "../constants";

interface EffectNodes {
  delay: DelayNode;
  feedback: GainNode;
  wet: GainNode;
  dry: GainNode;
  filter: BiquadFilterNode;
}

export class EffectsChain {
  private ctx: AudioContext;
  private chains: Map<StemName, EffectNodes> = new Map();
  private engaged = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  /** Create an effects chain for a stem, inserted between gain and analyser */
  createChain(stemName: StemName, input: GainNode, output: AnalyserNode): void {
    // Disconnect direct path
    input.disconnect(output);

    // Dry path (bypasses effects)
    const dry = this.ctx.createGain();
    dry.gain.value = 1;

    // Wet path (through effects)
    const wet = this.ctx.createGain();
    wet.gain.value = 0;

    // Echo: delay with feedback loop
    const delay = this.ctx.createDelay(2.0);
    delay.delayTime.value = 0.3;

    const feedback = this.ctx.createGain();
    feedback.gain.value = 0.4;

    // Gate: low-pass filter that can sweep to cut highs
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 20000; // fully open by default
    filter.Q.value = 0.7;

    // Routing:
    // input → dry → output
    // input → delay → filter → wet → output
    //                  ↑←feedback←↓
    input.connect(dry);
    dry.connect(output);

    input.connect(delay);
    delay.connect(filter);
    filter.connect(wet);
    wet.connect(output);

    // Feedback loop
    filter.connect(feedback);
    feedback.connect(delay);

    this.chains.set(stemName, { delay, feedback, wet, dry, filter });
  }

  /** Fades in at the caller's mix so the Mix slider matches what is heard. */
  engage(wetAmount: number): void {
    this.engaged = true;
    for (const [, chain] of this.chains) {
      chain.dry.gain.linearRampToValueAtTime(1 - wetAmount * 0.5, this.ctx.currentTime + 0.1);
      chain.wet.gain.linearRampToValueAtTime(wetAmount, this.ctx.currentTime + 0.1);
    }
  }

  bypass(): void {
    this.engaged = false;
    for (const [, chain] of this.chains) {
      chain.dry.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 0.1);
      chain.wet.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);
    }
  }

  get isEngaged(): boolean {
    return this.engaged;
  }

  setEchoTime(time: number): void {
    for (const [, chain] of this.chains) {
      chain.delay.delayTime.linearRampToValueAtTime(time, this.ctx.currentTime + 0.05);
    }
  }

  setFeedback(amount: number): void {
    // Clamp to < 1 to prevent infinite feedback
    const clamped = Math.min(amount, 0.85);
    for (const [, chain] of this.chains) {
      chain.feedback.gain.linearRampToValueAtTime(clamped, this.ctx.currentTime + 0.05);
    }
  }

  setGateFrequency(frequency: number): void {
    // Map 0-1 to 200Hz-20000Hz (log scale)
    const freq = 200 * Math.pow(100, frequency);
    for (const [, chain] of this.chains) {
      chain.filter.frequency.linearRampToValueAtTime(
        Math.min(freq, 20000),
        this.ctx.currentTime + 0.05,
      );
    }
  }

  setWetDryMix(wetAmount: number): void {
    for (const [, chain] of this.chains) {
      chain.wet.gain.linearRampToValueAtTime(wetAmount, this.ctx.currentTime + 0.05);
      chain.dry.gain.linearRampToValueAtTime(1 - wetAmount * 0.5, this.ctx.currentTime + 0.05);
    }
  }

  dispose(): void {
    for (const [, chain] of this.chains) {
      chain.delay.disconnect();
      chain.feedback.disconnect();
      chain.wet.disconnect();
      chain.dry.disconnect();
      chain.filter.disconnect();
    }
    this.chains.clear();
    this.engaged = false;
  }
}
