import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CanvasApiError, CanvasClient } from "../src/canvas-client.js";

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as T;

describe("CanvasClient", () => {
  it.each([
    ["empty base URL", { baseUrl: "", apiToken: "secret" }],
    ["invalid base URL", { baseUrl: "not a URL", apiToken: "secret" }],
    ["empty API token", { baseUrl: "https://canvas.test", apiToken: "   " }],
    ["zero timeout", { baseUrl: "https://canvas.test", apiToken: "secret", timeoutMs: 0 }],
    ["negative timeout", { baseUrl: "https://canvas.test", apiToken: "secret", timeoutMs: -1 }],
    ["NaN timeout", { baseUrl: "https://canvas.test", apiToken: "secret", timeoutMs: Number.NaN }],
    ["infinite timeout", { baseUrl: "https://canvas.test", apiToken: "secret", timeoutMs: Number.POSITIVE_INFINITY }],
  ])("rejects invalid configuration: %s", (_label, config) => {
    expect(() => new CanvasClient(config)).toThrow(TypeError);
  });

  it.each([Number.NaN, 0, -1, 1.5])("rejects invalid course IDs: %s", async (courseId) => {
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret" });

    await expect(client.listAssignments(courseId)).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "courseId must be a positive integer",
    });
  });

  it("follows Canvas pagination links", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture("canvas-courses-page-1.json")), { status: 200, headers: { link: '<https://canvas.test/api/v1/courses?page=2>; rel="next"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture("canvas-courses-page-2.json")), { status: 200 }));
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });
    await expect(client.listCourses()).resolves.toMatchObject([
      { id: 2001, name: "Introduction to Biology" },
      { id: 2002, name: "Foundations of Computer Science" },
    ]);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://canvas.test/api/v1/courses?per_page=100",
      "https://canvas.test/api/v1/courses?page=2",
    ]);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: "Bearer secret" } });
  });

  it("follows only rel=next and preserves page ordering", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1, name: "A" }]), {
        status: 200,
        headers: { link: '<https://canvas.test/api/v1/courses?page=0>; rel="prev", <https://canvas.test/api/v1/courses?page=2>; rel="next", <https://canvas.test/api/v1/courses?page=9>; rel="last"' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 2, name: "B" }]), { status: 200 }));
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });

    await expect(client.listCourses()).resolves.toEqual([
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("parses commas in URLs and multiple link relations", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture("canvas-courses-page-1.json")), {
        status: 200,
        headers: { link: '<https://canvas.test/api/v1/courses?page=2&sort=a,b>; rel="prev next", <https://canvas.test/api/v1/courses?page=9>; rel=last' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture("canvas-courses-page-2.json")), { status: 200 }));
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });

    await expect(client.listCourses()).resolves.toHaveLength(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://canvas.test/api/v1/courses?page=2&sort=a,b");
  });

  it("retries 429 responses using Retry-After and then succeeds", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "rate limited" }), { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture("canvas-courses-page-1.json")), { status: 200 }));
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });

    await expect(client.listCourses()).resolves.toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops after the configured maximum page count", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(fixture("canvas-courses-page-1.json")), {
        status: 200,
        headers: { link: '<https://canvas.test/api/v1/courses?page=2>; rel="next"' },
      }),
    );
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", maxPages: 1, fetchImpl });

    await expect(client.listCourses()).rejects.toMatchObject({
      code: "CANVAS_API_ERROR",
      message: "Canvas API pagination page limit exceeded",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("loads and validates the Canvas user fixture", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(fixture("canvas-user.json")), { status: 200 }),
    );
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });

    await expect(client.getCurrentUser()).resolves.toMatchObject({ id: 1001, name: "Example Canvas User" });
  });

  it("loads and validates the Canvas assignments fixture", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(fixture("canvas-assignments.json")), { status: 200 }),
    );
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });

    await expect(client.listAssignments(2001)).resolves.toMatchObject([
      { id: 3001, course_id: 2001, name: "Week 1 Reflection" },
    ]);
  });

  it("rejects pagination links outside the configured Canvas origin", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(fixture("canvas-courses-page-1.json")), {
        status: 200,
        headers: { link: '<https://attacker.example.invalid/courses?page=2>; rel="next"' },
      }),
    );
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });

    await expect(client.listCourses()).rejects.toMatchObject({
      code: "CANVAS_API_ERROR",
      message: "Canvas pagination URL is outside the configured Canvas origin",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns an empty result for an empty Canvas page", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("[]", { status: 200 }));
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });
    await expect(client.listCourses()).resolves.toEqual([]);
  });

  it("accepts null optional course fields and normalizes them to undefined", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([{
        id: 2003,
        name: "Course with incomplete metadata",
        course_code: null,
        workflow_state: null,
        start_at: null,
        end_at: null,
        html_url: null,
      }]), { status: 200 }),
    );
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });

    await expect(client.listCourses()).resolves.toEqual([{
      id: 2003,
      name: "Course with incomplete metadata",
      course_code: undefined,
      workflow_state: undefined,
      start_at: null,
      end_at: null,
      html_url: undefined,
    }]);
  });

  it("provides a stable name when Canvas returns a blank course name", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([{ id: 2004, name: null }]), { status: 200 }),
    );
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });

    await expect(client.listCourses()).resolves.toEqual([{ id: 2004, name: "Unnamed Canvas course" }]);
  });

  it("rejects course records that do not match CanvasCourseSchema", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([{ id: "not-a-number", name: "Invalid course" }]), { status: 200 }),
    );
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });

    await expect(client.listCourses()).rejects.toMatchObject({
      code: "CANVAS_API_ERROR",
      message: "Canvas API returned an invalid list response",
    });
  });

  it("stops repeated next URLs instead of looping forever", async () => {
    const repeatedUrl = "https://canvas.test/api/v1/courses?page=2";
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1, name: "A" }]), {
        status: 200,
        headers: { link: `<${repeatedUrl}>; rel="next"` },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 2, name: "B" }]), {
        status: 200,
        headers: { link: `<${repeatedUrl}>; rel="next"` },
      }));
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });

    await expect(client.listCourses()).rejects.toMatchObject({
      code: "CANVAS_API_ERROR",
      message: "Canvas API pagination loop detected",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, "CANVAS_API_ERROR"],
    [403, "CANVAS_API_ERROR"],
    [404, "CANVAS_API_ERROR"],
    [429, "RATE_LIMITED"],
    [500, "CANVAS_API_ERROR"],
    [502, "CANVAS_API_ERROR"],
  ])("maps HTTP %s to a stable code without exposing the body", async (status, expectedCode) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ token: "do-not-return" }), { status }),
    );
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", maxRateLimitRetries: 0, fetchImpl });

    const error = await client.listCourses().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(CanvasApiError);
    expect(error).toMatchObject({ code: expectedCode, status });
    expect((error as Error).message).not.toContain("do-not-return");
  });

  it("maps malformed JSON to CANVAS_API_ERROR", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("not-json", { status: 200 }));
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });

    await expect(client.listCourses()).rejects.toMatchObject({ code: "CANVAS_API_ERROR" });
  });

  it("maps network failures to CANVAS_API_ERROR", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("socket details"));
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });

    await expect(client.listCourses()).rejects.toMatchObject({ code: "CANVAS_API_ERROR" });
  });

  it("maps AbortError to CANVAS_TIMEOUT", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", timeoutMs: 10, fetchImpl });

    await expect(client.listCourses()).rejects.toMatchObject({ code: "CANVAS_TIMEOUT" });
  });

  it("uses a ten-second default timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
    );
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });
    const pending = expect(client.listCourses()).rejects.toMatchObject({ code: "CANVAS_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    vi.useRealTimers();
  });
});
