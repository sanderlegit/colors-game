import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { oklch } from "@/color/types";
import { type ApiError, createApi, type GameApi, type Result } from "@/platform/api";
import { createFakeApi, FIXTURE_IDENTITY } from "@/platform/api.fixture";

/**
 * Every test injects `fetchImpl`. Nothing here is allowed near a real socket:
 * a suite that can reach the network is a suite that fails on a train.
 */

type Recorded = { readonly url: string; readonly init: RequestInit | undefined };

function recordingFetch(respond: (url: string) => Response): {
  fetchImpl: typeof fetch;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  return {
    calls,
    fetchImpl: (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      calls.push({ url, init });
      return Promise.resolve(respond(url));
    },
  };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const always =
  (response: () => Response): typeof fetch =>
  (): Promise<Response> =>
    Promise.resolve(response());

function expectError(result: Result<unknown>): ApiError {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.value)}`);
  return result.error;
}

function expectValue<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected a value, got ${JSON.stringify(result.error)}`);
  return result.value;
}

const VALID_IDENTITY = { name: "ada", bestScore: 412, gamesPlayed: 9, rank: 3 };
const VALID_GAME = { gameId: "g_01H8XK", seed: 20260801, roundsTotal: 5 };
const VALID_SUBMISSION = {
  totalScore: 412,
  rounds: [
    { deltaE: 1.2, score: 96 },
    { deltaE: 4.8, score: 81 },
  ],
  rank: 3,
  isPersonalBest: true,
  name: "ada",
  claimed: true,
};
const VALID_LEADERBOARD = {
  entries: [
    { rank: 1, name: "grace", score: 468, isYou: false },
    { rank: 2, name: "ada", score: 412, isYou: true },
  ],
};

const ROUTES: Record<string, unknown> = {
  "/api/me": VALID_IDENTITY,
  "/api/games": VALID_GAME,
  "/api/games/g_01H8XK/result": VALID_SUBMISSION,
  "/api/name": { name: "ada" },
  "/api/leaderboard": VALID_LEADERBOARD,
};

/** Answers every endpoint with a well-formed body. */
const routedFetch = (url: string): Response => {
  const payload = ROUTES[url];
  if (payload === undefined) return new Response("", { status: 404 });
  if (payload === null) return new Response(null, { status: 204 });
  return json(payload);
};

const GUESSES = [oklch(0.62, 0.15, 30), oklch(0.5, 0.1, 200)] as const;

/** One call per `GameApi` method, so totality can be asserted across all of them. */
const EVERY_METHOD: readonly ((api: GameApi) => Promise<Result<unknown>>)[] = [
  (api) => api.me(),
  (api) => api.startRanked(5000),
  (api) => api.submit({ gameId: "g_01H8XK", guesses: GUESSES }),
  (api) => api.claimName("ada"),
  (api) => api.leaderboard(),
];

