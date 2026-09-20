import type { CanvasAssignment, CanvasCourse, CanvasUser } from "./canvas-types.js";

export interface CanvasClientConfig {
  baseUrl: string;
  apiToken: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class CanvasApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
  ) {
    super(message);
    this.name = "CanvasApiError";
  }
}

export class CanvasClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: CanvasClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiToken = config.apiToken;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async getCurrentUser(): Promise<CanvasUser> {
    return this.get<CanvasUser>("/api/v1/users/self");
  }

  async listCourses(): Promise<CanvasCourse[]> {
    return this.getPaginated<CanvasCourse>("/api/v1/courses?per_page=100");
  }

  async listAssignments(courseId: number): Promise<CanvasAssignment[]> {
    return this.getPaginated<CanvasAssignment>(`/api/v1/courses/${courseId}/assignments?per_page=100`);
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.request(path);
    return (await response.json()) as T;
  }

  private async getPaginated<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | undefined = this.toAbsoluteUrl(path);

    while (nextUrl) {
      const response = await this.request(nextUrl);
      const page = (await response.json()) as T[];
      if (Array.isArray(page)) results.push(...page);
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
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new CanvasApiError("Canvas API request timed out", 408, url);
      }
      throw new CanvasApiError("Canvas API request failed", 502, url);
    } finally {
      clearTimeout(timeout);
    }
  }

  private toAbsoluteUrl(pathOrUrl: string): string {
    return pathOrUrl.startsWith("http") ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
  }

  private parseNextLink(header: string | null): string | undefined {
    const next = header?.split(",").find((part) => part.includes('rel="next"'));
    return next?.match(/<([^>]+)>/)?.[1];
  }
}
