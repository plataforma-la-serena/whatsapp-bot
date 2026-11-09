import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../config";
import { isWhatsAppMock } from "../config";

interface SendResponse {
  messages?: Array<{ id?: string }>;
}

export class WhatsAppService {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: FastifyBaseLogger,
  ) {}

  get mock(): boolean {
    return isWhatsAppMock(this.config);
  }

  async sendText(to: string, body: string): Promise<void> {
    if (this.mock) {
      this.logger.info({ to, body }, "whatsapp mock: mensaje no enviado");
      return;
    }

    const url = `https://graph.facebook.com/${this.config.whatsappApiVersion}/${this.config.whatsappPhoneNumberId}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.whatsappToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const detail = await response.text();
      this.logger.error(
        { status: response.status, detail },
        "error enviando mensaje de WhatsApp",
      );
      throw new Error("No se pudo enviar el mensaje de WhatsApp");
    }

    const payload = (await response.json()) as SendResponse;
    this.logger.info(
      { to, messageId: payload.messages?.[0]?.id },
      "mensaje de WhatsApp enviado",
    );
  }
}
