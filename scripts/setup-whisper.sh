#!/usr/bin/env bash
# Instala whisper.cpp y descarga el modelo base (~142 MB) para transcribir audios.
set -euo pipefail

DEST="${WHISPER_HOME:-$HOME/.local/share/whisper.cpp}"
MODEL="${WHISPER_MODEL_NAME:-base}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "Falta ffmpeg. Instalalo antes de continuar." >&2
  exit 1
fi

if [ ! -d "$DEST" ]; then
  git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git "$DEST"
fi

cd "$DEST"
cmake -B build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_EXAMPLES=ON
cmake --build build -j"$(nproc)" --config Release
bash models/download-ggml-model.sh "$MODEL"

echo
echo "Listo."
echo "Binario: $DEST/build/bin/whisper-cli"
echo "Modelo:  $DEST/models/ggml-$MODEL.bin"
