# syntax=docker/dockerfile:1.7
# Recap server: Next.js app + ffmpeg + whisper.cpp in one image. All state lives in /data.

ARG NODE_VERSION=24
ARG WHISPER_VERSION=v1.9.5

# ---- whisper.cpp ---------------------------------------------------------------------
FROM debian:bookworm-slim AS whisper
ARG WHISPER_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${WHISPER_VERSION} https://github.com/ggml-org/whisper.cpp /src
WORKDIR /src
# Portable build (no -march=native) so the image runs on any x86-64 / arm64 host.
RUN cmake -B build -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DWHISPER_BUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=Release \
 && cmake --build build -j"$(nproc)" --target whisper-cli \
 && strip build/bin/whisper-cli

# ---- app build -------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 RECAP_STANDALONE=1
RUN npm run build \
 && test ! -e .next/standalone/data && test ! -e .next/standalone/models

# ---- ffmpeg ---------------------------------------------------------------------------
# Debian bookworm ships ffmpeg 5.1, which lacks options the pipeline needs (-/filter_complex is 7.0+).
# Use the same pinned, checksum-verified static build as the desktop app.
FROM debian:bookworm-slim AS ffmpeg
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates xz-utils && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    base=https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-13-13-05; \
    case "$TARGETARCH" in \
      amd64) f=ffmpeg-n8.1.3-18-g46d899d7a0-linux64-gpl-8.1.tar.xz;    sum=b3506f47a71a2f8cff8c0775112bf02a8a49035e3994232aa5f218058328e0e7 ;; \
      arm64) f=ffmpeg-n8.1.3-18-g46d899d7a0-linuxarm64-gpl-8.1.tar.xz; sum=bb5477906594f7b02f84fedaa2dc3d503bb14166fc4acb2f3175be0488967e43 ;; \
      *) echo "unsupported arch $TARGETARCH"; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/ff.tar.xz "$base/$f"; \
    echo "$sum  /tmp/ff.tar.xz" | sha256sum -c -; \
    tar -xJf /tmp/ff.tar.xz -C /tmp; \
    cp /tmp/ffmpeg-*/bin/ffmpeg /usr/local/bin/ffmpeg; \
    /usr/local/bin/ffmpeg -hide_banner -version | head -1

# ---- runtime ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim
ARG RECAP_VERSION=dev
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 curl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ffmpeg /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=whisper /src/build/bin/whisper-cli /usr/local/bin/whisper-cli

WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/recap-entrypoint

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data \
    WHISPER_MODEL_NAME=base.en \
    RECAP_VERSION=${RECAP_VERSION}

RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["tini", "--", "recap-entrypoint"]
CMD ["node", "server.js"]
