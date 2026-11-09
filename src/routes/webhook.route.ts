import type { FastifyPluginAsync } from "fastify";
import type { AppConfig } from "../config";
import type { MessageDeduplicator } from "../lib/dedupe";
import { verifySignature } from "../lib/signature";
import type { OrchestratorService } from "../services/orchestrator.service";
import type { WhatsAppMessage, WhatsAppWebhookPayload } from "../types";

interface WebhookQuery {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
}

export interface WebhookDeps {
  config: AppConfig;
  orchestrator: OrchestratorService;
  dedupe: MessageDeduplicator;
}

function extractMessages(payload: WhatsAppWebhookPayload): WhatsAppMessage[] {
  return payload.entry.flatMap((entry) =>
    entry.changes.flatMap((change) => change.value.messages ?? []),
  );
}

function isTextMessage(message: WhatsAppMessage): boolean {
  return message.type === "text" && Boolean(message.text?.body);
}

export const webhookRoutes: FastifyPluginAsync<WebhookDeps> = async (
  app,
  deps,
) => {
  app.get<{ Querystring: WebhookQuery }>("/webhook", async (request, reply) => {
    const mode = request.query["hub.mode"];
    const token = request.query["hub.verify_token"];
    const challenge = request.query["hub.challenge"];

    if (
      mode === "subscribe" &&
      token &&
      token === deps.config.whatsappVerifyToken
    ) {
      return reply.code(200).send(challenge ?? "");
    }

    return reply.code(403).send({ error: "Verificación fallida" });
  });

  app.post("/webhook", async (request, reply) => {
    const rawBody = request.rawBody;
    if (!rawBody) {
      return reply.code(400).send({ error: "Cuerpo requerido" });
    }

    if (deps.config.whatsappAppSecret) {
      const signature = request.headers["x-hub-signature-256"];
      if (
        typeof signature !== "string" ||
        !verifySignature(rawBody, signature, deps.config.whatsappAppSecret)
      ) {
        return reply.code(401).send({ error: "Firma inválida" });
      }
    } else if (deps.config.isProduction) {
      return reply
        .code(500)
        .send({ error: "WHATSAPP_APP_SECRET no configurado" });
    }

    const payload = request.body as WhatsAppWebhookPayload;
    const messages = extractMessages(payload).filter(isTextMessage);

    for (const message of messages) {
      if (!deps.dedupe.firstTime(message.id)) {
        continue;
      }
      void deps.orchestrator
        .handleMessage(message.from, message.text!.body)
        .catch((error: unknown) => {
          app.log.error({ err: error, id: message.id }, "error en el webhook");
        });
    }

    return reply.code(200).send({ received: true });
  });
};
