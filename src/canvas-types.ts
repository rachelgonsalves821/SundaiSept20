export interface CanvasUser {
  id: number;
  name: string;
  short_name?: string;
  email?: string;
  login_id?: string;
  avatar_url?: string;
}

export interface CanvasCourse {
  id: number;
  name: string;
  course_code?: string;
  workflow_state?: string;
  start_at?: string | null;
  end_at?: string | null;
  html_url?: string;
}

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

/**
 * Transport-independent Canvas data access contract used by MCP tools.
 * Implementations may call the Canvas REST API, fixtures, or a test double.
 */
export interface CanvasGateway {
  getCurrentUser(): Promise<CanvasUser>;
  listCourses(): Promise<CanvasCourse[]>;
  listAssignments(courseId: number): Promise<CanvasAssignment[]>;
}
