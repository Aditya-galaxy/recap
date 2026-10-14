# Third-party software bundled with Recap Desktop

Recap itself is MIT licensed. The desktop app also ships these programs as separate executables:

| Component | Version | License | Source |
| --- | --- | --- | --- |
| FFmpeg (`bin/ffmpeg`) | 9.0.2 (macOS), 8.1.3 (Windows, Linux) | GPL v3+ (static build with libx264 and others) | https://ffmpeg.org · macOS build: https://ffmpeg.martin-riedl.de · Windows/Linux builds: https://github.com/BtbN/FFmpeg-Builds |
| whisper.cpp (`bin/whisper-cli`) | v1.9.5 | MIT | https://github.com/ggml-org/whisper.cpp |
| Whisper `base.en` model (downloaded on first run) | ggml conversion | MIT | https://huggingface.co/ggerganov/whisper.cpp |
| Electron, Chromium, Node.js | Electron 44 | MIT / BSD and others | https://github.com/electron/electron |

FFmpeg's complete corresponding source code is available from the build sources linked above.
Recap runs FFmpeg as a separate process and doesn't link against it.
