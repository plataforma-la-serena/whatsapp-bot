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
 * Transcribe notas de voz de WhatsApp con whisper.cpp.
 *
 * El audio se descarga de Meta, se convierte a WAV mono 16 kHz con ffmpeg y se
 * pasa al binario de whisper.cpp. Las transcripciones se procesan de a una para
 * no saturar la CPU.
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
      existsSync(this.config.whisperBin) &&
      existsSync(this.config.whisperModel)
    );
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
      const { buffer } = await this.whatsapp.downloadMedia(mediaId);
      return await this.transcribeBuffer(buffer);
    } catch (error) {
      this.logger.error({ err: error, mediaId }, "error transcribiendo audio");
      return null;
    }
  }

  async transcribeBuffer(buffer: Buffer): Promise<string | null> {
    if (!this.enabled) {
      this.logger.warn(
        {
          bin: this.config.whisperBin,
          model: this.config.whisperModel,
        },
        "transcripción deshabilitada: falta el binario o el modelo",
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

      const text = cleanTranscript(stdout);

      if (!text) {
        this.logger.info("audio sin voz detectable");
        return null;
      }

      this.logger.info({ characters: text.length }, "audio transcrito");
      return text;
    } catch (error) {
      this.logger.error({ err: error }, "error transcribiendo audio");
      return null;
    } finally {
      if (directory) {
        await rm(directory, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
    }
  }
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
