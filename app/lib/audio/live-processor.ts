/** The live player: one AudioWorklet node with four stereo outputs, one per
 *  stem, all read at a single playhead, so the stems stay sample-aligned
 *  however the decoded audio arrives. Blocks come straight from the decoder
 *  worker (live-decoder.worker.ts) over a MessagePort.
 *
 *  - Speed moves the playhead faster or slower, with Hermite interpolation,
 *    so pitch moves with it as it does on the media elements.
 *  - A seek inside what's decoded just moves the playhead; past it, the
 *    decoder starts again from there, and the player waits.
 *  - With too little decoded it plays silence and says it's buffering, then
 *    carries on once there's enough. */
import type { DecodedBlock, DecodedEnd, FromPlayer } from "./live-decoder.worker";

export type ToPlayer =
  | { type: "port"; port: MessagePort }
  | { type: "play" }
  | { type: "pause" }
  /** Source samples. */
  | { type: "seek"; sample: number }
  | { type: "rate"; rate: number }
  | { type: "loop"; start: number; end: number }
  | { type: "loop"; start: null; end: null }
  /** Keep what's decoded from here on, for a loop about to be closed. */
  | { type: "retain"; from: number | null };

export type FromPlayerNode =
  /** Enough is decoded to start. Once, the first time. */
  | { type: "primed" }
  | { type: "state"; pos: number; ctxTime: number; playing: boolean; buffering: boolean }
  | { type: "ended"; pos: number };

export interface PlayerOptions {
  /** Source samples decoded per stem before playing starts. */
  prebuffer: number;
  /** Samples to have again before carrying on after running out. */
  resume: number;
  /** Start playing on its own once primed. */
  autoplay: boolean;
  /** The stems' sample rate. */
  sourceRate: number;
}

interface Block {
  start: number;
  l: Float32Array;
  r: Float32Array;
}

interface Stem {
  blocks: Block[];
  /** Just past the last block, or -1 before any. */
  end: number;
  eof: boolean;
  eofEnd: number;
}

type WorkletScope = {
  sampleRate: number;
  currentTime: number;
  registerProcessor(name: string, ctor: unknown): void;
  AudioWorkletProcessor: new (options?: unknown) => { readonly port: MessagePort };
};
const scope = globalThis as unknown as WorkletScope;

/** Samples behind the playhead kept for a short seek back. */
const KEEP_BEHIND = 2 * 44100;
const STATE_EVERY = 8;
const PLAYHEAD_EVERY = 16;
const WINDOW = 4096;

class LivePlayer extends scope.AudioWorkletProcessor {
  private opts: PlayerOptions;
  private stems: Stem[] = [0, 1, 2, 3].map(() => ({
    blocks: [],
    end: 0,
    eof: false,
    eofEnd: Infinity,
  }));
  private decoder: MessagePort | null = null;
  private pos = 0;
  private rate = 1;
  private playing = false;
  private buffering = false;
  private primed = false;
  private loopStart: number | null = null;
  private loopEnd: number | null = null;
  private retainFrom: number | null = null;
  private gen = 0;
  private quanta = 0;
  private winL = new Float32Array(WINDOW);
  private winR = new Float32Array(WINDOW);

  constructor(options: { processorOptions: PlayerOptions }) {
    super(options);
    this.opts = options.processorOptions;
    this.port.onmessage = (event: MessageEvent<ToPlayer>) => this.control(event.data);
  }

  private control(m: ToPlayer): void {
    switch (m.type) {
      case "port":
        this.decoder = m.port;
        this.decoder.onmessage = (event: MessageEvent<DecodedBlock | DecodedEnd>) =>
          this.receive(event.data);
        break;
      case "play":
        this.playing = true;
        break;
      case "pause":
        this.playing = false;
        this.buffering = false;
        break;
      case "seek":
        this.seek(m.sample);
        break;
      case "rate":
        this.rate = m.rate;
        break;
      case "loop":
        this.loopStart = m.start;
        this.loopEnd = m.end;
        break;
      case "retain":
        this.retainFrom = m.from;
        break;
    }
    this.postState();
  }

  private receive(m: DecodedBlock | DecodedEnd): void {
    if (m.gen !== this.gen) return;
    const s = this.stems[m.stem];
    if (m.type === "eof") {
      s.eof = true;
      s.eofEnd = m.end;
      return;
    }
    s.blocks.push({ start: m.start, l: m.l, r: m.r });
    s.end = m.start + m.l.length;
  }

  private get step(): number {
    return (this.rate * this.opts.sourceRate) / scope.sampleRate;
  }

  /** Whether every stem has [from, to) decoded, or as much of it as exists. */
  private covered(from: number, to: number): boolean {
    return this.stems.every((s) => {
      if (s.end < 0) return false;
      const first = s.blocks[0];
      const start = first ? first.start : s.end;
      return (
        start <= Math.max(0, from) && (s.end >= to || (s.eof && s.end >= Math.min(to, s.eofEnd)))
      );
    });
  }

  private ahead(samples: number): boolean {
    return this.covered(Math.floor(this.pos) - 1, Math.ceil(this.pos) + samples);
  }

  private seek(sample: number): void {
    const target = Math.max(0, sample);
    // Inside what's decoded: just move.
    if (this.covered(Math.floor(target) - 1, Math.ceil(target) + 512)) {
      this.pos = target;
      return;
    }
    this.gen++;
    for (const s of this.stems) {
      s.blocks = [];
      s.end = -1;
      s.eof = false;
      s.eofEnd = Infinity;
    }
    this.pos = target;
    if (this.playing) this.buffering = true;
    const msg: FromPlayer = { type: "seek", sample: Math.floor(target), gen: this.gen };
    this.decoder?.postMessage(msg);
  }

