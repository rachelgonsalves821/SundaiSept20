# Canvas MCP Connector

Reusable TypeScript MCP server for authorized, capability-scoped access to Canvas data. The local development transport uses MCP stdio; the server is structured so a remote HTTP transport can be added without moving Canvas-specific code into tool definitions.

## Development

1. Copy `.env.example` to `.env` and set the Canvas URL/token and connector settings.
2. Run `npm install`.
3. Run `npm run typecheck` and `npm test`.
4. Run `npm run dev` for the stdio server.

The initial read-only capabilities are `read_profile`, `read_courses`, and `read_assignments`. Capabilities not listed in `CANVAS_CAPABILITIES` return permission errors. Credentials are never included in tool output or logs.
