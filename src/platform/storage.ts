/**
 * Persistence (SPEC §7): best score, games played, last used settings.
 *
 * Two failure modes drive the whole design.
 *
 * 1. **`localStorage` can be hostile.** Safari in private mode throws on write,
 *    some embedded webviews throw on *access*, and any browser can hit quota.
 *    None of that is a reason for a single-player offline game to stop working,
 *    so a failing store degrades to an in-memory mirror for the session instead
 *    of propagating an exception into the frame loop.
 * 2. **Stored JSON is untrusted input.** It was written by an older version of
 *    this code, or by hand, or by a different site on the same origin. Every read
 *    validates field by field and falls back to a default; nothing here can
 *    throw, and nothing hands the UI a value it has to sanity-check.
 */

import { DEFAULT_SETTINGS, type Settings } from "@/domain/state";

const STATS_KEY = "colors:stats";
const SETTINGS_KEY = "colors:settings";

/** SPEC §8: the memorize window is 3s, 5s or 8s, chosen before play. */
const ALLOWED_MEMORIZE_MS: readonly number[] = [3000, 5000, 8000];

export type Stats = {
  readonly bestScore: number;
  readonly gamesPlayed: number;
};

export const DEFAULT_STATS: Stats = { bestScore: 0, gamesPlayed: 0 };

/** The slice of the Web Storage API this module actually uses. */
export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type GameStorage = {
  readStats(): Stats;
  writeStats(stats: Stats): void;
  readSettings(): Settings;
  writeSettings(settings: Settings): void;
};

export function createMemoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem(key: string): string | null {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      map.set(key, value);
    },
  };
}

/**
 * `localStorage`, or `null` if it is missing or refuses a write. The probe is a
 * real round trip because feature detection by `"localStorage" in window` passes
 * in exactly the private-browsing case that then throws.
 */
export function browserStore(): KeyValueStore | null {
  try {
    const store: Storage | undefined = globalThis.localStorage;
    if (!store) return null;
    const probeKey = "colors:probe";
    store.setItem(probeKey, "1");
    store.removeItem(probeKey);
    return {
      getItem: (key: string): string | null => store.getItem(key),
      setItem: (key: string, value: string): void => {
        store.setItem(key, value);
      },
    };
  } catch {
    return null;
  }
}

/**
 * Wrap a store so it can never throw. Writes are mirrored into memory first, so
 * a store that dies mid-session keeps serving this session's own values.
 */
function guarded(store: KeyValueStore): KeyValueStore {
  const mirror = createMemoryStore();
  let broken = false;
  return {
    getItem(key: string): string | null {
      if (broken) return mirror.getItem(key);
      try {
        return mirror.getItem(key) ?? store.getItem(key);
      } catch {
        broken = true;
        return mirror.getItem(key);
      }
    },
    setItem(key: string, value: string): void {
      mirror.setItem(key, value);
      if (broken) return;
      try {
        store.setItem(key, value);
      } catch {
        broken = true;
      }
    },
  };
}

function readRecord(store: KeyValueStore, key: string): Record<string, unknown> | null {
  const raw = store.getItem(key);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function numberField(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function booleanField(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

export function createStorage(
  store: KeyValueStore = browserStore() ?? createMemoryStore(),
): GameStorage {
  const safe = guarded(store);

  function write(key: string, value: unknown): void {
    let encoded: string;
    try {
      encoded = JSON.stringify(value);
    } catch {
      return;
    }
    safe.setItem(key, encoded);
  }

  return {
    readStats(): Stats {
      const record = readRecord(safe, STATS_KEY);
      if (record === null) return DEFAULT_STATS;
      return {
        bestScore: numberField(record, "bestScore", DEFAULT_STATS.bestScore),
        gamesPlayed: numberField(record, "gamesPlayed", DEFAULT_STATS.gamesPlayed),
      };
    },
    writeStats(stats: Stats): void {
      write(STATS_KEY, { bestScore: stats.bestScore, gamesPlayed: stats.gamesPlayed });
    },
    readSettings(): Settings {
      const record = readRecord(safe, SETTINGS_KEY);
      if (record === null) return DEFAULT_SETTINGS;
      const memorizeMs = numberField(record, "memorizeMs", DEFAULT_SETTINGS.memorizeMs);
      return {
        memorizeMs: ALLOWED_MEMORIZE_MS.includes(memorizeMs)
          ? memorizeMs
          : DEFAULT_SETTINGS.memorizeMs,
        reducedMotion: booleanField(record, "reducedMotion", DEFAULT_SETTINGS.reducedMotion),
      };
    },
    writeSettings(settings: Settings): void {
      write(SETTINGS_KEY, {
        memorizeMs: settings.memorizeMs,
        reducedMotion: settings.reducedMotion,
      });
    },
  };
}
