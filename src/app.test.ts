import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { loadConfig } from "./config";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    ...loadConfig(),
    logLevel: "silent",
    whatsappToken: "",
    whatsappPhoneNumberId: "",
    whatsappAppSecret: "",
    whatsappVerifyToken: "verify-test",
    internalApiToken: "token-test",
  });
});

afterAll(async () => {
  await app.close();
});

describe("app", () => {
  it("responde health en modo mock", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, mode: "mock" });
  });

  it("devuelve 400 con JSON malformado (no 500)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhook",
      headers: { "content-type": "application/json" },
      payload: "no-es-json",
    });

    expect(res.statusCode).toBe(400);
  });

  it("rechaza el challenge con token incorrecto", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/webhook?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=abc",
    });

    expect(res.statusCode).toBe(403);
  });

  it("protege /internal/messages con el token de servicio", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/messages",
      payload: { to: "5492615555555", text: "hola" },
    });

    expect(res.statusCode).toBe(401);
  });
});
