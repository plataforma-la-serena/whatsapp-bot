import { describe, expect, it } from "vitest";
import { imagesForApartment, normalize } from "./apartment-images";

describe("normalize", () => {
  it("quita acentos y pasa a minúsculas", () => {
    expect(normalize("BALCÓN")).toBe("balcon");
  });
});

describe("imagesForApartment", () => {
  it("devuelve vacío sin fotos", () => {
    expect(imagesForApartment([], 0)).toEqual([]);
  });

  it("pone la portada primero", () => {
    const images = imagesForApartment(["/media/a", "/media/b", "/media/c"], 2);
    expect(images).toHaveLength(2);
    expect(images[0].source).toEqual({ link: "/media/c" });
    expect(images[1].source).toEqual({ link: "/media/a" });
  });

  it("usa la primera foto si el índice de portada no existe", () => {
    const images = imagesForApartment(["/media/a"], 9);
    expect(images[0].source).toEqual({ link: "/media/a" });
  });

  it("marca las fotos como no referenciales", () => {
    const images = imagesForApartment(["/media/a", "/media/b"], 0);
    expect(images.every((image) => image.reference === false)).toBe(true);
  });
});
