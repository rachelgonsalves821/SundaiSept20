import { describe, expect, it } from "vitest";
import { CAPABILITIES, Capability, CapabilityPolicy, PermissionDeniedError } from "../src/capabilities.js";

describe("capability policy", () => {
  it("exposes a frozen, finite capability vocabulary", () => {
    expect(Object.isFrozen(CAPABILITIES)).toBe(true);
    expect(CAPABILITIES).toEqual(["read_profile", "read_courses", "read_assignments"]);
    expect(Capability.safeParse("write_grades").success).toBe(false);
  });

  it("allows configured read capabilities", () => {
    const policy = new CapabilityPolicy("read_profile,read_courses");
    expect(() => policy.assertAllowed("read_profile")).not.toThrow();
    expect(() => policy.assertAllowed("read_courses")).not.toThrow();
  });

  it("blocks capabilities that are not configured", () => {
    const policy = new CapabilityPolicy("read_courses");
    expect(() => policy.assertAllowed("read_assignments")).toThrow(PermissionDeniedError);
  });
});
