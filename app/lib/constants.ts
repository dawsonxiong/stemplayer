export const STEMS = {
  vocals: { label: "Vocals", index: 0 },
  drums: { label: "Drums", index: 1 },
  bass: { label: "Bass", index: 2 },
  other: { label: "Other", index: 3 },
} as const;

// The device's LEDs, hub to rim. The baked map is a continuous
// cyan→blue→white→lavender→magenta ramp and every groove shows the same one, so
// colour says how loud a stem is, not which stem it is.
export const LED_PALETTE = ["#4CC2DB", "#9EC2DE", "#D1E5F5", "#C79AD9", "#DA66D6"] as const;

export type StemName = keyof typeof STEMS;

// The three colourways the real product ships in.
export const DEVICE_COLORS = {
  tan: { label: "Tan", swatch: "#AA8D80" },
  bao: { label: "Bao", swatch: "#E4E3DE" },
  clear: { label: "Clear", swatch: "#D8E1EA" },
} as const;

export type DeviceColor = keyof typeof DEVICE_COLORS;

// One plays at a time, picked like the device's effects menu.
export const EFFECT_NAMES = ["echo", "reverb", "filter"] as const;
export type EffectName = (typeof EFFECT_NAMES)[number];

export const EFFECTS = {
  echo: { min: 0.05, max: 1.0, default: 0.3 },
  feedback: { min: 0, max: 0.85, default: 0.4 },
  /** Reverb tail length in seconds. */
  reverbSize: { min: 0.4, max: 4, default: 1.8 },
  /** Filter resonance (Q). */
  resonance: { min: 0.7, max: 12, default: 4 },
};

// Playback rates, slowest to fastest. Pitch moves with speed, like a
// turntable, rather than being held.
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5] as const;

export const MAX_FILE_SIZE_MB = 50;
export const MAX_DURATION_MINUTES = 10;
export const ACCEPTED_FORMATS = [
  "audio/mpeg",
  "audio/wav",
  "audio/flac",
  "audio/ogg",
  "audio/aac",
  "audio/mp4",
  "audio/x-m4a",
];
// Status is long-polled (the Worker answers when the job changes); this is
// the wait after a failed check, or between polls of a Worker that answers
// at once.
export const POLL_INTERVAL_MS = 1000;
export const POLL_MAX_INTERVAL_MS = 5000;
export const POLL_TIMEOUT_MS = 10 * 60 * 1000;
export const AUTO_DELETE_DAYS = 14;
export const SEPARATIONS_PER_HOUR = 5;
