import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../config";
import type { WhatsAppService } from "./whatsapp.service";

const execFileAsync = promisify(execFile);

/**
 * Transcribe notas de voz de WhatsApp.
 *
 * Modo preferido: API externa compatible con OpenAI
 * (`/audio/transcriptions`), por ejemplo Groq o OpenAI.
 * Respaldo: whisper.cpp local, si está instalado.
 */
export class TranscriptionService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly config: AppConfig,
    private readonly whatsapp: WhatsAppService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  get enabled(): boolean {
    return (
      this.config.transcriptionEnabled &&
      (this.hasExternal() || this.hasLocal())
    );
  }

  get provider(): "external" | "local" | "none" {
    if (this.hasExternal()) {
      return "external";
    }
    if (this.hasLocal()) {
      return "local";
    }
    return "none";
  }

  transcribe(mediaId: string): Promise<string | null> {
    const task = this.queue.then(
      () => this.run(mediaId),
      () => this.run(mediaId),
    );
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async run(mediaId: string): Promise<string | null> {
    try {
      const { buffer, mimeType } = await this.whatsapp.downloadMedia(mediaId);
      return await this.transcribeBuffer(buffer, mimeType);
    } catch (error) {
      this.logger.error({ err: error, mediaId }, "error transcribiendo audio");
      return null;
    }
  }

  async transcribeBuffer(
    buffer: Buffer,
    mimeType = "audio/ogg",
  ): Promise<string | null> {
    if (!this.enabled) {
      this.logger.warn(
        {
          mode: this.config.transcriptionMode,
          external: this.hasExternal(),
          local: this.hasLocal(),
        },
        "transcripción deshabilitada: falta la API key o el whisper local",
      );
      return null;
    }

    if (buffer.byteLength > this.config.maxAudioBytes) {
      this.logger.warn(
        { bytes: buffer.byteLength },
        "audio demasiado grande para transcribir",
      );
      return null;
    }

    if (this.hasExternal()) {
      try {
        const text = await this.transcribeExternal(buffer, mimeType);
        if (text) {
          return text;
        }
      } catch (error) {
        this.logger.warn(
          { err: error },
          "falló la transcripción externa; se intenta con whisper local",
        );
      }

      if (!this.hasLocal()) {
        return null;
      }
    }

    return this.transcribeLocal(buffer);
  }

  private async transcribeExternal(
    buffer: Buffer,
    mimeType: string,
  ): Promise<string | null> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: mimeType }),
      `audio.${extensionFor(mimeType)}`,
    );
    form.append("model", this.config.transcriptionModel);
    form.append("language", this.config.transcriptionLanguage);
    form.append("response_format", "json");

    const response = await fetch(this.config.transcriptionApiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.transcriptionApiKey}`,
      },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `STT respondió ${response.status}: ${detail.slice(0, 200)}`,
      );
    }

    const raw = await response.text();
    let text = raw;

    try {
      const payload = JSON.parse(raw) as { text?: string };
      if (typeof payload.text === "string") {
        text = payload.text;
      }
    } catch {
      // Algunos proveedores devuelven texto plano.
    }

    const cleaned = correctTranscript(cleanTranscript(text));

    if (!cleaned) {
      this.logger.info("audio sin voz detectable (externo)");
      return null;
    }

    this.logger.info(
      {
        provider: "external",
        model: this.config.transcriptionModel,
        characters: cleaned.length,
      },
      "audio transcrito",
    );
    return cleaned;
  }

  private async transcribeLocal(buffer: Buffer): Promise<string | null> {
    if (!this.hasLocal()) {
      return null;
    }

    let directory: string | null = null;

    try {
      directory = await mkdtemp(join(tmpdir(), "laserena-audio-"));
      const source = join(directory, "audio.ogg");
      const wav = join(directory, "audio.wav");

      await writeFile(source, buffer);
      await execFileAsync(
        this.config.ffmpegBin,
        [
          "-y",
          "-i",
          source,
          "-ar",
          "16000",
          "-ac",
          "1",
          "-f",
          "wav",
          wav,
        ],
        { timeout: 60_000, maxBuffer: 1024 * 1024 },
      );

      const { stdout } = await execFileAsync(
        this.config.whisperBin,
        [
          "-m",
          this.config.whisperModel,
          "-f",
          wav,
          "-l",
          this.config.whisperLanguage,
          "-nt",
          "-t",
          String(this.config.whisperThreads),
        ],
        { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
      );

      const text = correctTranscript(cleanTranscript(stdout));

      if (!text) {
        this.logger.info("audio sin voz detectable (local)");
        return null;
      }

      this.logger.info(
        { provider: "local", characters: text.length },
        "audio transcrito",
      );
      return text;
    } catch (error) {
      this.logger.error({ err: error }, "error transcribiendo audio local");
      return null;
    } finally {
      if (directory) {
        await rm(directory, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
    }
  }

  private hasExternal(): boolean {
    return (
      this.config.transcriptionMode === "external" &&
      this.config.transcriptionApiKey.length > 0
    );
  }

  private hasLocal(): boolean {
    return (
      existsSync(this.config.whisperBin) &&
      existsSync(this.config.whisperModel)
    );
  }
}

const AUDIO_EXTENSIONS: Array<[string, string]> = [
  ["ogg", "ogg"],
  ["mpeg", "mp3"],
  ["mp3", "mp3"],
  ["mp4", "m4a"],
  ["m4a", "m4a"],
  ["wav", "wav"],
  ["webm", "webm"],
  ["amr", "amr"],
];

function extensionFor(mimeType: string): string {
  const mime = mimeType.toLowerCase();
  return AUDIO_EXTENSIONS.find(([needle]) => mime.includes(needle))?.[1] ?? "ogg";
}

const TRANSCRIPT_CORRECTIONS: Array<[RegExp, string]> = [
  [/\basionamiento\b/gi, "estacionamiento"],
  [/\bestasionamiento\b/gi, "estacionamiento"],
  [/\bde posito\b/gi, "depósito"],
  [/\bdeposito\b/gi, "depósito"],
  [/\bqui[eé]n es cocina\b/gi, "tiene cocina"],
  [/\bqui[eé]n es balc[oó]n\b/gi, "tiene balcón"],
  [/\besta (estacionamiento|ascensor|pileta|cocina|balc[oó]n|wifi)\b/gi, "$1"],
  [/\bmechamos\b/gi, "me llamo"],
  [/\bcarlo magno piso 1\b/gi, "Carlo Magno Piso 1"],
  [/\breinos francos\b/gi, "Reinos Francos"],
];

function correctTranscript(text: string): string {
  return TRANSCRIPT_CORRECTIONS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
}

function cleanTranscript(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !/^\[.*\]$/.test(line) &&
        !/^\(.*\)$/.test(line),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
