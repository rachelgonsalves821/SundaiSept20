import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";
import { policyFromEnvironment } from "./capabilities.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const server = createMcpServer({
  canvasBaseUrl: required("CANVAS_BASE_URL"),
  canvasApiToken: required("CANVAS_API_TOKEN"),
  capabilities: policyFromEnvironment(),
});

await server.connect(new StdioServerTransport());
