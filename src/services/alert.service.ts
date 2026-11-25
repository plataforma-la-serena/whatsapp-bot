import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../config";
import type { ApiCentralService } from "./api-central.service";
import type { WhatsAppService } from "./whatsapp.service";

export type AlertKind = "human" | "reservation";

export interface AlertInput {
  phone: string;
  name?: string | null;
  kind: AlertKind;
}

interface AlertCopy {
  detail: string;
  text: string;
}

function composeAlert({ phone, name, kind }: AlertInput): AlertCopy {
  const detail =
    kind === "human"
      ? "quiere hablar con una persona real"
      : "está interesado en reservar";
  const text = `El número ${phone}${name ? ` (${name})` : ""} ${detail} ${
    kind === "human" ? "🔔" : "🟢"
  }`;
  return { detail, text };
}

/**
 * Avisa al número del equipo cuando alguien pide atención humana o ya está
 * interesado en reservar.
 *
 * WhatsApp solo permite texto libre dentro de la ventana de 24 horas desde el
 * último mensaje del destinatario. Si la ventana está cerrada se usa una
 * plantilla aprobada (WHATSAPP_ALERT_TEMPLATE).
 */
export class AlertService {
  constructor(
    private readonly config: AppConfig,
    private readonly api: ApiCentralService,
    private readonly whatsapp: WhatsAppService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  get alertPhone(): string {
    return this.config.alertPhone;
  }

  async notify(input: AlertInput): Promise<void> {
    const { phone, kind } = input;
    const { detail, text } = composeAlert(input);

    if (this.config.alertDryRun) {
      this.logger.info(
        { to: this.config.alertPhone, text, kind },
        "aviso al equipo (dry run): no enviado",
      );
      return;
    }

    const windowOpen = await this.windowIsOpen();
    if (windowOpen && (await this.sendTextAlert(text, kind))) {
      return;
    }

    await this.sendTemplateAlert(phone, detail, kind);
  }

  private async windowIsOpen(): Promise<boolean> {
    try {
      return (await this.api.window(this.config.alertPhone)).open;
    } catch (error) {
      this.logger.warn(
        { err: error, to: this.config.alertPhone },
        "no se pudo verificar la ventana de 24h; se intenta texto directo",
      );
      return true;
    }
  }

  private async sendTextAlert(text: string, kind: AlertKind): Promise<boolean> {
    try {
      await this.whatsapp.sendText(this.config.alertPhone, text);
      this.logger.info(
        { to: this.config.alertPhone, kind },
        "aviso al equipo enviado como texto",
      );
      return true;
    } catch (error) {
      this.logger.warn(
        { err: error, to: this.config.alertPhone, kind },
        "falló el texto directo; se intenta la plantilla",
      );
      return false;
    }
  }

  private async sendTemplateAlert(
    phone: string,
    detail: string,
    kind: AlertKind,
  ): Promise<void> {
    if (!this.config.alertTemplateName) {
      this.logger.error(
        { to: this.config.alertPhone, kind },
        "ventana de 24h cerrada y WHATSAPP_ALERT_TEMPLATE sin configurar: aviso no enviado",
      );
      return;
    }

    try {
      await this.whatsapp.sendTemplate(
        this.config.alertPhone,
        this.config.alertTemplateName,
        this.config.alertTemplateLang,
        [phone, detail],
      );
      this.logger.info(
        {
          to: this.config.alertPhone,
          kind,
          template: this.config.alertTemplateName,
        },
        "aviso al equipo enviado como plantilla",
      );
    } catch (error) {
      this.logger.error(
        { err: error, to: this.config.alertPhone, kind },
        "no se pudo enviar el aviso al equipo",
      );
    }
  }
}
