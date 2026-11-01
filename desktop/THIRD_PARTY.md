# Third-party software bundled with Recap Desktop

Recap itself is MIT licensed. The desktop app also ships these programs as separate executables:

| Component | Version | License | Source |
| --- | --- | --- | --- |
| FFmpeg (`bin/ffmpeg`) | 9.0.2 (macOS), 8.1.3 (Windows, Linux) | GPL v3+ (static build with libx264 and others) | https://ffmpeg.org · macOS build: https://ffmpeg.martin-riedl.de · Windows/Linux builds: https://github.com/BtbN/FFmpeg-Builds (unmodified copies: https://github.com/Aditya-galaxy/recap/releases/tag/build-deps-ffmpeg) |
| whisper.cpp (`bin/whisper-cli`) | v1.9.5 | MIT | https://github.com/ggml-org/whisper.cpp |
| Whisper `base.en` model (downloaded on first run) | ggml conversion | MIT | https://huggingface.co/ggerganov/whisper.cpp |
| Silero VAD (`ggml-silero-v5.1.2.bin`, bundled) | v5.1.2, ggml conversion | MIT | https://github.com/snakers4/silero-vad · https://huggingface.co/ggml-org/whisper-vad |
| llama.cpp (`bin/llama-completion`) | v0.6.0 | MIT | https://github.com/ggml-org/llama.cpp |
| Qwen2.5 1.5B Instruct, Q4_K_M GGUF (downloaded only if you choose AI polish) | official GGUF | Apache-2.0 | https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF |
| uiohook-napi (only loaded if you turn on "highlight my clicks"; listens for mouse presses only) | 1.5.5 | MIT | https://github.com/SnosMe/uiohook-napi |
| Electron, Chromium, Node.js | Electron 44 | MIT / BSD and others | https://github.com/electron/electron |

FFmpeg's macOS build sources are available from the macOS build link above.
The Windows and Linux builds are BtbN's `autobuild-2026-10-31-12-59` archives, unmodified. BtbN deletes dated builds after about two weeks, so Recap keeps copies in its `build-deps-ffmpeg` release.
Their source is FFmpeg revision [8dca1586f4](https://github.com/FFmpeg/FFmpeg/tree/8dca1586f468bfcbb78ae3ed618af1361d9f140a), built with [BtbN/FFmpeg-Builds at 5031c6f](https://github.com/BtbN/FFmpeg-Builds/tree/5031c6f1082414e53688d39e521849905071070d), whose scripts name the source repository and revision of each bundled library.
Recap runs FFmpeg as a separate process and doesn't link against it.

Geist (`public/fonts/Geist-Regular.ttf`, used for burned-in captions and end cards) is licensed under the SIL Open Font License 1.1. The license is alongside it in `public/fonts/Geist-OFL.txt`. Source: https://github.com/vercel/geist-font
