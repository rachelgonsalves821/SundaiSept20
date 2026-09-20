import { createHash, timingSafeEqual } from "node:crypto";
import { UnauthorizedError } from "./errors.js";

/**
 * Inbound authentication for agent requests on the HTTP transport.
 *
 * The connector auth token is for inbound requests only. It is never placed
 * on outbound Canvas calls; the Canvas client has its own token.
 *
 * Every failure path throws the same bare `UnauthorizedError` ("Unauthorized")
 * so a caller cannot tell a missing header from a malformed one from a wrong
 * token. Nothing about the presented or expected token is ever included.
 */
export function assertConnectorToken(
  header: string | undefined,
  config: { expectedToken: string },
): void {
  const presented = extractBearerToken(header);
  if (presented === undefined) throw new UnauthorizedError();
  if (!config.expectedToken) throw new UnauthorizedError();
  if (!constantTimeEquals(presented, config.expectedToken)) throw new UnauthorizedError();
}

/** Accepts `Bearer <token>` (scheme case-insensitive per RFC 7235). Returns undefined for anything else. */
function extractBearerToken(header: string | undefined): string | undefined {
  if (typeof header !== "string") return undefined;
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1];
}

/**
 * Hash both sides to a fixed 32-byte digest before comparing. `timingSafeEqual`
 * throws on length mismatch, and that throw would leak the token's length.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}
