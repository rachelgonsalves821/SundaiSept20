import { describe, expect, it } from "vitest";
import { CapabilityPolicy, PermissionDeniedError } from "../src/capabilities.js";
import { listCourses } from "../src/tools.js";

const deps = (capabilities: string) => ({
  policy: new CapabilityPolicy(capabilities),
  canvasBaseUrl: "https://canvas.test",
  client: { listCourses: async () => [{ id: 7, name: "Canvas 101" }] } as never,
});

describe("MCP tool dependencies", () => {
  it("returns normalized courses when read_courses is allowed", async () => {
    const result = await listCourses(deps("read_courses"));
    expect(result.courses[0]).toMatchObject({ id: 7, name: "Canvas 101", source_system: "canvas", external_id: "7" });
  });

  it("returns a permission error before calling Canvas when blocked", async () => {
    await expect(listCourses(deps("read_profile"))).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
