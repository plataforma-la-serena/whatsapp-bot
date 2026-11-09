import type { AppConfig } from "../config";
import type { IaRequest, IaResponse } from "../types";

export class IaService {
  constructor(private readonly config: AppConfig) {}

  async reply(input: IaRequest): Promise<IaResponse> {
    const response = await fetch(`${this.config.iaUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(this.config.iaTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`servicio-ia respondió ${response.status}`);
    }

    return (await response.json()) as IaResponse;
  }
}
