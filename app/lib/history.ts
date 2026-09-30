import { useSyncExternalStore } from "react";
import { AUTO_DELETE_DAYS } from "./constants";

/** A song this browser has split, so it can be reopened without a new run. */
export interface HistoryEntry {
  taskId: string;
  title: string;
  duration: number;
  addedAt: number;
}

const KEY = "stemplayer:history";
const MAX_ENTRIES = 20;
// The stems are deleted after this, so older entries could never load.
const MAX_AGE_MS = AUTO_DELETE_DAYS * 86_400_000;

const listeners = new Set<() => void>();
const EMPTY: HistoryEntry[] = [];
// What React renders from. Dropped whenever storage may have changed.
let cache: HistoryEntry[] | null = null;

/** Straight from storage, so a write never clobbers another tab's changes. */
function load(): HistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as HistoryEntry[];
    const cutoff = Date.now() - MAX_AGE_MS;
    return Array.isArray(parsed) ? parsed.filter((e) => e.taskId && e.addedAt > cutoff) : [];
  } catch {
    return [];
  }
}

const snapshot = () => (cache ??= load());

function write(entries: HistoryEntry[]) {
  cache = entries;
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Private mode or full storage: history just won't outlive the tab.
  }
  for (const l of listeners) l();
}

/** Newest first; opening a song again moves it back to the top. */
export function rememberTrack(entry: HistoryEntry) {
  const rest = load().filter((e) => e.taskId !== entry.taskId);
  write([entry, ...rest].slice(0, MAX_ENTRIES));
}

export function forgetTrack(taskId: string) {
  write(load().filter((e) => e.taskId !== taskId));
}

export function findTrack(taskId: string): HistoryEntry | undefined {
  return load().find((e) => e.taskId === taskId);
}

function subscribe(listener: () => void) {
  // Another tab split or removed a song.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY && e.key !== null) return;
    cache = null;
    listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useHistory(): HistoryEntry[] {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}
