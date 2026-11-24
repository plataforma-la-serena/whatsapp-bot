# Build de la aplicación
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# whisper.cpp + modelo para transcripción local
FROM node:22-bookworm-slim AS whisper
ARG WHISPER_MODEL=base
RUN apt-get update \
  && apt-get install -y --no-install-recommends git cmake make g++ ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git /opt/whisper
WORKDIR /opt/whisper
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_EXAMPLES=ON -DBUILD_SHARED_LIBS=OFF \
  && cmake --build build -j"$(nproc)" --config Release
RUN bash models/download-ggml-model.sh "${WHISPER_MODEL}"
RUN mkdir -p /opt/whisper-runtime/models \
  && cp build/bin/whisper-cli /opt/whisper-runtime/ \
  && cp "models/ggml-${WHISPER_MODEL}.bin" /opt/whisper-runtime/models/ggml-model.bin \
  && (cp build/bin/*.so* /opt/whisper-runtime/ 2>/dev/null || true)

# Runtime
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=whisper /opt/whisper-runtime /opt/whisper
ENV WHISPER_BIN=/opt/whisper/whisper-cli \
    WHISPER_MODEL=/opt/whisper/models/ggml-model.bin \
    WHISPER_THREADS=2 \
    LD_LIBRARY_PATH=/opt/whisper
EXPOSE 3003
CMD ["node", "dist/server.js"]
