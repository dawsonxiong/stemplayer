// LED colors: warm white/cream (matching the real Stem Player's default state)
// The real device uses warm white LEDs that glow through silicone
// Per-track color palettes (pink/blue etc.) vary by song
export const STEMS = {
  vocals: { label: "Vocals", colour: "#F0D8B8", colourLight: "#F8E8D0", index: 0 },
  drums: { label: "Drums", colour: "#ECD0B0", colourLight: "#F4E0C8", index: 1 },
  bass: { label: "Bass", colour: "#E8CCB0", colourLight: "#F0DCC8", index: 2 },
  other: { label: "Other", colour: "#E4C8A8", colourLight: "#ECD8C0", index: 3 },
} as const;

export type StemName = keyof typeof STEMS;

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
export const AUTO_DELETE_DAYS = 14;
