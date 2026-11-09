import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { isWhatsAppMock, type AppConfig } from "./config";
import { MessageDeduplicator } from "./lib/dedupe";
import { webhookRoutes } from "./routes/webhook.route";
import { ApiCentralService } from "./services/api-central.service";
import { IaService } from "./services/ia.service";
import { OrchestratorService } from "./services/orchestrator.service";
import { WhatsAppService } from "./services/whatsapp.service";

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
  const orchestrator = new OrchestratorService(api, ia, whatsapp, app.log);
  const dedupe = new MessageDeduplicator();

  app.get("/health", async () => ({
    ok: true,
    service: "whatsapp-bot",
    mode: isWhatsAppMock(config) ? "mock" : "live",
  }));

  await app.register(webhookRoutes, { config, orchestrator, dedupe });
  return app;
}
