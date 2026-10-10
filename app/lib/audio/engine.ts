import type { StemName } from "../constants";
import { LIVE_STEMS, type LiveHeader } from "../live-protocol";
import { EffectsChain, type EffectsSettings } from "./effects";
import type { ToDecoder } from "./live-decoder.worker";
import type { FromPlayerNode, PlayerOptions, ToPlayer } from "./live-processor";
// Vite bundles the worklet on its own and hands back its URL; the linter
// can't see through the query.
// oxlint-disable-next-line import/default
import processorUrl from "./live-processor.ts?worker&url";
import type { LiveSession } from "./live";
import { MixRecorder } from "./recorder";

interface StemNode {
  /** The stem's media element; none while it plays live. */
  audio: HTMLAudioElement | null;
  /** Where the stem enters the graph: its element, or the live player's trim. */
  source: AudioNode;
  gain: GainNode;
  analyser: AnalyserNode;
}

/** The live player's sample rate, Demucs's. */
const LIVE_RATE = 44100;
/** Seconds decoded per stem before live playback starts, and before it
 *  carries on after running out. The stream's first stretch is ~8 s, so
 *  waiting for more than this costs nothing once it arrives. */
const LIVE_PREBUFFER_SECONDS = 1;
const LIVE_RESUME_SECONDS = 1;

/** The stems while they stream: decoded in a worker, played by one worklet
 *  node with an output per stem (live-processor.ts). */
interface LivePlayback {
  session: LiveSession;
  worker: Worker;
  node: AudioWorkletNode | null;
  trims: GainNode[];
  header: LiveHeader | null;
  /** The worklet's last report: its playhead in source samples, and when. */
  pos: number;
  ctxTime: number;
  playing: boolean;
  buffering: boolean;
  ended: boolean;
  rate: number;
  loop: { start: number; end: number } | null;
  duration: number;
}

