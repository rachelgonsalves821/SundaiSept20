import { CanvasAssignmentSchema, CanvasCourseSchema, CanvasUserSchema } from "./canvas-types.js";
import type { CanvasAssignment, CanvasCourse, CanvasGateway, CanvasUser } from "./canvas-types.js";
import { ConnectorError, InvalidInputError } from "./errors.js";
import { z } from "zod";

export type { CanvasGateway } from "./canvas-types.js";

export interface CanvasClientConfig {
  baseUrl: string;
  apiToken: string;
  timeoutMs?: number;
  maxPages?: number;
  maxRateLimitRetries?: number;
  fetchImpl?: typeof fetch;
}

export class CanvasApiError extends ConnectorError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
    code: "CANVAS_API_ERROR" | "CANVAS_TIMEOUT" = "CANVAS_API_ERROR",
  ) {
    super(code, message);
    this.name = "CanvasApiError";
  }
}

export class CanvasClient implements CanvasGateway {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly timeoutMs: number;
  private readonly maxPages: number;
  private readonly maxRateLimitRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly canvasOrigin: string;

  constructor(config: CanvasClientConfig) {
    if (typeof config.baseUrl !== "string" || config.baseUrl.trim().length === 0) {
      throw new TypeError("Canvas base URL must not be empty");
    }
    if (typeof config.apiToken !== "string" || config.apiToken.trim().length === 0) {
      throw new TypeError("Canvas API token must not be empty");
    }
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    let parsedBaseUrl: URL;
    try {
      parsedBaseUrl = new URL(normalizedBaseUrl);
    } catch {
      throw new TypeError("Canvas base URL must be a valid URL");
    }
    if (parsedBaseUrl.protocol !== "https:" && parsedBaseUrl.protocol !== "http:") {
      throw new TypeError("Canvas base URL must use HTTP or HTTPS");
    }
    if (config.timeoutMs !== undefined && (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0)) {
      throw new TypeError("Canvas timeout must be a positive finite number");
    }
    if (config.maxPages !== undefined && (!Number.isInteger(config.maxPages) || config.maxPages <= 0)) {
      throw new TypeError("Canvas maxPages must be a positive integer");
    }
    if (config.maxRateLimitRetries !== undefined && (!Number.isInteger(config.maxRateLimitRetries) || config.maxRateLimitRetries < 0 || config.maxRateLimitRetries > 2)) {
      throw new TypeError("Canvas maxRateLimitRetries must be an integer from 0 to 2");
    }
    this.baseUrl = normalizedBaseUrl;
    this.canvasOrigin = parsedBaseUrl.origin;
    this.apiToken = config.apiToken;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.maxPages = config.maxPages ?? 100;
    this.maxRateLimitRetries = config.maxRateLimitRetries ?? 2;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async getCurrentUser(): Promise<CanvasUser> {
    return this.get("/api/v1/users/self", CanvasUserSchema);
  }

  async listCourses(): Promise<CanvasCourse[]> {
    return this.getPaginated("/api/v1/courses?per_page=100", CanvasCourseSchema);
  }

  async listAssignments(courseId: number): Promise<CanvasAssignment[]> {
    if (!Number.isInteger(courseId) || courseId <= 0) {
      throw new InvalidInputError("courseId must be a positive integer");
    }
    return this.getPaginated(`/api/v1/courses/${courseId}/assignments?per_page=100`, CanvasAssignmentSchema);
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const response = await this.request(path);
    const value = await this.parseJson<unknown>(response);
    try {
      return schema.parse(value);
    } catch {
      throw new CanvasApiError("Canvas API returned an invalid response", 502, response.url || this.baseUrl);
    }
  }

  private async getPaginated<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | undefined = this.toAbsoluteUrl(path);
    const visitedUrls = new Set<string>();
    let pageCount = 0;

    while (nextUrl) {
      if (visitedUrls.has(nextUrl)) {
        throw new CanvasApiError("Canvas API pagination loop detected", 502, nextUrl);
      }
      visitedUrls.add(nextUrl);
      pageCount += 1;
      if (pageCount > this.maxPages) {
        throw new CanvasApiError("Canvas API pagination page limit exceeded", 502, nextUrl);
      }

      const response = await this.request(nextUrl);
      const page = await this.parseJson<unknown>(response);
      if (!Array.isArray(page)) {
        throw new CanvasApiError("Canvas API returned an invalid list response", 502, nextUrl);
      }
      try {
        results.push(...page.map((item) => schema.parse(item)));
      } catch {
        throw new CanvasApiError("Canvas API returned an invalid list response", 502, nextUrl);
      }
      nextUrl = this.parseNextLink(response.headers.get("link"));
    }
    return results;
  }

