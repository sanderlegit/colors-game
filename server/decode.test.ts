import { describe, expect, it } from "vitest";
import { ROUNDS_PER_GAME } from "../src/domain/state";
import {
  ALLOWED_MEMORIZE_MS,
  decodeGuesses,
  decodeName,
  decodeStartGame,
  decodeSubmit,
  MAX_BODY_BYTES,
  MAX_NAME_LENGTH,
  nameKey,
  readJsonBody,
} from "./decode";

const guess = (L = 0.5, c = 0.1, h = 180): Record<string, unknown> => ({ L, c, h });
const guesses = (n = ROUNDS_PER_GAME): Record<string, unknown>[] =>
  Array.from({ length: n }, () => guess());

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://colors.example/api/games", { method: "POST", body, headers });
}

describe("readJsonBody", () => {
  it("reads an object body", async () => {
    await expect(readJsonBody(post('{"memorizeMs":5000}'))).resolves.toEqual({ memorizeMs: 5000 });
  });

  it("rejects a body whose declared length is over the cap", async () => {
    // Rejected before it is parsed: JSON.parse on a megabyte of nesting is work
    // an unauthenticated caller should not be able to ask for.
    const request = post("{}", { "content-length": String(MAX_BODY_BYTES + 1) });
    await expect(readJsonBody(request)).resolves.toBeNull();
  });

  it("rejects an oversized body that under-declared its length", async () => {
    const padded = `{"name":"${"x".repeat(MAX_BODY_BYTES)}"}`;
    await expect(readJsonBody(post(padded, { "content-length": "10" }))).resolves.toBeNull();
  });

  it("rejects malformed JSON", async () => {
    await expect(readJsonBody(post("{nope"))).resolves.toBeNull();
  });

  it("rejects JSON that is not an object", async () => {
    await expect(readJsonBody(post("[1,2,3]"))).resolves.toBeNull();
    await expect(readJsonBody(post('"hello"'))).resolves.toBeNull();
    await expect(readJsonBody(post("null"))).resolves.toBeNull();
  });

  it("rejects an empty body", async () => {
    await expect(readJsonBody(post(""))).resolves.toBeNull();
  });
});

describe("decodeStartGame", () => {
  it("accepts each memorize window the spec offers, at the only issuable tier", () => {
    for (const memorizeMs of ALLOWED_MEMORIZE_MS) {
      expect(decodeStartGame({ memorizeMs })).toEqual({ memorizeMs, difficulty: "normal" });
    }
  });

  it("refuses a tier the client cannot actually play", () => {
    // `createReducer` calls `deps.target(seed, roundIndex)` with no difficulty,
    // so a game stored as "hard" would replay against colours nobody saw.
    expect(decodeStartGame({ memorizeMs: 5000, difficulty: "hard" })).toBeNull();
    expect(decodeStartGame({ memorizeMs: 5000, difficulty: "easy" })).toBeNull();
    expect(decodeStartGame({ memorizeMs: 5000, difficulty: 7 })).toBeNull();
    expect(decodeStartGame({ memorizeMs: 5000, difficulty: "normal" })).toEqual({
      memorizeMs: 5000,
      difficulty: "normal",
    });
  });

  it("rejects a duration outside the offered set", () => {
    // The client picks from three buttons. A fourth value is a client that is
    // not ours, and a longer memorize window is an advantage.
    expect(decodeStartGame({ memorizeMs: 4000 })).toBeNull();
    expect(decodeStartGame({ memorizeMs: 600000 })).toBeNull();
  });

  it("rejects non-numbers and non-finite numbers", () => {
    expect(decodeStartGame({ memorizeMs: "5000" })).toBeNull();
    expect(decodeStartGame({ memorizeMs: Number.NaN })).toBeNull();
    expect(decodeStartGame({ memorizeMs: Number.POSITIVE_INFINITY })).toBeNull();
    expect(decodeStartGame({})).toBeNull();
  });
});

