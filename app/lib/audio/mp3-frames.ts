/** Finds MP3 frames in a stem's bytes as they arrive, so the live decoder can
 *  start anywhere: frame k holds samples [k·1152, (k+1)·1152) for MPEG-1 Layer
 *  III, and mpg123 decodes from frame k−2 onwards sample for sample as it
 *  would from the start (measured: within 1e-7). The stems are LAME's CBR,
 *  192 kbps, with no tag frame, so this only needs Layer III. */

// kbps by bitrate index, for MPEG-1 and for MPEG-2/2.5, Layer III.
const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES = [44100, 48000, 32000];

export interface FrameInfo {
  length: number;
  samples: number;
  sampleRate: number;
}

/** A Layer III frame header at `at`, or null if there isn't one. */
export function readFrameHeader(bytes: Uint8Array, at: number): FrameInfo | null {
  if (at + 4 > bytes.length) return null;
  const b1 = bytes[at + 1];
  const b2 = bytes[at + 2];
  if (bytes[at] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 3; // 3: MPEG-1, 2: MPEG-2, 0: MPEG-2.5
  const layer = (b1 >> 1) & 3; // 1: Layer III
  if (version === 1 || layer !== 1) return null;
  const bitrateIndex = b2 >> 4;
  const rateIndex = (b2 >> 2) & 3;
  if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const v1 = version === 3;
  const kbps = (v1 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex];
  const sampleRate = SAMPLE_RATES[rateIndex] / (v1 ? 1 : version === 2 ? 2 : 4);
  const padding = (b2 >> 1) & 1;
  const samples = v1 ? 1152 : 576;
  const length = Math.floor(((samples / 8) * kbps * 1000) / sampleRate) + padding;
  return { length, samples, sampleRate };
}

/** Where each complete frame starts in a growing buffer. */
export class Mp3FrameIndex {
  /** Start of each complete frame. */
  readonly offsets: number[] = [];
  /** Just past the last complete frame. */
  end = 0;
  samplesPerFrame = 1152;
  sampleRate = 44100;
  /** Where the next scan starts. */
  private at = 0;

  /** Indexes whatever new frames `bytes[0, length)` completes. */
  scan(bytes: Uint8Array, length: number): void {
    while (this.at + 4 <= length) {
      const frame = readFrameHeader(bytes, this.at);
      if (!frame) {
        // Not a frame (a tag, or damage): look for the next sync word.
        this.at++;
        continue;
      }
      if (this.at + frame.length > length) break;
      if (this.offsets.length === 0) {
        this.samplesPerFrame = frame.samples;
        this.sampleRate = frame.sampleRate;
      }
      this.offsets.push(this.at);
      this.at += frame.length;
      this.end = this.at;
    }
  }

  get count(): number {
    return this.offsets.length;
  }

  /** Byte range of frames [from, to). */
  range(from: number, to: number): [number, number] {
    return [this.offsets[from], to < this.offsets.length ? this.offsets[to] : this.end];
  }
}
