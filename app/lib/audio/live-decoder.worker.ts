/** Decodes the four live stems for the player worklet (live-processor.ts).
 *
 *  Holds every byte of each stem it's been given, so it can decode from
 *  anywhere: to start, after a seek, or to carry on from a new encoding of a
 *  stem (a RESET, or a stem that was rescaled) at the frame it had reached.
 *  Decodes ahead of the worklet's playhead, the stem furthest behind first,
 *  and posts planar blocks straight to the worklet over a MessagePort. */
import { MPEGDecoder } from "mpg123-decoder";
import { Mp3FrameIndex } from "./mp3-frames";

/** Seconds decoded ahead of the playhead. */
const AHEAD_SECONDS = 10;
/** Frames per decode call: ~0.4 s, small enough to start quickly. */
const BATCH_FRAMES = 16;
/** Frames decoded and thrown away before a frame decoded out of order, to
 *  fill the bit reservoir. */
const PRIME_FRAMES = 2;
/** The most one turn of decoding takes before letting messages in. */
const SLICE_MS = 8;

export type ToDecoder =
  | { type: "init"; port: MessagePort }
  /** More of a stem, in order. */
  | { type: "bytes"; stem: number; bytes: Uint8Array }
  /** That's all of this stem. */
  | { type: "end"; stem: number }
  /** What follows is a fresh encoding of this stem, from its start. Decoding
   *  carries on from the frame it had reached, its samples scaled by
   *  `gainNorm` to match the level of the rest. */
  | { type: "replace"; stem: number; gainNorm: number };

/** To the worklet. */
export type DecodedBlock = {
  type: "block";
  stem: number;
  start: number;
  gen: number;
  l: Float32Array;
  r: Float32Array;
};
export type DecodedEnd = { type: "eof"; stem: number; end: number; gen: number };

/** From the worklet. */
export type FromPlayer =
  | { type: "playhead"; pos: number }
  | { type: "seek"; sample: number; gen: number };

interface Stem {
  bytes: Uint8Array;
  length: number;
  index: Mp3FrameIndex;
  ended: boolean;
  decoder: MPEGDecoder | null;
  /** Bumped by every prime, so a decoder that finishes loading late is dropped. */
  token: number;
  /** Next frame to feed. */
  next: number;
  /** Samples still to throw away from what comes out. */
  skip: number;
  /** Sample index of the next sample out. */
  frontier: number;
  gainNorm: number;
  eofSent: boolean;
}

const scope = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<ToDecoder>) => void) | null;
};

const newStore = () => ({ bytes: new Uint8Array(1 << 20), length: 0, index: new Mp3FrameIndex() });

const stems: Stem[] = [0, 1, 2, 3].map(() => ({
  ...newStore(),
  ended: false,
  decoder: null,
  token: 0,
  next: 0,
  skip: 0,
  frontier: 0,
  gainNorm: 1,
  eofSent: false,
}));

let port: MessagePort | null = null;
let playhead = 0;
let gen = 0;
let pumping = false;
let scheduled = false;

function append(s: Stem, chunk: Uint8Array): void {
  if (s.length + chunk.byteLength > s.bytes.byteLength) {
    const grown = new Uint8Array(Math.max(s.bytes.byteLength * 2, s.length + chunk.byteLength));
    grown.set(s.bytes.subarray(0, s.length));
    s.bytes = grown;
  }
  s.bytes.set(chunk, s.length);
  s.length += chunk.byteLength;
  s.index.scan(s.bytes, s.length);
}

/** Decode this stem from frame `frame` on, with a fresh decoder. */
function prime(s: Stem, frame: number): void {
  const from = Math.max(0, frame - PRIME_FRAMES);
  const spf = s.index.samplesPerFrame;
  s.next = from;
  s.skip = (frame - from) * spf;
  s.frontier = frame * spf;
  s.eofSent = false;
  s.decoder?.free();
  s.decoder = null;
  const token = ++s.token;
  const decoder = new MPEGDecoder({ enableGapless: false });
  void decoder.ready.then(() => {
    if (token !== s.token) return decoder.free();
    s.decoder = decoder;
    pump();
  });
}

function decodeSome(i: number, s: Stem, decoder: MPEGDecoder): void {
  const to = Math.min(s.index.count, s.next + BATCH_FRAMES);
  const [a, b] = s.index.range(s.next, to);
  const out = decoder.decode(s.bytes.subarray(a, b));
  s.next = to;
  let [l, r] = out.channelData;
  let n = out.samplesDecoded;
  if (!l || !r || n === 0) return;
  if (s.skip > 0) {
    const drop = Math.min(s.skip, n);
    s.skip -= drop;
    n -= drop;
    l = l.subarray(drop);
    r = r.subarray(drop);
  }
  if (n === 0) return;
  if (s.gainNorm !== 1) {
    for (let k = 0; k < n; k++) {
      l[k] *= s.gainNorm;
      r[k] *= s.gainNorm;
    }
  }
  const block: DecodedBlock = { type: "block", stem: i, start: s.frontier, gen, l, r };
  port?.postMessage(block, [l.buffer, r.buffer]);
  s.frontier += n;
}

function pump(): void {
  if (pumping || !port) return;
  pumping = true;
  const began = performance.now();
  try {
    for (;;) {
      let best = -1;
      stems.forEach((s, i) => {
        if (!s.decoder) return;
        if (s.next >= s.index.count) {
          if (s.ended && !s.eofSent) {
            s.eofSent = true;
            const end: DecodedEnd = { type: "eof", stem: i, end: s.frontier, gen };
            port?.postMessage(end);
          }
          return;
        }
        if (s.frontier >= playhead + AHEAD_SECONDS * s.index.sampleRate) return;
        if (best < 0 || s.frontier < stems[best].frontier) best = i;
      });
      if (best < 0) break;
      decodeSome(best, stems[best], stems[best].decoder!);
      if (performance.now() - began > SLICE_MS) {
        if (!scheduled) {
          scheduled = true;
          setTimeout(() => {
            scheduled = false;
            pump();
          }, 0);
        }
        break;
      }
    }
  } finally {
    pumping = false;
  }
}

function fromPlayer(event: MessageEvent<FromPlayer>): void {
  const m = event.data;
  if (m.type === "playhead") {
    playhead = m.pos;
  } else if (m.type === "seek") {
    gen = m.gen;
    for (const s of stems) prime(s, Math.floor(m.sample / s.index.samplesPerFrame));
  }
  pump();
}

scope.onmessage = (event) => {
  const m = event.data;
  if (m.type === "init") {
    port = m.port;
    port.onmessage = fromPlayer;
    for (const s of stems) prime(s, 0);
  } else if (m.type === "bytes") {
    append(stems[m.stem], m.bytes);
  } else if (m.type === "end") {
    stems[m.stem].ended = true;
  } else if (m.type === "replace") {
    const s = stems[m.stem];
    Object.assign(s, newStore(), { ended: false, gainNorm: m.gainNorm });
    prime(s, Math.floor(s.frontier / s.index.samplesPerFrame));
  }
  pump();
};
