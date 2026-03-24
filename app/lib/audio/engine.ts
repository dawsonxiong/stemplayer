import type { StemName } from "../constants";

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

  private getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  async loadStems(urls: Record<string, string>): Promise<void> {
    // Clean up any existing stems
    this.dispose();

    const ctx = this.getContext();

    const entries = await Promise.all(
      Object.entries(urls).map(async ([name, url]) => {
        const audio = new Audio();
        audio.crossOrigin = "anonymous";
        audio.preload = "auto";
        audio.src = url;

        await new Promise<void>((resolve, reject) => {
          audio.addEventListener("canplaythrough", () => resolve(), {
            once: true,
          });
          audio.addEventListener("error", () => reject(audio.error), {
            once: true,
          });
        });

        return [name as StemName, audio] as const;
      })
    );

    for (const [name, audio] of entries) {
      const source = ctx.createMediaElementSource(audio);
      const gain = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;

      source.connect(gain);
      gain.connect(analyser);
      analyser.connect(this.masterGain!);

      this.stems.set(name, { audio, source, gain, analyser });
    }
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
    const stem = this.stems.get(stemName);
    if (!stem) return;
    const ctx = this.getContext();
    stem.gain.gain.linearRampToValueAtTime(value, ctx.currentTime + 0.02);
  }

  setMasterVolume(value: number): void {
    if (!this.masterGain || !this.ctx) return;
    this.masterGain.gain.linearRampToValueAtTime(
      value,
      this.ctx.currentTime + 0.02
    );
  }

  getAnalyserData(stemName: StemName): Uint8Array {
    const stem = this.stems.get(stemName);
    if (!stem) return new Uint8Array(0);
    const data = new Uint8Array(stem.analyser.frequencyBinCount);
    stem.analyser.getByteFrequencyData(data);
    return data;
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
