export const STEMS = {
  vocals: { label: "Vocals", colour: "#F5A623", colourLight: "#FDD68A", index: 0 },
  drums: { label: "Drums", colour: "#E74C3C", colourLight: "#F5A6A0", index: 1 },
  bass: { label: "Bass", colour: "#3498DB", colourLight: "#85C1E9", index: 2 },
  other: { label: "Other", colour: "#2ECC71", colourLight: "#82E0AA", index: 3 },
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
