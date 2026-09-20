import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CanvasClient } from "./canvas-client.js";
import type { CanvasGateway } from "./canvas-types.js";
import { CapabilityPolicy } from "./capabilities.js";
import { getCurrentUser, listAssignments, listCourses } from "./tools.js";
import { listIntents, resolveIntent } from "./intents.js";
import { toConnectorError } from "./errors.js";

export interface ServerConfig {
  canvasBaseUrl: string;
  canvasApiToken: string;
  capabilities: CapabilityPolicy;
  client?: CanvasGateway;
}

const textResult = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const errorResult = (error: unknown) => {
  const connectorError = toConnectorError(error);
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(connectorError.toJSON()) }] };
};

async function runTool<T>(operation: () => Promise<T>) {
  try {
    return textResult(await operation());
  } catch (error) {
    return errorResult(error);
  }
}

export function createMcpServer(config: ServerConfig): McpServer {
  const server = new McpServer({ name: "canvas-mcp-connector", version: "0.1.0" });
  const deps = { client: config.client ?? new CanvasClient({ baseUrl: config.canvasBaseUrl, apiToken: config.canvasApiToken }), policy: config.capabilities, canvasBaseUrl: config.canvasBaseUrl };

  server.tool("health_check", "Report connector health without exposing credentials.", {}, async () => textResult({ status: "ok", service: "canvas-mcp-connector" }));

  // Intent tools answer "can this connector do what the user is asking for"
  // before any Canvas read happens. Both are pure lookups against the registry
  // and the capability policy; neither contacts Canvas.
  server.tool("list_intents", "List the user goals this connector recognizes, with whether each can be served in this deployment. Match a user request against the examples, then call resolve_intent.", {}, async () => runTool(async () => listIntents(deps.policy)));
  // Intentionally z.string() rather than z.enum(): an unknown intent should
  // come back as the connector's own INVALID_INPUT, naming the valid ids, not
  // as an SDK schema rejection the agent cannot act on.
  server.tool("resolve_intent", "Resolve one user goal to a tool plan, a capability gap, or a final refusal. Does not contact Canvas.", { intent: z.string() }, async ({ intent }) => runTool(async () => resolveIntent(intent, deps.policy)));
  server.tool("get_current_user", "Read the current Canvas user profile.", {}, async () => runTool(() => getCurrentUser(deps)));
  server.tool("list_courses", "List courses visible to the current Canvas token.", {}, async () => runTool(() => listCourses(deps)));
  server.tool("list_assignments", "List assignments for a Canvas course.", { course_id: z.coerce.number().int().positive() }, async ({ course_id }) => runTool(() => listAssignments({ course_id }, deps)));
  return server;
}
