import { readFile } from "node:fs/promises";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../config";
import { isWhatsAppMock } from "../config";

interface SendResponse {
  messages?: Array<{ id?: string }>;
}

interface MediaResponse {
  id?: string;
}

export interface ImageSource {
  link?: string;
  path?: string;
}

const ALLOWED_LIST_ERROR = "131030";

// Los números de prueba de Meta en Argentina quedan registrados en la lista de
// permitidos sin el 9 después del código de país. WhatsApp entrega los mensajes
// entrantes con el 9, así que se reintenta con la variante registrada.
function alternateRecipient(to: string): string | null {
  if (/^549\d{10}$/.test(to)) {
    return `54${to.slice(3)}`;
  }

  return null;
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

    await this.send(
      to,
      (recipient) => ({
        messaging_product: "whatsapp",
        to: recipient,
        type: "text",
        text: { body },
      }),
      "texto",
    );
  }

  async sendImage(
    to: string,
    source: ImageSource,
    caption?: string,
  ): Promise<void> {
    if (this.mock) {
      this.logger.info({ to, source }, "whatsapp mock: imagen no enviada");
      return;
    }

    const media = await this.resolveMedia(source);

    await this.send(
      to,
      (recipient) => ({
        messaging_product: "whatsapp",
        to: recipient,
        type: "image",
        image: caption ? { ...media, caption } : media,
      }),
      "imagen",
    );
  }

  private async resolveMedia(
    source: ImageSource,
  ): Promise<{ link: string } | { id: string }> {
    if (source.link && !source.link.startsWith("/")) {
      return { link: source.link };
    }

    if (source.link) {
      if (!/^\/media\/[a-z0-9-]+$/i.test(source.link)) {
        throw new Error("Ruta de imagen inválida");
      }

      const response = await fetch(`${this.config.apiCentralUrl}${source.link}`, {
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        throw new Error("No se pudo descargar la imagen del departamento");
      }

      const mimeType = response.headers.get("content-type") ?? "image/jpeg";
      const data = new Uint8Array(await response.arrayBuffer());
      return { id: await this.uploadImage(data, mimeType) };
    }

    if (!source.path) {
      throw new Error("La imagen no tiene ruta ni enlace");
    }

    const data = new Uint8Array(await readFile(source.path));
    return { id: await this.uploadImage(data, "image/jpeg") };
  }

  private async uploadImage(
    data: Uint8Array<ArrayBuffer>,
    mimeType: string,
  ): Promise<string> {
    const extension = mimeType === "image/png" ? "png" : "jpg";
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    form.append("file", new Blob([data], { type: mimeType }), `foto.${extension}`);

    const response = await fetch(this.messagesUrl("media"), {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.whatsappToken}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const detail = await response.text();
      this.logger.error(
        { status: response.status, detail },
        "error subiendo imagen a WhatsApp",
      );
      throw new Error("No se pudo subir la imagen a WhatsApp");
    }

    const payload = (await response.json()) as MediaResponse;
    if (!payload.id) {
      throw new Error("WhatsApp no devolvió el id de la imagen");
    }

    return payload.id;
  }

  private async send(
    to: string,
    payloadFor: (recipient: string) => Record<string, unknown>,
    kind: string,
  ): Promise<void> {
    const response = await this.postMessage(payloadFor(to));

    if (response.ok) {
      const payload = (await response.json()) as SendResponse;
      this.logger.info(
        { to, messageId: payload.messages?.[0]?.id, kind },
        "mensaje de WhatsApp enviado",
      );
      return;
    }

    const detail = await response.text();
    const alternate = alternateRecipient(to);

    if (
      response.status === 400 &&
      detail.includes(ALLOWED_LIST_ERROR) &&
      alternate
    ) {
      const retry = await this.postMessage(payloadFor(alternate));

      if (retry.ok) {
        const payload = (await retry.json()) as SendResponse;
        this.logger.info(
          { to: alternate, messageId: payload.messages?.[0]?.id, kind },
          "mensaje de WhatsApp enviado con destinatario alternativo",
        );
        return;
      }

      this.logger.error(
        { status: retry.status, detail: await retry.text(), kind },
        "error enviando mensaje de WhatsApp",
      );
      throw new Error("No se pudo enviar el mensaje de WhatsApp");
    }

    this.logger.error(
      { status: response.status, detail, kind },
      "error enviando mensaje de WhatsApp",
    );
    throw new Error("No se pudo enviar el mensaje de WhatsApp");
  }

  private postMessage(payload: Record<string, unknown>): Promise<Response> {
    return fetch(this.messagesUrl("messages"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.whatsappToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  }

  private messagesUrl(resource: "messages" | "media"): string {
    return `https://graph.facebook.com/${this.config.whatsappApiVersion}/${this.config.whatsappPhoneNumberId}/${resource}`;
  }
}
