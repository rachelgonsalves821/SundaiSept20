# SundaiSept20 — Canvas MCP Connector

Reusable TypeScript MCP server for authorized, capability-scoped access to Canvas data. The local development transport uses MCP stdio; the server is structured so a remote HTTP transport can be added without moving Canvas-specific code into tool definitions.

## Development

1. Copy `.env.example` to `.env` and set the Canvas URL/token and connector settings.
2. Run `npm install`.
3. Run `npm run typecheck` and `npm test`.
4. Run `npm run dev` for the stdio server.
5. Run `npm run dev:http` for the authenticated Streamable HTTP server.

The initial read-only capabilities are `read_profile`, `read_courses`, and `read_assignments`. Capabilities not listed in `CANVAS_CAPABILITIES` return permission errors. Credentials are never included in tool output or logs.

## HTTP transport

The hosted transport exposes:

- `GET /health` — public liveness check; returns no credentials.
- `POST /mcp` — MCP Streamable HTTP endpoint. The server also supports the protocol's `GET` and `DELETE` session methods.

Every `/mcp` request must include:

```http
Authorization: Bearer <CONNECTOR_AUTH_TOKEN>
Content-Type: application/json
Accept: application/json, text/event-stream
```

Missing or invalid connector tokens return `401 Unauthorized`. The HTTP transport uses MCP session IDs for compatibility with clients that require stateful Streamable HTTP. Clients must return the `Mcp-Session-Id` response header on subsequent requests. Start it locally with `npm run dev:http` or in production with `npm run start:http`.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `CANVAS_BASE_URL` | yes | Canvas instance, `http(s)://` only. Trailing slashes are stripped; query, fragment, and embedded credentials are rejected. |
| `CANVAS_API_TOKEN` | yes | Canvas personal access token. Used on outbound Canvas calls only. |
| `CONNECTOR_AUTH_TOKEN` | yes | Bearer token agents must present on the HTTP transport. Inbound only; never sent to Canvas. |
| `CANVAS_CAPABILITIES` | yes | Comma-separated allow-list from `read_profile`, `read_courses`, `read_assignments`. Unknown names are dropped (warning on stderr), never granted. If nothing recognized remains, the connector refuses to start. |
| `PORT` | no | HTTP transport port, 1–65535. Defaults to `3000`. |

Startup validation failures are written to stderr and name the variable, never its value. Stdout is reserved for the MCP protocol stream on the stdio transport; nothing else may write to it.

## Security model

**Single-tenant: one deployment serves one Canvas identity.** There is one `CANVAS_API_TOKEN` per deployment, so every agent that presents a valid `CONNECTOR_AUTH_TOKEN` acts as that same Canvas user and sees exactly what that user sees. The connector token authenticates *the agent to the connector*; it does not select or scope a Canvas identity. If you need different agents to see different Canvas data, run separate deployments with separate Canvas tokens. There is no OAuth, no per-user mapping, and no plan to add either in this version.

Three credentials/controls, three jobs:

- **Canvas token** (`CANVAS_API_TOKEN`) authenticates the connector to Canvas. It stays server-side and is never returned to an agent.
- **Connector token** (`CONNECTOR_AUTH_TOKEN`) authenticates agents to the hosted connector. It is never sent to Canvas.
- **Capabilities** (`CANVAS_CAPABILITIES`) decide which tools are usable at all.

Other guarantees:

- **No OAuth, no write capability anywhere.** There is no capability that permits a write, so none can be enabled by configuration.
- **Read-only.** The four tools (`get_current_user`, `list_courses`, `list_assignments`, `health_check`) only perform GETs against Canvas.
- **Capability checks happen before Canvas is called.** A blocked capability returns `PERMISSION_DENIED` without any outbound request.
- **Auth failures are uniform.** Missing header, malformed header, and wrong token all return the identical `UNAUTHORIZED` / `"Unauthorized"` response. Token comparison is constant-time over SHA-256 digests, so neither a mismatch position nor the token length is observable.
- **Secrets never appear in error messages.** Every client-visible error carries a stable `code` and a `message` that contains no tokens, headers, or raw Canvas response bodies. Unknown internal failures surface as a bare `INTERNAL_ERROR`.
- **Config is redacted everywhere it can be printed.** `JSON.stringify(config)`, `console.log(config)`, `util.inspect(config)`, and `` `${config}` `` all show `[REDACTED]` for both tokens.

### Error codes

| Code | When |
|---|---|
| `PERMISSION_DENIED` | The capability behind the tool is not in `CANVAS_CAPABILITIES`. |
| `INVALID_INPUT` | Tool arguments failed validation. |
| `UNAUTHORIZED` | Inbound bearer token missing, malformed, or wrong. Always the bare message `Unauthorized`. |
| `CANVAS_API_ERROR` | Canvas returned a non-success status other than the ones below. |
| `CANVAS_TIMEOUT` | Canvas did not respond in time (or returned 408/504). |
| `RATE_LIMITED` | Canvas returned 429. Transient; retry with backoff. |
| `INTERNAL_ERROR` | Anything else. Details stay server-side. |

## Testing

`npm test` runs the vitest suite. Tests never reach the network: the Canvas client takes an injected `fetchImpl`, and tool-level tests inject a `CanvasGateway` double instead of a real client.

Sanitized Canvas payloads live in `fixtures/` and are loaded by URL relative to the test file:

```ts
const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as T;
```

Fixtures contain no real identifiers — hosts use `.invalid`, and IDs are synthetic.

## Docker

One image serves both transports. Build it with:

```bash
docker build -t canvas-mcp-connector .
```

The default command is the authenticated HTTP transport:

```bash
docker run --rm -p 3000:3000 --env-file .env canvas-mcp-connector
```

The same image runs the stdio transport when given an explicit command. An MCP client drives it over stdin/stdout, so `-i` is required:

```bash
docker run -i --rm --env-file .env canvas-mcp-connector node dist/src/index.js
```

The image is a two-stage build: stage one installs all dependencies and compiles, stage two installs production dependencies only and copies in `dist/src`. Tests are not copied into the image, and it runs as the unprivileged `node` user. Credentials are passed at runtime and never baked into a layer.

Note that `tsconfig.json` sets `rootDir: "."`, so compiled output lands in `dist/src/`, not `dist/`. The `start` / `start:http` scripts and the image `CMD` all reflect that, and the build fails if either entrypoint goes missing.

## CI

`.github/workflows/ci.yml` runs on pushes to `main`, on pull requests, and on manual dispatch. Three jobs:

- **verify** — `npm ci`, `typecheck`, `test`, `build` across Node 20 and 22 (the `engines` floor and current LTS), then asserts both build entrypoints exist and match the start scripts.
- **no committed credentials** — fails if a `.env` file is ever tracked, or if `.env.example` picks up something that looks like a real token rather than a `replace-with-` placeholder.
- **docker build** — builds the image and smoke-tests both transports. For HTTP: `GET /health` returns ok, `POST /mcp` without a token returns 401, and `POST /mcp` with the connector token completes an MCP `initialize`. For stdio: a real `initialize` / `tools/list` handshake over stdin. Neither needs a live Canvas instance.
