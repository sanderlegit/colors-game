import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/domain/state";
import {
  browserStore,
  createMemoryStore,
  createStorage,
  DEFAULT_STATS,
  type KeyValueStore,
} from "@/platform/storage";

/** A store that behaves like Safari in private mode: reads fine, throws on write. */
function readOnlyStore(seed: Record<string, string> = {}): KeyValueStore {
  return {
    getItem(key: string): string | null {
      return seed[key] ?? null;
    },
    setItem(): void {
      throw new DOMException("QuotaExceededError");
    },
  };
}

function storeWith(entries: Record<string, string>): KeyValueStore {
  const store = createMemoryStore();
  for (const [key, value] of Object.entries(entries)) store.setItem(key, value);
  return store;
}

describe("createStorage", () => {
  it("round-trips stats", () => {
    const storage = createStorage(createMemoryStore());
    storage.writeStats({ bestScore: 412, gamesPlayed: 9 });

    expect(storage.readStats()).toEqual({ bestScore: 412, gamesPlayed: 9 });
  });

  it("round-trips settings", () => {
    const storage = createStorage(createMemoryStore());
    storage.writeSettings({ memorizeMs: 8000, reducedMotion: true });

    expect(storage.readSettings()).toEqual({ memorizeMs: 8000, reducedMotion: true });
  });

  it("returns defaults when nothing has been stored", () => {
    const storage = createStorage(createMemoryStore());

    expect(storage.readStats()).toEqual(DEFAULT_STATS);
    expect(storage.readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("survives a store that throws on every write", () => {
    const storage = createStorage(readOnlyStore());

    expect(() => {
      storage.writeStats({ bestScore: 100, gamesPlayed: 1 });
    }).not.toThrow();
    // Degraded to session-only rather than dead.
    expect(storage.readStats()).toEqual({ bestScore: 100, gamesPlayed: 1 });
  });

  it("survives a store that throws on read", () => {
    const hostile: KeyValueStore = {
      getItem(): string | null {
        throw new DOMException("SecurityError");
      },
      setItem(): void {},
    };
    const storage = createStorage(hostile);

    expect(storage.readStats()).toEqual(DEFAULT_STATS);
    expect(storage.readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  const garbage: ReadonlyArray<[string, string]> = [
    ["not json at all", "colors:stats"],
    ["", "colors:stats"],
    ["null", "colors:stats"],
    ["[]", "colors:stats"],
    ['"a string"', "colors:stats"],
    ["42", "colors:stats"],
    ["{", "colors:stats"],
    ['{"bestScore":"lots"}', "colors:stats"],
    ['{"bestScore":null,"gamesPlayed":true}', "colors:stats"],
    ['{"bestScore":-5,"gamesPlayed":-1}', "colors:stats"],
    ['{"gamesPlayed":1e400}', "colors:stats"],
    ['{"unrelated":{"deeply":["nested"]}}', "colors:stats"],
  ];

  for (const [raw, key] of garbage) {
    it(`falls back to default stats for ${JSON.stringify(raw)}`, () => {
      const storage = createStorage(storeWith({ [key]: raw }));

      expect(storage.readStats()).toEqual(DEFAULT_STATS);
    });
  }

  it("keeps the fields it can salvage from a partially valid record", () => {
    const storage = createStorage(
      storeWith({ "colors:stats": '{"bestScore":320,"gamesPlayed":"x"}' }),
    );

    expect(storage.readStats()).toEqual({ bestScore: 320, gamesPlayed: 0 });
  });

  it("rejects a memorize duration the game does not offer", () => {
    const storage = createStorage(
      storeWith({ "colors:settings": '{"memorizeMs":60000,"reducedMotion":true}' }),
    );

    // SPEC §8 lists 3s / 5s / 8s; anything else is corrupt, not a preference.
    expect(storage.readSettings()).toEqual({ memorizeMs: 5000, reducedMotion: true });
  });

  it("never throws for any garbage input", () => {
    for (const [raw] of garbage) {
      const storage = createStorage(storeWith({ "colors:stats": raw, "colors:settings": raw }));
      expect(() => storage.readStats()).not.toThrow();
      expect(() => storage.readSettings()).not.toThrow();
    }
  });
});

describe("browserStore", () => {
  it("reports absence rather than throwing when localStorage is unavailable", () => {
    // happy-dom does not provide localStorage, which is the case this guards.
    expect(() => browserStore()).not.toThrow();
  });

  it("defaults to an in-memory store when there is no usable localStorage", () => {
    const storage = createStorage();
    storage.writeStats({ bestScore: 7, gamesPlayed: 1 });

    expect(storage.readStats()).toEqual({ bestScore: 7, gamesPlayed: 1 });
  });
});
