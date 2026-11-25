import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isWhatsAppMock, loadConfig } from "./config";

const MANAGED = [
  "PORT",
  "NODE_ENV",
  "API_CENTRAL_URL",
  "TRANSCRIPTION_MODE",
  "WHATSAPP_ALERT_DRY_RUN",
  "WHATSAPP_ALERT_PHONE",
  "WHISPER_ENABLED",
  "TRANSCRIPTION_API_KEY",
  "GROQ_API_KEY",
  "OPENAI_API_KEY",
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of MANAGED) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of MANAGED) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
});

describe("loadConfig", () => {
  it("usa valores por defecto sin entorno", () => {
    const config = loadConfig();
    expect(config.port).toBe(3003);
    expect(config.apiCentralUrl).toBe("http://localhost:3001");
    expect(config.transcriptionMode).toBe("external");
    expect(config.alertDryRun).toBe(false);
  });

  it("lee y normaliza variables de entorno", () => {
    process.env.PORT = "4000";
    process.env.API_CENTRAL_URL = "http://api:3001/";
    process.env.TRANSCRIPTION_MODE = "local";
    process.env.WHATSAPP_ALERT_DRY_RUN = "true";

    const config = loadConfig();
    expect(config.port).toBe(4000);
    expect(config.apiCentralUrl).toBe("http://api:3001");
    expect(config.transcriptionMode).toBe("local");
    expect(config.alertDryRun).toBe(true);
  });

  it("detecta modo producción y mock de WhatsApp", () => {
    process.env.NODE_ENV = "production";
    const config = loadConfig();
    expect(config.isProduction).toBe(true);
    expect(isWhatsAppMock(config)).toBe(true);
  });

  it("toma la primera API key definida", () => {
    process.env.TRANSCRIPTION_API_KEY = "";
    process.env.GROQ_API_KEY = "gsk-test";
    expect(loadConfig().transcriptionApiKey).toBe("");
  });

  it("permite deshabilitar la transcripción", () => {
    process.env.WHISPER_ENABLED = "false";
    expect(loadConfig().transcriptionEnabled).toBe(false);
  });
});
