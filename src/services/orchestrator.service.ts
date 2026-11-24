import type { FastifyBaseLogger } from "fastify";
import { imagesForApartment, normalize } from "../lib/apartment-images";
import type { ApartmentContext, StoredMessage } from "../types";
import type { AlertService } from "./alert.service";
import type { ApiCentralService } from "./api-central.service";
import type { IaService } from "./ia.service";
import type { TranscriptionService } from "./transcription.service";
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
    private readonly alert: AlertService,
    private readonly transcription: TranscriptionService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async handleMessage(
    phone: string,
    text: string,
    storedText = text,
  ): Promise<void> {
    const { session, messages } = await this.api.session(phone);
    await this.api.appendMessage(phone, "USER", storedText);

    if (!session.botActive) {
      this.logger.info({ phone }, "bot pausado: el mensaje queda para el operador");
      return;
    }

    await this.respond(phone, text, messages, session);
  }

  async handleAudio(phone: string, mediaId: string): Promise<void> {
    const transcript = await this.transcription.transcribe(mediaId);

    if (!transcript) {
      await this.api
        .appendMessage(phone, "USER", "[Audio no transcrito]")
        .catch(() => undefined);

      try {
        const { session } = await this.api.session(phone);
        if (session.botActive) {
          await this.whatsapp.sendText(
            phone,
            "No pude escuchar el audio. ¿Me lo podés escribir?",
          );
        }
      } catch (error) {
        this.logger.error(
          { err: error, phone },
          "error respondiendo audio no transcrito",
        );
      }
      return;
    }

    await this.handleMessage(phone, transcript, `🎤 ${transcript}`);
  }

  private async respond(
    phone: string,
    text: string,
    messages: StoredMessage[],
    session: Awaited<ReturnType<ApiCentralService["session"]>>["session"],
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

      const name = result.customerName ?? session.customerName ?? null;
      const humanRequested = Boolean(result.wantsHuman);
      const reservationInterest = Boolean(result.wantsReservation);
      const humanIsNew = humanRequested && !session.wantsHuman;
      const reservationIsNew =
        reservationInterest && !session.wantsReservation;

      if (name || reservationInterest || humanRequested) {
        await this.api.setLead(phone, {
          name: name ?? undefined,
          wantsReservation: reservationInterest || undefined,
          wantsHuman: humanRequested || undefined,
        });
      }

      if (humanRequested) {
        await this.api.setBotActive(phone, false);
        this.logger.info(
          { phone },
          "pedido de humano: bot pausado para intervención humana",
        );
      } else if (result.handoff) {
        await this.api.setBotActive(phone, false);
        this.logger.info({ phone }, "handoff: bot pausado para intervención humana");
      }

      await this.whatsapp.sendText(phone, result.reply);

      if (humanIsNew) {
        await this.alert.notify({ phone, name, kind: "human" });
      }
      if (reservationIsNew) {
        await this.alert.notify({ phone, name, kind: "reservation" });
      }
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