describe("createApi request shape", () => {
  it("sends a same-origin GET to /api/me with a deadline", async () => {
    const { fetchImpl, calls } = recordingFetch(routedFetch);
    await createApi({ fetchImpl, timeoutMs: 50 }).me();

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe("/api/me");
    expect(call?.init?.method).toBe("GET");
    expect(call?.init?.credentials).toBe("same-origin");
    expect(call?.init?.signal).toBeInstanceOf(AbortSignal);
    // A GET has no entity, so it must not claim a Content-Type for one.
    expect(call?.init?.headers).toBeUndefined();
    expect(call?.init?.body).toBeUndefined();
  });

  it("posts JSON on writes", async () => {
    const { fetchImpl, calls } = recordingFetch(routedFetch);
    await createApi({ fetchImpl, timeoutMs: 50 }).startRanked(8000);

    const call = calls[0];
    expect(call?.url).toBe("/api/games");
    expect(call?.init?.method).toBe("POST");
    expect(call?.init?.credentials).toBe("same-origin");
    expect(call?.init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(call?.init?.body).toBe('{"memorizeMs":8000}');
  });

  it("sends the guesses as plain OKLCh coordinates", async () => {
    const { fetchImpl, calls } = recordingFetch(routedFetch);
    await createApi({ fetchImpl, timeoutMs: 50 }).submit({
      gameId: "g_01H8XK",
      guesses: [oklch(0.5, 0.1, 200)],
    });

    // The game id is the single-use submit token and travels in the path only.
    expect(calls[0]?.url).toBe("/api/games/g_01H8XK/result");
    expect(calls[0]?.init?.body).toBe('{"guesses":[{"L":0.5,"c":0.1,"h":200}]}');
  });

  it("includes an optional name only when one was given", async () => {
    const { fetchImpl, calls } = recordingFetch(routedFetch);
    const api = createApi({ fetchImpl, timeoutMs: 50 });
    await api.submit({ gameId: "g", guesses: [], name: "ada" });
    await api.submit({ gameId: "g", guesses: [] });

    expect(calls[0]?.init?.body).toBe('{"guesses":[],"name":"ada"}');
    expect(calls[1]?.init?.body).toBe('{"guesses":[]}');
  });

  it("honours a base URL override without doubling the slash", async () => {
    const { fetchImpl, calls } = recordingFetch(() => json(VALID_LEADERBOARD));
    await createApi({
      fetchImpl,
      timeoutMs: 50,
      baseUrl: "https://scores.example/v2/",
    }).leaderboard();

    expect(calls[0]?.url).toBe("https://scores.example/v2/leaderboard");
  });

  it("issues exactly one attempt — no retry against a rate limiter", async () => {
    const { fetchImpl, calls } = recordingFetch(() => json({ message: "slow down" }, 429));
    const result = await createApi({ fetchImpl, timeoutMs: 50 }).leaderboard();

    expect(calls).toHaveLength(1);
    expect(expectError(result).kind).toBe("rejected");
  });
});

describe("createApi decoding", () => {
  const api = (respond: (url: string) => Response): GameApi =>
    createApi({ fetchImpl: recordingFetch(respond).fetchImpl, timeoutMs: 50 });

  it("decodes an identity", async () => {
    expect(expectValue(await api(routedFetch).me())).toEqual(VALID_IDENTITY);
  });

  it("reads a 204 as no identity rather than an error", async () => {
    const result = await api(() => new Response(null, { status: 204 })).me();

    expect(expectValue(result)).toBeNull();
  });

  it("accepts a nulled name and rank on an unclaimed identity", async () => {
    const body = { name: null, bestScore: 0, gamesPlayed: 0, rank: null };
    const result = await api(() => json(body)).me();

    expect(expectValue(result)).toEqual(body);
  });

  it("decodes a ranked game, a submission and a leaderboard", async () => {
    const client = api(routedFetch);

    expect(expectValue(await client.startRanked(5000))).toEqual(VALID_GAME);
    expect(expectValue(await client.submit({ gameId: "g_01H8XK", guesses: [] }))).toEqual(
      VALID_SUBMISSION,
    );
    expect(expectValue(await client.leaderboard())).toEqual(VALID_LEADERBOARD);
    expect(expectValue(await client.claimName("ada"))).toEqual({ name: "ada" });
  });

  const garbage: ReadonlyArray<readonly [string, string]> = [
    ["not json at all", "prose"],
    ["", "an empty 200"],
    ["null", "a JSON null"],
    ["[]", "an array"],
    ['"ada"', "a bare string"],
    ["{", "a truncated object"],
  ];

  for (const [raw, label] of garbage) {
    it(`treats ${label} as a server fault`, async () => {
      const result = await api(() => new Response(raw, { status: 200 })).me();

      expect(expectError(result).kind).toBe("server");
    });
  }

  const malformed: ReadonlyArray<readonly [string, unknown]> = [
    ["a missing field", { name: "ada", bestScore: 412 }],
    ["a wrong-typed number", { ...VALID_IDENTITY, bestScore: "412" }],
    ["a wrong-typed name", { ...VALID_IDENTITY, name: 7 }],
    ["a null count", { ...VALID_IDENTITY, gamesPlayed: null }],
    ["a negative count", { ...VALID_IDENTITY, gamesPlayed: -1 }],
    ["a rank below 1", { ...VALID_IDENTITY, rank: 0 }],
    ["an over-long name", { ...VALID_IDENTITY, name: "a".repeat(25) }],
  ];

  for (const [label, body] of malformed) {
    it(`rejects an identity with ${label} rather than defaulting`, async () => {
      const result = await api(() => json(body)).me();

      expect(expectError(result).kind).toBe("server");
    });
  }

  it("rejects a leaderboard whose rows are not all readable", async () => {
    const body = { entries: [VALID_LEADERBOARD.entries[0], { rank: 2, name: "ada", score: 412 }] };
    const result = await api(() => json(body)).leaderboard();

    expect(expectError(result).kind).toBe("server");
  });

  it("rejects a round score outside the 0..100 the spec defines", async () => {
    const body = { ...VALID_SUBMISSION, rounds: [{ deltaE: 1.2, score: 101 }] };
    const result = await api(() => json(body)).submit({ gameId: "g", guesses: [] });

    expect(expectError(result).kind).toBe("server");
  });

  it("accepts an empty leaderboard", async () => {
    const result = await api(() => json({ entries: [] })).leaderboard();

    expect(expectValue(result)).toEqual({ entries: [] });
  });
});

describe("createApi failure mapping", () => {
  const api = (respond: () => Response): GameApi =>
    createApi({ fetchImpl: always(respond), timeoutMs: 50 });

  it("passes a 4xx message through verbatim", async () => {
    const message = "That name is taken — try another.";
    const result = await api(() => json({ message }, 422)).claimName("ada");

    expect(expectError(result)).toEqual({ kind: "rejected", message });
  });

  it("falls back to its own wording when a 4xx carries no message", async () => {
    const result = await api(() => json({ detail: "nope" }, 400)).claimName("ada");
    const error = expectError(result);

    expect(error.kind).toBe("rejected");
    expect(error.message).not.toBe("");
  });

  it("does not read a message out of an unparseable 4xx body", async () => {
    const result = await api(() => new Response("<html>404</html>", { status: 404 })).me();

    expect(expectError(result).kind).toBe("rejected");
  });

  for (const status of [500, 502, 503]) {
    it(`maps ${status} to a server fault, not a rejection`, async () => {
      const result = await api(() => json({ message: "internal" }, status)).leaderboard();

      // A 5xx `message` is an implementation detail; it is not player-facing.
      expect(expectError(result).kind).toBe("server");
    });
  }

  it("maps a rejecting fetch to offline", async () => {
    const fetchImpl: typeof fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    const result = await createApi({ fetchImpl, timeoutMs: 50 }).me();

    expect(expectError(result).kind).toBe("offline");
  });

  it("maps an aborted fetch to offline", async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    const result = await createApi({ fetchImpl, timeoutMs: 50 }).submit({
      gameId: "g",
      guesses: [],
    });

    expect(expectError(result).kind).toBe("offline");
  });

  it("maps its own deadline to offline", async () => {
    // The signal has to do real work here: a fetch that never answers is the
    // failure mode a `timeoutMs` exists for.
    const fetchImpl: typeof fetch = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("timed out", "TimeoutError"));
        });
      });
    const result = await createApi({ fetchImpl, timeoutMs: 1 }).leaderboard();

    expect(expectError(result).kind).toBe("offline");
  });

  it("maps a body that dies mid-read to offline", async () => {
    // Headers arrive, the connection drops before the body does. The `Result`
    // must still come back rather than the read rejecting into the caller.
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller: ReadableStreamDefaultController<Uint8Array>): void {
              controller.error(new TypeError("network error"));
            },
          }),
        ),
      );
    const result = await createApi({ fetchImpl, timeoutMs: 50 }).me();

    expect(expectError(result).kind).toBe("offline");
  });
});

