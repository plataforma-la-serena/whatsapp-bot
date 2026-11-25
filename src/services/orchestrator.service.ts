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

type ChatSession =
  Awaited<ReturnType<ApiCentralService["session"]>>["session"];
type IaReply = Awaited<ReturnType<IaService["reply"]>>;

interface RespondInput {
  phone: string;
  text: string;
  messages: StoredMessage[];
  session: ChatSession;
  source: "text" | "audio";
}

interface ImagesInput {
  apartmentIds: string[];
  apartments: ApartmentContext[];
  userText: string;
  history: StoredMessage[];
}

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
    source: "text" | "audio" = "text",
  ): Promise<void> {
    const { session, messages } = await this.api.session(phone);
    await this.api.appendMessage(phone, "USER", storedText);

    // El número de avisos puede abrir su ventana de 24 h con un comando simple.
    if (
      phone === this.alert.alertPhone &&
      /^(abrir avisos|canal de avisos|\/avisos)\b/i.test(text.trim())
    ) {
      await this.whatsapp.sendText(
        phone,
        "Canal de avisos abierto por 24 h. Los próximos avisos de reservas y pedidos de atención humana van a llegar por acá.",
      );
      return;
    }

    if (!session.botActive) {
      this.logger.info({ phone }, "bot pausado: el mensaje queda para el operador");
      return;
    }

    await this.respond({ phone, text, messages, session, source });
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

    await this.handleMessage(phone, transcript, `🎤 ${transcript}`, "audio");
  }

  private async respond(input: RespondInput): Promise<void> {
    const { phone, text, messages, session, source } = input;

    try {
      const apartments = await this.api.context();
      const result = await this.ia.reply({
        message: text,
        phone,
        history: toHistory(messages),
        apartments,
        source,
      });

      await this.api.appendMessage(phone, "ASSISTANT", result.reply);

      const name = result.customerName ?? session.customerName ?? null;
      await this.syncLead(phone, name, result);
      await this.pauseBotIfNeeded(phone, result);
      await this.whatsapp.sendText(phone, result.reply);
      await this.notifyTeam(phone, name, result, session);
      await this.sendApartmentImages(phone, {
        apartmentIds: result.apartmentIds ?? [],
        apartments,
        userText: text,
        history: messages,
      });
    } catch (error) {
      this.logger.error({ err: error, phone }, "error procesando el mensaje");
      await this.whatsapp.sendText(phone, FALLBACK_REPLY).catch(() => undefined);
    }
  }

  private async syncLead(
    phone: string,
    name: string | null,
    result: IaReply,
  ): Promise<void> {
    const wantsReservation = Boolean(result.wantsReservation);
    const wantsHuman = Boolean(result.wantsHuman);
    const hasLead = Boolean(name) || wantsReservation || wantsHuman;

    if (!hasLead) {
      return;
    }

    await this.api.setLead(phone, {
      name: name ?? undefined,
      wantsReservation: wantsReservation || undefined,
      wantsHuman: wantsHuman || undefined,
    });
  }

  private async pauseBotIfNeeded(phone: string, result: IaReply): Promise<void> {
    if (result.wantsHuman) {
      await this.api.setBotActive(phone, false);
      this.logger.info(
        { phone },
        "pedido de humano: bot pausado para intervención humana",
      );
      return;
    }

    if (result.handoff) {
      await this.api.setBotActive(phone, false);
      this.logger.info(
        { phone },
        "handoff: bot pausado para intervención humana",
      );
    }
  }

  private async notifyTeam(
    phone: string,
    name: string | null,
    result: IaReply,
    session: ChatSession,
  ): Promise<void> {
    if (result.wantsHuman && !session.wantsHuman) {
      await this.alert.notify({ phone, name, kind: "human" });
    }
    if (result.wantsReservation && !session.wantsReservation) {
      await this.alert.notify({ phone, name, kind: "reservation" });
    }
  }

  private async sendApartmentImages(
    phone: string,
    input: ImagesInput,
  ): Promise<void> {
    const { apartmentIds, apartments, userText, history } = input;
    const askedForPhotos = PHOTO_REQUEST.test(normalize(userText));
    const alreadyDiscussed = normalize(
      history.map((message) => message.content).join("\n"),
    );
    let sent = 0;

    for (const id of apartmentIds) {
      if (sent >= MAX_IMAGES) {
        return;
      }

      const apartment = apartments.find((item) => item.id === id);
      if (!apartment) {
        continue;
      }

      const wasShown = alreadyDiscussed.includes(normalize(apartment.title));
      if (wasShown && !askedForPhotos) {
        continue;
      }

      sent = await this.sendApartmentImagesFor(phone, apartment, sent);
    }
  }

  private async sendApartmentImagesFor(
    phone: string,
    apartment: ApartmentContext,
    sent: number,
  ): Promise<number> {
    const images = imagesForApartment(apartment.images, apartment.coverIndex);
    let count = sent;

    for (const [position, image] of images.entries()) {
      if (count >= MAX_IMAGES) {
        break;
      }

      const caption =
        position === 0
          ? `*${apartment.title}*${image.reference ? "\nImagen de referencia" : ""}`
          : undefined;

      try {
        await this.whatsapp.sendImage(phone, image.source, caption);
        count += 1;
      } catch (error) {
        this.logger.error(
          { err: error, phone, apartment: apartment.title },
          "error enviando imagen del departamento",
        );
        break;
      }
    }

    return count;
  }
}
