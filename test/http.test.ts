import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createHttpServer } from "../src/http.js";

const config = loadConfig({
  CANVAS_BASE_URL: "https://canvas.example.edu",
  CANVAS_API_TOKEN: "canvas-test-token",
  CONNECTOR_AUTH_TOKEN: "connector-test-token",
  CANVAS_CAPABILITIES: "read_profile,read_courses,read_assignments",
});

const servers: ReturnType<typeof createHttpServer>[] = [];

async function startTestServer() {
  const server = createHttpServer(config);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
});

describe("Streamable HTTP transport", () => {
  it("serves a public health endpoint without exposing credentials", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "canvas-mcp-connector" });
  });

  it("rejects missing and incorrect connector tokens", async () => {
    const baseUrl = await startTestServer();
    const missing = await fetch(`${baseUrl}/mcp`, { method: "POST", body: "{}" });
    const wrong = await fetch(`${baseUrl}/mcp`, { method: "POST", headers: { Authorization: "Bearer wrong" }, body: "{}" });

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await missing.json()).toEqual({ code: "UNAUTHORIZED", message: "Unauthorized" });
    expect(await wrong.json()).toEqual({ code: "UNAUTHORIZED", message: "Unauthorized" });
  });

  it("accepts a valid connector token for MCP initialization", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Authorization: "Bearer connector-test-token",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "http-test", version: "1.0.0" },
        },
      }),
    });

    expect(response.status).toBe(200);
    const sessionId = response.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    const body = await response.text();
    expect(body).toContain('"serverInfo"');
    expect(body).toContain('"canvas-mcp-connector"');

    const tools = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Authorization: "Bearer connector-test-token",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": sessionId!,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    expect(tools.status).toBe(200);
    expect(await tools.text()).toContain('"list_courses"');
  });

  it("supports Streamable HTTP GET negotiation", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/mcp`, {
      headers: { Authorization: "Bearer connector-test-token" },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "MCP_SESSION_REQUIRED", message: "A valid MCP session is required" } });
  });

  it("rejects unsupported MCP HTTP methods", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/mcp`, { method: "PUT" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST, DELETE");
  });
});
