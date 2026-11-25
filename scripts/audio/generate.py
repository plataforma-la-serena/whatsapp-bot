#!/usr/bin/env python3
"""Genera audios de prueba (OGG/Opus) a partir de manifest.json.

Requiere edge-tts y ffmpeg. Ejemplo:
  EDGE_TTS=/tmp/opencode/ttsvenv/bin/edge-tts python3 generate.py
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
AUDIO_DIR = HERE / "audio"
AUDIO_DIR.mkdir(exist_ok=True)

edge_tts = os.environ.get(
    "EDGE_TTS",
    "/tmp/opencode/ttsvenv/bin/edge-tts"
    if Path("/tmp/opencode/ttsvenv/bin/edge-tts").exists()
    else "edge-tts",
)

if shutil.which(edge_tts) is None and not Path(edge_tts).exists():
    sys.stderr.write(f"No se encontró edge-tts ({edge_tts}). Instalalo o pasá EDGE_TTS.\n")
    sys.exit(1)

if shutil.which("ffmpeg") is None:
    sys.stderr.write("Falta ffmpeg.\n")
    sys.exit(1)

manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))

for case in manifest["cases"]:
    for index, turn in enumerate(case["turns"]):
        if turn.get("textOnly"):
            continue

        base = AUDIO_DIR / f"{case['id']}-{index}"
        mp3 = base.with_suffix(".mp3")
        ogg = base.with_suffix(".ogg")

        subprocess.run(
            [
                edge_tts,
                "--text",
                turn["text"],
                "--voice",
                turn["voice"],
                "--rate",
                turn.get("rate", "+0%"),
                "--write-media",
                str(mp3),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

        if turn.get("noise"):
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    str(mp3),
                    "-f",
                    "lavfi",
                    "-i",
                    "anoisesrc=color=pink:amplitude=0.02:d=12",
                    "-filter_complex",
                    "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2[a]",
                    "-map",
                    "[a]",
                    "-c:a",
                    "libopus",
                    "-b:a",
                    "32k",
                    "-ar",
                    "48000",
                    "-ac",
                    "1",
                    str(ogg),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    str(mp3),
                    "-c:a",
                    "libopus",
                    "-b:a",
                    "32k",
                    "-ar",
                    "48000",
                    "-ac",
                    "1",
                    str(ogg),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

        mp3.unlink(missing_ok=True)
        sys.stdout.write(f"{ogg.name}\n")

sys.stdout.write(f"\nAudios generados en {AUDIO_DIR}\n")
