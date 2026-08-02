import { describe, expect, it } from "vitest";
import {
  COOKIE_MAX_AGE_SECONDS,
  clearCookie,
  IDENTITY_COOKIE,
  readCookie,
  setCookie,
} from "./cookie";

describe("readCookie", () => {
  it("finds the named cookie among several", () => {
    expect(readCookie("a=1; colors_id=tok; b=2", IDENTITY_COOKIE)).toBe("tok");
  });

  it("reads a lone cookie", () => {
    expect(readCookie("colors_id=tok", IDENTITY_COOKIE)).toBe("tok");
  });

  it("tolerates the whitespace browsers actually send", () => {
    expect(readCookie("  colors_id = tok  ", IDENTITY_COOKIE)).toBe("tok");
  });

  it("returns null when there is no header at all", () => {
    expect(readCookie(null, IDENTITY_COOKIE)).toBeNull();
  });

  it("returns null when the cookie is absent", () => {
    expect(readCookie("a=1; b=2", IDENTITY_COOKIE)).toBeNull();
  });

  it("treats an empty value as absent", () => {
    // A cleared cookie that is still being echoed sends `name=`; reading that as
    // an identity would look up the SHA-256 of the empty string.
    expect(readCookie("colors_id=", IDENTITY_COOKIE)).toBeNull();
  });

  it("ignores a valueless segment", () => {
    expect(readCookie("flag; colors_id=tok", IDENTITY_COOKIE)).toBe("tok");
  });

  it("does not match a name that merely ends with the one asked for", () => {
    expect(readCookie("xcolors_id=other", IDENTITY_COOKIE)).toBeNull();
  });

  it("takes the first of a duplicated name", () => {
    expect(readCookie("colors_id=first; colors_id=second", IDENTITY_COOKIE)).toBe("first");
  });

  it("does not decode the value", () => {
    // Base64url needs no encoding, so a decode step could only ever disagree
    // with the encoder that never ran.
    expect(readCookie("colors_id=a%20b", IDENTITY_COOKIE)).toBe("a%20b");
  });
});

describe("setCookie", () => {
  const header = setCookie(IDENTITY_COOKIE, "tok");

  it("carries the value", () => {
    expect(header.startsWith(`${IDENTITY_COOKIE}=tok;`)).toBe(true);
  });

  it("is HttpOnly, Secure, SameSite=Strict and path-wide", () => {
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Path=/");
  });

  it("defaults to the 400-day ceiling browsers enforce", () => {
    expect(header).toContain(`Max-Age=${COOKIE_MAX_AGE_SECONDS}`);
    expect(COOKIE_MAX_AGE_SECONDS).toBe(400 * 24 * 60 * 60);
  });

  it("accepts an explicit lifetime", () => {
    expect(setCookie(IDENTITY_COOKIE, "tok", 60)).toContain("Max-Age=60");
  });
});

describe("clearCookie", () => {
  it("expires immediately with an empty value", () => {
    const header = clearCookie(IDENTITY_COOKIE);
    expect(header.startsWith(`${IDENTITY_COOKIE}=;`)).toBe(true);
    expect(header).toContain("Max-Age=0");
  });

  it("repeats the attributes the cookie was set with", () => {
    // A browser matches a clearing cookie on name plus attributes. Any drift
    // between these two headers means DELETE /api/me silently keeps the cookie,
    // which is the one bug in this file nobody would notice in a unit test that
    // only checked Max-Age.
    const attributes = (header: string): string =>
      header
        .split(";")
        .slice(1)
        .map((part) => part.trim())
        .filter((part) => !part.startsWith("Max-Age="))
        .join("; ");
    expect(attributes(clearCookie(IDENTITY_COOKIE))).toBe(
      attributes(setCookie(IDENTITY_COOKIE, "tok")),
    );
  });
});
