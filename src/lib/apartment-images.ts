import { join } from "node:path";
import type { ImageSource } from "../services/whatsapp.service";

const REFERENCE_FILES = [
  "interior-living.jpg",
  "interior-bedroom.jpg",
  "interior-kitchen.jpg",
  "interior-terrace.jpg",
];

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
  index: number,
): ApartmentImage[] {
  if (images.length > 0) {
    const cover = images[coverIndex] ?? images[0];
    const rest = images.filter((image) => image !== cover);

    return [cover, ...rest].slice(0, 2).map((link) => ({
      source: { link },
      reference: false,
    }));
  }

  const start = (index * 2) % REFERENCE_FILES.length;

  return [0, 1].map((offset) => ({
    source: {
      path: join(
        __dirname,
        "..",
        "..",
        "assets",
        "apartments",
        REFERENCE_FILES[(start + offset) % REFERENCE_FILES.length],
      ),
    },
    reference: true,
  }));
}