  private async request(pathOrUrl: string): Promise<Response> {
    const url = this.toAbsoluteUrl(pathOrUrl);
    const deadline = Date.now() + this.timeoutMs;
    let rateLimitRetries = 0;

    while (true) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new CanvasApiError("Canvas API request timed out", 408, url, "CANVAS_TIMEOUT");
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), remainingMs);
      try {
        const response = await this.fetchImpl(url, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.apiToken}`,
          },
          signal: controller.signal,
        });
        if (response.status === 429 && rateLimitRetries < this.maxRateLimitRetries) {
          const retryDelayMs = this.retryDelayMs(response.headers.get("retry-after"));
          if (retryDelayMs < deadline - Date.now()) {
            rateLimitRetries += 1;
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            continue;
          }
        }
        if (!response.ok) {
          throw new CanvasApiError(`Canvas API request failed with status ${response.status}`, response.status, url);
        }
        return response;
      } catch (error) {
        if (error instanceof CanvasApiError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new CanvasApiError("Canvas API request timed out", 408, url, "CANVAS_TIMEOUT");
        }
        throw new CanvasApiError("Canvas API request failed", 502, url);
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  private async parseJson<T>(response: Response): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch {
      throw new CanvasApiError("Canvas API returned malformed JSON", 502, response.url || this.baseUrl);
    }
  }

  private toAbsoluteUrl(pathOrUrl: string): string {
    const url = new URL(pathOrUrl, `${this.baseUrl}/`);
    if (url.origin !== this.canvasOrigin) {
      throw new CanvasApiError("Canvas pagination URL is outside the configured Canvas origin", 502, url.toString());
    }
    return url.toString();
  }

  private retryDelayMs(header: string | null): number {
    if (!header) return 0;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const timestamp = Date.parse(header);
    return Number.isNaN(timestamp) ? 0 : Math.max(0, timestamp - Date.now());
  }

  private parseNextLink(header: string | null): string | undefined {
    if (!header) return undefined;
    for (const part of this.splitLinkHeader(header)) {
      const url = part.match(/^\s*<([^>]+)>/i)?.[1];
      const relation = part.match(/;\s*rel\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
      const relations = relation?.[1] ?? relation?.[2] ?? "";
      if (url && relations.split(/\s+/).includes("next")) return url;
    }
    return undefined;
  }

  private splitLinkHeader(header: string): string[] {
    const parts: string[] = [];
    let start = 0;
    let angleDepth = 0;
    let inQuotes = false;
    let escaped = false;

    for (let index = 0; index < header.length; index += 1) {
      const character = header[index];
      if (escaped) {
        escaped = false;
      } else if (character === "\\" && inQuotes) {
        escaped = true;
      } else if (character === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes && character === "<") {
        angleDepth += 1;
      } else if (!inQuotes && character === ">") {
        angleDepth = Math.max(0, angleDepth - 1);
      } else if (!inQuotes && angleDepth === 0 && character === ",") {
        parts.push(header.slice(start, index));
        start = index + 1;
      }
    }
    parts.push(header.slice(start));
    return parts;
  }
}
