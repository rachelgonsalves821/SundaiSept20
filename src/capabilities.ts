import { z } from "zod";
import { ConnectorError } from "./errors.js";

export const CAPABILITIES = Object.freeze([
  "read_profile",
  "read_courses",
  "read_assignments",
] as const);

export type Capability = (typeof CAPABILITIES)[number];
export const Capability = z.enum([...CAPABILITIES] as [Capability, ...Capability[]]);

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

export class PermissionDeniedError extends ConnectorError {
  constructor(public readonly capability: Capability) {
    super("PERMISSION_DENIED", `Permission denied: capability '${capability}' is not enabled`);
    this.name = "PermissionDeniedError";
  }
}

/**
 * Allow-list of capabilities this deployment is willing to serve.
 *
 * Names are trimmed and lowercased. Unknown strings are dropped at construction and never granted, so
 * "read_courses,write_grades,admin" yields exactly ["read_courses"]. Dropped
 * names are reported on stderr (never stdout — that is the MCP stream).
 */
export class CapabilityPolicy {
  private readonly enabled: ReadonlySet<Capability>;

  constructor(input: string | string[]) {
    const raw = typeof input === "string" ? input.split(",") : input;
    const names = raw.map((value) => value.trim().toLowerCase()).filter(Boolean);

    const known = new Set<Capability>();
    const unknown: string[] = [];
    for (const name of names) {
      if (isCapability(name)) known.add(name);
      else unknown.push(name);
    }
    if (unknown.length > 0) {
      process.stderr.write(`[capabilities] ignoring unknown capabilities: ${unknown.join(", ")}\n`);
    }
    this.enabled = known;
  }

  allows(capability: Capability): boolean {
    return this.enabled.has(capability);
  }

  /** Throws PERMISSION_DENIED. Call this before touching the Canvas client, never after. */
  assertAllowed(capability: Capability): void {
    if (!this.enabled.has(capability)) throw new PermissionDeniedError(capability);
  }

  /** Enabled capabilities in canonical order. Lets the MCP layer avoid advertising tools it will refuse. */
  list(): Capability[] {
    return CAPABILITIES.filter((capability) => this.enabled.has(capability));
  }
}

export function policyFromEnvironment(env: NodeJS.ProcessEnv = process.env): CapabilityPolicy {
  return new CapabilityPolicy(env.CANVAS_CAPABILITIES ?? "");
}
