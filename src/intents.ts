/**
 * Intent registry: what the user is actually trying to do, and whether this
 * deployment can serve it.
 *
 * Tools describe *operations*; intents describe *goals*. An agent holding only
 * a tool list has to infer that "what's on my quiz" means two chained reads,
 * and that "submit my essay" is impossible here. Inferring the second wrongly
 * is the expensive failure: it ends with the agent reporting that it submitted
 * coursework it never touched. Resolving the intent first turns that into a
 * structured refusal before any tool runs.
 *
 * Classification stays in the model. `listIntents` publishes example phrasings,
 * the model matches against them, and `resolveIntent` rules on the match — no
 * NLP happens server-side, so the decision is deterministic and testable.
 *
 * Nothing in this module contacts Canvas.
 */
import { CapabilityPolicy, type Capability } from "./capabilities.js";
import { InvalidInputError } from "./errors.js";

export const INTENT_IDS = Object.freeze([
  "check_connector_health",
  "identify_self",
  "list_enrolled_courses",
  "review_upcoming_work",
  "prepare_for_assessment",
  "submit_assignment",
  "take_quiz",
  "change_grades",
  "message_instructor",
] as const);

export type IntentId = (typeof INTENT_IDS)[number];

export function isIntentId(value: string): value is IntentId {
  return (INTENT_IDS as readonly string[]).includes(value);
}

/** Why an intent cannot be served, as distinct from merely being disabled. */
export type UnsupportedReason =
  /** Would require writing to Canvas; no capability here permits a write. */
  | "read_only_connector"
  /** Readable in principle, but outside what this connector exposes. */
  | "out_of_scope";

export interface PlanStep {
  tool: string;
  /** What this step contributes, so an agent can narrate or skip it. */
  why: string;
  /** Where this step's arguments come from, when they are not user-supplied. */
  arguments_from?: string;
}

interface IntentBase {
  id: IntentId;
  description: string;
  /** Phrasings an agent can match a user request against. */
  examples: readonly string[];
}

export interface ServableIntent extends IntentBase {
  supported: true;
  requires: readonly Capability[];
  plan: readonly PlanStep[];
}

export interface UnsupportedIntent extends IntentBase {
  supported: false;
  reason: UnsupportedReason;
  /** Told to the user. States the limit plainly; no lecture. */
  guidance: string;
  /** Servable neighbours, so a refusal still moves the user forward. */
  alternatives: readonly IntentId[];
}

export type Intent = ServableIntent | UnsupportedIntent;

const REGISTRY: Readonly<Record<IntentId, Intent>> = Object.freeze({
  check_connector_health: {
    id: "check_connector_health",
    description: "Check that the connector is reachable.",
    examples: ["is the canvas connector up?", "are you connected to canvas?"],
    supported: true,
    requires: [],
    plan: [{ tool: "health_check", why: "Reports liveness without reading any Canvas data." }],
  },
  identify_self: {
    id: "identify_self",
    description: "Find out which Canvas account this connector is acting as.",
    examples: ["who am i in canvas?", "whose canvas account is this?", "what's my canvas email?"],
    supported: true,
    requires: ["read_profile"],
    plan: [{ tool: "get_current_user", why: "Returns the profile of the single Canvas identity this deployment serves." }],
  },
  list_enrolled_courses: {
    id: "list_enrolled_courses",
    description: "List the courses the Canvas identity is enrolled in.",
    examples: ["what classes am i taking?", "list my courses", "am i still enrolled in bio?"],
    supported: true,
    requires: ["read_courses"],
    plan: [{ tool: "list_courses", why: "Returns every course visible to the Canvas token, across all pages." }],
  },
  review_upcoming_work: {
    id: "review_upcoming_work",
    description: "See what work is assigned and when it is due.",
    examples: ["what's due this week?", "do i have anything overdue?", "what assignments are coming up?"],
    supported: true,
    requires: ["read_courses", "read_assignments"],
    plan: [
      { tool: "list_courses", why: "Assignments are per-course, so the course set comes first." },
      {
        tool: "list_assignments",
        why: "Returns assignments and due dates for one course; repeat per course of interest.",
        arguments_from: "course_id from the chosen entry in list_courses output",
      },
    ],
  },
  prepare_for_assessment: {
    id: "prepare_for_assessment",
    description: "Find out what an upcoming quiz or assignment covers, in order to study for it.",
    examples: ["what's on the biology quiz?", "help me study for my cs midterm", "what does week 1 reflection ask for?"],
    supported: true,
    requires: ["read_courses", "read_assignments"],
    plan: [
      { tool: "list_courses", why: "Locates the course the assessment belongs to." },
      {
        tool: "list_assignments",
        why: "Returns assignment names, descriptions, and due dates to study from.",
        arguments_from: "course_id from the chosen entry in list_courses output",
      },
    ],
  },
  submit_assignment: {
    id: "submit_assignment",
    description: "Turn in work for an assignment.",
    examples: ["submit my essay", "turn in the week 1 reflection", "upload my homework to canvas"],
    supported: false,
    reason: "read_only_connector",
    guidance:
      "This connector is read-only and has no capability that writes to Canvas, so it cannot submit work. Submit through Canvas directly. It can show you what the assignment asks for and when it is due.",
    alternatives: ["prepare_for_assessment", "review_upcoming_work"],
  },
  take_quiz: {
    id: "take_quiz",
    description: "Answer or complete a graded quiz.",
    examples: ["take my quiz for me", "answer the bio quiz", "complete quiz 3 in canvas"],
    supported: false,
    reason: "read_only_connector",
    guidance:
      "This connector is read-only and cannot submit quiz responses. It can tell you what an assessment covers and when it is due so you can prepare for it.",
    alternatives: ["prepare_for_assessment"],
  },
  change_grades: {
    id: "change_grades",
    description: "Modify a grade or score.",
    examples: ["change my grade", "update my score on the midterm"],
    supported: false,
    reason: "read_only_connector",
    guidance: "This connector is read-only and cannot modify grades.",
    alternatives: [],
  },
  message_instructor: {
    id: "message_instructor",
    description: "Send a message to an instructor or classmate.",
    examples: ["email my professor", "message my ta about the extension"],
    supported: false,
    reason: "read_only_connector",
    guidance: "This connector cannot send messages; it has no write capability. Use Canvas Inbox or email directly.",
    alternatives: ["list_enrolled_courses"],
  },
});

