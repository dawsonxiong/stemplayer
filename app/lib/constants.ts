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

export const EFFECTS = {
  echo: { min: 0.05, max: 1.0, default: 0.3 },
  feedback: { min: 0, max: 0.85, default: 0.4 },
  gate: { min: 0, max: 1.0, default: 0 },
};

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
export const POLL_INTERVAL_MS = 2000;
export const POLL_MAX_INTERVAL_MS = 5000;
export const POLL_TIMEOUT_MS = 10 * 60 * 1000;
export const AUTO_DELETE_DAYS = 14;
export const SEPARATIONS_PER_HOUR = 5;
