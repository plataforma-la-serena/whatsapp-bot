import type { AppConfig } from "../config";
import type {
  ApartmentContext,
  SessionPayload,
  StoredMessage,
} from "../types";

export class ApiCentralService {
  constructor(private readonly config: AppConfig) {}

  context(): Promise<ApartmentContext[]> {
    return this.request<ApartmentContext[]>("/internal/context");
  }

  session(phone: string): Promise<SessionPayload> {
    return this.request<SessionPayload>(this.sessionPath(phone));
  }

  appendMessage(
    phone: string,
    role: StoredMessage["role"],
    content: string,
  ): Promise<unknown> {
    return this.request(`${this.sessionPath(phone)}/messages`, {
      method: "POST",
      body: JSON.stringify({ role, content }),
    });
  }

  setBotActive(phone: string, botActive: boolean): Promise<unknown> {
    return this.request(`${this.sessionPath(phone)}/bot`, {
      method: "PATCH",
      body: JSON.stringify({ botActive }),
    });
  }

  private sessionPath(phone: string): string {
    return `/internal/chat-sessions/${encodeURIComponent(phone)}`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.config.apiCentralUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-service-token": this.config.internalApiToken,
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`api-central respondió ${response.status} en ${path}`);
    }

    return (await response.json()) as T;
  }
}
