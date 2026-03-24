import { create } from "zustand";
import type { StemName } from "./constants";

interface PlayerState {
  // Track state
  taskId: string | null;
  trackTitle: string;
  status: "idle" | "uploading" | "processing" | "ready" | "error";
  processingProgress: number;
  errorMessage: string | null;

  // Playback
  isPlaying: boolean;
  currentTime: number;
  duration: number;

  // Stem volumes (0.0 - 1.0)
  volumes: Record<StemName, number>;

  // Effects
  effectsMode: boolean;
  echo: { delayTime: number; feedback: number; wet: number };
  gate: { threshold: number; active: boolean };

  // Loop
  loop: { active: boolean; start: number; end: number };

  // Recording
  isRecording: boolean;

  // Actions
  setVolume: (stem: StemName, value: number) => void;
  setStatus: (status: PlayerState["status"]) => void;
  setPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setTaskId: (taskId: string) => void;
  setTrackTitle: (title: string) => void;
  setProcessingProgress: (progress: number) => void;
  setErrorMessage: (message: string | null) => void;
  toggleEffectsMode: () => void;
  setEcho: (params: Partial<PlayerState["echo"]>) => void;
  setLoop: (params: Partial<PlayerState["loop"]>) => void;
  setRecording: (recording: boolean) => void;
  reset: () => void;
}

const initialState = {
  taskId: null,
  trackTitle: "",
  status: "idle" as const,
  processingProgress: 0,
  errorMessage: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volumes: { vocals: 1, drums: 1, bass: 1, other: 1 },
  effectsMode: false,
  echo: { delayTime: 0.3, feedback: 0.4, wet: 0 },
  gate: { threshold: 0, active: false },
  loop: { active: false, start: 0, end: 0 },
  isRecording: false,
};

export const usePlayerStore = create<PlayerState>((set) => ({
  ...initialState,

  setVolume: (stem, value) =>
    set((s) => ({ volumes: { ...s.volumes, [stem]: value } })),
  setStatus: (status) => set({ status }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setDuration: (duration) => set({ duration }),
  setTaskId: (taskId) => set({ taskId }),
  setTrackTitle: (trackTitle) => set({ trackTitle }),
  setProcessingProgress: (processingProgress) => set({ processingProgress }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),
  toggleEffectsMode: () => set((s) => ({ effectsMode: !s.effectsMode })),
  setEcho: (params) => set((s) => ({ echo: { ...s.echo, ...params } })),
  setLoop: (params) => set((s) => ({ loop: { ...s.loop, ...params } })),
  setRecording: (isRecording) => set({ isRecording }),
  reset: () => set(initialState),
}));
