import type { CanvasAssignment, CanvasCourse, CanvasUser } from "./canvas-types.js";

export interface SourceMetadata {
  source_url: string;
  source_system: "canvas";
  external_id: string;
  fetched_at: string;
}

const metadata = (sourceUrl: string, externalId: number | string): SourceMetadata => ({
  source_url: sourceUrl,
  source_system: "canvas",
  external_id: String(externalId),
  fetched_at: new Date().toISOString(),
});

export function normalizeUser(user: CanvasUser, baseUrl: string) {
  return { id: user.id, name: user.name, short_name: user.short_name, email: user.email, ...metadata(`${baseUrl}/api/v1/users/self`, user.id) };
}

export function normalizeCourse(course: CanvasCourse, baseUrl: string) {
  return { id: course.id, name: course.name, course_code: course.course_code, workflow_state: course.workflow_state, start_at: course.start_at, end_at: course.end_at, ...metadata(course.html_url ?? `${baseUrl}/api/v1/courses/${course.id}`, course.id) };
}

export function normalizeAssignment(assignment: CanvasAssignment, baseUrl: string) {
  return { id: assignment.id, name: assignment.name, description: assignment.description, due_at: assignment.due_at, points_possible: assignment.points_possible, submission_types: assignment.submission_types, ...metadata(assignment.html_url ?? `${baseUrl}/api/v1/courses/${assignment.course_id}/assignments/${assignment.id}`, assignment.id) };
}
