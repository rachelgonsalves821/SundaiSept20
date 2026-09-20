import "dotenv/config";
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";
import { policyFromEnvironment } from "./capabilities.js";

export function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export async function startStdioServer(): Promise<void> {
  const server = createMcpServer({
    canvasBaseUrl: requiredEnvironmentVariable("CANVAS_BASE_URL"),
    canvasApiToken: requiredEnvironmentVariable("CANVAS_API_TOKEN"),
    capabilities: policyFromEnvironment(),
  });

  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startStdioServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unable to start Canvas MCP connector";
    // stdout is the MCP protocol stream; startup failures must stay on stderr.
    console.error(message);
    process.exitCode = 1;
  });
}
