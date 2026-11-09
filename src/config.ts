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
  };
}

export function isWhatsAppMock(config: AppConfig): boolean {
  return !config.whatsappToken || !config.whatsappPhoneNumberId;
}
