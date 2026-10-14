# Recap

A local-first, Loom-style screen recorder with AI clean-up. Original implementation; no code from Loom.

- **Record** screen, window or tab with a draggable webcam bubble, mic and tab audio, pause/resume.
  "Pop out" floats the camera and controls above every app (Chrome Document Picture-in-Picture).
- **Share** each video at `/v/<id>`, with a range-seekable player, captions, and a click-to-seek transcript.
- **Clean up** filler words (um/uh, and optionally comma-delimited "like," / "you know,") and long pauses.
  You get a live estimate and an in-player preview before rendering a cleaned cut. The original is kept.

## Requirements

```bash
brew install ffmpeg whisper-cpp
mkdir -p models && curl -L -o models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
npm install
npm run dev
```

Override with `WHISPER_BIN` / `WHISPER_MODEL` (for example `ggml-small.en.bin` for better accuracy).

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
- No auth. Anyone who can reach the server can view and delete videos. Add auth before exposing it.

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
