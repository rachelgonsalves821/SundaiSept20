/**
 * How a calling agent is expected to react to each connector error code.
 *
 * The codes themselves are pinned by the unit tests. What nothing pins down is
 * their *meaning to a caller*: whether receiving one should make an agent stop,
 * retry the identical call, or retry with different arguments. That mapping is
 * the contract an agent's control flow is built on, so a code that silently
 * changes category is a real regression even when its string is unchanged.
 *
 * Scenarios assert a disposition rather than only a code, so swapping (say)
 * CANVAS_TIMEOUT for CANVAS_API_ERROR fails loudly as "a retryable condition
 * now reads as terminal".
 */
import type { ConnectorErrorCode } from "../src/errors.js";

export type Disposition =
  /** Nothing the agent can do about it; surface to the user and stop. */
  | "terminal"
  /** The identical call may succeed later; retry with backoff. */
  | "retry"
  /** Deterministic for these arguments; only worth retrying with different ones. */
  | "fix_arguments";

export const DISPOSITIONS: Readonly<Record<ConnectorErrorCode, Disposition>> = Object.freeze({
  PERMISSION_DENIED: "terminal",
  INVALID_INPUT: "fix_arguments",
  CANVAS_API_ERROR: "terminal",
  CANVAS_TIMEOUT: "retry",
  RATE_LIMITED: "retry",
  UNAUTHORIZED: "terminal",
  INTERNAL_ERROR: "terminal",
});

export function dispositionOf(code: string): Disposition | undefined {
  return Object.prototype.hasOwnProperty.call(DISPOSITIONS, code)
    ? DISPOSITIONS[code as ConnectorErrorCode]
    : undefined;
}
