/** The live stream's framing, shared by Modal's sender (`_Live` in
 *  modal/app.py, which packs the same layout with `struct`), the LiveRelay
 *  Durable Object (worker/live-relay.ts) and the browser (app/lib/audio/live.ts).
 *
 *  Every frame is a 10-byte head, little-endian, then its payload:
 *
 *    u8 type | u8 stem | u32 value | u32 length | payload
 *
 *  `value` is the payload's byte offset in its stem for DATA, the stem's
 *  length for STEM_END and the new epoch for RESET; 0 otherwise. Modal sends
 *  one frame per WebSocket message; the relay sends the browser a stream of
 *  them back to back. */

export const LiveFrame = {
  /** JSON `LiveHeader`. First, before any data. */
  HEADER: 1,
  /** A piece of one stem's MP3, at `value` bytes into it. */
  DATA: 2,
  /** That stem is complete at `value` bytes. A stem that had to be rescaled
   *  never gets one: its stream stopped where clipping was found. */
  STEM_END: 3,
  /** JSON `LiveEnd`. The job has encoded everything; nothing follows. */
  END: 4,
  /** The song is being separated again from the start (a file that couldn't
   *  be decoded as it streamed). What came before is void; offsets restart
   *  at 0 in epoch `value`. */
  RESET: 5,
  /** UTF-8 reason. The stream stops here; the finished files still come. */
  ABORT: 6,
  /** Nothing, to keep idle connections open. */
  KEEPALIVE: 7,
} as const;

export type LiveFrameType = (typeof LiveFrame)[keyof typeof LiveFrame];

/** Stem order on the wire, as `STEMS` in modal/app.py. */
export const LIVE_STEMS = ["vocals", "drums", "bass", "other"] as const;

export const FRAME_HEAD_BYTES = 10;

/** The most a DATA frame carries, from Modal and from the relay. */
export const LIVE_PIECE_BYTES = 64 * 1024;

export interface LiveHeader {
  stems: string[];
  samplerate: number;
  channels: number;
  /** kbps, constant. */
  bitrate: number;
  /** What every stem is stored at; the player turns each up by 1 / this. */
  gain: number;
  /** Seconds, from the file or the link's page; null if neither said. */
  durationHint: number | null;
  title: string | null;
}

export interface LiveEnd {
  /** Each stem's stored gain, as the finished job reports it. */
  gains: Record<string, number>;
  /** Stems whose stream stopped short and were encoded again, quieter. */
  rescaled: string[];
  /** Each stem's streamed length. */
  bytes: Record<string, number>;
}

export interface Frame {
  type: number;
  stem: number;
  value: number;
  payload: Uint8Array;
}

const EMPTY = new Uint8Array(0);

export function encodeFrame(
  type: LiveFrameType,
  stem = 0,
  value = 0,
  payload: Uint8Array = EMPTY,
): Uint8Array {
  const out = new Uint8Array(FRAME_HEAD_BYTES + payload.byteLength);
  const view = new DataView(out.buffer);
  view.setUint8(0, type);
  view.setUint8(1, stem);
  view.setUint32(2, value, true);
  view.setUint32(6, payload.byteLength, true);
  out.set(payload, FRAME_HEAD_BYTES);
  return out;
}

/** One whole frame, as a WebSocket message carries it. */
export function decodeFrame(bytes: Uint8Array): Frame | null {
  if (bytes.byteLength < FRAME_HEAD_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(6, true);
  if (FRAME_HEAD_BYTES + length !== bytes.byteLength) return null;
  return {
    type: view.getUint8(0),
    stem: view.getUint8(1),
    value: view.getUint32(2, true),
    payload: bytes.subarray(FRAME_HEAD_BYTES),
  };
}

/** Frames from a byte stream that splits them anywhere. Each payload is its
 *  own copy, so it can be transferred to a worker. */
export class FrameReader {
  private buf = new Uint8Array(64 * 1024);
  private start = 0;
  private end = 0;

  push(chunk: Uint8Array): Frame[] {
    this.append(chunk);
    const frames: Frame[] = [];
    while (this.end - this.start >= FRAME_HEAD_BYTES) {
      const view = new DataView(this.buf.buffer, this.start, FRAME_HEAD_BYTES);
      const length = view.getUint32(6, true);
      const total = FRAME_HEAD_BYTES + length;
      if (this.end - this.start < total) break;
      frames.push({
        type: view.getUint8(0),
        stem: view.getUint8(1),
        value: view.getUint32(2, true),
        payload: this.buf.slice(this.start + FRAME_HEAD_BYTES, this.start + total),
      });
      this.start += total;
    }
    return frames;
  }

  private append(chunk: Uint8Array): void {
    if (this.start === this.end) this.start = this.end = 0;
    if (this.end + chunk.byteLength > this.buf.byteLength) {
      // Slide what's held to the front, into a bigger buffer if it won't fit.
      const held = this.end - this.start;
      if (held + chunk.byteLength > this.buf.byteLength) {
        const next = new Uint8Array((held + chunk.byteLength) * 2);
        next.set(this.buf.subarray(this.start, this.end));
        this.buf = next;
      } else {
        this.buf.copyWithin(0, this.start, this.end);
      }
      this.start = 0;
      this.end = held;
    }
    this.buf.set(chunk, this.end);
    this.end += chunk.byteLength;
  }
}
