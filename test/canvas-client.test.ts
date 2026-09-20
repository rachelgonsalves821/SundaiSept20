import { describe, expect, it, vi } from "vitest";
import { CanvasClient } from "../src/canvas-client.js";

describe("CanvasClient", () => {
  it("follows Canvas pagination links", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1, name: "A" }]), { status: 200, headers: { link: '<https://canvas.test/api/v1/courses?page=2>; rel="next"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 2, name: "B" }]), { status: 200 }));
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });
    await expect(client.listCourses()).resolves.toHaveLength(2);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: "Bearer secret" } });
  });

  it("returns an empty result for an empty Canvas page", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("[]", { status: 200 }));
    const client = new CanvasClient({ baseUrl: "https://canvas.test", apiToken: "secret", fetchImpl });
    await expect(client.listCourses()).resolves.toEqual([]);
  });
});
