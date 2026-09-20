import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./server.js";

const config = loadConfig();

const server = createMcpServer({
  canvasBaseUrl: config.canvasBaseUrl,
  canvasApiToken: config.canvasApiToken,
  capabilities: config.capabilities,
});

await server.connect(new StdioServerTransport());
