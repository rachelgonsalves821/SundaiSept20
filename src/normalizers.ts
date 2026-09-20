import type { CanvasAssignment, CanvasCourse, CanvasUser } from "./canvas-types.js";

export interface SourceMetadata {
  source_url: string;
  source_system: "canvas";
  external_id: string;
  fetched_at: string;
}

export interface NormalizedCanvasUser extends CanvasUser, SourceMetadata {}
export interface NormalizedCanvasCourse extends CanvasCourse, SourceMetadata {}
export interface NormalizedCanvasAssignment extends CanvasAssignment, SourceMetadata {}

const metadata = (sourceUrl: string, externalId: number | string): SourceMetadata => ({
  source_url: sourceUrl,
  source_system: "canvas",
  external_id: String(externalId),
  fetched_at: new Date().toISOString(),
});

export function normalizeUser(user: CanvasUser, baseUrl: string): NormalizedCanvasUser {
  return { ...user, ...metadata(`${baseUrl.replace(/\/+$/, "")}/api/v1/users/self`, user.id) };
}

export function normalizeCourse(course: CanvasCourse, baseUrl: string): NormalizedCanvasCourse {
  return { ...course, ...metadata(course.html_url ?? `${baseUrl.replace(/\/+$/, "")}/api/v1/courses/${course.id}`, course.id) };
}

export function normalizeAssignment(assignment: CanvasAssignment, baseUrl: string): NormalizedCanvasAssignment {
  return { ...assignment, ...metadata(assignment.html_url ?? `${baseUrl.replace(/\/+$/, "")}/api/v1/courses/${assignment.course_id}/assignments/${assignment.id}`, assignment.id) };
}
