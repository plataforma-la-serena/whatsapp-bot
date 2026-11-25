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

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 3003),
    logLevel: process.env.LOG_LEVEL ?? "info",
    isProduction: process.env.NODE_ENV === "production",
    apiCentralUrl: (process.env.API_CENTRAL_URL ?? "http://localhost:3001").replace(
      /\/$/,
      "",
    ),
    internalApiToken: process.env.INTERNAL_API_TOKEN ?? "",
    iaUrl: (process.env.IA_URL ?? "http://localhost:3002").replace(/\/$/, ""),
    iaTimeoutMs: Number(process.env.IA_TIMEOUT_MS ?? 20000),
    whatsappToken: process.env.WHATSAPP_TOKEN ?? "",
    whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    whatsappAppSecret: process.env.WHATSAPP_APP_SECRET ?? "",
    whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "",
    whatsappApiVersion: process.env.WHATSAPP_API_VERSION ?? "v21.0",
    catalogUrl: process.env.CATALOG_URL ?? "http://localhost:3000",
    alertPhone: process.env.WHATSAPP_ALERT_PHONE ?? "5492613368554",
    alertTemplateName: process.env.WHATSAPP_ALERT_TEMPLATE ?? "",
    alertTemplateLang: process.env.WHATSAPP_ALERT_TEMPLATE_LANG ?? "es",
    alertDryRun: process.env.WHATSAPP_ALERT_DRY_RUN === "true",
    transcriptionEnabled: process.env.WHISPER_ENABLED !== "false",
    transcriptionMode:
      process.env.TRANSCRIPTION_MODE === "local" ? "local" : "external",
    transcriptionApiUrl:
      process.env.TRANSCRIPTION_API_URL ??
      "https://api.groq.com/openai/v1/audio/transcriptions",
    transcriptionApiKey:
      process.env.TRANSCRIPTION_API_KEY ??
      process.env.GROQ_API_KEY ??
      process.env.OPENAI_API_KEY ??
      "",
    transcriptionModel:
      process.env.TRANSCRIPTION_MODEL ?? "whisper-large-v3-turbo",
    transcriptionLanguage:
      process.env.TRANSCRIPTION_LANGUAGE ??
      process.env.WHISPER_LANGUAGE ??
      "es",
    whisperBin:
      process.env.WHISPER_BIN ??
      `${homedir()}/.local/share/whisper.cpp/build/bin/whisper-cli`,
    whisperModel:
      process.env.WHISPER_MODEL ??
      `${homedir()}/.local/share/whisper.cpp/models/ggml-base.bin`,
    whisperLanguage: process.env.WHISPER_LANGUAGE ?? "es",
    whisperThreads: Number(process.env.WHISPER_THREADS ?? 4),
    ffmpegBin: process.env.FFMPEG_BIN ?? "ffmpeg",
    maxAudioBytes: Number(process.env.MAX_AUDIO_BYTES ?? 25 * 1024 * 1024),
  };
}

export function isWhatsAppMock(config: AppConfig): boolean {
  return !config.whatsappToken || !config.whatsappPhoneNumberId;
}
