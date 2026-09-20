import { describe, expect, it, vi } from "vitest";
import { CanvasApiError, CanvasClient } from "../src/canvas-client.js";

describe("CanvasClient", () => {
  it("follows Canvas pagination links", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1, name: "A" }]), { status: 200, headers: { link: '<https://canvas.test/api/v1/courses?page=2>; rel="next"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 2, name: "B" }]), { status: 200 }));
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });
    await expect(client.listCourses()).resolves.toHaveLength(2);
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

  it("returns an empty result for an empty Canvas page", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("[]", { status: 200 }));
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });
    await expect(client.listCourses()).resolves.toEqual([]);
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

  it.each([401, 403, 404, 429, 500, 502])("maps HTTP %s to CANVAS_API_ERROR without exposing the body", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ token: "do-not-return" }), { status }),
    );
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });

    const error = await client.listCourses().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(CanvasApiError);
    expect(error).toMatchObject({ code: "CANVAS_API_ERROR", status });
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
