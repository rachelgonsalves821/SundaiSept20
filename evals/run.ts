/**
 * CLI entry point: `npm run eval`.
 *
 * Exits non-zero when any scenario fails so it can gate a pipeline directly,
 * though `npm test` already covers the same scenarios via evals/eval.test.ts.
 * Writes to stdout only — nothing here shares a process with the stdio MCP
 * transport, so stdout is free.
 */
import { runScenarios } from "./harness.js";
import { formatReport, summarize, toJson } from "./report.js";
import { scenarios } from "./scenarios.js";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const filters = args.filter((arg) => !arg.startsWith("--"));

const selected =
  filters.length === 0
    ? scenarios
    : scenarios.filter((scenario) =>
        filters.some((filter) => scenario.id.includes(filter) || scenario.category === filter),
      );

if (selected.length === 0) {
  process.stderr.write(`No scenarios matched: ${filters.join(", ")}\n`);
  process.exit(2);
}

const report = summarize(await runScenarios(selected));
process.stdout.write(asJson ? `${JSON.stringify(toJson(report), null, 2)}\n` : formatReport(report));
process.exit(report.failures.length > 0 ? 1 : 0);
