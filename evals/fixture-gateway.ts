/**
 * Fixture-backed CanvasGateway for the eval harness.
 *
 * Lets a scenario drive the real McpServer end to end with no network and no
 * Canvas credentials, while recording every Canvas read a tool sequence
 * performed so a scenario can assert which reads did (and did not) happen.
 *
 * Faults are constructed as CanvasApiError with the same codes and messages
 * CanvasClient itself produces, so the error-contract evals measure the real
 * client's contract rather than a convenient stand-in. Keep them in sync with
 * `request()` in src/canvas-client.ts.
 */
import { readFileSync } from "node:fs";
import { CanvasApiError } from "../src/canvas-client.js";
import type { CanvasAssignment, CanvasCourse, CanvasGateway, CanvasUser } from "../src/canvas-types.js";
import { InvalidInputError } from "../src/errors.js";

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as T;

const USER = fixture<CanvasUser>("canvas-user.json");
/** Two pages, because the real client pages through /courses and merges them. */
const COURSES: CanvasCourse[] = [
  ...fixture<CanvasCourse[]>("canvas-courses-page-1.json"),
  ...fixture<CanvasCourse[]>("canvas-courses-page-2.json"),
];
const ASSIGNMENTS = fixture<CanvasAssignment[]>("canvas-assignments.json");

export type GatewayMethod = "getCurrentUser" | "listCourses" | "listAssignments";

/** Failure modes a scenario can inject, named for the condition rather than the status. */
export type Fault = "timeout" | "rate_limited" | "api_error";

export interface GatewayCall {
  method: GatewayMethod;
  courseId?: number;
}

export interface FixtureGatewayOptions {
  faults?: Partial<Record<GatewayMethod, Fault>>;
}

const FAULT_URL = "https://canvas.example.invalid/api/v1";

function raise(fault: Fault): never {
  switch (fault) {
    case "timeout":
      throw new CanvasApiError("Canvas API request timed out", 408, FAULT_URL, "CANVAS_TIMEOUT");
    case "rate_limited":
      throw new CanvasApiError("Canvas API request failed with status 429", 429, FAULT_URL, "RATE_LIMITED");
    case "api_error":
      throw new CanvasApiError("Canvas API request failed with status 500", 500, FAULT_URL);
  }
}

export class FixtureCanvasGateway implements CanvasGateway {
  readonly calls: GatewayCall[] = [];
  private readonly faults: Partial<Record<GatewayMethod, Fault>>;

  constructor(options: FixtureGatewayOptions = {}) {
    this.faults = options.faults ?? {};
  }

  /** Canvas reads performed so far, in order. */
  methodsCalled(): GatewayMethod[] {
    return this.calls.map((call) => call.method);
  }

  async getCurrentUser(): Promise<CanvasUser> {
    this.calls.push({ method: "getCurrentUser" });
    if (this.faults.getCurrentUser) raise(this.faults.getCurrentUser);
    return structuredClone(USER);
  }

  async listCourses(): Promise<CanvasCourse[]> {
    this.calls.push({ method: "listCourses" });
    if (this.faults.listCourses) raise(this.faults.listCourses);
    return structuredClone(COURSES);
  }

  async listAssignments(courseId: number): Promise<CanvasAssignment[]> {
    this.calls.push({ method: "listAssignments", courseId });
    // CanvasClient validates before it requests; mirror that order so an
    // injected fault cannot mask an argument the real client would reject.
    if (!Number.isInteger(courseId) || courseId <= 0) {
      throw new InvalidInputError("courseId must be a positive integer");
    }
    if (this.faults.listAssignments) raise(this.faults.listAssignments);
    // Canvas 404s an unknown course; the client turns that into CANVAS_API_ERROR.
    if (!COURSES.some((course) => course.id === courseId)) {
      throw new CanvasApiError("Canvas API request failed with status 404", 404, FAULT_URL);
    }
    return structuredClone(ASSIGNMENTS.filter((assignment) => assignment.course_id === courseId));
  }
}
