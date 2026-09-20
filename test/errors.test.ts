import { describe, expect, it } from "vitest";
import { CanvasApiError } from "../src/canvas-client.js";
import { InvalidInputError, toConnectorError } from "../src/errors.js";

describe("stable connector errors", () => {
  it("assigns stable codes to typed errors", () => {
    expect(new InvalidInputError().toJSON()).toEqual({ code: "INVALID_INPUT", message: "Invalid tool input" });
    expect(new CanvasApiError("Canvas returned 408", 408, "https://canvas.test").code).toBe("CANVAS_API_ERROR");
  });

  it("converts unknown errors to a safe internal error", () => {
    const error = toConnectorError(new Error("secret implementation detail"));
    expect(error.toJSON()).toEqual({ code: "INTERNAL_ERROR", message: "Internal connector error" });
  });
});
