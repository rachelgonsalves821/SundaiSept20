import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { CanvasApiError } from "../src/canvas-client.js";
import {
  ConnectorError,
  InternalError,
  InvalidInputError,
  RateLimitedError,
  UnauthorizedError,
  canvasStatusToCode,
  toConnectorError,
} from "../src/errors.js";

describe("stable connector errors", () => {
  it("assigns stable codes to typed errors", () => {
    expect(new InvalidInputError().toJSON()).toEqual({ code: "INVALID_INPUT", message: "Invalid tool input" });
    expect(new UnauthorizedError().toJSON()).toEqual({ code: "UNAUTHORIZED", message: "Unauthorized" });
    expect(new RateLimitedError().code).toBe("RATE_LIMITED");
    // CanvasApiError takes an explicit code (defaults to CANVAS_API_ERROR); the client passes CANVAS_TIMEOUT on abort.
    expect(new CanvasApiError("Canvas returned 408", 408, "https://canvas.test").code).toBe("CANVAS_API_ERROR");
    expect(new CanvasApiError("timed out", 408, "https://canvas.test", "CANVAS_TIMEOUT").code).toBe("CANVAS_TIMEOUT");
  });

  it("maps Canvas HTTP statuses to codes, with 429 kept distinct from generic API errors", () => {
    expect(canvasStatusToCode(429)).toBe("RATE_LIMITED");
    expect(canvasStatusToCode(408)).toBe("CANVAS_TIMEOUT");
    expect(canvasStatusToCode(504)).toBe("CANVAS_TIMEOUT");
    expect(canvasStatusToCode(500)).toBe("CANVAS_API_ERROR");
    expect(canvasStatusToCode(404)).toBe("CANVAS_API_ERROR");
    expect(canvasStatusToCode(401)).toBe("CANVAS_API_ERROR");
  });

  it("converts unknown errors to a safe internal error", () => {
    const error = toConnectorError(new Error("secret implementation detail"));
    expect(error.toJSON()).toEqual({ code: "INTERNAL_ERROR", message: "Internal connector error" });
    expect(JSON.stringify(error)).not.toContain("secret implementation detail");
  });

  it("passes ConnectorErrors through untouched", () => {
    const original = new InvalidInputError("course_id must be a positive integer");
    expect(toConnectorError(original)).toBe(original);
  });

  it("keeps cause server-side: excluded from the wire shape", () => {
    const error = new InternalError("Internal connector error", { authorization: "Bearer leaked-token" });
    expect(JSON.stringify(error)).not.toContain("leaked-token");
    expect(error.cause).toMatchObject({ authorization: "Bearer leaked-token" });
  });

  it("is an Error subclass with a code and name", () => {
    const error = new ConnectorError("CANVAS_API_ERROR", "boom");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ConnectorError");
    expect(inspect(error)).toContain("boom");
  });
});
