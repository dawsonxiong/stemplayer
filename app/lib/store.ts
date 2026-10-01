import { create } from "zustand";
import type { DeviceColor, EffectName, StemName } from "./constants";
import type { Provider } from "./links";

/** Where a song is in the pipeline. Kept after a failure to show which broke.
 *  An upload goes upload → start → separate → load. A link is looked up
 *  instead of uploaded, and the GPU job fetches it once it's running:
 *  lookup → start → fetch → separate → load. */
export type Stage = "upload" | "lookup" | "start" | "fetch" | "separate" | "load";

/** Where the song came from: a file, or a link to one of these sites. */
export type Source = "file" | Provider;

interface PlayerState {
  // Track state
  taskId: string | null;
  trackTitle: string;
  /** When the song was uploaded, for the header. */
  trackDate: number | null;
  status: "idle" | "uploading" | "processing" | "ready" | "error";
  processingProgress: number;
  stage: Stage | null;
  source: Source | null;
  /** For a Spotify or Apple Music song, the YouTube video it was found as. */
  matchedVideo: { id: string; title: string } | null;
  errorMessage: string | null;
  /** Whether the failed attempt could go differently a second time. */
  canRetry: boolean;

  // Playback
  isPlaying: boolean;
  currentTime: number;
  duration: number;

  // Stem volumes (0.0 - 1.0)
  volumes: Record<StemName, number>;
  // Stems played on their own; the rest are silent until none are left.
  isolated: StemName[];

  // Playback rate, one of SPEEDS.
  speed: number;

  // Effects. effectsMode is on or off; effect is the one that plays.
  effectsMode: boolean;
  effect: EffectName;
  echo: { delayTime: number; feedback: number; wet: number };
  reverb: { size: number; wet: number };
  filter: { cutoff: number; resonance: number };

  // Loop. Only a start means the out point is still to be set.
  loop: { start: number | null; end: number | null };

  // Recording
  isRecording: boolean;

  // Appearance
  deviceColor: DeviceColor;

  // Master output, driven by the device's side rocker
  masterVolume: number;

  // Device power. Off means dark LEDs and silence, like the real unit.
  isOn: boolean;

  // Actions
  setVolume: (stem: StemName, value: number) => void;
  setIsolated: (stems: StemName[]) => void;
  setSpeed: (speed: number) => void;
  setEffect: (effect: EffectName) => void;
  setReverb: (params: Partial<PlayerState["reverb"]>) => void;
  setFilter: (params: Partial<PlayerState["filter"]>) => void;
  setStatus: (status: PlayerState["status"]) => void;
  setPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setTaskId: (taskId: string) => void;
  setTrackTitle: (title: string) => void;
  setTrackDate: (date: number | null) => void;
  setProcessingProgress: (progress: number) => void;
  setStage: (stage: Stage | null) => void;
  setSource: (source: Source | null) => void;
  setMatchedVideo: (video: PlayerState["matchedVideo"]) => void;
  setErrorMessage: (message: string | null) => void;
  setCanRetry: (canRetry: boolean) => void;
  toggleEffectsMode: () => void;
  setEcho: (params: Partial<PlayerState["echo"]>) => void;
  setLoop: (params: Partial<PlayerState["loop"]>) => void;
  setRecording: (recording: boolean) => void;
  setDeviceColor: (color: DeviceColor) => void;
  setMasterVolume: (value: number) => void;
  setPower: (on: boolean) => void;
  reset: () => void;
}

const initialState = {
  taskId: null,
  trackTitle: "",
  trackDate: null,
  status: "idle" as const,
  processingProgress: 0,
  stage: null,
  source: null as Source | null,
  matchedVideo: null as PlayerState["matchedVideo"],
  errorMessage: null,
  canRetry: false,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volumes: { vocals: 1, drums: 1, bass: 1, other: 1 },
  isolated: [] as StemName[],
  speed: 1,
  effectsMode: false,
  effect: "echo" as EffectName,
  echo: { delayTime: 0.3, feedback: 0.4, wet: 0.5 },
  reverb: { size: 1.8, wet: 0.4 },
  filter: { cutoff: 0.55, resonance: 4 },
  loop: { start: null, end: null },
  isRecording: false,
  deviceColor: "tan" as const,
  masterVolume: 1,
  isOn: true,
};

export const usePlayerStore = create<PlayerState>((set) => ({
  ...initialState,

  setVolume: (stem, value) => set((s) => ({ volumes: { ...s.volumes, [stem]: value } })),
  setIsolated: (isolated) => set({ isolated }),
  setSpeed: (speed) => set({ speed }),
  setEffect: (effect) => set({ effect }),
  setReverb: (params) => set((s) => ({ reverb: { ...s.reverb, ...params } })),
  setFilter: (params) => set((s) => ({ filter: { ...s.filter, ...params } })),
  setStatus: (status) => set({ status }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setDuration: (duration) => set({ duration }),
  setTaskId: (taskId) => set({ taskId }),
  setTrackTitle: (trackTitle) => set({ trackTitle }),
  setTrackDate: (trackDate) => set({ trackDate }),
  setProcessingProgress: (processingProgress) => set({ processingProgress }),
  setStage: (stage) => set({ stage }),
  setSource: (source) => set({ source }),
  setMatchedVideo: (matchedVideo) => set({ matchedVideo }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),
  setCanRetry: (canRetry) => set({ canRetry }),
  toggleEffectsMode: () => set((s) => ({ effectsMode: !s.effectsMode })),
  setEcho: (params) => set((s) => ({ echo: { ...s.echo, ...params } })),
  setLoop: (params) => set((s) => ({ loop: { ...s.loop, ...params } })),
  setRecording: (isRecording) => set({ isRecording }),
  setDeviceColor: (deviceColor) => set({ deviceColor }),
  setMasterVolume: (masterVolume) => set({ masterVolume }),
  setPower: (isOn) => set({ isOn }),
  // Colourway and output level are user preferences, not track state.
  reset: () =>
    set((s) => ({
      ...initialState,
      deviceColor: s.deviceColor,
      masterVolume: s.masterVolume,
      isOn: s.isOn,
    })),
}));
