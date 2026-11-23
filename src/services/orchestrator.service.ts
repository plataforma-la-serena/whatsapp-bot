import type { FastifyBaseLogger } from "fastify";
import { imagesForApartment, normalize } from "../lib/apartment-images";
import type { ApartmentContext, StoredMessage } from "../types";
import type { ApiCentralService } from "./api-central.service";
import type { IaService } from "./ia.service";
import type { WhatsAppService } from "./whatsapp.service";

const FALLBACK_REPLY =
  "Estamos teniendo un problema técnico. Por favor, intentá nuevamente en unos minutos.";

const MAX_IMAGES = 4;
const PHOTO_REQUEST = /\b(foto|fotos|imagen|imagenes|mostrame|mostrar|mostra|ver)\b/;

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

      if (result.customerName || result.wantsReservation) {
        await this.api.setLead(phone, {
          name: result.customerName ?? undefined,
          wantsReservation: result.wantsReservation || undefined,
        });
      }

      if (result.handoff) {
        await this.api.setBotActive(phone, false);
        this.logger.info({ phone }, "handoff: bot pausado para intervención humana");
      }

      await this.whatsapp.sendText(phone, result.reply);
      await this.sendApartmentImages(
        phone,
        result.apartmentIds ?? [],
        apartments,
        text,
        messages,
      );
    } catch (error) {
      this.logger.error({ err: error, phone }, "error procesando el mensaje");
      await this.whatsapp.sendText(phone, FALLBACK_REPLY).catch(() => undefined);
    }
  }

  private async sendApartmentImages(
    phone: string,
    apartmentIds: string[],
    apartments: ApartmentContext[],
    userText: string,
    history: StoredMessage[],
  ): Promise<void> {
    let sent = 0;
    const askedForPhotos = PHOTO_REQUEST.test(normalize(userText));
    const alreadyDiscussed = normalize(
      history.map((message) => message.content).join("\n"),
    );

    for (const id of apartmentIds) {
      if (sent >= MAX_IMAGES) {
        return;
      }

      const index = apartments.findIndex((apartment) => apartment.id === id);
      if (index < 0) {
        continue;
      }

      const apartment = apartments[index];
      const wasShown = alreadyDiscussed.includes(normalize(apartment.title));

      if (wasShown && !askedForPhotos) {
        continue;
      }

      const images = imagesForApartment(
        apartment.images,
        apartment.coverIndex,
      );

      for (const [position, image] of images.entries()) {
        if (sent >= MAX_IMAGES) {
          return;
        }

        try {
          const caption =
            position === 0
              ? `*${apartment.title}*${image.reference ? "\nImagen de referencia" : ""}`
              : undefined;
          await this.whatsapp.sendImage(phone, image.source, caption);
          sent += 1;
        } catch (error) {
          this.logger.error(
            { err: error, phone, apartment: apartment.title },
            "error enviando imagen del departamento",
          );
          break;
        }
      }
    }
  }
}
