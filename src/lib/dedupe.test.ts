import { describe, expect, it } from "vitest";
import { MessageDeduplicator } from "./dedupe";

describe("MessageDeduplicator", () => {
  it("acepta un id la primera vez y lo rechaza después", () => {
    const dedupe = new MessageDeduplicator();
    expect(dedupe.firstTime("wamid.1")).toBe(true);
    expect(dedupe.firstTime("wamid.1")).toBe(false);
  });

  it("trata ids distintos como mensajes distintos", () => {
    const dedupe = new MessageDeduplicator();
    expect(dedupe.firstTime("wamid.1")).toBe(true);
    expect(dedupe.firstTime("wamid.2")).toBe(true);
  });
});
