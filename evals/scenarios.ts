/**
 * Tier 1 eval scenarios.
 *
 * Each one names a real user request and the tool sequence meant to satisfy
 * it. Where a step needs an argument, it derives that argument from the
 * previous step's output through a resolver that throws when the data is not
 * there — so "the agent could not have known which course_id to pass" is
 * recorded as a failure rather than quietly hard-coded around.
 */
import type { Scenario } from "./harness.js";

/**
 * Stand-in for the model's job in a chained call: pick the course the user
 * meant and pull the id the next tool needs. Every throw here is a statement
 * that list_courses did not return enough to continue.
 */
function courseIdMatching(last: unknown, pattern: RegExp): number {
  const courses = (last as { courses?: unknown } | null)?.courses;
  if (!Array.isArray(courses)) {
    throw new Error("list_courses returned no `courses` array to choose from");
  }
  const match = courses.find((course: Record<string, unknown>) =>
    [course?.name, course?.course_code].some((field) => typeof field === "string" && pattern.test(field)),
  );
  if (!match) {
    throw new Error(`no course in list_courses output matched ${pattern} (names are the only handle an agent has)`);
  }
  if (typeof match.id !== "number") {
    throw new Error("matched course carried no numeric `id`, so list_assignments cannot be called");
  }
  return match.id;
}

const nonEmptyString = (value: unknown) => typeof value === "string" && value.trim().length > 0;

