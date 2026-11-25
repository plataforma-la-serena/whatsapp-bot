import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApartmentContext } from "../types";
import type { AlertService } from "./alert.service";
import type { ApiCentralService } from "./api-central.service";
import type { IaService } from "./ia.service";
import type { TranscriptionService } from "./transcription.service";
import type { WhatsAppService } from "./whatsapp.service";
import { OrchestratorService } from "./orchestrator.service";

const PHONE = "5492615555555";
const ALERT_PHONE = "5492614703862";

function apartment(id: string, title: string): ApartmentContext {
  return {
    id,
    title,
    description: "Depto",
    pricePerNight: 60000,
    capacity: 4,
    features: ["Wi-Fi"],
    images: ["/media/a", "/media/b"],
    coverIndex: 0,
  };
}

describe("OrchestratorService", () => {
  let api: {
    session: ReturnType<typeof vi.fn>;
    appendMessage: ReturnType<typeof vi.fn>;
    context: ReturnType<typeof vi.fn>;
    setLead: ReturnType<typeof vi.fn>;
    setBotActive: ReturnType<typeof vi.fn>;
  };
  let ia: { reply: ReturnType<typeof vi.fn> };
  let whatsapp: {
    sendText: ReturnType<typeof vi.fn>;
    sendImage: ReturnType<typeof vi.fn>;
  };
  let alert: { notify: ReturnType<typeof vi.fn>; alertPhone: string };
  let transcription: { transcribe: ReturnType<typeof vi.fn> };
  let logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let service: OrchestratorService;

  beforeEach(() => {
    api = {
      session: vi.fn().mockResolvedValue({
        session: {
          id: "s1",
          phoneNumber: PHONE,
          customerName: null,
          wantsHuman: false,
          wantsReservation: false,
          botActive: true,
        },
        messages: [],
      }),
      appendMessage: vi.fn().mockResolvedValue(undefined),
      context: vi.fn().mockResolvedValue([]),
      setLead: vi.fn().mockResolvedValue(undefined),
      setBotActive: vi.fn().mockResolvedValue(undefined),
    };
    ia = {
      reply: vi.fn().mockResolvedValue({
        reply: "Respuesta del asistente",
        intent: "question",
        handoff: false,
        model: "mock",
        apartmentIds: [],
        customerName: null,
        wantsReservation: false,
        wantsHuman: false,
      }),
    };
    whatsapp = {
      sendText: vi.fn().mockResolvedValue(undefined),
      sendImage: vi.fn().mockResolvedValue(undefined),
    };
    alert = { notify: vi.fn().mockResolvedValue(undefined), alertPhone: ALERT_PHONE };
    transcription = { transcribe: vi.fn() };
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    service = new OrchestratorService(
      api as unknown as ApiCentralService,
      ia as unknown as IaService,
      whatsapp as unknown as WhatsAppService,
      alert as unknown as AlertService,
      transcription as unknown as TranscriptionService,
      logger as never,
    );
  });

  it("guarda el mensaje del usuario y responde", async () => {
    await service.handleMessage(PHONE, "hola");

    expect(api.appendMessage).toHaveBeenNthCalledWith(1, PHONE, "USER", "hola");
    expect(ia.reply).toHaveBeenCalled();
    expect(api.appendMessage).toHaveBeenNthCalledWith(
      2,
      PHONE,
      "ASSISTANT",
      "Respuesta del asistente",
    );
    expect(whatsapp.sendText).toHaveBeenCalledWith(
      PHONE,
      "Respuesta del asistente",
    );
  });

  it("abre la ventana de 24 h con el comando de avisos", async () => {
    await service.handleMessage(ALERT_PHONE, "abrir avisos");

    expect(whatsapp.sendText).toHaveBeenCalledWith(
      ALERT_PHONE,
      expect.stringContaining("Canal de avisos abierto"),
    );
    expect(ia.reply).not.toHaveBeenCalled();
  });

  it("no responde si el bot está pausado", async () => {
    api.session.mockResolvedValue({
      session: { botActive: false, wantsHuman: false, wantsReservation: false },
      messages: [],
    });

    await service.handleMessage(PHONE, "hola");

    expect(ia.reply).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
  });

  it("pausa el bot y avisa al equipo ante un pedido de humano", async () => {
    ia.reply.mockResolvedValue({
      reply: "Te paso con el equipo",
      intent: "question",
      handoff: false,
      model: "mock",
      apartmentIds: [],
      customerName: "Ana",
      wantsReservation: false,
      wantsHuman: true,
    });

    await service.handleMessage(PHONE, "quiero hablar con alguien");

    expect(api.setBotActive).toHaveBeenCalledWith(PHONE, false);
    expect(alert.notify).toHaveBeenCalledWith({
      phone: PHONE,
      name: "Ana",
      kind: "human",
    });
  });

  it("avisa al equipo cuando aparece el interés de reserva", async () => {
    ia.reply.mockResolvedValue({
      reply: "Perfecto",
      intent: "reservation",
      handoff: true,
      model: "mock",
      apartmentIds: [],
      customerName: "Ana",
      wantsReservation: true,
      wantsHuman: false,
    });

    await service.handleMessage(PHONE, "quiero reservar");

    expect(alert.notify).toHaveBeenCalledWith({
      phone: PHONE,
      name: "Ana",
      kind: "reservation",
    });
    expect(api.setLead).toHaveBeenCalled();
  });

  it("envía fotos cuando la respuesta menciona departamentos y piden fotos", async () => {
    api.context.mockResolvedValue([apartment("a1", "Carlo Magno")]);
    ia.reply.mockResolvedValue({
      reply: "Te muestro Carlo Magno",
      intent: "question",
      handoff: false,
      model: "mock",
      apartmentIds: ["a1"],
      customerName: null,
      wantsReservation: false,
      wantsHuman: false,
    });

    await service.handleMessage(PHONE, "mostrame fotos de Carlo Magno");

    expect(whatsapp.sendImage).toHaveBeenCalled();
  });

  it("pide escribir el audio si no se pudo transcribir", async () => {
    transcription.transcribe.mockResolvedValue(null);

    await service.handleAudio(PHONE, "media-1");

    expect(api.appendMessage).toHaveBeenCalledWith(
      PHONE,
      "USER",
      "[Audio no transcrito]",
    );
    expect(whatsapp.sendText).toHaveBeenCalledWith(
      PHONE,
      "No pude escuchar el audio. ¿Me lo podés escribir?",
    );
  });

  it("responde un audio transcrito", async () => {
    transcription.transcribe.mockResolvedValue("quiero reservar");

    await service.handleAudio(PHONE, "media-1");

    expect(ia.reply).toHaveBeenCalledWith(
      expect.objectContaining({ message: "quiero reservar", source: "audio" }),
    );
  });
});
