#!/usr/bin/env node
/**
 * Simulador de audios de WhatsApp.
 *
 * Genera (con scripts/audio/generate.py) notas de voz OGG/Opus, las transcribe
 * con el mismo TranscriptionService del bot y manda la transcripción a la IA.
 * NO envía nada a WhatsApp.
 *
 * Uso local:
 *   cd whatsapp-bot
 *   AUDIO_DIR=scripts/audio node scripts/audio-simulator.mjs
 *
 * Uso dentro del contenedor:
 *   AUDIO_DIR=/tmp/audio-test API_URL=http://api-central:3001 \
 *   IA_URL=http://servicio-ia:3002 node /tmp/audio-test/audio-simulator.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BOT_ROOT = resolve(process.env.BOT_ROOT ?? process.cwd());
const AUDIO_DIR = resolve(process.env.AUDIO_DIR ?? join(BOT_ROOT, "scripts/audio"));
const API_URL = process.env.API_URL ?? "http://localhost:3101";
const IA_URL = process.env.IA_URL ?? "http://localhost:3102";
const REPORT = process.env.AUDIO_REPORT ?? "/tmp/opencode/audio-simulation.json";

function loadEnvFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1)];
        }),
    );
  } catch {
    return {};
  }
}

const localEnv = loadEnvFile(resolve(BOT_ROOT, "..", "api-central/.env"));
const INTERNAL_TOKEN =
  process.env.INTERNAL_API_TOKEN ?? localEnv.INTERNAL_API_TOKEN ?? "";

const { loadConfig } = await import(
  pathToFileURL(join(BOT_ROOT, "dist/config.js")).href
);
const { TranscriptionService } = await import(
  pathToFileURL(join(BOT_ROOT, "dist/services/transcription.service.js")).href
);
const normalize = (text) =>
  String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const logger = {
  info: () => {},
  warn: (...args) => console.log("warn:", ...args),
  error: (...args) => console.log("error:", ...args),
};

const config = loadConfig();
const transcription = new TranscriptionService(config, {}, logger);

const manifest = JSON.parse(
  readFileSync(join(AUDIO_DIR, "manifest.json"), "utf8"),
);

function words(text) {
  return normalize(text)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
}

function wer(reference, hypothesis) {
  const ref = words(reference);
  const hyp = words(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return levenshtein(ref, hyp) / ref.length;
}

function includesAll(reply, needles) {
  const text = normalize(reply);
  return needles.every((needle) => text.includes(normalize(needle)));
}

function includesAny(reply, needles) {
  const text = normalize(reply);
  return needles.some((needle) => text.includes(normalize(needle)));
}

function evaluate(turn, transcript, reply, data, check) {
  const flags = [];
  const text = normalize(reply ?? "");
  const transcriptText = normalize(transcript ?? "");

  const transcriptWer = wer(turn.text, transcript ?? "");
  if (transcriptWer > 0.35) {
    flags.push(`transcription_wer:${transcriptWer.toFixed(2)}`);
  }
  if (
    check.transcriptIncludes &&
    !includesAll(transcriptText, check.transcriptIncludes)
  ) {
    flags.push("transcript_missing_entity");
  }
  if (
    check.transcriptIncludesAny &&
    !includesAny(transcriptText, check.transcriptIncludesAny)
  ) {
    flags.push("transcript_missing_entity");
  }

  if (reply == null || reply.trim().length === 0) {
    flags.push("empty_reply");
  }

  if (check.replyIncludes && !includesAll(reply, check.replyIncludes)) {
    flags.push("reply_missing");
  }
  if (
    check.replyIncludesAll &&
    !includesAll(reply, check.replyIncludesAll)
  ) {
    flags.push("reply_missing");
  }
  if (
    check.replyIncludesAny &&
    !includesAny(reply, check.replyIncludesAny)
  ) {
    flags.push("reply_missing");
  }
  if (check.replyExcludes && includesAny(reply, check.replyExcludes)) {
    flags.push("reply_forbidden");
  }

  if (
    check.wantsReservation !== undefined &&
    Boolean(data?.wantsReservation) !== check.wantsReservation
  ) {
    flags.push("wantsReservation_mismatch");
  }
  if (check.wantsHuman !== undefined && Boolean(data?.wantsHuman) !== check.wantsHuman) {
    flags.push("wantsHuman_mismatch");
  }
  if (check.handoff !== undefined && Boolean(data?.handoff) !== check.handoff) {
    flags.push("handoff_mismatch");
  }
  if (
    check.customerName !== undefined &&
    normalize(String(data?.customerName ?? "")) !== normalize(check.customerName)
  ) {
    flags.push("customerName_mismatch");
  }

  if (check.noCityPitch) {
    if (/https?:\/\//.test(reply ?? "")) {
      flags.push("city_url");
    }
    if (/(departamento|depto|carlo magno|reserva|precio)/.test(text)) {
      flags.push("city_pitch");
    }
  }

  const catalogMentions = (String(reply ?? "").match(/cat[aá]logo/gi) ?? []).length;
  const links = (String(reply ?? "").match(/https?:\/\//g) ?? []).length;
  if (
    check.maxCatalogMentions !== undefined &&
    catalogMentions > check.maxCatalogMentions
  ) {
    flags.push(`catalog_mentions:${catalogMentions}`);
  }
  if (check.maxLinks !== undefined && links > check.maxLinks) {
    flags.push(`links:${links}`);
  }

  const emojis = (String(reply ?? "").match(/\p{Extended_Pictographic}/gu) ?? []).length;
  if (emojis > 2) {
    flags.push(`too_many_emojis:${emojis}`);
  }
  if (/\busted\b|\bestimad[oa]\b/.test(text)) {
    flags.push("tone_usted");
  }

  return { flags, transcriptWer };
}

async function transcribe(file) {
  const buffer = readFileSync(file);
  return transcription.transcribeBuffer(buffer, "audio/ogg; codecs=opus");
}

async function callIa(message, history, phone, apartments, source) {
  const response = await fetch(`${IA_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, phone, history, apartments, source }),
  });
  if (!response.ok) {
    throw new Error(`IA respondió ${response.status}`);
  }
  return response.json();
}

async function main() {
  if (!transcription.enabled) {
    console.error(
      "Transcripción deshabilitada: revisá WHISPER_BIN/WHISPER_MODEL o la API externa.",
    );
    process.exit(1);
  }

  const contextResponse = await fetch(`${API_URL}/internal/context`, {
    headers: { "x-service-token": INTERNAL_TOKEN },
  });
  const apartments = await contextResponse.json();
  console.log(
    `Contexto: ${apartments.length} departamento(s) | audios: ${AUDIO_DIR}`,
  );

  const results = [];
  let turnCount = 0;
  let werSum = 0;
  let failures = 0;

  const only = process.env.CASE?.split(",").map((item) => item.trim()).filter(Boolean);

  for (const [caseIndex, testCase] of manifest.cases.entries()) {
    if (only && !only.includes(testCase.id)) {
      continue;
    }
    const phone = `54900009${String(caseIndex).padStart(3, "0")}`;
    const history = [];
    const checks = Array.isArray(testCase.checks)
      ? testCase.checks
      : [testCase.checks];

    for (const [turnIndex, turn] of testCase.turns.entries()) {
      turnCount += 1;
      const file = join(AUDIO_DIR, "audio", `${testCase.id}-${turnIndex}.ogg`);
      let transcript = null;
      let data = null;
      let error = null;

      try {
        transcript = turn.textOnly ? turn.text : await transcribe(file);
        data = await callIa(
          transcript ?? "",
          history,
          phone,
          apartments,
          turn.textOnly ? "text" : "audio",
        );
        history.push(
          { role: "user", content: transcript ?? "" },
          { role: "assistant", content: data.reply ?? "" },
        );
      } catch (caught) {
        error = String(caught);
      }

      const check = checks[turnIndex] ?? {};
      const evaluated =
        transcript && data
          ? evaluate(turn, transcript, data.reply, data, check)
          : { flags: ["request_error"], transcriptWer: 1 };

      if (error) {
        evaluated.flags.push(`error:${error.slice(0, 80)}`);
      }

      werSum += evaluated.transcriptWer;
      if (evaluated.flags.length > 0) {
        failures += 1;
      }

      results.push({
        case: testCase.id,
        turn: turnIndex,
        text: turn.text,
        transcript,
        reply: data?.reply ?? null,
        wantsReservation: data?.wantsReservation ?? null,
        wantsHuman: data?.wantsHuman ?? null,
        handoff: data?.handoff ?? null,
        customerName: data?.customerName ?? null,
        wer: Number(evaluated.transcriptWer.toFixed(3)),
        flags: evaluated.flags,
      });

      const status = evaluated.flags.length === 0 ? "OK " : "FAIL";
      console.log(
        `${status} ${testCase.id}#${turnIndex} | WER ${evaluated.transcriptWer.toFixed(2)} | ${evaluated.flags.join(", ")}`,
      );
      if (evaluated.flags.length > 0) {
        console.log(`     > ${turn.text}`);
        console.log(`     < ${transcript ?? "(sin transcripción)"}`);
        console.log(`     bot> ${String(data?.reply ?? "").replace(/\n/g, " ").slice(0, 220)}`);
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    audios: turnCount,
    failures,
    averageWer: turnCount ? werSum / turnCount : 0,
    results,
  };
  writeFileSync(REPORT, JSON.stringify(report, null, 2));

  console.log(
    `\nAudios: ${turnCount} | Fallos: ${failures} | WER promedio: ${(report.averageWer * 100).toFixed(1)}%`,
  );
  console.log(`Reporte: ${REPORT}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