/**
 * `ready` means go; `blocked_by_capability` means this deployment turned it off
 * and an operator could turn it back on; `unsupported` means no configuration
 * of this connector will ever serve it. Agents should treat the last as final.
 */
export type IntentStatus = "ready" | "blocked_by_capability" | "unsupported";

export interface IntentResolution {
  intent: IntentId;
  description: string;
  status: IntentStatus;
  requires?: Capability[];
  /** Required capabilities this deployment has not enabled. */
  missing?: Capability[];
  plan?: PlanStep[];
  reason?: UnsupportedReason;
  guidance?: string;
  alternatives?: IntentId[];
}

function statusOf(intent: Intent, policy: CapabilityPolicy): IntentStatus {
  if (!intent.supported) return "unsupported";
  return intent.requires.every((capability) => policy.allows(capability)) ? "ready" : "blocked_by_capability";
}

export function resolveIntent(id: string, policy: CapabilityPolicy): IntentResolution {
  if (!isIntentId(id)) {
    // Deliberately lists the valid ids: INVALID_INPUT tells an agent to retry
    // with different arguments, which is only actionable if it knows the set.
    throw new InvalidInputError(`Unknown intent. Known intents: ${INTENT_IDS.join(", ")}`);
  }
  const intent = REGISTRY[id];

  if (!intent.supported) {
    return {
      intent: intent.id,
      description: intent.description,
      status: "unsupported",
      reason: intent.reason,
      guidance: intent.guidance,
      alternatives: [...intent.alternatives],
    };
  }

  const missing = intent.requires.filter((capability) => !policy.allows(capability));
  return {
    intent: intent.id,
    description: intent.description,
    status: missing.length === 0 ? "ready" : "blocked_by_capability",
    requires: [...intent.requires],
    missing,
    plan: intent.plan.map((step) => ({ ...step })),
    ...(missing.length > 0
      ? {
          guidance: `This deployment has not enabled ${missing.join(", ")}. An operator can add it to CANVAS_CAPABILITIES; it cannot be granted at request time.`,
        }
      : {}),
  };
}

export interface IntentSummary {
  id: IntentId;
  description: string;
  examples: string[];
  status: IntentStatus;
}

/**
 * The whole catalogue with per-intent status, so an agent can match a request
 * and check feasibility in one round trip rather than probing tools blindly.
 */
export function listIntents(policy: CapabilityPolicy): { intents: IntentSummary[]; count: number } {
  const intents = INTENT_IDS.map((id) => {
    const intent = REGISTRY[id];
    return {
      id: intent.id,
      description: intent.description,
      examples: [...intent.examples],
      status: statusOf(intent, policy),
    };
  });
  return { intents, count: intents.length };
}
