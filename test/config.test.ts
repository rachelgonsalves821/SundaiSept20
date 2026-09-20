import { format, inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigError, ConnectorConfig, loadConfig } from "../src/config.js";

const CANVAS_TOKEN = "canvas-api-token-7f3a9c1e-SECRET";
const CONNECTOR_TOKEN = "connector-auth-token-b2d4f6-SECRET";

const validEnv = (): NodeJS.ProcessEnv => ({
  CANVAS_BASE_URL: "https://canvas.example.edu",
  CANVAS_API_TOKEN: CANVAS_TOKEN,
  CONNECTOR_AUTH_TOKEN: CONNECTOR_TOKEN,
  CANVAS_CAPABILITIES: "read_profile,read_courses,read_assignments",
});

beforeEach(() => {
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadConfig happy path", () => {
  it("returns a ConnectorConfig with every field populated", () => {
    const config = loadConfig(validEnv());
    expect(config).toBeInstanceOf(ConnectorConfig);
    expect(config.canvasBaseUrl).toBe("https://canvas.example.edu");
    expect(config.canvasApiToken).toBe(CANVAS_TOKEN);
    expect(config.connectorAuthToken).toBe(CONNECTOR_TOKEN);
    expect(config.capabilities.list()).toEqual(["read_profile", "read_courses", "read_assignments"]);
    expect(config.port).toBe(3000);
  });

  it("does not read process.env when an env object is supplied", () => {
    const original = process.env.CANVAS_API_TOKEN;
    process.env.CANVAS_API_TOKEN = "from-process-env";
    try {
      expect(loadConfig(validEnv()).canvasApiToken).toBe(CANVAS_TOKEN);
    } finally {
      if (original === undefined) delete process.env.CANVAS_API_TOKEN;
      else process.env.CANVAS_API_TOKEN = original;
    }
  });

  it("parses PORT when present", () => {
    expect(loadConfig({ ...validEnv(), PORT: "8080" }).port).toBe(8080);
  });

  it("trims surrounding whitespace from values", () => {
    const config = loadConfig({ ...validEnv(), CANVAS_API_TOKEN: `  ${CANVAS_TOKEN}  ` });
    expect(config.canvasApiToken).toBe(CANVAS_TOKEN);
  });
});

describe("loadConfig required variables", () => {
  const REQUIRED = ["CANVAS_BASE_URL", "CANVAS_API_TOKEN", "CONNECTOR_AUTH_TOKEN", "CANVAS_CAPABILITIES"] as const;

  it.each(REQUIRED)("fails at startup when %s is missing", (name) => {
    const env = validEnv();
    delete env[name];
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(`Missing required environment variable: ${name}`);
  });

  it.each(REQUIRED)("fails at startup when %s is empty or whitespace", (name) => {
    expect(() => loadConfig({ ...validEnv(), [name]: "" })).toThrow(`Missing required environment variable: ${name}`);
    expect(() => loadConfig({ ...validEnv(), [name]: "   " })).toThrow(`Missing required environment variable: ${name}`);
  });

  it("startup error messages never include secret values", () => {
    const env = validEnv();
    delete env.CANVAS_BASE_URL;
    let message = "";
    try {
      loadConfig(env);
    } catch (error) {
      message = inspect(error);
    }
    expect(message).not.toContain(CANVAS_TOKEN);
    expect(message).not.toContain(CONNECTOR_TOKEN);
  });
});

describe("loadConfig base URL", () => {
  it.each([
    ["not a url", "not a url"],
    ["bare hostname", "canvas.example.edu"],
    ["ftp scheme", "ftp://canvas.example.edu"],
    ["file scheme", "file:///etc/passwd"],
    ["javascript scheme", "javascript:alert(1)"],
    ["with query string", "https://canvas.example.edu/?x=1"],
    ["with fragment", "https://canvas.example.edu/#frag"],
    ["with embedded credentials", "https://user:pass@canvas.example.edu"],
  ])("rejects %s", (_label, url) => {
    expect(() => loadConfig({ ...validEnv(), CANVAS_BASE_URL: url })).toThrow(ConfigError);
    expect(() => loadConfig({ ...validEnv(), CANVAS_BASE_URL: url })).toThrow(/CANVAS_BASE_URL/);
  });

  it("URL rejection message does not echo the rejected value", () => {
    const url = "https://user:pass-SECRET@canvas.example.edu";
    let message = "";
    try {
      loadConfig({ ...validEnv(), CANVAS_BASE_URL: url });
    } catch (error) {
      message = inspect(error);
    }
    expect(message).not.toContain("pass-SECRET");
  });

  it("accepts http as well as https", () => {
    expect(loadConfig({ ...validEnv(), CANVAS_BASE_URL: "http://localhost:3001" }).canvasBaseUrl).toBe("http://localhost:3001");
  });

  it.each([
    ["https://canvas.example.edu/", "https://canvas.example.edu"],
    ["https://canvas.example.edu///", "https://canvas.example.edu"],
    ["https://canvas.example.edu/sub/path/", "https://canvas.example.edu/sub/path"],
    ["https://canvas.example.edu:8443/", "https://canvas.example.edu:8443"],
  ])("normalizes trailing slashes: %s → %s", (input, expected) => {
    expect(loadConfig({ ...validEnv(), CANVAS_BASE_URL: input }).canvasBaseUrl).toBe(expected);
  });

  it("normalization is idempotent", () => {
    const once = loadConfig(validEnv()).canvasBaseUrl;
    const twice = loadConfig({ ...validEnv(), CANVAS_BASE_URL: once }).canvasBaseUrl;
    expect(twice).toBe(once);
  });
});

