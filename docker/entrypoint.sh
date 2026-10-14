#!/bin/sh
# Downloads the Whisper model into the data volume on first start, then runs the server.
set -eu

: "${WHISPER_MODEL:=/data/models/ggml-${WHISPER_MODEL_NAME}.bin}"
export WHISPER_MODEL

if [ ! -s "$WHISPER_MODEL" ]; then
  mkdir -p "$(dirname "$WHISPER_MODEL")"
  url="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER_MODEL_NAME}.bin"
  echo "recap: downloading Whisper model ${WHISPER_MODEL_NAME} (first start only)…"
  curl -fL --retry 3 -o "$WHISPER_MODEL.part" "$url"
  mv "$WHISPER_MODEL.part" "$WHISPER_MODEL"
fi

exec "$@"
