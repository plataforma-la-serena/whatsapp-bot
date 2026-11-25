import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { isWhatsAppMock, type AppConfig } from "./config";
import { MessageDeduplicator } from "./lib/dedupe";
import { webhookRoutes } from "./routes/webhook.route";
import { AlertService } from "./services/alert.service";
import { ApiCentralService } from "./services/api-central.service";
import { IaService } from "./services/ia.service";
import { OrchestratorService } from "./services/orchestrator.service";
import { TranscriptionService } from "./services/transcription.service";
import { WhatsAppService } from "./services/whatsapp.service";

function safeEqual(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function isAuthorized(
  provided: string | string[] | undefined,
  expected: string,
): boolean {
  return typeof provided === "string" && safeEqual(provided, expected);
}

interface OperatorMessage {
  to: string;
  text: string;
}

function readOperatorMessage(body: unknown): OperatorMessage | null {
  const payload = body as { to?: string; text?: string } | undefined;
  const to = String(payload?.to ?? "");
  const text = String(payload?.text ?? "").trim();

  if (!/^[0-9]{8,15}$/.test(to) || text.length === 0 || text.length > 4000) {
    return null;
  }
  return { to, text };
}

function registerInternalMessages(
  app: FastifyInstance,
  whatsapp: WhatsAppService,
  config: AppConfig,
): void {
  app.post("/internal/messages", async (request, reply) => {
    const provided = request.headers["x-internal-token"];
    if (!isAuthorized(provided, config.internalApiToken)) {
      return reply.code(401).send({ error: "No autorizado" });
    }

    const message = readOperatorMessage(request.body);
    if (!message) {
      return reply.code(400).send({ error: "Mensaje inválido" });
    }

    try {
      await whatsapp.sendText(message.to, message.text);
      return { ok: true };
    } catch (error) {
      request.log.error(
        { err: error, to: message.to },
        "error enviando mensaje del operador",
      );
      return reply.code(502).send({ error: "No se pudo enviar el mensaje" });
    }
  });
}

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel } });

  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body, done) => {
      request.rawBody = body as Buffer;
      try {
        done(null, JSON.parse((body as Buffer).toString("utf8")));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  const api = new ApiCentralService(config);
  const ia = new IaService(config);
  const whatsapp = new WhatsAppService(config, app.log);
  const alert = new AlertService(config, api, whatsapp, app.log);
  const transcription = new TranscriptionService(config, whatsapp, app.log);
  const orchestrator = new OrchestratorService(
    api,
    ia,
    whatsapp,
    alert,
    transcription,
    app.log,
  );

  app.log.info(
    {
      enabled: transcription.enabled,
      provider: transcription.provider,
      externalModel: config.transcriptionModel,
      hasApiKey: config.transcriptionApiKey.length > 0,
      whisperBin: config.whisperBin,
      whisperModel: config.whisperModel,
    },
    transcription.enabled
      ? "transcripción de audios activa"
      : "transcripción de audios deshabilitada",
  );
  const dedupe = new MessageDeduplicator();

  app.get("/health", async () => ({
    ok: true,
    service: "whatsapp-bot",
    mode: isWhatsAppMock(config) ? "mock" : "live",
  }));

  registerInternalMessages(app, whatsapp, config);

  await app.register(webhookRoutes, { config, orchestrator, dedupe });
  return app;
}
