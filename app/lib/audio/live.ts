/** Reads a job's live stream from its LiveRelay (GET /api/live/<taskId>):
 *  the stems' MP3 as the GPU job encodes them, interleaved by audio time.
 *  Reconnects with the offsets it has if the connection drops, and keeps
 *  the tail of each stem, to check that a finished file carries on from it.
 *  It only reads; AudioEngine.loadLive decodes and plays. */
import {
  FrameReader,
  LIVE_STEMS,
  LiveFrame,
  type LiveEnd,
  type LiveHeader,
} from "../live-protocol";

/** Bytes of each stem kept to compare with the finished file. */
const TAIL_BYTES = 4096;
const MAX_RECONNECTS = 4;

export interface LiveListener {
  header(header: LiveHeader): void;
  /** In order, from where the last piece of this stem ended. */
  data(stem: number, bytes: Uint8Array): void;
  /** What came before is void; each stem starts again from its first byte. */
  reset(): void;
  /** This stem arrived whole: nothing more of it is coming. */
  ended(stem: number): void;
}

export class LiveSession {
  header: LiveHeader | null = null;
  end: LiveEnd | null = null;
  /** Why the stream stopped short, if it did. */
  failure: string | null = null;
  epoch = 0;
  /** Bytes of each stem in this epoch. */
  readonly received = LIVE_STEMS.map(() => 0);
  readonly stemEnded = LIVE_STEMS.map(() => false);
  private tails = LIVE_STEMS.map(() => new Uint8Array(0));
  private listener: LiveListener | null = null;
  private held: Array<() => void> = [];
  private abort = new AbortController();
  private settle!: () => void;
  /** Resolves once the stream has ended, stopped or been closed. */
  readonly settled = new Promise<void>((resolve) => (this.settle = resolve));

  constructor(readonly taskId: string) {
    performance.mark("live:open");
    void this.run();
  }

  /** Who gets what arrives. What came before it is handed over first. */
  listen(listener: LiveListener): void {
    this.listener = listener;
    for (const deliver of this.held.splice(0)) deliver();
  }

  get done(): boolean {
    return this.end !== null || this.failure !== null;
  }

  /** Whether every stem arrived whole: its file holds nothing more. */
  complete(stem: number): boolean {
    const name = LIVE_STEMS[stem];
    return (
      this.end !== null &&
      !this.end.rescaled.includes(name) &&
      this.stemEnded[stem] &&
      this.received[stem] === this.end.bytes[name]
    );
  }

  /** The last bytes received of a stem. */
  tail(stem: number): Uint8Array {
    return this.tails[stem];
  }

  /** Seconds of every stem received so far. */
  get loaded(): number {
    if (!this.header) return 0;
    return Math.min(...this.received) / (this.header.bitrate * 125);
  }

  close(): void {
    this.abort.abort();
    this.failure ??= "closed";
    this.settle();
  }

  private emit(deliver: () => void): void {
    if (this.listener) deliver();
    else this.held.push(deliver);
  }

  private async run(): Promise<void> {
    let attempts = 0;
    while (!this.done) {
      try {
        const query = `from=${this.received.join(",")}&epoch=${this.epoch}`;
        // no-store: a URL an <audio> element is already loading would make
        // Chrome wait for that load.
        const res = await fetch(`/api/live/${this.taskId}?${query}`, {
          cache: "no-store",
          signal: this.abort.signal,
        });
        // Live playback is off, or there's no such task: nothing to retry.
        if (res.status === 404 || !res.body) {
          this.failure = `unavailable (${res.status})`;
          break;
        }
        if (!res.ok) throw new Error(`live stream ${res.status}`);
        const reader = res.body.getReader();
        const frames = new FrameReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          attempts = 0;
          for (const frame of frames.push(value))
            this.handle(frame.type, frame.stem, frame.value, frame.payload);
          if (this.done) break;
        }
      } catch (err) {
        if (this.abort.signal.aborted) break;
        if (++attempts > MAX_RECONNECTS) {
          this.failure = err instanceof Error ? err.message : String(err);
          break;
        }
        await new Promise((r) => setTimeout(r, 250 * attempts));
      }
    }
    this.settle();
  }

  private handle(type: number, stem: number, value: number, payload: Uint8Array): void {
    switch (type) {
      case LiveFrame.HEADER: {
        if (this.header) return;
        const header = JSON.parse(new TextDecoder().decode(payload)) as LiveHeader;
        this.header = header;
        performance.mark("live:header");
        this.emit(() => this.listener?.header(header));
        return;
      }
      case LiveFrame.DATA: {
        if (stem >= LIVE_STEMS.length) return;
        // Resumed streams can repeat a little; a gap can't be decoded across,
        // so a stem with one stops here and is filled in from its file.
        const have = this.received[stem];
        if (value > have || value + payload.byteLength <= have) return;
        const bytes = payload.subarray(have - value);
        if (have === 0 && this.received.every((r) => r === 0)) performance.mark("live:first-data");
        this.received[stem] += bytes.byteLength;
        this.keepTail(stem, bytes);
        this.emit(() => this.listener?.data(stem, bytes));
        return;
      }
      case LiveFrame.STEM_END:
        if (stem < LIVE_STEMS.length && value === this.received[stem]) this.stemEnded[stem] = true;
        return;
      case LiveFrame.END:
        this.end = JSON.parse(new TextDecoder().decode(payload)) as LiveEnd;
        LIVE_STEMS.forEach((_, i) => {
          if (this.complete(i)) this.emit(() => this.listener?.ended(i));
        });
        return;
      case LiveFrame.RESET:
        this.epoch = value;
        this.received.fill(0);
        this.stemEnded.fill(false);
        this.tails = LIVE_STEMS.map(() => new Uint8Array(0));
        this.emit(() => this.listener?.reset());
        return;
      case LiveFrame.ABORT:
        this.failure = new TextDecoder().decode(payload) || "aborted";
        return;
    }
  }

  private keepTail(stem: number, bytes: Uint8Array): void {
    const old = this.tails[stem];
    const keep = Math.min(TAIL_BYTES, old.byteLength + bytes.byteLength);
    const tail = new Uint8Array(keep);
    const fromNew = Math.min(keep, bytes.byteLength);
    tail.set(old.subarray(old.byteLength - (keep - fromNew)), 0);
    tail.set(bytes.subarray(bytes.byteLength - fromNew), keep - fromNew);
    this.tails[stem] = tail;
  }
}
