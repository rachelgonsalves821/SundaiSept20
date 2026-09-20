/**
 * Runs the Tier 1 evals under vitest so `npm test` gates on them, one test per
 * scenario for readable failures. `npm run eval` runs the same scenarios and
 * prints the scored report.
 */
import { describe, expect, it } from "vitest";
import { runScenario } from "./harness.js";
import { scenarios } from "./scenarios.js";

describe("tier 1 evals", () => {
  it("every scenario id is unique", () => {
    const ids = scenarios.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(scenarios.map((scenario) => [scenario.id, scenario] as const))("%s", async (_id, scenario) => {
    const result = await runScenario(scenario);
    const failed = result.checks
      .filter((check) => !check.passed)
      .map((check) => `${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
    expect(failed).toEqual([]);
    // A scenario whose steps all short-circuited would vacuously pass.
    expect(result.checks.length).toBeGreaterThan(0);
  });
});