describe("loadConfig capabilities", () => {
  it("drops unknown capabilities", () => {
    const config = loadConfig({ ...validEnv(), CANVAS_CAPABILITIES: "read_courses,write_grades,admin" });
    expect(config.capabilities.list()).toEqual(["read_courses"]);
  });

  it("refuses to start when zero recognized capabilities parse", () => {
    expect(() => loadConfig({ ...validEnv(), CANVAS_CAPABILITIES: "write_grades,admin" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...validEnv(), CANVAS_CAPABILITIES: "write_grades,admin" })).toThrow(/no recognized capabilities/);
    expect(() => loadConfig({ ...validEnv(), CANVAS_CAPABILITIES: " , , " })).toThrow(ConfigError);
  });
});

describe("loadConfig PORT", () => {
  it.each(["0", "-1", "65536", "abc", "80.5", "1e3"])("rejects PORT=%s", (port) => {
    expect(() => loadConfig({ ...validEnv(), PORT: port })).toThrow(/PORT/);
  });

  it("treats an empty PORT as unset", () => {
    expect(loadConfig({ ...validEnv(), PORT: "" }).port).toBe(3000);
  });
});

describe("ConnectorConfig redaction", () => {
  const config = () => loadConfig(validEnv());

  it("JSON.stringify redacts both tokens and keeps non-secret fields", () => {
    const json = JSON.stringify(config());
    expect(json).not.toContain(CANVAS_TOKEN);
    expect(json).not.toContain(CONNECTOR_TOKEN);
    expect(JSON.parse(json)).toEqual({
      canvasBaseUrl: "https://canvas.example.edu",
      canvasApiToken: "[REDACTED]",
      connectorAuthToken: "[REDACTED]",
      capabilities: ["read_profile", "read_courses", "read_assignments"],
      port: 3000,
    });
  });

  it("util.inspect (what console.log uses) redacts both tokens", () => {
    const text = inspect(config(), { depth: null, showHidden: true });
    expect(text).not.toContain(CANVAS_TOKEN);
    expect(text).not.toContain(CONNECTOR_TOKEN);
    expect(text).toContain("[REDACTED]");
  });

  it("util.format %o / %j / %s (console.log with format args) redacts both tokens", () => {
    for (const spec of ["%o", "%O", "%j", "%s"]) {
      const text = format(spec, config());
      expect(text, spec).not.toContain(CANVAS_TOKEN);
      expect(text, spec).not.toContain(CONNECTOR_TOKEN);
    }
  });

  it("string coercion redacts both tokens", () => {
    const text = `${config()}`;
    expect(text).not.toContain(CANVAS_TOKEN);
    expect(text).not.toContain(CONNECTOR_TOKEN);
  });

  it("spread, Object.keys, and Object.entries do not expose secrets", () => {
    const c = config();
    expect(Object.keys(c)).not.toContain("canvasApiToken");
    expect(Object.keys(c)).not.toContain("connectorAuthToken");
    expect(JSON.stringify({ ...c })).not.toContain(CANVAS_TOKEN);
    expect(JSON.stringify(Object.entries(c))).not.toContain(CONNECTOR_TOKEN);
  });

  it("inspecting a wrapper object still redacts (nested inspect path)", () => {
    const text = inspect({ config: config(), other: 1 }, { depth: null });
    expect(text).not.toContain(CANVAS_TOKEN);
    expect(text).not.toContain(CONNECTOR_TOKEN);
  });

  it("secrets remain readable through the typed getters", () => {
    const c = config();
    expect(c.canvasApiToken).toBe(CANVAS_TOKEN);
    expect(c.connectorAuthToken).toBe(CONNECTOR_TOKEN);
  });
});
