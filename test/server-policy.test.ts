/**
 * Server-level policy tests: drive the real McpServer from a real MCP client
 * over an in-memory transport. `fetch` is stubbed to throw, so if any tool
 * reaches the Canvas client while its capability is blocked, the test fails
 * with a loud, distinctive error rather than a silent network call.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityPolicy } from "../src/capabilities.js";
import { createMcpServer } from "../src/server.js";

const CANVAS_TOKEN = "canvas-api-token-SERVER-TEST-SECRET";
const CONNECTOR_TOKEN = "connector-auth-token-SERVER-TEST-SECRET";
const CANVAS_URL = "https://canvas.example.edu";

type ToolResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };

async function connect(capabilities: string) {
  const server = createMcpServer({
    canvasBaseUrl: CANVAS_URL,
    canvasApiToken: CANVAS_TOKEN,
    capabilities: new CapabilityPolicy(capabilities),
  });
  const client = new Client({ name: "policy-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    call: async (name: string, args: Record<string, unknown> = {}) =>
      (await client.callTool({ name, arguments: args })) as ToolResult,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

const payload = (result: ToolResult) => JSON.parse(result.content[0]?.text ?? "null");

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(async () => {
    throw new Error("CANVAS_FETCH_MUST_NOT_BE_CALLED");
  });
  vi.stubGlobal("fetch", fetchSpy);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MCP server: blocked capabilities never reach Canvas", () => {
  const cases: Array<[tool: string, args: Record<string, unknown>, enabledOthers: string]> = [
    ["get_current_user", {}, "read_courses,read_assignments"],
    ["list_courses", {}, "read_profile,read_assignments"],
    ["list_assignments", { course_id: 7 }, "read_profile,read_courses"],
  ];

  it.each(cases)("%s returns PERMISSION_DENIED as an MCP error result and does not call fetch", async (tool, args, others) => {
    const session = await connect(others);
    try {
      const result = await session.call(tool, args);
      expect(result.isError).toBe(true);
      expect(payload(result)).toEqual({
        code: "PERMISSION_DENIED",
        message: expect.stringMatching(/^Permission denied: capability 'read_\w+' is not enabled$/),
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await session.close();
    }
  });

  it("with an empty policy every Canvas-backed tool is denied and fetch is never called", async () => {
    const session = await connect("");
    try {
      for (const [tool, args] of cases) {
        const result = await session.call(tool, args);
        expect(result.isError, tool).toBe(true);
        expect(payload(result).code, tool).toBe("PERMISSION_DENIED");
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await session.close();
    }
  });

  it("health_check works with an empty policy and never touches Canvas", async () => {
    const session = await connect("");
    try {
      const result = await session.call("health_check");
      expect(result.isError).toBeFalsy();
      expect(payload(result)).toEqual({ status: "ok", service: "canvas-mcp-connector" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await session.close();
    }
  });
});

describe("MCP server: allowed capabilities do reach Canvas (control)", () => {
  it("list_courses calls fetch exactly once when read_courses is enabled", async () => {
    const session = await connect("read_courses");
    try {
      const result = await session.call("list_courses");
      // fetch throws, so this surfaces as a Canvas error — the point is that it was attempted.
      expect(result.isError).toBe(true);
      expect(payload(result).code).toMatch(/^CANVAS_/);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      await session.close();
    }
  });
});

describe("MCP server: responses are secret-safe", () => {
  it("no tool result, success or error, contains either token", async () => {
    const session = await connect("read_profile,read_courses,read_assignments");
    try {
      const results = await Promise.all([
        session.call("health_check"),
        session.call("get_current_user"),
        session.call("list_courses"),
        session.call("list_assignments", { course_id: 7 }),
      ]);
      for (const result of results) {
        const text = JSON.stringify(result);
        expect(text).not.toContain(CANVAS_TOKEN);
        expect(text).not.toContain(CONNECTOR_TOKEN);
        expect(text).not.toContain("Bearer");
      }
    } finally {
      await session.close();
    }
  });

  it("Canvas failures surface as a stable code with no raw upstream detail", async () => {
    fetchSpy.mockImplementation(async () => {
      throw new Error(`upstream said: token ${CANVAS_TOKEN} rejected`);
    });
    const session = await connect("read_courses");
    try {
      const result = await session.call("list_courses");
      expect(result.isError).toBe(true);
      const body = payload(result);
      expect(body.code).toMatch(/^CANVAS_/);
      expect(JSON.stringify(result)).not.toContain(CANVAS_TOKEN);
      expect(JSON.stringify(result)).not.toContain("upstream said");
    } finally {
      await session.close();
    }
  });

  it("tools/list never mentions credentials", async () => {
    const session = await connect("read_profile,read_courses,read_assignments");
    try {
      const { tools } = await session.client.listTools();
      const text = JSON.stringify(tools);
      expect(text).not.toContain(CANVAS_TOKEN);
      expect(text).not.toContain(CONNECTOR_TOKEN);
      expect(tools.map((t) => t.name).sort()).toEqual([
        "get_current_user",
        "health_check",
        "list_assignments",
        "list_courses",
        "list_intents",
        "resolve_intent",
      ]);
    } finally {
      await session.close();
    }
  });
});
