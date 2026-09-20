export type ConnectorErrorCode =
  | "PERMISSION_DENIED"
  | "INVALID_INPUT"
  | "CANVAS_API_ERROR"
  | "CANVAS_TIMEOUT"
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

  toJSON() {
    return { code: this.code, message: this.message };
  }
}

export class InvalidInputError extends ConnectorError {
  constructor(message = "Invalid tool input") {
    super("INVALID_INPUT", message);
    this.name = "InvalidInputError";
  }
}

export class UnauthorizedError extends ConnectorError {
  constructor(message = "Unauthorized") {
    super("UNAUTHORIZED", message);
    this.name = "UnauthorizedError";
  }
}

export class InternalError extends ConnectorError {
  constructor(message = "Internal connector error", cause?: unknown) {
    super("INTERNAL_ERROR", message, cause);
    this.name = "InternalError";
  }
}

export function toConnectorError(error: unknown): ConnectorError {
  if (error instanceof ConnectorError) return error;
  return new InternalError("Internal connector error", error);
}
