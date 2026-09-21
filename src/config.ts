import { createHash } from "node:crypto";
import { inspect } from "node:util";
import { CapabilityPolicy } from "./capabilities.js";

const REDACTED = "[REDACTED]";
const DEFAULT_PORT = 3000;

export interface ConnectorConfigValues {
  canvasBaseUrl: string;
  canvasApiToken: string;
  connectorAuthToken: string;
  capabilities: CapabilityPolicy;
  port: number;
}

/**
 * Validated startup configuration.
 *
 * Secrets live in private fields and are exposed through prototype getters, so
 * they are not own-enumerable: `{...config}`, `Object.keys`, `JSON.stringify`
 * and `util.inspect` (which is what `console.log` uses — it ignores `toJSON`)
 * all see the redacted view. Both `toJSON` and `[inspect.custom]` are required;
 * either one alone leaves a leak path open.
 */
export class ConnectorConfig {
  readonly canvasBaseUrl: string;
  readonly capabilities: CapabilityPolicy;
  readonly port: number;
  readonly #canvasApiToken: string;
  readonly #connectorAuthToken: string;

  constructor(values: ConnectorConfigValues) {
    this.canvasBaseUrl = values.canvasBaseUrl;
    this.capabilities = values.capabilities;
    this.port = values.port;
    this.#canvasApiToken = values.canvasApiToken;
    this.#connectorAuthToken = values.connectorAuthToken;
  }

  /** Outbound Canvas credential. Only the Canvas client should read this. */
  get canvasApiToken(): string {
    return this.#canvasApiToken;
  }

  /** Inbound agent credential. Only the auth check should read this. */
  get connectorAuthToken(): string {
    return this.#connectorAuthToken;
  }

  /**
   * Temporary, non-secret diagnostic value for comparing deployments.
   * This is intentionally only a short SHA-256 prefix, never the token.
   */
  get connectorAuthTokenFingerprint(): string {
    return createHash("sha256").update(this.#connectorAuthToken, "utf8").digest("hex").slice(0, 12);
  }

  toJSON(): Record<string, unknown> {
    return {
      canvasBaseUrl: this.canvasBaseUrl,
      canvasApiToken: REDACTED,
      connectorAuthToken: REDACTED,
      capabilities: this.capabilities.list(),
      port: this.port,
    };
  }

  [inspect.custom](): string {
    return `ConnectorConfig ${inspect(this.toJSON())}`;
  }

  toString(): string {
    return this[inspect.custom]();
  }
}

/**
 * Thrown for any startup validation failure. Messages name the offending
 * variable but never include its value — they are written to stderr and may
 * end up in logs.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(`Missing required environment variable: ${name}`);
  return value;
}

/** Validates and normalizes CANVAS_BASE_URL: must parse, must be http(s), trailing slashes stripped. */
function parseBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError("CANVAS_BASE_URL is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ConfigError("CANVAS_BASE_URL must use http or https");
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new ConfigError("CANVAS_BASE_URL must not contain query, fragment, or credentials");
  }
  return url.toString().replace(/\/+$/, "");
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;
  const port = /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError("PORT must be an integer between 1 and 65535");
  }
  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConnectorConfig {
  const canvasBaseUrl = parseBaseUrl(requireEnv(env, "CANVAS_BASE_URL"));
  const canvasApiToken = requireEnv(env, "CANVAS_API_TOKEN");
  const connectorAuthToken = requireEnv(env, "CONNECTOR_AUTH_TOKEN");
  const capabilities = new CapabilityPolicy(requireEnv(env, "CANVAS_CAPABILITIES"));
  const port = parsePort(env.PORT);

  // A connector that boots healthy and serves nothing is worse than one that refuses to start.
  if (capabilities.list().length === 0) {
    throw new ConfigError("CANVAS_CAPABILITIES contains no recognized capabilities");
  }

  return new ConnectorConfig({ canvasBaseUrl, canvasApiToken, connectorAuthToken, capabilities, port });
}
