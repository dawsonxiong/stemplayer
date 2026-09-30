import type { StemName } from "../constants";
import { EffectsChain, type EffectsSettings } from "./effects";
import { MixRecorder } from "./recorder";

interface StemNode {
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private stems: Map<StemName, StemNode> = new Map();
  private masterGain: GainNode | null = null;
  /** Where the stems meet, ahead of the effects. */
  private bus: GainNode | null = null;
  private _effects: EffectsChain | null = null;
  /** Each stem's own level; isolation silences on top without losing it. */
  private levels: Map<StemName, number> = new Map();
  private isolated: Set<StemName> = new Set();
  private _recorder: MixRecorder | null = null;
  /** Survives the gain node, which only exists once a track has been loaded. */
  private _masterVolume = 1;
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  /** Called when playback reaches the end of the track. */
  onEnded: (() => void) | null = null;

  private getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this._masterVolume;
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  async loadStems(urls: Record<string, string>): Promise<void> {
    this.dispose();

    const ctx = this.getContext();
    this.bus = ctx.createGain();
    this._effects = new EffectsChain(ctx, this.bus, this.masterGain!);

    const entries = await Promise.all(
      Object.entries(urls).map(async ([name, url]) => {
        const audio = new Audio();
        audio.crossOrigin = "anonymous";
        audio.preload = "auto";
        // Speed changes pitch too, like a turntable.
        audio.preservesPitch = false;
        audio.src = url;

        // "canplay" not "canplaythrough" — the latter never fires reliably in
        // Safari and would hang the load forever. The element keeps buffering.
        await new Promise<void>((resolve, reject) => {
          audio.addEventListener("canplay", () => resolve(), { once: true });
          audio.addEventListener(
            "error",
            () =>
              reject(
                new Error(
                  `Could not load ${name} stem: ${audio.error?.message ?? "unknown error"}`,
                ),
              ),
            { once: true },
          );
        });

        return [name as StemName, audio] as const;
      }),
    );

    // Stems share a length, so the first one speaks for the track.
    entries[0]?.[1].addEventListener("ended", () => this.onEnded?.());

    for (const [name, audio] of entries) {
      const source = ctx.createMediaElementSource(audio);
      const gain = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;

      source.connect(gain);
      gain.connect(analyser);
      analyser.connect(this.bus);

      this.stems.set(name, { audio, source, gain, analyser });
    }

    // Set up recorder on master output
    this._recorder = new MixRecorder(ctx, this.masterGain!);
  }

  play(): void {
    const ctx = this.getContext();
    if (ctx.state === "suspended") ctx.resume();

    for (const [, stem] of this.stems) {
      stem.audio.play();
    }
  }

  pause(): void {
    for (const [, stem] of this.stems) {
      stem.audio.pause();
    }
  }

  seek(time: number): void {
    for (const [, stem] of this.stems) {
      stem.audio.currentTime = time;
    }
  }

  setVolume(stemName: StemName, value: number): void {
    this.levels.set(stemName, value);
    this.applyGain(stemName);
  }

  /** Plays only these stems; an empty list plays them all again. */
  setIsolated(stems: StemName[]): void {
    this.isolated = new Set(stems);
    for (const name of this.stems.keys()) this.applyGain(name);
  }

  private applyGain(stemName: StemName): void {
    const stem = this.stems.get(stemName);
    if (!stem) return;
    const muted = this.isolated.size > 0 && !this.isolated.has(stemName);
    const value = muted ? 0 : (this.levels.get(stemName) ?? 1);
    const ctx = this.getContext();
    stem.gain.gain.linearRampToValueAtTime(value, ctx.currentTime + 0.02);
  }

  setSpeed(rate: number): void {
    for (const [, stem] of this.stems) stem.audio.playbackRate = rate;
  }

  setEffects(settings: EffectsSettings): void {
    this._effects?.apply(settings);
  }

  /** Jump back to `start` whenever playback reaches `end`. A timer rather than
   *  rAF: rAF stops in background tabs, while timers in audible tabs keep
   *  running. Pass nulls to clear. */
  setLoop(start: number | null, end: number | null): void {
    if (this.loopTimer !== null) clearInterval(this.loopTimer);
    this.loopTimer = null;
    if (start === null || end === null) return;
    this.loopTimer = setInterval(() => {
      if (this.currentTime >= end) this.seek(start);
    }, 20);
  }

  setMasterVolume(value: number): void {
    // Remember it either way: the rocker can be used before a track is loaded,
    // and the gain node does not exist until then.
    this._masterVolume = value;
    if (!this.masterGain || !this.ctx) return;
    this.masterGain.gain.linearRampToValueAtTime(value, this.ctx.currentTime + 0.02);
  }

  getAnalyserData(stemName: StemName): Uint8Array {
    const stem = this.stems.get(stemName);
    if (!stem) return new Uint8Array(0);
    const data = new Uint8Array(stem.analyser.frequencyBinCount);
    stem.analyser.getByteFrequencyData(data);
    return data;
  }

  get recorder(): MixRecorder | null {
    return this._recorder;
  }

  get currentTime(): number {
    const first = this.stems.values().next().value;
    return first?.audio.currentTime ?? 0;
  }

  get duration(): number {
    const first = this.stems.values().next().value;
    return first?.audio.duration ?? 0;
  }

  get isPlaying(): boolean {
    const first = this.stems.values().next().value;
    return first ? !first.audio.paused : false;
  }

  get destination(): AudioNode | null {
    return this.masterGain;
  }

  get audioContext(): AudioContext | null {
    return this.ctx;
  }

  dispose(): void {
    this.setLoop(null, null);
    this._effects?.dispose();
    this._effects = null;
    this.bus?.disconnect();
    this.bus = null;
    // A new track starts at full mix, as the store does. New audio elements
    // start at normal speed on their own.
    this.levels.clear();
    this.isolated.clear();
    this._recorder = null;
    for (const [, stem] of this.stems) {
      stem.audio.pause();
      stem.audio.src = "";
      stem.source.disconnect();
      stem.gain.disconnect();
      stem.analyser.disconnect();
    }
    this.stems.clear();
  }
}
