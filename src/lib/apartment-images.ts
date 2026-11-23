import type { ImageSource } from "../services/whatsapp.service";

export interface ApartmentImage {
  source: ImageSource;
  reference: boolean;
}

export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function imagesForApartment(
  images: string[],
  coverIndex: number,
): ApartmentImage[] {
  if (images.length === 0) {
    return [];
  }

  const cover = images[coverIndex] ?? images[0];
  const rest = images.filter((image) => image !== cover);

  return [cover, ...rest].slice(0, 2).map((link) => ({
    source: { link },
    reference: false,
  }));
}
