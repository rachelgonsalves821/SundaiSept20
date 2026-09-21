import { z } from "zod";

const optionalCanvasString = z.preprocess(
  (value) => value === null ? undefined : value,
  z.string().optional(),
) as z.ZodType<string | undefined>;
const optionalCanvasUrl = z.preprocess(
  (value) => value === null ? undefined : value,
  z.string().url().optional(),
) as z.ZodType<string | undefined>;
const canvasCourseName = z.preprocess(
  (value) => value === null || value === undefined || value === "" ? "Unnamed Canvas course" : value,
  z.string(),
) as z.ZodType<string>;

export interface CanvasUser {
  id: number;
  name: string;
  short_name?: string;
  email?: string;
  login_id?: string;
  avatar_url?: string;
}

export const CanvasUserSchema = z.object({
  id: z.number(),
  name: z.string(),
  short_name: z.string().optional(),
  email: z.string().optional(),
  login_id: z.string().optional(),
  avatar_url: z.string().url().optional(),
});

export interface CanvasCourse {
  id: number;
  name: string;
  course_code?: string;
  workflow_state?: string;
  start_at?: string | null;
  end_at?: string | null;
  html_url?: string;
}

export const CanvasCourseSchema = z.object({
  id: z.number(),
  name: canvasCourseName,
  // Canvas may return null for optional fields even when the field is present.
  // Normalize those nulls to undefined so the connector contract stays stable.
  course_code: optionalCanvasString,
  workflow_state: optionalCanvasString,
  start_at: z.string().nullable().optional(),
  end_at: z.string().nullable().optional(),
  html_url: optionalCanvasUrl,
});

export interface CanvasAssignment {
  id: number;
  name: string;
  description?: string | null;
  due_at?: string | null;
  points_possible?: number | null;
  course_id?: number;
  html_url?: string;
  submission_types?: string[];
}

export const CanvasAssignmentSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable().optional(),
  due_at: z.string().nullable().optional(),
  points_possible: z.number().nullable().optional(),
  course_id: z.number().optional(),
  html_url: z.string().url().optional(),
  submission_types: z.array(z.string()).optional(),
});

/**
 * Transport-independent Canvas data access contract used by MCP tools.
 * Implementations may call the Canvas REST API, fixtures, or a test double.
 */
export interface CanvasGateway {
  getCurrentUser(): Promise<CanvasUser>;
  listCourses(): Promise<CanvasCourse[]>;
  listAssignments(courseId: number): Promise<CanvasAssignment[]>;
}