describe("decodeSubmit", () => {
  it("accepts exactly the round count the game has", () => {
    const decoded = decodeSubmit({ guesses: guesses() });
    expect(decoded?.guesses).toHaveLength(ROUNDS_PER_GAME);
    expect(decoded?.guesses[0]).toEqual({ L: 0.5, c: 0.1, h: 180 });
  });

  it("rejects too few and too many rounds", () => {
    // Too few merely scores lower; too many would score rounds the game never
    // had. Pinning the count exactly is what keeps the replay over the same
    // five rounds the player saw.
    expect(decodeSubmit({ guesses: guesses(ROUNDS_PER_GAME - 1) })).toBeNull();
    expect(decodeSubmit({ guesses: guesses(ROUNDS_PER_GAME + 1) })).toBeNull();
    expect(decodeSubmit({ guesses: [] })).toBeNull();
  });

  it("rejects a guesses field that is not an array", () => {
    expect(decodeSubmit({ guesses: { L: 0.5, c: 0.1, h: 180 } })).toBeNull();
    expect(decodeSubmit({})).toBeNull();
  });

  it("rejects a coordinate out of range", () => {
    const bad = (over: Record<string, unknown>): Record<string, unknown> => ({
      guesses: [{ ...guess(), ...over }, ...guesses(ROUNDS_PER_GAME - 1)],
    });
    expect(decodeSubmit(bad({ L: 1.5 }))).toBeNull();
    expect(decodeSubmit(bad({ L: -0.1 }))).toBeNull();
    expect(decodeSubmit(bad({ c: -1 }))).toBeNull();
    expect(decodeSubmit(bad({ c: 5 }))).toBeNull();
    expect(decodeSubmit(bad({ h: 361 }))).toBeNull();
  });

  it("accepts the endpoints of each axis", () => {
    const edges = [{ L: 0, c: 0, h: 0 }, { L: 1, c: 0.5, h: 360 }, ...guesses(ROUNDS_PER_GAME - 2)];
    expect(decodeSubmit({ guesses: edges })?.guesses).toHaveLength(ROUNDS_PER_GAME);
  });

  it("normalises the wrap point so one hue has one representation", () => {
    // 360 and 0 are the same hue. Storing both would let one game's guesses
    // round-trip into two different strings.
    const wrapped = [{ L: 0.5, c: 0.1, h: 360 }, ...guesses(ROUNDS_PER_GAME - 1)];
    expect(decodeSubmit({ guesses: wrapped })?.guesses[0]).toEqual({ L: 0.5, c: 0.1, h: 0 });
  });

  it("rejects NaN and Infinity, which SQLite would store as NULL", () => {
    const withValue = (L: number): Record<string, unknown> => ({
      guesses: [{ ...guess(), L }, ...guesses(ROUNDS_PER_GAME - 1)],
    });
    expect(decodeSubmit(withValue(Number.NaN))).toBeNull();
    expect(decodeSubmit(withValue(Number.POSITIVE_INFINITY))).toBeNull();
  });

  it("rejects a guess that is not an object", () => {
    expect(decodeSubmit({ guesses: ["red", ...guesses(ROUNDS_PER_GAME - 1)] })).toBeNull();
    expect(decodeSubmit({ guesses: [null, ...guesses(ROUNDS_PER_GAME - 1)] })).toBeNull();
  });

  it("omits the name key entirely when no name was sent", () => {
    // `exactOptionalPropertyTypes` is on: `{ name: undefined }` is a different
    // thing from an absent key, and only the absent key type-checks.
    const decoded = decodeSubmit({ guesses: guesses() });
    expect(decoded).not.toBeNull();
    expect(decoded !== null && "name" in decoded).toBe(false);
  });

  it("carries a valid name through", () => {
    expect(decodeSubmit({ guesses: guesses(), name: "  Ada  " })?.name).toBe("Ada");
  });

  it("rejects the whole submission when the name is invalid", () => {
    expect(decodeSubmit({ guesses: guesses(), name: "" })).toBeNull();
    expect(decodeSubmit({ guesses: guesses(), name: 7 })).toBeNull();
  });
});

describe("decodeGuesses", () => {
  it("narrows a stored guesses_json the same way it narrowed the request", () => {
    // The resubmit path reads the row back through this. A stored row must not
    // become a second entry point that skips the bounds.
    const decoded = decodeSubmit({ guesses: guesses() });
    const roundTripped: unknown = JSON.parse(JSON.stringify(decoded?.guesses));
    expect(decodeGuesses(roundTripped)).toEqual(decoded?.guesses);
  });

  it("rejects anything that is not five in-range triples", () => {
    expect(decodeGuesses(guesses(ROUNDS_PER_GAME - 1))).toBeNull();
    expect(decodeGuesses("[]")).toBeNull();
    expect(decodeGuesses(null)).toBeNull();
  });
});

describe("decodeName", () => {
  it("keeps the player's own casing for display", () => {
    expect(decodeName({ name: "AdaL" })).toEqual({ name: "AdaL", key: "adal" });
  });

  it("trims and collapses whitespace in both forms", () => {
    expect(decodeName({ name: "  Ada   Lovelace " })).toEqual({
      name: "Ada Lovelace",
      key: "ada lovelace",
    });
  });

  it("folds case and compatibility forms onto one key", () => {
    // Fullwidth "ａｄａ" renders identically to "ada" on a leaderboard row.
    const plain = decodeName({ name: "ada" });
    const fullwidth = decodeName({ name: "ａｄａ" });
    expect(fullwidth?.key).toBe(plain?.key);
    expect(fullwidth?.name).not.toBe(plain?.name);
  });

  it("does not pretend to fold homoglyphs", () => {
    // Cyrillic "а" is a different key, deliberately: confusable detection needs
    // a table we would have to ship and keep current.
    expect(decodeName({ name: "аda" })?.key).not.toBe(decodeName({ name: "ada" })?.key);
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(decodeName({ name: "" })).toBeNull();
    expect(decodeName({ name: "   " })).toBeNull();
  });

  it("rejects a non-string", () => {
    expect(decodeName({ name: 42 })).toBeNull();
    expect(decodeName({})).toBeNull();
  });

  it("counts length in code points, not UTF-16 units", () => {
    const emoji = "🎨".repeat(MAX_NAME_LENGTH);
    expect(decodeName({ name: emoji })?.name).toBe(emoji);
    expect(decodeName({ name: "🎨".repeat(MAX_NAME_LENGTH + 1) })).toBeNull();
  });

  it("rejects control characters, bidi overrides and zero-width marks", () => {
    for (const hidden of ["\u0007", "\u001b", "\u009f", "\u200b", "\u202e", "\ufeff"]) {
      expect(decodeName({ name: `ad${hidden}a` })).toBeNull();
    }
  });

  it("rejects a name whose folded key overflows the bound", () => {
    // NFKC expands some characters: the ligature ﬁ folds to two code points, so
    // a name at the limit can produce a key past it. The unique index holds the
    // key, so the key is what the bound has to apply to.
    expect(decodeName({ name: "ﬁ".repeat(MAX_NAME_LENGTH) })).toBeNull();
  });
});

describe("nameKey", () => {
  it("is idempotent", () => {
    for (const name of ["Ada", "ＡＤＡ", "  a  b  ", "🎨"]) {
      expect(nameKey(nameKey(name))).toBe(nameKey(name));
    }
  });

  it("agrees with the key decodeName produces", () => {
    const decoded = decodeName({ name: " Ada  Lovelace " });
    expect(decoded?.key).toBe(nameKey(decoded?.name ?? ""));
  });
});
