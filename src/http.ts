import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { assertConnectorToken } from "./auth.js";
import { ConnectorConfig } from "./config.js";
import { toConnectorError } from "./errors.js";
import { createMcpServer } from "./server.js";

const MAX_BODY_BYTES = 1_000_000;

interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: ReturnType<typeof createMcpServer>;
  connected: boolean;
}

export function createHttpServer(config: ConnectorConfig): Server {
  const sessions = new Map<string, McpSession>();

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (url.pathname === "/health" && request.method === "GET") {
        writeJson(response, 200, {
          status: "ok",
          service: "canvas-mcp-connector",
          build: "4071649-course-normalization-2",
          auth_token_fingerprint: config.connectorAuthTokenFingerprint,
        });
        return;
      }

      if (url.pathname !== "/mcp") {
        writeJson(response, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
        return;
      }

      // Streamable HTTP supports POST for JSON-RPC messages, GET for the
      // server-to-client SSE stream, and DELETE for session termination.
      // Authentication is required for all MCP methods.
      if (!["POST", "GET", "DELETE"].includes(request.method ?? "")) {
        response.setHeader("Allow", "GET, POST, DELETE");
        writeJson(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
        return;
      }

      try {
        assertConnectorToken(readAuthorizationHeader(request), { expectedToken: config.connectorAuthToken });
      } catch (error) {
        const connectorError = toConnectorError(error);
        response.setHeader("WWW-Authenticate", "Bearer");
        writeJson(response, 401, connectorError.toJSON());
        return;
      }

      const body = request.method === "POST" ? await readJsonBody(request) : undefined;
      const sessionId = readSessionId(request);
      let session = sessionId === undefined ? undefined : sessions.get(sessionId);

      if (session === undefined) {
        if (request.method !== "POST" || !isInitializeRequest(body)) {
          writeJson(response, 400, { error: { code: "MCP_SESSION_REQUIRED", message: "A valid MCP session is required" } });
          return;
        }

        const server = createMcpServer({
          canvasBaseUrl: config.canvasBaseUrl,
          canvasApiToken: config.canvasApiToken,
          capabilities: config.capabilities,
        });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: (id) => {
            sessions.set(id, session!);
          },
          onsessionclosed: (id) => {
            const closed = sessions.get(id);
            sessions.delete(id);
            void closed?.server.close();
          },
        });
        session = { transport, server, connected: false };
      }

      if (!session.connected) {
        await session.server.connect(session.transport);
        session.connected = true;
      }
      await session.transport.handleRequest(request, response, body);
    } catch (error) {
      if (response.headersSent) return;
      const connectorError = toConnectorError(error);
      const status = connectorError.code === "INVALID_INPUT" ? 400 : 500;
      writeJson(response, status, connectorError.toJSON());
    }
  });
}

export function startHttpServer(config: ConnectorConfig, host = "0.0.0.0"): Promise<Server> {
  const server = createHttpServer(config);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, host, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

function readAuthorizationHeader(request: IncomingMessage): string | undefined {
  const value = request.headers.authorization;
  return Array.isArray(value) ? undefined : value;
}

function readSessionId(request: IncomingMessage): string | undefined {
  const value = request.headers["mcp-session-id"];
  return Array.isArray(value) ? undefined : value;
}

function isInitializeRequest(body: unknown): body is { method: "initialize" } {
  return typeof body === "object" && body !== null && "method" in body && body.method === "initialize";
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  if (!body) throw new Error("Request body is required");
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  if (response.headersSent) return;
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}
