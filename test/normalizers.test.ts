import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeAssignment, normalizeCourse, normalizeUser } from "../src/normalizers.js";
import type { CanvasAssignment, CanvasCourse, CanvasUser } from "../src/canvas-types.js";

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as T;

describe("Canvas normalizers", () => {
  it("adds source metadata to user records", () => {
    const result = normalizeUser(fixture<CanvasUser>("canvas-user.json"), "https://canvas.test");
    expect(result).toMatchObject({
      source_url: "https://canvas.test/api/v1/users/self",
      source_system: "canvas",
      external_id: "1001",
    });
    expect(result.fetched_at).toEqual(expect.any(String));
  });

  it("adds source metadata to course records", () => {
    const course = fixture<CanvasCourse[]>("canvas-courses-page-1.json")[0];
    const result = normalizeCourse(course, "https://canvas.test");
    expect(result).toMatchObject({
      source_url: "https://canvas.example.invalid/courses/2001",
      source_system: "canvas",
      external_id: "2001",
    });
  });

  it("adds source metadata to assignment records", () => {
    const assignment = fixture<CanvasAssignment[]>("canvas-assignments.json")[0];
    const result = normalizeAssignment(assignment, "https://canvas.test");
    expect(result).toMatchObject({
      source_url: "https://canvas.example.invalid/courses/2001/assignments/3001",
      source_system: "canvas",
      external_id: "3001",
    });
  });
});
