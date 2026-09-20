/**
 * Stable, client-visible error vocabulary for the connector.
 *
 * `message` on every ConnectorError is sent to the calling agent. Never put
 * tokens, auth headers, or raw Canvas response bodies in one. Anything that
 * needs to stay server-side goes in `cause`, which `toJSON()` omits.
 */
export type ConnectorErrorCode =
  | "PERMISSION_DENIED"
  | "INVALID_INPUT"
  | "CANVAS_API_ERROR"
  | "CANVAS_TIMEOUT"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR";

export class ConnectorError extends Error {
  constructor(
    public readonly code: ConnectorErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ConnectorError";
  }

  /** Wire shape. Deliberately excludes `cause` and `stack`. */
  toJSON(): { code: ConnectorErrorCode; message: string } {
    return { code: this.code, message: this.message };
  }
}

export class InvalidInputError extends ConnectorError {
  constructor(message = "Invalid tool input") {
    super("INVALID_INPUT", message);
    this.name = "InvalidInputError";
  }
}

/**
 * Every inbound auth failure (missing header, malformed header, wrong token)
 * must produce this exact error with this exact message so the failure modes
 * are indistinguishable to the caller. Do not add a parameter.
 */
export class UnauthorizedError extends ConnectorError {
  constructor() {
    super("UNAUTHORIZED", "Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export class RateLimitedError extends ConnectorError {
  constructor(message = "Canvas rate limit exceeded; retry later") {
    super("RATE_LIMITED", message);
    this.name = "RateLimitedError";
  }
}

export class InternalError extends ConnectorError {
  constructor(message = "Internal connector error", cause?: unknown) {
    super("INTERNAL_ERROR", message, cause);
    this.name = "InternalError";
  }
}

/**
 * Maps a Canvas HTTP status to a connector error code. 429 is its own code
 * because agents retry transient failures differently from hard API errors.
 * Intended for the Canvas client; kept here so the vocabulary lives in one file.
 */
export function canvasStatusToCode(status: number): ConnectorErrorCode {
  if (status === 408 || status === 504) return "CANVAS_TIMEOUT";
  if (status === 429) return "RATE_LIMITED";
  return "CANVAS_API_ERROR";
}

/**
 * Boundary conversion for anything thrown inside a tool handler. Unknown
 * errors become a bare INTERNAL_ERROR; their original message is preserved
 * only in `cause` (server-side), never in the client-visible message.
 */
export function toConnectorError(error: unknown): ConnectorError {
  if (error instanceof ConnectorError) return error;
  return new InternalError("Internal connector error", error);
}