type Navigator_ = Navigator & { audioSession?: { type: string } };

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private stems: Map<StemName, StemNode> = new Map();
  private masterGain: GainNode | null = null;
  /** After the master volume, before the speakers and the recorder. */
  private limiter: DynamicsCompressorNode | null = null;
  /** Where the stems meet, ahead of the effects. */
  private bus: GainNode | null = null;
  private _effects: EffectsChain | null = null;
  private effectsSettings: EffectsSettings | null = null;
  /** Each stem's own level; isolation silences on top without losing it. */
  private levels: Map<StemName, number> = new Map();
  private isolated: Set<StemName> = new Set();
  /** Undoes the level each stem was stored at (1 / its gain), so they add up
   *  to the song again. Stems are stored 6 dB down to keep loud ones from
   *  clipping. Live stems do it in their trims instead. */
  private restore: Map<StemName, number> = new Map();
  private _recorder: MixRecorder | null = null;
  /** Survives the gain node, which only exists once a track has been loaded. */
  private _masterVolume = 1;
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  /** Live playback asks for its sample rate when it creates the context. */
  private preferredRate: number | undefined;
  private worklet: Promise<void> | null = null;
  private live: LivePlayback | null = null;
  /** "media": four audio elements, the finished files. "live": the stream. */
  mode: "media" | "live" = "media";
  /** Called when playback reaches the end of the track. */
  onEnded: (() => void) | null = null;
  /** Called when live playback runs out of audio, and when it carries on. */
  onBuffering: ((buffering: boolean) => void) | null = null;

  private getContext(): AudioContext {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext(
          this.preferredRate ? { sampleRate: this.preferredRate } : undefined,
        );
      } catch {
        // A rate it won't run at: the live player resamples anyway.
        this.ctx = new AudioContext();
      }
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this._masterVolume;
      // Stems play at their true level, and a loud song's can pass full
      // scale on their own (drums at +4.3 dBFS, soloed). This catches only
      // what would otherwise clip: nothing at or below 0 dBFS is touched.
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = 0;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.002;
      this.limiter.release.value = 0.1;
      this.masterGain.connect(this.limiter);
      this.limiter.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /** Readies live playback. Call in the click that starts a split: iOS only
   *  lets audio start in a gesture, and plays through the silent switch only
   *  as a "playback" session. */
  prime(): void {
    this.preferredRate ??= LIVE_RATE;
    const ctx = this.getContext();
    if (ctx.state === "suspended") void ctx.resume();
    try {
      const session = (navigator as Navigator_).audioSession;
      if (session) session.type = "playback";
    } catch {
      // Not settable here; the ringer switch may mute it.
    }
    this.worklet ??= ctx.audioWorklet.addModule(processorUrl).catch((err: unknown) => {
      this.worklet = null;
      throw err;
    });
  }

  async loadStems(
    urls: Record<string, string>,
    gains: Record<string, number> = {},
    { keepMix = false } = {},
  ): Promise<void> {
    this.dispose({ keepMix });
    this.restore = new Map(
      Object.keys(urls).map((name) => {
        const gain = gains[name];
        return [name as StemName, gain && gain > 0 && gain <= 1 ? 1 / gain : 1];
      }),
    );

    const ctx = this.getContext();
    this.setUpBus(ctx);

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
    entries[0]?.[1].addEventListener("ended", () => {
      this._recorder?.pause();
      this.onEnded?.();
    });

    for (const [name, audio] of entries) {
      const source = ctx.createMediaElementSource(audio);
      this.addStem(ctx, name, source, audio);
    }

    // A take in progress carries on across a switch from live playback.
    if (!keepMix || !this._recorder) this._recorder = new MixRecorder(ctx, this.limiter!);
  }

  /** The bus the stems meet on, and the effects after it. */
  private setUpBus(ctx: AudioContext): void {
    this.bus = ctx.createGain();
    this._effects = new EffectsChain(ctx, this.bus, this.masterGain!);
    if (this.effectsSettings) this._effects.apply(this.effectsSettings);
  }

  private addStem(
    ctx: AudioContext,
    name: StemName,
    source: AudioNode,
    audio: HTMLAudioElement | null,
  ): void {
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(gain);
    gain.connect(analyser);
    analyser.connect(this.bus!);
    this.stems.set(name, { audio, source, gain, analyser });
    this.applyGain(name);
  }

  /** Plays a song while it's still being separated, from its live stream.
   *  Resolves once enough of every stem is decoded to start, and with
   *  `autoplay` it has started by then. Rejects if the stream fails before
   *  a byte arrives, or another song is loaded first. */
  async loadLive(session: LiveSession, { autoplay }: { autoplay: boolean }): Promise<void> {
    this.dispose();
    this.restore = new Map();
    const ctx = this.getContext();
    this.setUpBus(ctx);

    const worker = new Worker(new URL("./live-decoder.worker.ts", import.meta.url), {
      type: "module",
    });
    const channel = new MessageChannel();
    const tell = (message: ToDecoder, transfer: Transferable[] = []) =>
      worker.postMessage(message, transfer);
    tell({ type: "init", port: channel.port1 }, [channel.port1]);

    const trims = LIVE_STEMS.map(() => ctx.createGain());
    const live: LivePlayback = {
      session,
      worker,
      node: null,
      trims,
      header: null,
      pos: 0,
      ctxTime: ctx.currentTime,
      playing: false,
      buffering: false,
      ended: false,
      rate: 1,
      loop: null,
      duration: 0,
    };
    this.live = live;
    this.mode = "live";
    LIVE_STEMS.forEach((name, i) => this.addStem(ctx, name, trims[i], null));
    this._recorder = new MixRecorder(ctx, this.limiter!);

    session.listen({
      header: (header) => {
        live.header = header;
        // Stored 6 dB down: each trim turns its stem back up.
        const restore = header.gain > 0 && header.gain <= 1 ? 1 / header.gain : 1;
        for (const trim of trims) trim.gain.value = restore;
        live.duration = header.durationHint ?? 0;
      },
      data: (stem, bytes) => tell({ type: "bytes", stem, bytes }, [bytes.buffer]),
      reset: () => LIVE_STEMS.forEach((_, stem) => tell({ type: "replace", stem, gainNorm: 1 })),
      ended: (stem) => {
        tell({ type: "end", stem });
        this.settleDuration(live);
      },
    });

    if (!this.worklet) this.prime();
    await this.worklet;
    if (this.live !== live) throw new Error("Replaced by another song");

    const options: PlayerOptions = {
      prebuffer: LIVE_PREBUFFER_SECONDS * LIVE_RATE,
      resume: LIVE_RESUME_SECONDS * LIVE_RATE,
      autoplay,
      sourceRate: LIVE_RATE,
    };
    const node = new AudioWorkletNode(ctx, "live-player", {
      numberOfInputs: 0,
      numberOfOutputs: LIVE_STEMS.length,
      outputChannelCount: LIVE_STEMS.map(() => 2),
      processorOptions: options,
    });
    live.node = node;
    this.toPlayer({ type: "port", port: channel.port2 }, [channel.port2]);
    trims.forEach((trim, i) => node.connect(trim, i));

    await new Promise<void>((resolve, reject) => {
      node.port.onmessage = (event: MessageEvent<FromPlayerNode>) => {
        const m = event.data;
        if (m.type === "primed") {
          performance.mark("live:start");
          // Its state report follows; say so now, for whoever's waiting.
          live.playing = autoplay;
          resolve();
        } else this.fromPlayer(live, m);
      };
      // Nothing came at all: let the finished files win instead.
      void session.settled.then(() => {
        if (session.received.every((r) => r === 0)) reject(new Error(session.failure ?? "ended"));
      });
    });
    if (this.live !== live) throw new Error("Replaced by another song");
    node.port.onmessage = (event: MessageEvent<FromPlayerNode>) =>
      this.fromPlayer(live, event.data);
  }

  private fromPlayer(live: LivePlayback, m: FromPlayerNode): void {
    if (this.live !== live) return;
    if (m.type === "ended") {
      live.ended = true;
      live.playing = false;
      live.pos = m.pos;
      this._recorder?.pause();
      this.onEnded?.();
      return;
    }
    if (m.type !== "state") return;
    const wasBuffering = live.buffering;
    live.pos = m.pos;
    live.ctxTime = m.ctxTime;
    live.playing = m.playing;
    live.buffering = m.buffering;
    if (m.buffering !== wasBuffering) {
      // A take holds while there's nothing to hear, as it does when paused.
      if (m.buffering) this._recorder?.pause();
      else if (m.playing) this._recorder?.resume();
      this.onBuffering?.(m.buffering);
    }
  }

  private toPlayer(message: ToPlayer, transfer: Transferable[] = []): void {
    this.live?.node?.port.postMessage(message, transfer);
  }

  /** Duration from what's arrived, once every stem has. */
  private settleDuration(live: LivePlayback, bytes?: number[]): void {
    const { session, header } = live;
    if (!header) return;
    const lengths =
      bytes ?? LIVE_STEMS.map((_, i) => (session.complete(i) ? session.received[i] : 0));
    if (lengths.some((n) => n === 0)) return;
    live.duration = Math.max(...lengths) / (header.bitrate * 125);
  }

  /** The job is done and its files are in R2. A stem that streamed whole is
   *  its file already. One whose stream stopped short carries on from its
   *  file where the stream stopped, and a stem encoded again (rescaled, or a
   *  stream that turns out to differ from the file) carries on from the new
   *  encoding at the frame decoding had reached. Playback carries on
   *  throughout. Rejects if a file can't be had, for the caller to fall
   *  back to `handOver`. */
  async completeLive(load: { stems: Record<string, string>; gains?: Record<string, number> }) {
    const live = this.live;
    if (!live || this.mode !== "live") return;
    const { session, worker } = live;
    // END goes before the upload, so it's normally here already.
    if (!session.done) await Promise.race([session.settled, sleep(3000)]);
    session.close();
    const header = live.header;
    if (!header) throw new Error("No live header");
    const tell = (message: ToDecoder, transfer: Transferable[] = []) =>
      worker.postMessage(message, transfer);

    const lengths = await Promise.all(
      LIVE_STEMS.map(async (name, i) => {
        const url = load.stems[name];
        if (!url) throw new Error(`No ${name} stem`);
        const gain = load.gains?.[name] ?? header.gain;
        const rescaled = session.end?.rescaled.includes(name) || gain < header.gain - 1e-6;
        if (!rescaled && session.complete(i)) return session.received[i];
        if (!rescaled) {
          const filled = await this.fillFrom(live, i, url, session.received[i], session.tail(i));
          if (filled !== null) return filled;
        }
        // Another encoding: take it from where decoding has got to.
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`${name} stem ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (this.live !== live) return bytes.byteLength;
        tell({ type: "replace", stem: i, gainNorm: header.gain / gain });
        tell({ type: "bytes", stem: i, bytes }, [bytes.buffer]);
        tell({ type: "end", stem: i });
        return bytes.byteLength;
      }),
    );
    if (this.live === live) this.settleDuration(live, lengths);
  }

  /** Streams the rest of a stem's file into its decoder, from byte `from`.
   *  The bytes just before must match `tail`, what the stream ended with,
   *  or the file is another encoding: then null, having sent nothing. */
  private async fillFrom(
    live: LivePlayback,
    stem: number,
    url: string,
    from: number,
    tail: Uint8Array,
  ): Promise<number | null> {
    const start = from - tail.byteLength;
    // no-store: Chrome holds a fetch of a URL an <audio> element is loading.
    const res = await fetch(url, {
      cache: "no-store",
      headers: start > 0 ? { Range: `bytes=${start}-` } : {},
    });
    if (!res.ok || !res.body) throw new Error(`stem fill ${res.status}`);
    // A server that ignores the range sends it all.
    let skip = res.status === 206 ? 0 : start;
    let checked = 0;
    let total = from;
    const reader = res.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      let chunk = value;
      if (skip > 0) {
        const drop = Math.min(skip, chunk.byteLength);
        skip -= drop;
        chunk = chunk.subarray(drop);
      }
      while (checked < tail.byteLength && chunk.byteLength > 0) {
        if (chunk[0] !== tail[checked]) {
          await reader.cancel();
          return null;
        }
        checked++;
        chunk = chunk.subarray(1);
      }
      if (chunk.byteLength === 0) continue;
      if (this.live !== live) {
        await reader.cancel();
        return total;
      }
      const bytes = chunk.slice();
      total += bytes.byteLength;
      live.worker.postMessage({ type: "bytes", stem, bytes } satisfies ToDecoder, [bytes.buffer]);
    }
    if (checked < tail.byteLength) return null;
    live.worker.postMessage({ type: "end", stem } satisfies ToDecoder);
    return total;
  }

  /** Switches from live playback to the finished files, at the same place
   *  and with the same mix: the fallback when the stream can't be completed. */
  async handOver(load: { stems: Record<string, string>; gains?: Record<string, number> }) {
    const live = this.live;
    const at = this.currentTime;
    const playing = this.isPlaying;
    const rate = live?.rate ?? 1;
    const loop = live?.loop ?? null;
    await this.loadStems(load.stems, load.gains, { keepMix: true });
    this.setSpeed(rate);
    if (loop) this.setLoop(loop.start / LIVE_RATE, loop.end / LIVE_RATE);
    this.seek(at);
    if (playing) this.play();
  }

  play(): void {
    const ctx = this.getContext();
    if (ctx.state === "suspended") ctx.resume();

    if (this.live) {
      // As a media element does, play from the end starts over.
      if (this.live.ended) this.seek(0);
      this.live.playing = true;
      this.toPlayer({ type: "play" });
    }
    for (const [, stem] of this.stems) {
      void stem.audio?.play();
    }
    // A take only runs while the song does, so it never records silence.
    this._recorder?.resume();
  }

  pause(): void {
    if (this.live) {
      this.live.pos = this.currentTime * LIVE_RATE;
      this.live.playing = false;
      this.toPlayer({ type: "pause" });
    }
    for (const [, stem] of this.stems) {
      stem.audio?.pause();
    }
    this._recorder?.pause();
  }

  seek(time: number): void {
    if (this.live && this.ctx) {
      this.live.pos = time * LIVE_RATE;
      this.live.ctxTime = this.ctx.currentTime;
      this.live.ended = false;
      this.toPlayer({ type: "seek", sample: time * LIVE_RATE });
    }
    for (const [, stem] of this.stems) {
      if (stem.audio) stem.audio.currentTime = time;
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
    const value = muted ? 0 : (this.levels.get(stemName) ?? 1) * (this.restore.get(stemName) ?? 1);
    const ctx = this.getContext();
    stem.gain.gain.linearRampToValueAtTime(value, ctx.currentTime + 0.02);
  }

  setSpeed(rate: number): void {
    if (this.live) {
      // Where it is now, at the old rate, before the new one takes over.
      if (this.ctx) {
        this.live.pos = this.currentTime * LIVE_RATE;
        this.live.ctxTime = this.ctx.currentTime;
      }
      this.live.rate = rate;
      this.toPlayer({ type: "rate", rate });
    }
    for (const [, stem] of this.stems) if (stem.audio) stem.audio.playbackRate = rate;
  }

  setEffects(settings: EffectsSettings): void {
    this.effectsSettings = settings;
    this._effects?.apply(settings);
  }

  /** The loop's in point, set before its out point is: live playback keeps
   *  what it decodes from here, so the loop can jump back without waiting.
   *  Null forgets it. */
  setLoopIn(time: number | null): void {
    this.toPlayer({ type: "retain", from: time === null ? null : time * LIVE_RATE });
  }

  /** Jump back to `start` whenever playback reaches `end`. A timer rather than
   *  rAF: rAF stops in background tabs, while timers in audible tabs keep
   *  running. Live playback loops in the worklet, to the sample. Pass nulls
   *  to clear. */
  setLoop(start: number | null, end: number | null): void {
    if (this.loopTimer !== null) clearInterval(this.loopTimer);
    this.loopTimer = null;
    if (this.live) {
      if (start === null || end === null) {
        this.live.loop = null;
        this.toPlayer({ type: "loop", start: null, end: null });
        this.toPlayer({ type: "retain", from: null });
      } else {
        this.live.loop = { start: start * LIVE_RATE, end: end * LIVE_RATE };
        this.toPlayer({ type: "loop", ...this.live.loop });
      }
      return;
    }
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
    const live = this.live;
    if (live) {
      let pos = live.pos;
      if (live.playing && !live.buffering && this.ctx) {
        // Carried on from the worklet's last report, at most a little way.
        const since = Math.min(0.25, Math.max(0, this.ctx.currentTime - live.ctxTime));
        pos += since * live.rate * LIVE_RATE;
        if (live.loop && pos >= live.loop.end) pos -= live.loop.end - live.loop.start;
      }
      const t = pos / LIVE_RATE;
      return live.duration > 0 ? Math.min(t, live.duration) : t;
    }
    const first = this.stems.values().next().value;
    return first?.audio?.currentTime ?? 0;
  }

  get duration(): number {
    if (this.live) return this.live.duration;
    const first = this.stems.values().next().value;
    return first?.audio?.duration ?? 0;
  }

  get isPlaying(): boolean {
    if (this.live) return this.live.playing;
    const first = this.stems.values().next().value;
    return first?.audio ? !first.audio.paused : false;
  }

  /** Seconds of every stem that have arrived, while playing live. */
  get loaded(): number {
    return this.live?.session.loaded ?? this.duration;
  }

  get destination(): AudioNode | null {
    return this.masterGain;
  }

  get audioContext(): AudioContext | null {
    return this.ctx;
  }

  /** `keepMix` keeps the levels, isolation and the take in progress, for a
   *  switch to the same song's files. */
  dispose({ keepMix = false } = {}): void {
    this.setLoop(null, null);
    this._effects?.dispose();
    this._effects = null;
    this.bus?.disconnect();
    this.bus = null;
    if (!keepMix) {
      // A new track starts at full mix, as the store does. New audio elements
      // start at normal speed on their own.
      this.levels.clear();
      this.isolated.clear();
      this._recorder = null;
      this.effectsSettings = null;
    }
    for (const [, stem] of this.stems) {
      if (stem.audio) {
        stem.audio.pause();
        stem.audio.src = "";
      }
      stem.source.disconnect();
      stem.gain.disconnect();
      stem.analyser.disconnect();
    }
    this.stems.clear();
    const live = this.live;
    if (live) {
      this.live = null;
      live.session.close();
      live.worker.terminate();
      if (live.node) {
        live.node.port.onmessage = null;
        live.node.disconnect();
      }
      for (const trim of live.trims) trim.disconnect();
      if (live.buffering) this.onBuffering?.(false);
    }
    this.mode = "media";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
