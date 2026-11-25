import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySignature } from "./signature";

const secret = "test-secret";
const body = Buffer.from(JSON.stringify({ hello: "world" }));

function sign(payload: Buffer, key = secret): string {
  return `sha256=${createHmac("sha256", key).update(payload).digest("hex")}`;
}

describe("verifySignature", () => {
  it("acepta una firma válida", () => {
    expect(verifySignature(body, sign(body), secret)).toBe(true);
  });

  it("rechaza una firma con otro secreto", () => {
    expect(verifySignature(body, sign(body, "otro"), secret)).toBe(false);
  });

  it("rechaza un cuerpo alterado", () => {
    const signature = sign(body);
    const tampered = Buffer.from(JSON.stringify({ hello: "evil" }));
    expect(verifySignature(tampered, signature, secret)).toBe(false);
  });

  it("rechaza firmas sin el prefijo sha256=", () => {
    const raw = sign(body).replace("sha256=", "");
    expect(verifySignature(body, raw, secret)).toBe(false);
    expect(verifySignature(body, undefined, secret)).toBe(false);
  });

  it("rechaza una firma con longitud inválida", () => {
    expect(verifySignature(body, "sha256=abcd", secret)).toBe(false);
  });
});
