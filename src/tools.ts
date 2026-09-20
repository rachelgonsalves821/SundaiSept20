import { z } from "zod";
import type { CanvasGateway } from "./canvas-types.js";
import { CapabilityPolicy } from "./capabilities.js";
import { normalizeAssignment, normalizeCourse, normalizeUser } from "./normalizers.js";

export const listAssignmentsInput = z.object({ course_id: z.coerce.number().int().positive() });

export interface ToolDependencies {
  client: CanvasGateway;
  policy: CapabilityPolicy;
  canvasBaseUrl: string;
}

export async function getCurrentUser(deps: ToolDependencies) {
  deps.policy.assertAllowed("read_profile");
  return normalizeUser(await deps.client.getCurrentUser(), deps.canvasBaseUrl);
}

export async function listCourses(deps: ToolDependencies) {
  deps.policy.assertAllowed("read_courses");
  const courses = await deps.client.listCourses();
  return { courses: courses.map((course) => normalizeCourse(course, deps.canvasBaseUrl)), count: courses.length };
}

export async function listAssignments(input: unknown, deps: ToolDependencies) {
  deps.policy.assertAllowed("read_assignments");
  const { course_id: courseId } = listAssignmentsInput.parse(input);
  const assignments = await deps.client.listAssignments(courseId);
  return { assignments: assignments.map((assignment) => normalizeAssignment(assignment, deps.canvasBaseUrl)), count: assignments.length };
}
