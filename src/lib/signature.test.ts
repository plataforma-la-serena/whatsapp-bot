import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySignature } from "./signature";

// Clave efímera por corrida: nunca hay un secreto literal en el repo.
const hmacKey = randomBytes(16).toString("hex");
const body = Buffer.from(JSON.stringify({ hello: "world" }));

function sign(payload: Buffer, key = hmacKey): string {
  return `sha256=${createHmac("sha256", key).update(payload).digest("hex")}`;
}

describe("verifySignature", () => {
  it("acepta una firma válida", () => {
    expect(verifySignature(body, sign(body), hmacKey)).toBe(true);
  });

  it("rechaza una firma con otro secreto", () => {
    expect(verifySignature(body, sign(body, "otra-clave"), hmacKey)).toBe(false);
  });

  it("rechaza un cuerpo alterado", () => {
    const signature = sign(body);
    const tampered = Buffer.from(JSON.stringify({ hello: "evil" }));
    expect(verifySignature(tampered, signature, hmacKey)).toBe(false);
  });

  it("rechaza firmas sin el prefijo sha256=", () => {
    const raw = sign(body).replace("sha256=", "");
    expect(verifySignature(body, raw, hmacKey)).toBe(false);
    expect(verifySignature(body, undefined, hmacKey)).toBe(false);
  });

  it("rechaza una firma con longitud inválida", () => {
    expect(verifySignature(body, "sha256=abcd", hmacKey)).toBe(false);
  });
});
