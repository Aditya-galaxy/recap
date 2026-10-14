# Recap

**A self-hosted, local-first alternative to Loom.** Record your screen with a camera bubble, get a
share link with a transcript and captions, and remove the "um"s and dead air in one click.
Transcription runs on your own machine with whisper.cpp. No account, no cloud, no API keys.

> **Status: v0.1, early release.** The full pipeline is tested end to end. The desktop apps have
> not yet had wide real-world testing, and the server has **no authentication**, so run it locally
> or on a private network, not on the open internet. Issues and PRs welcome.

- **Record:** screen + draggable camera bubble, mic and system audio, pause/resume.
  Use the web app in Chrome, or the native apps for macOS, Windows and Linux (global hotkey ⌥⌘R / Ctrl+Alt+R).
- **Share:** each video gets a page at `/v/<id>` with a seekable player, captions and a click-to-seek transcript.
- **Clean up:** cut filler words (um/uh; optionally comma-delimited "like," / "you know,") and shorten long
  pauses. You see the time saved and can preview the result before rendering. The original is kept.

Original implementation: no code from Loom; the name is only used to describe the category.

## Quick start

### 1. Run the server (required: the apps upload to it)

macOS:

```bash
brew install ffmpeg whisper-cpp
git clone https://github.com/Aditya-galaxy/recap && cd recap
mkdir -p models && curl -L -o models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
npm install
npm run build && npm start -- -p 3217      # or: npm run dev -- -p 3217
```

Linux: install `ffmpeg` from your package manager and build
[whisper.cpp](https://github.com/ggml-org/whisper.cpp) (it provides `whisper-cli`). Then follow the same steps.
Point to the binary and model with `WHISPER_BIN` / `WHISPER_MODEL` if they aren't on the default paths.
`ggml-small.en.bin` is more accurate than `base.en` but slower.

Open http://localhost:3217 to record from the browser, or use a desktop app:

### 2. Desktop apps

Download from [Releases](https://github.com/Aditya-galaxy/recap/releases/latest):

| OS | File | First launch |
| --- | --- | --- |
| macOS 15+ | `Recap-macOS.zip` | The app isn't notarized: unzip, move it to Applications, then run `xattr -dr com.apple.quarantine /Applications/Recap.app`, or use System Settings → Privacy & Security → "Open Anyway". Grant Screen Recording, then reopen the app. |
| Windows 10/11 | `Recap Setup 0.1.0.exe` or the portable `.exe` | It isn't code-signed: on the SmartScreen prompt choose "More info" → "Run anyway". |
| Linux | `.AppImage` or `.deb` | `chmod +x Recap-*.AppImage && ./Recap-*.AppImage` |

All apps upload to `http://localhost:3217` by default. Change this under **server** in the app.

## Known limitations

- **No authentication.** Anyone who can reach the server can watch, rename and delete videos.
- Apps are unsigned or ad-hoc signed (see the first-launch notes above).
- Linux: no system audio (mic only). The control bar is visible in recordings because Linux has no way to exclude a window from capture.
- The macOS app records whole displays, not single windows.
- English transcription by default (`base.en`). Use a multilingual Whisper model for other languages.

## How it works

| Step | Where |
| --- | --- |
| Canvas compositing (worker-timed so it keeps drawing in a background tab) → `MediaRecorder` → raw upload | `src/components/Recorder.tsx` |
| Transcode to CFR H.264 → thumbnail → whisper.cpp token timestamps → ffmpeg `silencedetect` | `src/lib/pipeline.ts` |
| Filler tagging, snapping words to silences, cut/keep ranges, timeline remapping | `src/lib/cuts.ts` |
| WebVTT for the original and cleaned timelines | `src/lib/captions.ts` |
| Storage: `data/videos/<id>/{meta.json, video.mp4, clean.mp4, transcript.json, thumb.jpg}` | `src/lib/store.ts` |

Notes:
- whisper.cpp runs with `-nfa`. Its default flash attention skews token timestamps around pauses badly.
- Whisper is primed with a prompt full of disfluencies; otherwise it drops "um" and "uh" from the transcript.

## Mac app (`mac/`)

A native menu-bar recorder (Swift, ScreenCaptureKit, macOS 15+). It uploads to the same server.

```bash
cd mac && ./build.sh            # → mac/build/Recap.app
./build.sh --install            # also copies to /Applications
```

- The camera bubble is a real floating window. Drag it anywhere and it's captured where it sits.
- The control bar (timer, pause, stop, discard) floats too, but is excluded from the recording.
- ⌥⌘R starts or stops from any app. System audio and mic are recorded as separate tracks and mixed server-side.
- Every recording is also saved to `~/Movies/Recap`. If an upload fails, use "retry upload" in the menu.
- The server URL (default `http://localhost:3217`) can be changed under "server" in the menu.
- The app is ad-hoc signed, so after a rebuild macOS may ask you to re-enable Screen Recording for it.

## Windows & Linux app (`desktop/`)

An Electron tray app with the same flow as the Mac app: a floating camera bubble, a control bar,
**Ctrl+Alt+R** to start or stop, and upload to the server with the share link opened and copied.
Recordings are also saved to `Videos/Recap`.

```bash
cd desktop && npm install && npm start      # run from source (works on macOS too)
npx electron-builder --win                  # build on Windows → NSIS installer + portable .exe
npx electron-builder --linux                # build on Linux   → AppImage + .deb
```

GitHub Actions (`.github/workflows/desktop.yml`) builds Windows, Linux and macOS on native runners
for every push to `desktop/` or `mac/`. Pushing a `v*` tag attaches them to a GitHub Release.

| | Windows | Linux |
| --- | --- | --- |
| System audio | ✓ (loopback) | ✗ (mic only) |
| Control bar hidden from recording | ✓ (Win10 2004+) | ✗ (visible in the video) |
| Wayland | n/a | screen capture through the PipeWire portal; always-on-top depends on the compositor |

## License

[MIT](LICENSE)
