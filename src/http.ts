import "dotenv/config";
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { policyFromEnvironment } from "./capabilities.js";
import { requiredEnvironmentVariable } from "./index.js";
import { createMcpServer, type ServerConfig } from "./server.js";

const HEALTH_RESPONSE = { status: "ok", service: "canvas-mcp-connector" };

export interface HttpServerConfig {
  connectorAuthToken: string;
  mcp: ServerConfig;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function hasValidBearerToken(header: string | string[] | undefined, expectedToken: string): boolean {
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(.+)$/i.exec(value ?? "");
  if (!match || !expectedToken) return false;

  const received = Buffer.from(match[1]);
  const expected = Buffer.from(expectedToken);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

  const body = Buffer.concat(chunks).toString("utf8");
  if (!body) return undefined;

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Request body must contain valid JSON");
  }
}

/**
 * Starts a stateless Streamable HTTP MCP server. A stateless transport avoids
 * retaining user state or credentials between remote requests.
 */
export async function createHttpServer(config: HttpServerConfig): Promise<Server> {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, HEALTH_RESPONSE);
      return;
    }

    if (url.pathname !== "/mcp") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    if (!hasValidBearerToken(request.headers.authorization, config.connectorAuthToken)) {
      response.writeHead(401, { "www-authenticate": "Bearer", "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    if (!(["GET", "POST", "DELETE"] as const).includes(request.method as "GET" | "POST" | "DELETE")) {
      response.setHeader("allow", "GET, POST, DELETE");
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const body = request.method === "POST" ? await readJsonBody(request) : undefined;
      // The SDK requires a fresh transport for every stateless request. Pair it
      // with a fresh server too so there is no shared request or user state.
      const mcpServer = createMcpServer(config.mcp);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await mcpServer.connect(transport);
      response.once("close", () => {
        void transport.close();
        void mcpServer.close();
      });
      await transport.handleRequest(request, response, body);
    } catch (error) {
      if (!response.headersSent) {
        const message = error instanceof Error ? error.message : "Invalid request";
        sendJson(response, 400, { error: message });
      } else {
        response.end();
      }
    }
  });
}

function httpPort(value: string | undefined): number {
  const port = Number(value ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

export async function startHttpServer(): Promise<Server> {
  const port = httpPort(process.env.PORT);
  const server = await createHttpServer({
    connectorAuthToken: requiredEnvironmentVariable("CONNECTOR_AUTH_TOKEN"),
    mcp: {
      canvasBaseUrl: requiredEnvironmentVariable("CANVAS_BASE_URL"),
      canvasApiToken: requiredEnvironmentVariable("CANVAS_API_TOKEN"),
      capabilities: policyFromEnvironment(),
    },
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve();
    });
  });
  console.error(`Canvas MCP HTTP server listening on port ${port}`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startHttpServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unable to start Canvas MCP HTTP connector";
    console.error(message);
    process.exitCode = 1;
  });
}
