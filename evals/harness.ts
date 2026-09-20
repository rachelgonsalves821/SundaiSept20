/**
 * Tier 1 eval harness: deterministic, model-free scoring of the connector's
 * agent-facing surface.
 *
 * The suite in test/ asks whether each unit behaves correctly. These evals ask
 * a different question: given only these tools and only what they return,
 * could an agent actually finish the task? So a scenario declares the user
 * request, the tool sequence that should satisfy it, and — the part that
 * carries the weight — derives each step's arguments from the previous step's
 * output. A resolver that cannot find what it needs is a genuine failure: it
 * means a tool returned too little for the next call to be made at all.
 *
 * No network, no Canvas token, no model, no clock dependence. Safe for CI.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CapabilityPolicy } from "../src/capabilities.js";
import type { ConnectorErrorCode } from "../src/errors.js";
import { createMcpServer } from "../src/server.js";
import { dispositionOf, type Disposition } from "./contract.js";
import { FixtureCanvasGateway, type FixtureGatewayOptions, type GatewayMethod } from "./fixture-gateway.js";

/**
 * Distinctive sentinels: every scenario scans its whole transcript for these,
 * so a leak shows up as the literal string rather than something plausible.
 */
const CANVAS_TOKEN = "canvas-api-token-EVAL-SENTINEL-8f2c";
const CONNECTOR_TOKEN = "connector-auth-token-EVAL-SENTINEL-4a91";
/** Matches the fixtures' own host so normalized source_urls stay coherent. */
const CANVAS_URL = "https://canvas.example.invalid";

export type Category =
  | "capability-enforcement"
  | "chaining"
  | "intent-routing"
  | "output-sufficiency"
  | "error-contract"
  | "secret-hygiene";

export interface StepContext {
  /** Payloads of previous *successful* steps, in order. */
  outputs: readonly unknown[];
  /** Payload of the most recent successful step. */
  last: unknown;
}

export type Fact =
  | { path: string; equals: unknown }
  | { path: string; satisfies: (value: unknown) => boolean; describe: string };

export interface ScenarioStep {
  tool: string;
  /** Fixed arguments. Ignored when `argsFrom` is present. */
  args?: Record<string, unknown>;
  /**
   * Derives arguments from earlier output. Must throw when the data it needs
   * is absent — that throw is the output-sufficiency signal.
   */
  argsFrom?: (context: StepContext) => Record<string, unknown>;
  /** Expected connector error code, when this step is meant to fail. */
  expectErrorCode?: ConnectorErrorCode;
  /** Expected caller disposition. Asserted against whatever code came back. */
  expectDisposition?: Disposition;
  /** Facts that must hold in this step's payload. */
  expectFacts?: Fact[];
}

export interface Scenario {
  id: string;
  category: Category;
  /**
   * The user request this sequence is meant to satisfy. Tier 1 never sends it
   * to a model; it records intent and is the handoff point for a Tier 2
   * model-in-the-loop run that would score tool choice against it.
   */
  prompt: string;
  /** Value of CANVAS_CAPABILITIES for this scenario. */
  capabilities: string;
  faults?: FixtureGatewayOptions["faults"];
  steps: ScenarioStep[];
  /** Canvas reads that must have happened, in order. `[]` asserts none did. */
  expectGatewayCalls?: GatewayMethod[];
}

export interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface ScenarioResult {
  scenario: Scenario;
  checks: CheckResult[];
  passed: boolean;
}

type ToolResult = { isError?: boolean; content?: Array<{ type: string; text?: string }> };

