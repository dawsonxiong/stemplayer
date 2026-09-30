import type { EffectName } from "../constants";

/** Everything the chain needs to sound right; the store holds the same shape. */
export interface EffectsSettings {
  on: boolean;
  effect: EffectName;
  echo: { delayTime: number; feedback: number; wet: number };
  reverb: { size: number; wet: number };
  filter: { cutoff: number; resonance: number };
}

const RAMP = 0.05;
const OPEN_HZ = 20000;

/** One chain on the mixed output, between the stems and the master gain, so
 *  the recorder hears it. Only one effect plays at a time, as on the device:
 *
 *    input → filter ─┬→ dry ─────────────────┐
 *                    ├→ delay ⟲ feedback → echo wet ┼→ output
 *                    └→ convolver → reverb wet ──┘
 */
export class EffectsChain {
  private ctx: AudioContext;
  private filter: BiquadFilterNode;
  private dry: GainNode;
  private delay: DelayNode;
  private feedback: GainNode;
  private echoWet: GainNode;
  private convolver: ConvolverNode;
  private reverbWet: GainNode;
  private reverbSize = 0;

  constructor(ctx: AudioContext, input: AudioNode, output: AudioNode) {
    this.ctx = ctx;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = OPEN_HZ;
    this.filter.Q.value = 0.7;

    this.dry = ctx.createGain();
    this.delay = ctx.createDelay(2.0);
    this.feedback = ctx.createGain();
    this.echoWet = ctx.createGain();
    this.echoWet.gain.value = 0;
    this.convolver = ctx.createConvolver();
    this.reverbWet = ctx.createGain();
    this.reverbWet.gain.value = 0;

    input.connect(this.filter);
    this.filter.connect(this.dry);
    this.dry.connect(output);

    this.filter.connect(this.delay);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(this.echoWet);
    this.echoWet.connect(output);

    this.filter.connect(this.convolver);
    this.convolver.connect(this.reverbWet);
    this.reverbWet.connect(output);
  }

  /** Ramps every node to match the settings. Cheap enough to call on every
   *  slider move; the reverb tail is only rebuilt when its size changes. */
  apply(s: EffectsSettings): void {
    const at = this.ctx.currentTime + RAMP;
    const active = s.on ? s.effect : null;

    const echoMix = active === "echo" ? s.echo.wet : 0;
    const reverbMix = active === "reverb" ? s.reverb.wet : 0;
    // Wet effects duck the dry signal a little so the mix doesn't get louder.
    this.dry.gain.linearRampToValueAtTime(1 - (echoMix + reverbMix) * 0.5, at);

    this.delay.delayTime.linearRampToValueAtTime(s.echo.delayTime, at);
    // Below 1, or the repeats never die away.
    this.feedback.gain.linearRampToValueAtTime(Math.min(s.echo.feedback, 0.85), at);
    this.echoWet.gain.linearRampToValueAtTime(echoMix, at);

    if (s.reverb.size !== this.reverbSize) {
      this.reverbSize = s.reverb.size;
      this.convolver.buffer = impulse(this.ctx, s.reverb.size);
    }
    this.reverbWet.gain.linearRampToValueAtTime(reverbMix, at);

    const filtering = active === "filter";
    // Cutoff 0–1 maps 200 Hz–20 kHz on a log scale, as the ear hears pitch.
    const hz = filtering ? Math.min(OPEN_HZ, 200 * Math.pow(100, s.filter.cutoff)) : OPEN_HZ;
    this.filter.frequency.exponentialRampToValueAtTime(hz, at);
    this.filter.Q.linearRampToValueAtTime(filtering ? s.filter.resonance : 0.7, at);
  }

  dispose(): void {
    for (const node of [
      this.filter,
      this.dry,
      this.delay,
      this.feedback,
      this.echoWet,
      this.convolver,
      this.reverbWet,
    ]) {
      node.disconnect();
    }
  }
}

/** A room's echo, faked: stereo noise dying away over `seconds`. */
function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.round(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
    }
  }
  return buffer;
}