  private postState(): void {
    const msg: FromPlayerNode = {
      type: "state",
      pos: this.pos,
      ctxTime: scope.currentTime,
      playing: this.playing,
      buffering: this.playing && this.buffering,
    };
    this.port.postMessage(msg);
  }

  private prune(): void {
    let keep = this.pos - KEEP_BEHIND;
    if (this.retainFrom !== null) keep = Math.min(keep, this.retainFrom);
    if (this.loopStart !== null) keep = Math.min(keep, this.loopStart);
    keep -= 4;
    for (const s of this.stems) {
      while (s.blocks.length > 1 && s.blocks[0].start + s.blocks[0].l.length < keep)
        s.blocks.shift();
    }
  }

  /** Copies samples [from, from + n) of a stem into the window, zeros where
   *  there are none. */
  private fill(s: Stem, from: number, n: number): void {
    this.winL.fill(0, 0, n);
    this.winR.fill(0, 0, n);
    const to = from + n;
    for (const b of s.blocks) {
      const bEnd = b.start + b.l.length;
      if (bEnd <= from) continue;
      if (b.start >= to) break;
      const lo = Math.max(from, b.start);
      const hi = Math.min(to, bEnd);
      this.winL.set(b.l.subarray(lo - b.start, hi - b.start), lo - from);
      this.winR.set(b.r.subarray(lo - b.start, hi - b.start), lo - from);
    }
  }

  /** Output samples [k0, k1) from source position p at `step` per sample. */
  private render(outputs: Float32Array[][], k0: number, k1: number, p: number, step: number): void {
    const count = k1 - k0;
    const base = Math.floor(p) - 1;
    const span = Math.min(WINDOW, Math.floor(p + (count - 1) * step) + 3 - base + 1);
    const exact = step === 1 && p === Math.floor(p);
    this.stems.forEach((s, i) => {
      const out = outputs[i];
      if (!out || out.length < 2) return;
      this.fill(s, base, span);
      const [L, R] = out;
      if (exact) {
        L.set(this.winL.subarray(1, 1 + count), k0);
        R.set(this.winR.subarray(1, 1 + count), k0);
        return;
      }
      for (let k = 0; k < count; k++) {
        const x = p + k * step;
        const xi = Math.floor(x);
        const t = x - xi;
        const j = xi - base;
        L[k0 + k] = hermite(this.winL, j, t);
        R[k0 + k] = hermite(this.winR, j, t);
      }
    });
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const n = outputs[0]?.[0]?.length ?? 128;
    const step = this.step;
    this.quanta++;

    if (!this.primed && this.ahead(this.opts.prebuffer)) {
      this.primed = true;
      this.port.postMessage({ type: "primed" } satisfies FromPlayerNode);
      if (this.opts.autoplay) this.playing = true;
      this.postState();
    }

    if (this.playing) {
      const wanted = Math.ceil(n * step) + 3;
      if (this.buffering && this.ahead(this.opts.resume)) {
        this.buffering = false;
        this.postState();
      }
      if (!this.buffering) {
        const ended =
          this.stems.every((s) => s.eof) &&
          this.pos >= Math.min(...this.stems.map((s) => s.eofEnd));
        if (ended) {
          this.playing = false;
          this.port.postMessage({ type: "ended", pos: this.pos } satisfies FromPlayerNode);
          this.postState();
        } else if (this.loopEnd !== null && this.pos + wanted > this.loopEnd) {
          this.playLooped(outputs, n, step);
        } else if (this.ahead(wanted)) {
          this.render(outputs, 0, n, this.pos, step);
          this.pos += n * step;
        } else {
          this.buffering = true;
          this.postState();
        }
      }
    }

    if (this.quanta % STATE_EVERY === 0) this.postState();
    if (this.quanta % PLAYHEAD_EVERY === 0) {
      this.prune();
      const msg: FromPlayer = { type: "playhead", pos: this.pos };
      this.decoder?.postMessage(msg);
    }
    return true;
  }

  /** A quantum that may cross the loop's end, wrapping back to its start. */
  private playLooped(outputs: Float32Array[][], n: number, step: number): void {
    const start = this.loopStart ?? 0;
    const end = this.loopEnd ?? Infinity;
    let p = this.pos;
    let k = 0;
    while (k < n) {
      if (p >= end) {
        p = start + ((p - end) % Math.max(1, end - start));
        if (!this.covered(Math.floor(p) - 1, Math.ceil(p) + Math.ceil((n - k) * step) + 3)) {
          // Its start wasn't kept: fetch it again, and wait.
          this.seek(p);
          return;
        }
      }
      const until = Math.min(n, k + Math.max(1, Math.ceil((end - p) / step)));
      if (!this.covered(Math.floor(p) - 1, Math.ceil(p + (until - k) * step) + 3)) {
        this.pos = p;
        this.buffering = true;
        this.postState();
        return;
      }
      this.render(outputs, k, until, p, step);
      p += (until - k) * step;
      k = until;
    }
    this.pos = p;
  }
}

/** 4-point, 3rd-order Hermite between w[j] and w[j + 1]. */
function hermite(w: Float32Array, j: number, t: number): number {
  const xm1 = w[j - 1];
  const x0 = w[j];
  const x1 = w[j + 1];
  const x2 = w[j + 2];
  const c1 = 0.5 * (x1 - xm1);
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return ((c3 * t + c2) * t + c1) * t + x0;
}

scope.registerProcessor("live-player", LivePlayer);
