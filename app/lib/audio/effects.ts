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
    // A new delay sits at 0 s and a new gain at 1, which makes the loop a
    // repeat that never fades. It fills up unheard until echo is turned on,
    // then screams, so the loop starts silent and only runs while echo plays.
    this.delay.delayTime.value = 0.3;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0;
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
    const active = s.on ? s.effect : null;
    const ramp = (param: AudioParam, value: number) => glide(this.ctx, param, value, false);

    const echoMix = active === "echo" ? s.echo.wet : 0;
    const reverbMix = active === "reverb" ? s.reverb.wet : 0;
    // Wet effects duck the dry signal a little so the mix doesn't get louder.
    ramp(this.dry.gain, 1 - (echoMix + reverbMix) * 0.5);

    ramp(this.delay.delayTime, s.echo.delayTime);
    // Below 1, or the repeats never die away. Off while echo isn't playing,
    // so turning it on starts clean rather than with old repeats.
    ramp(this.feedback.gain, active === "echo" ? Math.min(s.echo.feedback, 0.85) : 0);
    ramp(this.echoWet.gain, echoMix);

    if (s.reverb.size !== this.reverbSize) {
      this.reverbSize = s.reverb.size;
      this.convolver.buffer = impulse(this.ctx, s.reverb.size);
    }
    ramp(this.reverbWet.gain, reverbMix);

    const filtering = active === "filter";
    // Cutoff 0–1 maps 200 Hz–20 kHz on a log scale, as the ear hears pitch.
    const hz = filtering ? Math.min(OPEN_HZ, 200 * Math.pow(100, s.filter.cutoff)) : OPEN_HZ;
    glide(this.ctx, this.filter.frequency, hz, true);
    ramp(this.filter.Q, filtering ? s.filter.resonance : 0.7);
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

/** Ramps from wherever the param is now. A ramp with nothing scheduled before
 *  it starts from the last event instead, which can be long past, so it
 *  jumps rather than glides. */
function glide(ctx: AudioContext, param: AudioParam, value: number, exponential: boolean) {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  if (exponential) param.exponentialRampToValueAtTime(value, now + RAMP);
  else param.linearRampToValueAtTime(value, now + RAMP);
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