describe("createApi when the browser reports no network", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("short-circuits without issuing a request", async () => {
    const { fetchImpl, calls } = recordingFetch(routedFetch);
    const results = await Promise.all(EVERY_METHOD.map((call) => call(createApi({ fetchImpl }))));

    expect(calls).toHaveLength(0);
    for (const result of results) expect(expectError(result).kind).toBe("offline");
  });
});

describe("no GameApi method ever rejects", () => {
  const hostile: ReadonlyArray<readonly [string, typeof fetch]> = [
    ["fetch rejects", () => Promise.reject(new TypeError("Failed to fetch"))],
    [
      "fetch throws synchronously",
      () => {
        throw new TypeError("Illegal invocation");
      },
    ],
    ["the body is prose", always(() => new Response("<html>", { status: 200 }))],
    ["fields are wrong-typed", always(() => json({ rank: "first", entries: "none" }))],
    ["the server rejects", always(() => json({ message: "no" }, 422))],
    ["the server is broken", always(() => json({ message: "boom" }, 500))],
    ["the response is a 204", always(() => new Response(null, { status: 204 }))],
  ];

  for (const [label, fetchImpl] of hostile) {
    it(`resolves every method when ${label}`, async () => {
      const api = createApi({ fetchImpl, timeoutMs: 50 });

      for (const call of EVERY_METHOD) {
        // An unhandled rejection here fails the test, which is the assertion:
        // one uncaught throw in the frame loop takes the whole game down.
        const result = await call(api);
        expect(typeof result.ok, label).toBe("boolean");
      }
    });
  }

  it("resolves every method on the happy path", async () => {
    const api = createApi({ fetchImpl: recordingFetch(routedFetch).fetchImpl, timeoutMs: 50 });

    for (const call of EVERY_METHOD) {
      expect((await call(api)).ok).toBe(true);
    }
  });
});

describe("createFakeApi", () => {
  it("satisfies GameApi without a fetch in sight", async () => {
    const fake = createFakeApi();
    const results = await Promise.all(EVERY_METHOD.map((call) => call(fake)));

    for (const result of results) expect(result.ok).toBe(true);
    expect(fake.calls.map((call) => call.method)).toEqual([
      "me",
      "startRanked",
      "submit",
      "claimName",
      "leaderboard",
    ]);
  });

  it("records the arguments a caller sent", async () => {
    const fake = createFakeApi();
    await fake.submit({ gameId: "g_01H8XK", guesses: GUESSES });

    expect(fake.calls[0]).toEqual({
      method: "submit",
      request: { gameId: "g_01H8XK", guesses: GUESSES },
    });
  });

  it("overrides one method without disturbing the rest", async () => {
    const error = { kind: "offline", message: "You are offline." } as const;
    const fake = createFakeApi({ submit: { ok: false, error } });

    expect(expectError(await fake.submit({ gameId: "g", guesses: [] }))).toEqual(error);
    expect(expectValue(await fake.me())).toEqual(FIXTURE_IDENTITY);
  });
});
