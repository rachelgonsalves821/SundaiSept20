import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CanvasClient } from "./canvas-client.js";
import { CapabilityPolicy } from "./capabilities.js";
import { getCurrentUser, listAssignments, listCourses } from "./tools.js";

export interface ServerConfig {
  canvasBaseUrl: string;
  canvasApiToken: string;
  capabilities: CapabilityPolicy;
}

const textResult = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

export function createMcpServer(config: ServerConfig): McpServer {
  const server = new McpServer({ name: "canvas-mcp-connector", version: "0.1.0" });
  const deps = { client: new CanvasClient({ baseUrl: config.canvasBaseUrl, apiToken: config.canvasApiToken }), policy: config.capabilities, canvasBaseUrl: config.canvasBaseUrl };

  server.tool("health_check", "Report connector health without exposing credentials.", {}, async () => textResult({ status: "ok", service: "canvas-mcp-connector" }));
  server.tool("get_current_user", "Read the current Canvas user profile.", {}, async () => textResult(await getCurrentUser(deps)));
  server.tool("list_courses", "List courses visible to the current Canvas token.", {}, async () => textResult(await listCourses(deps)));
  server.tool("list_assignments", "List assignments for a Canvas course.", { course_id: z.coerce.number().int().positive() }, async ({ course_id }) => textResult(await listAssignments({ course_id }, deps)));
  return server;
}