function parsePayload(result: ToolResult): unknown {
  const text = result.content?.[0]?.text;
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Dotted path lookup; numeric segments index arrays ("assignments.0.name"). */
function resolvePath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const show = (value: unknown) => (value === undefined ? "undefined" : JSON.stringify(value));

function checkFacts(label: string, payload: unknown, facts: readonly Fact[]): CheckResult[] {
  return facts.map((fact) => {
    const actual = resolvePath(payload, fact.path);
    if ("equals" in fact) {
      return {
        name: `${label}: ${fact.path} is ${show(fact.equals)}`,
        passed: same(actual, fact.equals),
        detail: `got ${show(actual)}`,
      };
    }
    return {
      name: `${label}: ${fact.describe}`,
      passed: fact.satisfies(actual),
      detail: `${fact.path} was ${show(actual)}`,
    };
  });
}

function checkErrorStep(label: string, step: ScenarioStep, result: ToolResult, payload: unknown): CheckResult[] {
  const checks: CheckResult[] = [];
  const body = (payload ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof body.code === "string" ? body.code : undefined;

  checks.push({
    name: `${label}: reported as an MCP error result`,
    passed: result.isError === true,
    detail: result.isError === true ? undefined : "call reported success",
  });

  if (step.expectErrorCode) {
    checks.push({
      name: `${label}: code is ${step.expectErrorCode}`,
      passed: code === step.expectErrorCode,
      detail: `got ${show(code)}`,
    });
  }

  if (step.expectDisposition) {
    const actual = code === undefined ? undefined : dispositionOf(code);
    checks.push({
      name: `${label}: an agent should '${step.expectDisposition}'`,
      passed: actual === step.expectDisposition,
      detail: `code ${show(code)} maps to ${show(actual)}`,
    });
  }

  // toJSON() deliberately drops cause and stack; assert that at the MCP edge,
  // not just at the error class, since that is where a leak would reach agents.
  const keys = payload && typeof payload === "object" ? Object.keys(payload).sort() : [];
  checks.push({
    name: `${label}: error payload is exactly { code, message }`,
    passed: same(keys, ["code", "message"]),
    detail: `keys were ${show(keys)}`,
  });

  checks.push({
    name: `${label}: message is present and human-readable`,
    passed: typeof body.message === "string" && body.message.trim().length > 0,
    detail: `got ${show(body.message)}`,
  });

  return checks;
}

export async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const gateway = new FixtureCanvasGateway({ faults: scenario.faults });
  const server = createMcpServer({
    canvasBaseUrl: CANVAS_URL,
    canvasApiToken: CANVAS_TOKEN,
    capabilities: new CapabilityPolicy(scenario.capabilities),
    client: gateway,
  });
  const client = new Client({ name: "eval-harness", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const checks: CheckResult[] = [];
  const transcript: string[] = [];
  const outputs: unknown[] = [];

  try {
    // Descriptions are what an agent selects on, so they belong in the
    // transcript the secret scan runs over.
    transcript.push(JSON.stringify((await client.listTools()).tools));

    for (const [index, step] of scenario.steps.entries()) {
      const label = `step ${index + 1} (${step.tool})`;
      let args: Record<string, unknown>;

      if (step.argsFrom) {
        try {
          args = step.argsFrom({ outputs, last: outputs.at(-1) });
          checks.push({ name: `${label}: arguments derivable from earlier output`, passed: true });
        } catch (error) {
          checks.push({
            name: `${label}: arguments derivable from earlier output`,
            passed: false,
            detail: `earlier tool output did not carry what this call needs: ${(error as Error).message}`,
          });
          break;
        }
      } else {
        args = step.args ?? {};
      }

      let result: ToolResult;
      try {
        result = (await client.callTool({ name: step.tool, arguments: args })) as ToolResult;
      } catch (error) {
        // A throw means the failure never became a connector error result, so
        // an agent sees a protocol fault instead of a code it can act on.
        checks.push({
          name: `${label}: failure surfaces as a tool result, not a protocol error`,
          passed: false,
          detail: `callTool threw: ${(error as Error).message}`,
        });
        break;
      }

      transcript.push(JSON.stringify(result));
      const payload = parsePayload(result);

      const expectsFailure = step.expectErrorCode !== undefined || step.expectDisposition !== undefined;
      const stepChecks = expectsFailure
        ? checkErrorStep(label, step, result, payload)
        : [
            {
              name: `${label}: succeeds`,
              passed: !result.isError,
              detail: result.isError ? `failed with ${show(payload)}` : undefined,
            },
            ...checkFacts(label, payload, step.expectFacts ?? []),
          ];
      checks.push(...stepChecks);

      if (stepChecks.some((check) => !check.passed)) break;
      if (!result.isError) outputs.push(payload);
    }

    if (scenario.expectGatewayCalls) {
      const actual = gateway.methodsCalled();
      checks.push({
        name: `Canvas reads are exactly [${scenario.expectGatewayCalls.join(", ")}]`,
        passed: same(actual, scenario.expectGatewayCalls),
        detail: `got [${actual.join(", ")}]`,
      });
    }

    const haystack = transcript.join("\n");
    for (const [what, secret] of [
      ["the Canvas token", CANVAS_TOKEN],
      ["the connector token", CONNECTOR_TOKEN],
      ["an Authorization header", "Bearer "],
    ] as const) {
      checks.push({
        name: `nothing returned to the agent contains ${what}`,
        passed: !haystack.includes(secret),
        detail: haystack.includes(secret) ? `found ${JSON.stringify(secret)} in a tool result` : undefined,
      });
    }
  } finally {
    await client.close();
    await server.close();
  }

  return { scenario, checks, passed: checks.every((check) => check.passed) };
}

export async function runScenarios(scenarios: readonly Scenario[]): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario));
  }
  return results;
}
