/** LiveRelay: one Durable Object per task, relaying the stems' MP3 from the
 *  Modal job to the browser while they're still being encoded.
 *
 *  Modal connects a WebSocket to /api/live/<taskId>/ingest and sends one
 *  frame per message (app/lib/live-protocol.ts). The browser reads
 *  GET /api/live/<taskId>?from=<offsets>&epoch=<n>, a streaming response of
 *  the same frames, interleaved by audio time: each piece comes from the stem
 *  this reader has been sent least of. Resuming is a new GET with the
 *  offsets it has.
 *
 *  Everything is held in memory and nothing is stored: the object lives as
 *  long as a connection does, and an alarm clears it a couple of minutes
 *  after the stream ends. */
import { DurableObject } from "cloudflare:workers";
import { LIVE_STEMS, LiveFrame, decodeFrame, encodeFrame } from "../app/lib/live-protocol";

/** The most a reader is sent from one stem at a time: ~1.4 s of audio. */
const PIECE_BYTES = 32 * 1024;
/** A 10-minute song is ~58 MB, under an isolate's 128 MB with room left. */
const MAX_BYTES = 64 * 1024 * 1024;
const KEEPALIVE_MS = 15_000;
/** How long a finished stream stays for a reader that's behind or resuming. */
const LINGER_MS = 2 * 60_000;
/** Clears a task whose stream never finished, past Modal's 15-minute limit. */
const ABANDON_MS = 20 * 60_000;

interface Stem {
  /** Pieces as they came, starting `base` bytes into the stem. */
  chunks: Uint8Array[];
  starts: number[];
  base: number;
  length: number;
  ended: boolean;
}

interface Reader {
  epoch: number;
  sent: number[];
  headerSent: boolean;
  stemEnds: boolean[];
  done: boolean;
}

const freshStems = (): Stem[] =>
  LIVE_STEMS.map(() => ({ chunks: [], starts: [], base: 0, length: 0, ended: false }));

export class LiveRelay extends DurableObject<Env> {
  private header: Uint8Array | null = null;
  private epoch = 0;
  private stems = freshStems();
  private end: Uint8Array | null = null;
  private abort: Uint8Array | null = null;
  private stored = 0;
  /** Over MAX_BYTES with nothing it could drop: later data isn't kept, and
   *  the browser fills in from R2 once the files are there. */
  private truncated = false;
  private ingest: WebSocket | null = null;
  private readers = new Set<Reader>();
  private waiters = new Set<() => void>();
  private alarmSet = false;

  async fetch(request: Request): Promise<Response> {
    await this.scheduleCleanup(ABANDON_MS);
    const url = new URL(request.url);
    if (url.pathname.endsWith("/ingest")) return this.accept(request);
    return this.read(url);
  }

  async alarm(): Promise<void> {
    this.alarmSet = false;
    this.ingest?.close(1000, "expired");
    this.ingest = null;
    this.header = this.end = null;
    this.abort ??= new TextEncoder().encode("expired");
    this.stems = freshStems();
    this.stored = 0;
    this.notify();
  }

  private async scheduleCleanup(ms: number): Promise<void> {
    if (this.alarmSet && ms === ABANDON_MS) return;
    this.alarmSet = true;
    await this.ctx.storage.setAlarm(Date.now() + ms);
  }

  // Ingest -------------------------------------------------------------------

