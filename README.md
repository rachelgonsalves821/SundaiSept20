# SundaiSept20 — Canvas MCP Connector

Reusable TypeScript MCP server for authorized, capability-scoped access to Canvas data. The local development transport uses MCP stdio; the server is structured so a remote HTTP transport can be added without moving Canvas-specific code into tool definitions.

## Development

1. Copy `.env.example` to `.env` and set the Canvas URL/token and connector settings.
2. Run `npm install`.
3. Run `npm run typecheck` and `npm test`.
4. Run `npm run dev` for the stdio server.

The initial read-only capabilities are `read_profile`, `read_courses`, and `read_assignments`. Capabilities not listed in `CANVAS_CAPABILITIES` return permission errors. Credentials are never included in tool output or logs.

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
