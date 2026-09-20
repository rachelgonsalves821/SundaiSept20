import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  CAPABILITIES,
  Capability,
  CapabilityPolicy,
  PermissionDeniedError,
  isCapability,
  policyFromEnvironment,
} from "../src/capabilities.js";
import { getCurrentUser, listAssignments, listCourses } from "../src/tools.js";

let stderr: MockInstance<typeof process.stderr.write>;
let stdout: MockInstance<typeof process.stdout.write>;

beforeEach(() => {
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("capability vocabulary", () => {
  it("exposes a frozen, finite capability vocabulary", () => {
    expect(Object.isFrozen(CAPABILITIES)).toBe(true);
    expect(CAPABILITIES).toEqual(["read_profile", "read_courses", "read_assignments"]);
    expect(Capability.safeParse("write_grades").success).toBe(false);
    expect(isCapability("read_profile")).toBe(true);
    expect(isCapability("admin")).toBe(false);
  });
});

describe("CapabilityPolicy allow/block", () => {
  it.each(CAPABILITIES)("allows %s when it is the only configured capability", (capability) => {
    const policy = new CapabilityPolicy(capability);
    expect(policy.allows(capability)).toBe(true);
    expect(() => policy.assertAllowed(capability)).not.toThrow();
    expect(policy.list()).toEqual([capability]);
  });

  it.each(CAPABILITIES)("blocks %s when every other capability is configured", (capability) => {
    const others = CAPABILITIES.filter((c) => c !== capability);
    const policy = new CapabilityPolicy(others.join(","));
    expect(policy.allows(capability)).toBe(false);
    expect(() => policy.assertAllowed(capability)).toThrow(PermissionDeniedError);
    for (const other of others) expect(policy.allows(other)).toBe(true);
  });

  it("throws PERMISSION_DENIED with a message that names the capability and nothing else", () => {
    const policy = new CapabilityPolicy("read_courses");
    let caught: unknown;
    try {
      policy.assertAllowed("read_assignments");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PermissionDeniedError);
    expect(caught).toMatchObject({
      code: "PERMISSION_DENIED",
      capability: "read_assignments",
      message: "Permission denied: capability 'read_assignments' is not enabled",
    });
  });

  it("accepts an array as well as a comma-separated string", () => {
    expect(new CapabilityPolicy(["read_profile", "read_assignments"]).list()).toEqual(["read_profile", "read_assignments"]);
    expect(new CapabilityPolicy("read_profile,read_assignments").list()).toEqual(["read_profile", "read_assignments"]);
  });

  it("trims whitespace and ignores empty entries", () => {
    const policy = new CapabilityPolicy(" read_profile , ,read_courses,, ");
    expect(policy.list()).toEqual(["read_profile", "read_courses"]);
  });

  it("returns list() in canonical order regardless of input order", () => {
    expect(new CapabilityPolicy("read_assignments,read_profile").list()).toEqual(["read_profile", "read_assignments"]);
  });

  it("yields an empty policy for empty input", () => {
    const policy = new CapabilityPolicy("");
    expect(policy.list()).toEqual([]);
    for (const capability of CAPABILITIES) expect(policy.allows(capability)).toBe(false);
  });
});

describe("unknown capabilities", () => {
  it("drops unknown capability strings and never grants them", () => {
    const policy = new CapabilityPolicy("read_courses,write_grades,admin");
    expect(policy.list()).toEqual(["read_courses"]);
    expect(policy.allows("write_grades" as Capability)).toBe(false);
    expect(policy.allows("admin" as Capability)).toBe(false);
    expect(() => policy.assertAllowed("write_grades" as Capability)).toThrow(PermissionDeniedError);
  });

  it("is case-sensitive: READ_COURSES is not read_courses", () => {
    expect(new CapabilityPolicy("READ_COURSES").list()).toEqual([]);
  });

  it("reports dropped names on stderr and never on stdout", () => {
    new CapabilityPolicy("read_courses,write_grades,admin");
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0]?.[0])).toContain("write_grades");
    expect(String(stderr.mock.calls[0]?.[0])).toContain("admin");
    expect(stdout).not.toHaveBeenCalled();
  });

  it("writes nothing when every capability is recognized", () => {
    new CapabilityPolicy("read_profile,read_courses,read_assignments");
    expect(stderr).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  });
});

describe("policyFromEnvironment", () => {
  it("reads CANVAS_CAPABILITIES", () => {
    expect(policyFromEnvironment({ CANVAS_CAPABILITIES: "read_profile" }).list()).toEqual(["read_profile"]);
  });

  it("yields an empty policy when the variable is unset", () => {
    expect(policyFromEnvironment({}).list()).toEqual([]);
  });
});

describe("blocked capability prevents Canvas client invocation", () => {
  const makeClient = () => ({
    getCurrentUser: vi.fn(async () => ({ id: 1, name: "Test" })),
    listCourses: vi.fn(async () => [{ id: 7, name: "Canvas 101" }]),
    listAssignments: vi.fn(async () => [{ id: 9, name: "HW 1", course_id: 7 }]),
  });

  const deps = (capabilities: string, client = makeClient()) => ({
    policy: new CapabilityPolicy(capabilities),
    canvasBaseUrl: "https://canvas.test",
    client: client as never,
  });

  it("get_current_user: client is never called when read_profile is blocked", async () => {
    const client = makeClient();
    await expect(getCurrentUser(deps("read_courses,read_assignments", client))).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(client.getCurrentUser).not.toHaveBeenCalled();
  });

  it("list_courses: client is never called when read_courses is blocked", async () => {
    const client = makeClient();
    await expect(listCourses(deps("read_profile,read_assignments", client))).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(client.listCourses).not.toHaveBeenCalled();
  });

  it("list_assignments: client is never called when read_assignments is blocked, even with valid input", async () => {
    const client = makeClient();
    await expect(listAssignments({ course_id: 7 }, deps("read_profile,read_courses", client))).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(client.listAssignments).not.toHaveBeenCalled();
  });

  it("list_assignments: permission check runs before input validation", async () => {
    const client = makeClient();
    await expect(listAssignments({ course_id: "not-a-number" }, deps("read_profile", client))).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(client.listAssignments).not.toHaveBeenCalled();
  });

  it("calls the client exactly once when the capability is allowed", async () => {
    const client = makeClient();
    await listCourses(deps("read_courses", client));
    expect(client.listCourses).toHaveBeenCalledTimes(1);
  });
});
