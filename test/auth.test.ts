import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { assertConnectorToken } from "../src/auth.js";
import { UnauthorizedError } from "../src/errors.js";

const EXPECTED = "s3cret-connector-token-QmFzZTY0";
const config = { expectedToken: EXPECTED };

function capture(header: string | undefined, cfg = config): UnauthorizedError {
  try {
    assertConnectorToken(header, cfg);
  } catch (error) {
    if (error instanceof UnauthorizedError) return error;
    throw new Error(`expected UnauthorizedError, got ${String(error)}`);
  }
  throw new Error("expected assertConnectorToken to throw");
}

/** Every representation of the error a caller or log sink could see. */
function allStrings(error: UnauthorizedError): string[] {
  return [
    error.message,
    String(error),
    JSON.stringify(error),
    JSON.stringify(error.toJSON()),
    inspect(error),
    error.stack ?? "",
  ];
}

const FAILURE_MODES: Array<[label: string, header: string | undefined]> = [
  ["missing header", undefined],
  ["empty header", ""],
  ["malformed header (wrong scheme)", `Basic ${EXPECTED}`],
  ["malformed header (no scheme)", EXPECTED],
  ["malformed header (bearer with no token)", "Bearer "],
  ["malformed header (bearer with two tokens)", `Bearer ${EXPECTED} extra`],
  ["wrong token, same length", `Bearer ${"x".repeat(EXPECTED.length)}`],
  ["wrong token, shorter", "Bearer short"],
  ["wrong token, longer", `Bearer ${EXPECTED}${EXPECTED}`],
  ["wrong token, prefix of expected", `Bearer ${EXPECTED.slice(0, -1)}`],
  ["wrong token, expected plus one char", `Bearer ${EXPECTED}x`],
  ["wrong token, case-flipped", `Bearer ${EXPECTED.toUpperCase()}`],
];

describe("assertConnectorToken success", () => {
  it("accepts the exact expected token", () => {
    expect(() => assertConnectorToken(`Bearer ${EXPECTED}`, config)).not.toThrow();
  });

  it("accepts a case-insensitive scheme and surrounding whitespace", () => {
    expect(() => assertConnectorToken(`bearer ${EXPECTED}`, config)).not.toThrow();
    expect(() => assertConnectorToken(`  Bearer   ${EXPECTED}  `, config)).not.toThrow();
  });
});

describe("assertConnectorToken failure modes", () => {
  it.each(FAILURE_MODES)("%s → UnauthorizedError", (_label, header) => {
    const error = capture(header);
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error.code).toBe("UNAUTHORIZED");
  });

  it("every failure mode is indistinguishable: identical code, message, and wire shape", () => {
    const shapes = new Set(FAILURE_MODES.map(([, header]) => JSON.stringify(capture(header).toJSON())));
    expect(shapes.size).toBe(1);
    expect([...shapes][0]).toBe(JSON.stringify({ code: "UNAUTHORIZED", message: "Unauthorized" }));

    const messages = new Set(FAILURE_MODES.map(([, header]) => capture(header).message));
    expect(messages).toEqual(new Set(["Unauthorized"]));

    const names = new Set(FAILURE_MODES.map(([, header]) => capture(header).name));
    expect(names).toEqual(new Set(["UnauthorizedError"]));
  });

  it("carries no cause that could distinguish failure modes", () => {
    for (const [, header] of FAILURE_MODES) expect(capture(header).cause).toBeUndefined();
  });

  it.each(FAILURE_MODES)("%s → expected token absent from every error string", (_label, header) => {
    for (const text of allStrings(capture(header))) {
      expect(text).not.toContain(EXPECTED);
    }
  });

  it("presented token is absent from every error string", () => {
    const presented = "attacker-supplied-value-9f8e7d";
    for (const text of allStrings(capture(`Bearer ${presented}`))) {
      expect(text).not.toContain(presented);
    }
  });

  it("rejects everything when the expected token is empty, including an empty bearer", () => {
    const empty = { expectedToken: "" };
    expect(() => assertConnectorToken("Bearer ", empty)).toThrow(UnauthorizedError);
    expect(() => assertConnectorToken("Bearer x", empty)).toThrow(UnauthorizedError);
    expect(() => assertConnectorToken(undefined, empty)).toThrow(UnauthorizedError);
  });

  it("does not throw a non-Unauthorized error on length mismatch (timingSafeEqual guard)", () => {
    // timingSafeEqual throws RangeError on length mismatch; hashing both sides first must prevent that.
    expect(() => assertConnectorToken("Bearer a", config)).toThrow(UnauthorizedError);
    expect(() => assertConnectorToken(`Bearer ${"a".repeat(10_000)}`, config)).toThrow(UnauthorizedError);
  });
});
