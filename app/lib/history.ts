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
let cache: HistoryEntry[] | null = null;

function read(): HistoryEntry[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as HistoryEntry[];
    const cutoff = Date.now() - MAX_AGE_MS;
    cache = Array.isArray(parsed) ? parsed.filter((e) => e.taskId && e.addedAt > cutoff) : [];
  } catch {
    cache = [];
  }
  return cache;
}

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
  const rest = read().filter((e) => e.taskId !== entry.taskId);
  write([entry, ...rest].slice(0, MAX_ENTRIES));
}

export function forgetTrack(taskId: string) {
  write(read().filter((e) => e.taskId !== taskId));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHistory(): HistoryEntry[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
