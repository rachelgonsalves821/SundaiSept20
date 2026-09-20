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
