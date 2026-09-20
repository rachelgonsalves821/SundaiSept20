import { z } from "zod";
import { ConnectorError } from "./errors.js";

export const CAPABILITIES = Object.freeze([
  "read_profile",
  "read_courses",
  "read_assignments",
] as const);

export type Capability = (typeof CAPABILITIES)[number];
export const Capability = z.enum([...CAPABILITIES] as [Capability, ...Capability[]]);

export class PermissionDeniedError extends ConnectorError {
  constructor(public readonly capability: Capability) {
    super("PERMISSION_DENIED", `Permission denied: capability '${capability}' is not enabled`);
    this.name = "PermissionDeniedError";
  }
}

export class CapabilityPolicy {
  private readonly enabled: ReadonlySet<string>;

  constructor(capabilities: string | Iterable<string>) {
    const values = typeof capabilities === "string"
      ? capabilities.split(",").map((value) => value.trim()).filter(Boolean)
      : [...capabilities];
    this.enabled = new Set(values);
  }

  assertAllowed(capability: Capability): void {
    if (!this.enabled.has(capability)) throw new PermissionDeniedError(capability);
  }

  allows(capability: Capability): boolean {
    return this.enabled.has(capability);
  }
}

export function policyFromEnvironment(env: NodeJS.ProcessEnv = process.env): CapabilityPolicy {
  return new CapabilityPolicy(env.CANVAS_CAPABILITIES ?? "");
}
