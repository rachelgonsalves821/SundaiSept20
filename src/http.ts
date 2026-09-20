import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { assertConnectorToken } from "./auth.js";
import { ConnectorConfig } from "./config.js";
import { toConnectorError } from "./errors.js";
import { createMcpServer } from "./server.js";

const MAX_BODY_BYTES = 1_000_000;

export function createHttpServer(config: ConnectorConfig): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (url.pathname === "/health" && request.method === "GET") {
        writeJson(response, 200, { status: "ok", service: "canvas-mcp-connector" });
        return;
      }

      if (url.pathname !== "/mcp") {
        writeJson(response, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
        return;
      }

      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
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

      const body = await readJsonBody(request);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = createMcpServer({
        canvasBaseUrl: config.canvasBaseUrl,
        canvasApiToken: config.canvasApiToken,
        capabilities: config.capabilities,
      });

      response.on("close", () => {
        void transport.close();
        void server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(request, response, body);
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
