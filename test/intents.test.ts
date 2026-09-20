import { describe, expect, it } from "vitest";
import { CapabilityPolicy } from "../src/capabilities.js";
import { ConnectorError } from "../src/errors.js";
import { INTENT_IDS, listIntents, resolveIntent, type IntentId } from "../src/intents.js";

const ALL = "read_profile,read_courses,read_assignments";
const policy = (capabilities: string) => new CapabilityPolicy(capabilities);

/** Tool names the server actually registers; a plan may not invent one. */
const REGISTERED_TOOLS = new Set([
  "health_check",
  "get_current_user",
  "list_courses",
  "list_assignments",
  "list_intents",
  "resolve_intent",
]);

describe("resolveIntent: capability-dependent statuses", () => {
  it("is ready when every required capability is enabled", () => {
    const resolution = resolveIntent("review_upcoming_work", policy(ALL));
    expect(resolution.status).toBe("ready");
    expect(resolution.missing).toEqual([]);
    expect(resolution.plan?.map((step) => step.tool)).toEqual(["list_courses", "list_assignments"]);
  });

  it("is blocked_by_capability when a required capability is off, and names only what is missing", () => {
    const resolution = resolveIntent("review_upcoming_work", policy("read_courses"));
    expect(resolution.status).toBe("blocked_by_capability");
    expect(resolution.missing).toEqual(["read_assignments"]);
    expect(resolution.requires).toEqual(["read_courses", "read_assignments"]);
    expect(resolution.guidance).toContain("CANVAS_CAPABILITIES");
  });

  it("still returns the plan when blocked, so an operator can see what enabling it would allow", () => {
    expect(resolveIntent("identify_self", policy("")).plan?.map((step) => step.tool)).toEqual(["get_current_user"]);
  });

  it("needs no capability for health", () => {
    const resolution = resolveIntent("check_connector_health", policy(""));
    expect(resolution.status).toBe("ready");
    expect(resolution.requires).toEqual([]);
  });
});

describe("resolveIntent: write intents are final, not merely disabled", () => {
  const writeIntents: IntentId[] = ["submit_assignment", "take_quiz", "change_grades", "message_instructor"];

  it.each(writeIntents)("%s is unsupported even with every capability enabled", (intent) => {
    const resolution = resolveIntent(intent, policy(ALL));
    expect(resolution.status).toBe("unsupported");
    expect(resolution.reason).toBe("read_only_connector");
    expect(resolution.guidance).toBeTruthy();
  });

  it.each(writeIntents)("%s carries no plan or requirements an agent could act on", (intent) => {
    const resolution = resolveIntent(intent, policy(ALL));
    expect(resolution.plan).toBeUndefined();
    expect(resolution.requires).toBeUndefined();
    expect(resolution.missing).toBeUndefined();
  });

  it("distinguishes taking a quiz from preparing for one", () => {
    expect(resolveIntent("take_quiz", policy(ALL)).status).toBe("unsupported");
    expect(resolveIntent("prepare_for_assessment", policy(ALL)).status).toBe("ready");
  });
});

describe("resolveIntent: unknown input", () => {
  it("raises INVALID_INPUT naming the known intents", () => {
    let thrown: unknown;
    try {
      resolveIntent("delete_everything", policy(ALL));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConnectorError);
    expect((thrown as ConnectorError).code).toBe("INVALID_INPUT");
    expect((thrown as ConnectorError).message).toContain("submit_assignment");
  });
});

describe("registry invariants", () => {
  it("every plan step names a tool the server registers", () => {
    for (const id of INTENT_IDS) {
      for (const step of resolveIntent(id, policy(ALL)).plan ?? []) {
        expect(REGISTERED_TOOLS, `${id} -> ${step.tool}`).toContain(step.tool);
      }
    }
  });

  it("every suggested alternative is a known intent that is not itself unsupported", () => {
    for (const id of INTENT_IDS) {
      for (const alternative of resolveIntent(id, policy(ALL)).alternatives ?? []) {
        expect(INTENT_IDS).toContain(alternative);
        expect(resolveIntent(alternative, policy(ALL)).status, `${id} -> ${alternative}`).not.toBe("unsupported");
      }
    }
  });

  it("no guidance string leaks a capability name that is not a real capability", () => {
    for (const id of INTENT_IDS) {
      const resolution = resolveIntent(id, policy("read_courses"));
      for (const capability of resolution.missing ?? []) {
        expect(["read_profile", "read_courses", "read_assignments"]).toContain(capability);
      }
    }
  });
});

describe("listIntents", () => {
  it("returns the whole catalogue with status reflecting the live policy", () => {
    const { intents, count } = listIntents(policy("read_courses"));
    expect(count).toBe(INTENT_IDS.length);
    const byId = new Map(intents.map((intent) => [intent.id, intent]));
    expect(byId.get("list_enrolled_courses")?.status).toBe("ready");
    expect(byId.get("identify_self")?.status).toBe("blocked_by_capability");
    expect(byId.get("submit_assignment")?.status).toBe("unsupported");
  });

  it("gives every intent at least one example phrasing to match against", () => {
    for (const intent of listIntents(policy(ALL)).intents) {
      expect(intent.examples.length, intent.id).toBeGreaterThan(0);
    }
  });
});
