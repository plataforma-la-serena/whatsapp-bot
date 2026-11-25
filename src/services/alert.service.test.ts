import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config";
import type { ApiCentralService } from "./api-central.service";
import type { WhatsAppService } from "./whatsapp.service";
import { AlertService } from "./alert.service";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    alertPhone: "5492614703862",
    alertTemplateName: "",
    alertTemplateLang: "es",
    alertDryRun: false,
    ...overrides,
  } as unknown as AppConfig;
}

describe("AlertService", () => {
  let api: { window: ReturnType<typeof vi.fn> };
  let whatsapp: {
    sendText: ReturnType<typeof vi.fn>;
    sendTemplate: ReturnType<typeof vi.fn>;
  };
  let logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    api = { window: vi.fn().mockResolvedValue({ open: true }) };
    whatsapp = {
      sendText: vi.fn().mockResolvedValue(undefined),
      sendTemplate: vi.fn().mockResolvedValue(undefined),
    };
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  });

  function build(config: AppConfig): AlertService {
    return new AlertService(
      config,
      api as unknown as ApiCentralService,
      whatsapp as unknown as WhatsAppService,
      logger as never,
    );
  }

  it("no envía nada en dry run", async () => {
    await build(makeConfig({ alertDryRun: true })).notify({
      phone: "5492615555555",
      name: "Ana",
      kind: "human",
    });

    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
  });

  it("envía texto libre si la ventana de 24 h está abierta", async () => {
    await build(makeConfig()).notify({
      phone: "5492615555555",
      name: "Ana",
      kind: "reservation",
    });

    expect(whatsapp.sendText).toHaveBeenCalledWith(
      "5492614703862",
      expect.stringContaining("5492615555555"),
    );
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it("usa la plantilla si la ventana está cerrada", async () => {
    api.window.mockResolvedValue({ open: false });
    await build(makeConfig({ alertTemplateName: "aviso_equipo_5" })).notify({
      phone: "5492615555555",
      kind: "human",
    });

    expect(whatsapp.sendTemplate).toHaveBeenCalledWith(
      "5492614703862",
      "aviso_equipo_5",
      "es",
      ["5492615555555", "quiere hablar con una persona real"],
    );
  });

  it("registra error si no hay plantilla configurada", async () => {
    api.window.mockResolvedValue({ open: false });
    await build(makeConfig()).notify({ phone: "5492615555555", kind: "human" });

    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("intenta texto directo si no puede verificar la ventana", async () => {
    api.window.mockRejectedValue(new Error("api caída"));
    await build(makeConfig()).notify({ phone: "5492615555555", kind: "human" });

    expect(whatsapp.sendText).toHaveBeenCalled();
  });

  it("cae a la plantilla si el texto directo falla", async () => {
    whatsapp.sendText.mockRejectedValue(new Error("rechazado"));
    await build(makeConfig({ alertTemplateName: "aviso_equipo_5" })).notify({
      phone: "5492615555555",
      kind: "human",
    });

    expect(whatsapp.sendTemplate).toHaveBeenCalled();
  });
});
