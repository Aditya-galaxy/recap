# Recap

**A self-hosted, local-first alternative to Loom.** Record your screen with a camera bubble, get a
share link with a transcript and captions, and remove the "um"s and dead air in one click.
Transcription runs on your own machine with whisper.cpp. No account, no cloud, no API keys.

> **Status: early release.** Accounts, private/unlisted videos, API tokens for the desktop apps, a crash-safe
> job queue and a Docker image are in. See [docs/ROADMAP.md](docs/ROADMAP.md) for what's next. Issues and PRs welcome.

- **Record:** screen + draggable camera bubble, mic and system audio, pause/resume.
  Use the web app in Chrome, or the native apps for macOS, Windows and Linux (global hotkey ⌥⌘R / Ctrl+Alt+R).
- **Share:** each video gets a page at `/v/<id>` with a seekable player, captions and a click-to-seek transcript.
- **Clean up:** cut filler words (um/uh; optionally comma-delimited "like," / "you know,") and shorten long
  pauses. You see the time saved and can preview the result before rendering. The original is kept.

Website and early access: **https://recap.kronagent.dev**

Original implementation: no code from Loom; the name is only used to describe the category.

## Quick start

### 1. Run the server

**Docker (recommended).** Any Linux box, VPS, NAS or Mac with Docker:

```bash
curl -O https://raw.githubusercontent.com/Aditya-galaxy/recap/main/docker-compose.yml
docker compose up -d
```

Open http://localhost:3217 and create your account; **the first account is the admin**. On first start the
container downloads the Whisper model (~140 MB) into the data volume.

| Variable | Default | |
| --- | --- | --- |
| `PUBLIC_URL` | (unset) | The address people open share links on, e.g. `https://recap.example.com`. Enables secure cookies for https. |
| `ALLOW_SIGNUP` | `true` | Set `false` once your team has accounts. Admins can still add users under Settings. |
| `SETUP_CODE` | (unset) | If set, creating the first (admin) account requires this code. Use it on public servers. |
| `MAX_UPLOAD_MB` | `4096` | Per-upload size cap. |
| `WHISPER_MODEL_NAME` | `base.en` | `small.en` is more accurate; `base` / `small` handle other languages. |

**Putting it on the internet:** run it behind a reverse proxy with HTTPS (Caddy, Traefik, nginx, Cloudflare Tunnel)
and set `PUBLIC_URL`. For example, with Caddy: `recap.example.com { reverse_proxy localhost:3217 }`.

**Cloud recipe:** [deploy/gcp](deploy/gcp) sets up a Google Cloud VM with HTTPS, swap, log rotation and
daily disk snapshots in a few `gcloud` commands (~$18/month).

**Backups:** everything (database, videos, model) is in the `recap-data` volume. Back that up.

<details>
<summary>Without Docker (macOS / Linux, for development)</summary>

```bash
brew install ffmpeg whisper-cpp        # Linux: ffmpeg from your package manager + build whisper.cpp
git clone https://github.com/Aditya-galaxy/recap && cd recap
mkdir -p models && curl -L -o models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
npm install
npm run dev -- -p 3217                 # or: npm run build && npm start -- -p 3217
```

Data goes to `./data` (override with `DATA_DIR`); point to whisper with `WHISPER_BIN` / `WHISPER_MODEL`.
</details>

### 2. Record

- **Browser:** sign in and press **record** (Chrome or Edge).
- **Desktop apps:** download from [Releases](https://github.com/Aditya-galaxy/recap/releases/latest). In the
  server's **Settings → connect the desktop apps**, create an API token, then paste the server URL and token
  into the app's **server** section and press **check connection**.

| OS | File | First launch |
| --- | --- | --- |
| macOS 15+ | `Recap-macOS.zip` | Not notarized: move it to Applications, run `xattr -dr com.apple.quarantine /Applications/Recap.app`, then grant Screen Recording and reopen. |
| Windows 10/11 | `Recap.Setup.<version>.exe` (installer) or `Recap.<version>.exe` (portable) | Not code-signed: on the SmartScreen prompt choose "More info" → "Run anyway". |
| Linux | `.AppImage` or `.deb` | `chmod +x Recap-*.AppImage && ./Recap-*.AppImage` |

### Sharing and privacy

- Videos are **unlisted** by default: anyone with the link can watch without an account, and pages are never indexed.
  Switch a video to **private** to make it visible only to you.
- Unlisted links show a title and thumbnail preview in Slack, X, iMessage and so on. Private ones show nothing.
- Owners see view counts. Viewers can watch, read the transcript and download; only owners can edit or delete.

## Known limitations

- Password-only sign-in (no SSO or password reset email yet; an admin can create a new account).
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
