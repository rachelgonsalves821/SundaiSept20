import { CanvasAssignmentSchema, CanvasCourseSchema, CanvasUserSchema } from "./canvas-types.js";
import type { CanvasAssignment, CanvasCourse, CanvasGateway, CanvasUser } from "./canvas-types.js";
import { ConnectorError } from "./errors.js";
import { z } from "zod";

export type { CanvasGateway } from "./canvas-types.js";

export interface CanvasClientConfig {
  baseUrl: string;
  apiToken: string;
  timeoutMs?: number;
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
  private readonly fetchImpl: typeof fetch;
  private readonly canvasOrigin: string;

  constructor(config: CanvasClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.canvasOrigin = new URL(this.baseUrl).origin;
    this.apiToken = config.apiToken;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async getCurrentUser(): Promise<CanvasUser> {
    return this.get("/api/v1/users/self", CanvasUserSchema);
  }

  async listCourses(): Promise<CanvasCourse[]> {
    return this.getPaginated("/api/v1/courses?per_page=100", CanvasCourseSchema);
  }

  async listAssignments(courseId: number): Promise<CanvasAssignment[]> {
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

    while (nextUrl) {
      if (visitedUrls.has(nextUrl)) {
        throw new CanvasApiError("Canvas API pagination loop detected", 502, nextUrl);
      }
      visitedUrls.add(nextUrl);

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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.apiToken}`,
        },
        signal: controller.signal,
      });
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

  private parseNextLink(header: string | null): string | undefined {
    const next = header?.split(",").find((part) => /;\s*rel\s*=\s*"?next"?(?:[;\s]|$)/i.test(part));
    return next?.match(/<([^>]+)>/)?.[1];
  }
}
