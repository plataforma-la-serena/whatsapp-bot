import type { FastifyBaseLogger } from "fastify";
import type { StoredMessage } from "../types";
import type { ApiCentralService } from "./api-central.service";
import type { IaService } from "./ia.service";
import type { WhatsAppService } from "./whatsapp.service";

const FALLBACK_REPLY =
  "Estamos teniendo un problema técnico. Por favor, intentá nuevamente en unos minutos.";

function toHistory(
  messages: StoredMessage[],
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter((message) => message.role !== "SYSTEM")
    .slice(-20)
    .map((message) => ({
      role: message.role === "USER" ? "user" : "assistant",
      content: message.content,
    }));
}

export class OrchestratorService {
  constructor(
    private readonly api: ApiCentralService,
    private readonly ia: IaService,
    private readonly whatsapp: WhatsAppService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async handleMessage(phone: string, text: string): Promise<void> {
    const { session, messages } = await this.api.session(phone);
    await this.api.appendMessage(phone, "USER", text);

    if (!session.botActive) {
      this.logger.info({ phone }, "bot pausado: el mensaje queda para el operador");
      return;
    }

    await this.respond(phone, text, messages);
  }

  private async respond(
    phone: string,
    text: string,
    messages: StoredMessage[],
  ): Promise<void> {
    try {
      const apartments = await this.api.context();
      const result = await this.ia.reply({
        message: text,
        phone,
        history: toHistory(messages),
        apartments,
      });

      await this.api.appendMessage(phone, "ASSISTANT", result.reply);
      await this.whatsapp.sendText(phone, result.reply);

      if (result.handoff) {
        await this.api.setBotActive(phone, false);
        this.logger.info({ phone }, "handoff: bot pausado para intervención humana");
      }
    } catch (error) {
      this.logger.error({ err: error, phone }, "error procesando el mensaje");
      await this.whatsapp.sendText(phone, FALLBACK_REPLY).catch(() => undefined);
    }
  }
}