  private accept(request: Request): Response {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket", { status: 426 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    // Otherwise binary messages arrive as Blobs at this compatibility date.
    server.binaryType = "arraybuffer";
    server.accept();
    // A sender that reconnects replaces the one before.
    this.ingest?.close(1000, "replaced");
    this.ingest = server;
    server.addEventListener("message", (event) => {
      if (typeof event.data !== "string") this.receive(new Uint8Array(event.data as ArrayBuffer));
    });
    const gone = () => {
      if (this.ingest !== server) return;
      this.ingest = null;
      // The job carries on without us; the browser fills in from R2.
      if (!this.end && !this.abort) this.finish(null, "sender disconnected");
    };
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);
    return new Response(null, { status: 101, webSocket: client });
  }

  private receive(bytes: Uint8Array): void {
    const frame = decodeFrame(bytes);
    if (!frame) return;
    switch (frame.type) {
      case LiveFrame.HEADER:
        this.header = frame.payload;
        break;
      case LiveFrame.DATA: {
        const stem = this.stems[frame.stem];
        // In order or not at all: the browser's decoder needs every byte.
        if (!stem || frame.value !== stem.length || stem.ended) break;
        if (this.truncated) break;
        if (this.stored + frame.payload.byteLength > MAX_BYTES && !this.drop(frame.payload)) {
          this.truncated = true;
          break;
        }
        stem.chunks.push(frame.payload);
        stem.starts.push(stem.length);
        stem.length += frame.payload.byteLength;
        this.stored += frame.payload.byteLength;
        break;
      }
      case LiveFrame.STEM_END: {
        const stem = this.stems[frame.stem];
        if (stem && !this.truncated) stem.ended = true;
        break;
      }
      case LiveFrame.END:
        this.finish(frame.payload, null);
        return;
      case LiveFrame.RESET:
        this.epoch = frame.value;
        this.stems = freshStems();
        this.stored = 0;
        this.truncated = false;
        break;
      case LiveFrame.ABORT:
        this.finish(null, frame.payload);
        return;
      default:
        return;
    }
    this.notify();
  }

  private finish(end: Uint8Array | null, abort: Uint8Array | string | null): void {
    this.end = end;
    this.abort = typeof abort === "string" ? new TextEncoder().encode(abort) : abort;
    this.notify();
    this.alarmSet = false;
    void this.scheduleCleanup(LINGER_MS);
  }

  /** Frees pieces every reader has been sent, to make room for `incoming`.
   *  Whether there's now room. */
  private drop(incoming: Uint8Array): boolean {
    const current = [...this.readers].filter((r) => r.epoch === this.epoch && !r.done);
    if (current.length === 0) return false;
    this.stems.forEach((stem, i) => {
      const sent = Math.min(...current.map((r) => r.sent[i]));
      while (stem.chunks.length && stem.starts[0] + stem.chunks[0].byteLength <= sent) {
        const piece = stem.chunks.shift()!;
        stem.starts.shift();
        stem.base += piece.byteLength;
        this.stored -= piece.byteLength;
      }
    });
    return this.stored + incoming.byteLength <= MAX_BYTES;
  }

  // Readers ------------------------------------------------------------------

  private read(url: URL): Response {
    const epoch = Number(url.searchParams.get("epoch") ?? 0);
    const from = (url.searchParams.get("from") ?? "").split(",").map(Number);
    const reader: Reader = {
      epoch: Number.isInteger(epoch) ? epoch : 0,
      sent: LIVE_STEMS.map((_, i) => (Number.isInteger(from[i]) && from[i] > 0 ? from[i] : 0)),
      headerSent: false,
      stemEnds: LIVE_STEMS.map(() => false),
      done: false,
    };
    this.readers.add(reader);
    const body = new ReadableStream<Uint8Array>(
      {
        pull: async (controller) => {
          for (;;) {
            const frame = this.next(reader);
            if (frame) {
              controller.enqueue(frame);
              if (reader.done) {
                this.readers.delete(reader);
                controller.close();
              }
              return;
            }
            if (!(await this.changed(KEEPALIVE_MS))) {
              controller.enqueue(encodeFrame(LiveFrame.KEEPALIVE));
              return;
            }
          }
        },
        cancel: () => {
          reader.done = true;
          this.readers.delete(reader);
        },
      },
      new ByteLengthQueuingStrategy({ highWaterMark: 2 * PIECE_BYTES }),
    );
    return new Response(body, {
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "no-store, no-transform",
        "x-content-type-options": "nosniff",
      },
    });
  }

  /** The next frame for this reader, or null to wait for more. */
  private next(r: Reader): Uint8Array | null {
    if (!r.headerSent && this.header) {
      r.headerSent = true;
      return encodeFrame(LiveFrame.HEADER, 0, 0, this.header);
    }
    if (r.headerSent && r.epoch !== this.epoch) {
      r.epoch = this.epoch;
      r.sent = r.sent.map(() => 0);
      r.stemEnds = r.stemEnds.map(() => false);
      return encodeFrame(LiveFrame.RESET, 0, this.epoch);
    }
    if (r.headerSent) {
      // The stem this reader has least of, so the four arrive in step.
      let best = -1;
      let at = 0;
      this.stems.forEach((stem, i) => {
        const from = Math.max(r.sent[i], stem.base);
        if (from < stem.length && (best < 0 || from < at)) {
          best = i;
          at = from;
        }
      });
      if (best >= 0) {
        const piece = this.slice(this.stems[best], at);
        r.sent[best] = at + piece.byteLength;
        return encodeFrame(LiveFrame.DATA, best, at, piece);
      }
      for (let i = 0; i < this.stems.length; i++) {
        const stem = this.stems[i];
        if (stem.ended && !r.stemEnds[i] && r.sent[i] >= stem.length) {
          r.stemEnds[i] = true;
          return encodeFrame(LiveFrame.STEM_END, i, stem.length);
        }
      }
      if (this.end) {
        r.done = true;
        return encodeFrame(LiveFrame.END, 0, 0, this.end);
      }
    }
    if (this.abort) {
      r.done = true;
      return encodeFrame(LiveFrame.ABORT, 0, 0, this.abort);
    }
    return null;
  }

  /** Up to PIECE_BYTES of a stem from byte `at`, within one stored piece. */
  private slice(stem: Stem, at: number): Uint8Array {
    let lo = 0;
    let hi = stem.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (stem.starts[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    const offset = at - stem.starts[lo];
    return stem.chunks[lo].subarray(offset, offset + PIECE_BYTES);
  }

  private changed(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.waiters.delete(wake);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.waiters.delete(wake);
        resolve(false);
      }, ms);
      this.waiters.add(wake);
    });
  }

  private notify(): void {
    for (const wake of [...this.waiters]) wake();
  }
}
