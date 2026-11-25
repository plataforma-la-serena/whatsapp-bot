import { homedir } from "node:os";

export interface AppConfig {
  port: number;
  logLevel: string;
  isProduction: boolean;
  apiCentralUrl: string;
  internalApiToken: string;
  iaUrl: string;
  iaTimeoutMs: number;
  whatsappToken: string;
  whatsappPhoneNumberId: string;
  whatsappAppSecret: string;
  whatsappVerifyToken: string;
  whatsappApiVersion: string;
  catalogUrl: string;
  alertPhone: string;
  alertTemplateName: string;
  alertTemplateLang: string;
  alertDryRun: boolean;
  transcriptionEnabled: boolean;
  transcriptionMode: "external" | "local";
  transcriptionApiUrl: string;
  transcriptionApiKey: string;
  transcriptionModel: string;
  transcriptionLanguage: string;
  whisperBin: string;
  whisperModel: string;
  whisperLanguage: string;
  whisperThreads: number;
  ffmpegBin: string;
  maxAudioBytes: number;
}

function text(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function url(name: string, fallback: string): string {
  return text(name, fallback).replace(/\/$/, "");
}

function num(name: string, fallback: number): number {
  return Number(process.env[name] ?? fallback);
}

function is(name: string, expected: string): boolean {
  return process.env[name] === expected;
}

function firstDefined(names: string[], fallback: string): string {
  for (const name of names) {
    const value = process.env[name];
    // Una variable definida pero vacía equivale a no configurada.
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  return fallback;
}

export function loadConfig(): AppConfig {
  return {
    port: num("PORT", 3003),
    logLevel: text("LOG_LEVEL", "info"),
    isProduction: is("NODE_ENV", "production"),
    apiCentralUrl: url("API_CENTRAL_URL", "http://localhost:3001"),
    internalApiToken: text("INTERNAL_API_TOKEN"),
    iaUrl: url("IA_URL", "http://localhost:3002"),
    iaTimeoutMs: num("IA_TIMEOUT_MS", 20000),
    whatsappToken: text("WHATSAPP_TOKEN"),
    whatsappPhoneNumberId: text("WHATSAPP_PHONE_NUMBER_ID"),
    whatsappAppSecret: text("WHATSAPP_APP_SECRET"),
    whatsappVerifyToken: text("WHATSAPP_VERIFY_TOKEN"),
    whatsappApiVersion: text("WHATSAPP_API_VERSION", "v21.0"),
    catalogUrl: text("CATALOG_URL", "http://localhost:3000"),
    alertPhone: text("WHATSAPP_ALERT_PHONE", "5492613368554"),
    alertTemplateName: text("WHATSAPP_ALERT_TEMPLATE"),
    alertTemplateLang: text("WHATSAPP_ALERT_TEMPLATE_LANG", "es"),
    alertDryRun: is("WHATSAPP_ALERT_DRY_RUN", "true"),
    transcriptionEnabled: process.env.WHISPER_ENABLED !== "false",
    transcriptionMode:
      process.env.TRANSCRIPTION_MODE === "local" ? "local" : "external",
    transcriptionApiUrl: text(
      "TRANSCRIPTION_API_URL",
      "https://api.groq.com/openai/v1/audio/transcriptions",
    ),
    transcriptionApiKey: firstDefined(
      ["TRANSCRIPTION_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY"],
      "",
    ),
    transcriptionModel: text(
      "TRANSCRIPTION_MODEL",
      "whisper-large-v3-turbo",
    ),
    transcriptionLanguage: firstDefined(
      ["TRANSCRIPTION_LANGUAGE", "WHISPER_LANGUAGE"],
      "es",
    ),
    whisperBin: text(
      "WHISPER_BIN",
      `${homedir()}/.local/share/whisper.cpp/build/bin/whisper-cli`,
    ),
    whisperModel: text(
      "WHISPER_MODEL",
      `${homedir()}/.local/share/whisper.cpp/models/ggml-base.bin`,
    ),
    whisperLanguage: text("WHISPER_LANGUAGE", "es"),
    whisperThreads: num("WHISPER_THREADS", 4),
    ffmpegBin: text("FFMPEG_BIN", "ffmpeg"),
    maxAudioBytes: num("MAX_AUDIO_BYTES", 25 * 1024 * 1024),
  };
}

export function isWhatsAppMock(config: AppConfig): boolean {
  return !config.whatsappToken || !config.whatsappPhoneNumberId;
}
