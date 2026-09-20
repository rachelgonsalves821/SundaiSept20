/**
 * Scoring and rendering for eval runs.
 *
 * A scenario passes only when every one of its checks passes; the check counts
 * are reported alongside so a single broken assertion in an otherwise healthy
 * scenario is visible as such rather than as a whole category going red.
 */
import type { Category, ScenarioResult } from "./harness.js";

export interface CategorySummary {
  category: Category;
  scenariosPassed: number;
  scenarioCount: number;
  checksPassed: number;
  checkCount: number;
}

export interface Report {
  results: readonly ScenarioResult[];
  categories: CategorySummary[];
  scenariosPassed: number;
  scenarioCount: number;
  checksPassed: number;
  checkCount: number;
  failures: ScenarioResult[];
}

export function summarize(results: readonly ScenarioResult[]): Report {
  const byCategory = new Map<Category, CategorySummary>();

  for (const result of results) {
    const summary = byCategory.get(result.scenario.category) ?? {
      category: result.scenario.category,
      scenariosPassed: 0,
      scenarioCount: 0,
      checksPassed: 0,
      checkCount: 0,
    };
    summary.scenarioCount += 1;
    if (result.passed) summary.scenariosPassed += 1;
    summary.checkCount += result.checks.length;
    summary.checksPassed += result.checks.filter((check) => check.passed).length;
    byCategory.set(result.scenario.category, summary);
  }

  const categories = [...byCategory.values()].sort((a, b) => a.category.localeCompare(b.category));

  return {
    results,
    categories,
    scenariosPassed: results.filter((result) => result.passed).length,
    scenarioCount: results.length,
    checksPassed: categories.reduce((total, category) => total + category.checksPassed, 0),
    checkCount: categories.reduce((total, category) => total + category.checkCount, 0),
    failures: results.filter((result) => !result.passed),
  };
}

export function formatReport(report: Report): string {
  const lines: string[] = ["", "Canvas MCP connector — Tier 1 evals (deterministic, no model)", ""];

  const labelWidth = Math.max(8, ...report.categories.map((category) => category.category.length));
  const row = (label: string, scenarios: string, checks: string) =>
    `  ${label.padEnd(labelWidth)}  ${scenarios.padStart(13)}  ${checks.padStart(13)}`;

  lines.push(row("", "scenarios", "checks"));
  for (const category of report.categories) {
    lines.push(
      row(
        category.category,
        `${category.scenariosPassed}/${category.scenarioCount}`,
        `${category.checksPassed}/${category.checkCount}`,
      ),
    );
  }
  lines.push(`  ${"-".repeat(labelWidth + 32)}`);
  lines.push(
    row("TOTAL", `${report.scenariosPassed}/${report.scenarioCount}`, `${report.checksPassed}/${report.checkCount}`),
  );

  if (report.failures.length > 0) {
    lines.push("", "FAILURES", "");
    for (const failure of report.failures) {
      lines.push(`  x ${failure.scenario.id}  [${failure.scenario.category}]`);
      lines.push(`    prompt: ${failure.scenario.prompt}`);
      for (const check of failure.checks.filter((check) => !check.passed)) {
        lines.push(`    x ${check.name}`);
        if (check.detail) lines.push(`        ${check.detail}`);
      }
      lines.push("");
    }
  }

  lines.push("");
  return lines.join("\n");
}

/** Machine-readable shape for CI artifacts and trend tracking. */
export function toJson(report: Report) {
  return {
    scenarios: { passed: report.scenariosPassed, total: report.scenarioCount },
    checks: { passed: report.checksPassed, total: report.checkCount },
    categories: report.categories,
    results: report.results.map((result) => ({
      id: result.scenario.id,
      category: result.scenario.category,
      prompt: result.scenario.prompt,
      passed: result.passed,
      checks: result.checks,
    })),
  };
}