export const scenarios: readonly Scenario[] = [
  // ---------------------------------------------------------------- chaining
  {
    id: "chain-assignments-for-named-course",
    category: "chaining",
    prompt: "What assignments do I have in Introduction to Biology?",
    capabilities: "read_courses,read_assignments",
    steps: [
      {
        tool: "list_courses",
        expectFacts: [
          { path: "count", equals: 2 },
          {
            path: "courses.0.id",
            satisfies: (value) => typeof value === "number",
            describe: "each course carries a numeric id usable as a later argument",
          },
        ],
      },
      {
        tool: "list_assignments",
        argsFrom: ({ last }) => ({ course_id: courseIdMatching(last, /biology/i) }),
        expectFacts: [
          { path: "count", equals: 1 },
          { path: "assignments.0.name", equals: "Week 1 Reflection" },
          { path: "assignments.0.due_at", equals: "2026-09-08T23:59:00Z" },
          {
            path: "assignments.0.source_url",
            satisfies: nonEmptyString,
            describe: "the assignment cites a source_url the user can open",
          },
        ],
      },
    ],
    expectGatewayCalls: ["listCourses", "listAssignments"],
  },
  {
    id: "chain-course-with-no-assignments",
    category: "chaining",
    prompt: "Is anything due in CS-100?",
    capabilities: "read_courses,read_assignments",
    steps: [
      { tool: "list_courses" },
      {
        // Resolves on course_code, not name: an agent given a course code
        // should not have to guess the title to make the call.
        tool: "list_assignments",
        argsFrom: ({ last }) => ({ course_id: courseIdMatching(last, /^CS-100$/i) }),
        expectFacts: [
          { path: "count", equals: 0 },
          { path: "assignments", equals: [] },
        ],
      },
    ],
    expectGatewayCalls: ["listCourses", "listAssignments"],
  },

  // ------------------------------------------------------- output sufficiency
  {
    id: "profile-is-answerable",
    category: "output-sufficiency",
    prompt: "Who am I logged in as in Canvas?",
    capabilities: "read_profile",
    steps: [
      {
        tool: "get_current_user",
        expectFacts: [
          { path: "id", equals: 1001 },
          { path: "name", equals: "Example Canvas User" },
          { path: "source_system", equals: "canvas" },
          { path: "external_id", equals: "1001" },
          { path: "source_url", satisfies: nonEmptyString, describe: "the profile cites where it came from" },
        ],
      },
    ],
    expectGatewayCalls: ["getCurrentUser"],
  },
  {
    id: "course-list-merges-pagination",
    category: "output-sufficiency",
    prompt: "List all of my courses.",
    capabilities: "read_courses",
    steps: [
      {
        // Both fixture pages must appear: an agent that sees only page one
        // would confidently give an incomplete answer.
        tool: "list_courses",
        expectFacts: [
          { path: "count", equals: 2 },
          { path: "courses.0.name", equals: "Introduction to Biology" },
          { path: "courses.1.name", equals: "Foundations of Computer Science" },
        ],
      },
    ],
    expectGatewayCalls: ["listCourses"],
  },
  {
    id: "health-check-needs-no-capability",
    category: "output-sufficiency",
    prompt: "Is the Canvas connector up?",
    capabilities: "",
    steps: [
      {
        tool: "health_check",
        expectFacts: [
          { path: "status", equals: "ok" },
          { path: "service", equals: "canvas-mcp-connector" },
        ],
      },
    ],
    expectGatewayCalls: [],
  },

  // -------------------------------------------------- capability enforcement
  {
    id: "denied-profile-never-reaches-canvas",
    category: "capability-enforcement",
    prompt: "Show me my Canvas profile.",
    capabilities: "read_courses,read_assignments",
    steps: [
      {
        tool: "get_current_user",
        expectErrorCode: "PERMISSION_DENIED",
        expectDisposition: "terminal",
      },
    ],
    expectGatewayCalls: [],
  },
  {
    id: "denial-midway-through-a-chain",
    category: "capability-enforcement",
    prompt: "What assignments do I have in Introduction to Biology?",
    capabilities: "read_courses",
    steps: [
      { tool: "list_courses", expectFacts: [{ path: "count", equals: 2 }] },
      {
        // The first half of the task is permitted and the second is not; the
        // denial must arrive before Canvas is touched a second time.
        tool: "list_assignments",
        argsFrom: ({ last }) => ({ course_id: courseIdMatching(last, /biology/i) }),
        expectErrorCode: "PERMISSION_DENIED",
        expectDisposition: "terminal",
      },
    ],
    expectGatewayCalls: ["listCourses"],
  },
  {
    id: "empty-policy-denies-every-canvas-tool",
    category: "capability-enforcement",
    prompt: "Tell me everything you can about my Canvas account.",
    capabilities: "",
    steps: [
      { tool: "get_current_user", expectErrorCode: "PERMISSION_DENIED", expectDisposition: "terminal" },
      { tool: "list_courses", expectErrorCode: "PERMISSION_DENIED", expectDisposition: "terminal" },
      { tool: "list_assignments", args: { course_id: 2001 }, expectErrorCode: "PERMISSION_DENIED", expectDisposition: "terminal" },
    ],
    expectGatewayCalls: [],
  },

  // ------------------------------------------------------------ error contract
  {
    id: "timeout-reads-as-retryable",
    category: "error-contract",
    prompt: "List all of my courses.",
    capabilities: "read_courses",
    faults: { listCourses: "timeout" },
    steps: [{ tool: "list_courses", expectErrorCode: "CANVAS_TIMEOUT", expectDisposition: "retry" }],
    expectGatewayCalls: ["listCourses"],
  },
  {
    id: "rate-limit-reads-as-retryable",
    category: "error-contract",
    prompt: "List all of my courses.",
    capabilities: "read_courses",
    faults: { listCourses: "rate_limited" },
    steps: [{ tool: "list_courses", expectErrorCode: "RATE_LIMITED", expectDisposition: "retry" }],
    expectGatewayCalls: ["listCourses"],
  },
  {
    id: "upstream-failure-reads-as-terminal",
    category: "error-contract",
    prompt: "Show me my Canvas profile.",
    capabilities: "read_profile",
    faults: { getCurrentUser: "api_error" },
    steps: [{ tool: "get_current_user", expectErrorCode: "CANVAS_API_ERROR", expectDisposition: "terminal" }],
    expectGatewayCalls: ["getCurrentUser"],
  },
  {
    id: "unknown-course-is-not-retryable-as-is",
    category: "error-contract",
    prompt: "What's due in course 9999?",
    capabilities: "read_assignments",
    steps: [
      {
        // A well-formed id for a course that does not exist. Retrying this
        // unchanged will never succeed, so it must not read as retryable.
        tool: "list_assignments",
        args: { course_id: 9999 },
        expectErrorCode: "CANVAS_API_ERROR",
        expectDisposition: "terminal",
      },
    ],
    expectGatewayCalls: ["listAssignments"],
  },

  // ------------------------------------------------------------ secret hygiene
  {
    id: "no-leak-when-every-canvas-call-fails",
    category: "secret-hygiene",
    prompt: "Give me my profile, my courses, and my assignments.",
    capabilities: "read_profile,read_courses,read_assignments",
    faults: { getCurrentUser: "api_error", listCourses: "timeout", listAssignments: "rate_limited" },
    steps: [
      { tool: "get_current_user", expectErrorCode: "CANVAS_API_ERROR", expectDisposition: "terminal" },
      { tool: "list_courses", expectErrorCode: "CANVAS_TIMEOUT", expectDisposition: "retry" },
      { tool: "list_assignments", args: { course_id: 2001 }, expectErrorCode: "RATE_LIMITED", expectDisposition: "retry" },
    ],
    expectGatewayCalls: ["getCurrentUser", "listCourses", "listAssignments"],
  },
  {
    id: "no-leak-on-the-happy-path",
    category: "secret-hygiene",
    prompt: "Give me my profile, my courses, and my assignments.",
    capabilities: "read_profile,read_courses,read_assignments",
    steps: [
      { tool: "get_current_user" },
      { tool: "list_courses" },
      { tool: "list_assignments", args: { course_id: 2001 } },
    ],
    expectGatewayCalls: ["getCurrentUser", "listCourses", "listAssignments"],
  },
];
