# Recap

**A self-hosted, local-first alternative to Loom.** Record your screen with a camera bubble, get a
share link with a transcript and captions, and remove the "um"s and dead air in one click.
Transcription runs on your own machine with whisper.cpp. No account, no API keys.

> **Status: early release (v0.4).** The desktop app runs everything on your own computer: recording,
> transcription and clean-up, with no account needed. Teams that want share links can run their own server.
> See [docs/ROADMAP.md](docs/ROADMAP.md). Issues and PRs welcome.

- **Record:** screen + draggable camera bubble, mic and system audio, pause/resume.
  Use the web app in Chrome, or the native apps for macOS, Windows and Linux (global hotkey ⌥⌘R / Ctrl+Alt+R).
- **Share:** each video gets a page at `/v/<id>` with a seekable player, captions, a click-to-seek transcript,
  timestamped comments, emoji reactions, and (for the owner) who watched and how far.
- **Clean up:** cut filler words (um/uh; optionally comma-delimited "like," / "you know,") and shorten long
  pauses. You see the time saved and can preview the result before rendering. The original is kept.

Website and early access: **https://recap.kronagent.dev**

Original implementation: no code from Loom; the name is only used to describe the category.

## Quick start

### Desktop app (recommended)

Download from **https://recap.kronagent.dev**, or straight from [Releases](https://github.com/Aditya-galaxy/recap/releases/latest):

| OS | File | First launch |
| --- | --- | --- |
| macOS 13+ (Apple silicon) | `Recap-mac-arm64.dmg` | Not notarized yet: drag Recap to Applications, then run `xattr -dr com.apple.quarantine /Applications/Recap.app` (or System Settings → Privacy & Security → "Open Anyway"). Allow Screen Recording, camera and microphone when asked. |
| Windows 10/11 (x64) | `Recap-windows-x64-setup.exe` | Not code-signed yet: on the SmartScreen prompt choose "More info" → "Run anyway". |
| Linux (x64) | `Recap-linux-x86_64.AppImage` or `Recap-linux-amd64.deb` | `chmod +x Recap-linux-x86_64.AppImage && ./Recap-linux-x86_64.AppImage` |

On first launch it downloads the transcription model (~140 MB, once). Everything else is in the installer:
the Recap engine, ffmpeg and whisper.cpp. Your library lives in `Videos/Recap/library` (`Movies` on macOS).
**Nothing is uploaded anywhere.**

- Record with the **record** button or **Ctrl+Alt+R** / **⌥⌘R** from any app: screen + a floating camera bubble.
- When you stop, the video opens in your library with a transcript; **clean up** cuts fillers and pauses.
- **share** a video straight from the app: drag it into Slack, Teams or an email, **copy video** and paste it
  anywhere (macOS, Windows), or use the macOS share menu (Mail, Messages, AirDrop). Or **export mp4**.

### Self-hosted server (for share links)

A shared server gives your team accounts, unlisted/private **share links** viewers can open without an account,
link previews and view counts. **Docker** on any Linux box, VPS, NAS or Mac:

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
| `FEEDBACK_URL` | recap.kronagent.dev | Where the in-app feedback box sends messages. Set it empty to remove the box. |

Put it behind HTTPS (Caddy, Traefik, nginx, Cloudflare Tunnel) and set `PUBLIC_URL`. Everything (database,
videos, model) is in the `recap-data` volume, so back that up. [deploy/gcp](deploy/gcp) has a Google Cloud VM recipe.

To record into a server from the desktop app: Settings → **create token** on the server, then paste the server URL
and token into the app's **storage** section. The browser recorder (Chrome/Edge) works too: sign in → **record**.

<details>
<summary>Run from source (development)</summary>

```bash
brew install ffmpeg whisper-cpp        # Linux: ffmpeg from your package manager + build whisper.cpp
git clone https://github.com/Aditya-galaxy/recap && cd recap
mkdir -p models && curl -L -o models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
npm install && npm run dev -- -p 3217

cd desktop && npm install && npm run engine && npm start     # desktop app against the local engine
```
</details>

### Sharing and privacy

- On a server, videos are **unlisted** by default: anyone with the link can watch without an account, and pages are
  never indexed. Switch a video to **private** to make it visible only to you.
- In the desktop app, nothing leaves your computer unless you export it.
- On a server, anyone can report a shared video; admins review reports at `/admin`.
- The **feedback** box sends only what you type (plus app version) to recap.kronagent.dev. Never video or transcripts.

## Performance

A 60-minute recording is watchable with a transcript in about 90 s, clean cuts stay within 5 ms of A/V sync,
and the app cold-starts in about 1 s. Full numbers and methodology: [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

## Known limitations

- Installers aren't code-signed/notarized yet (see first-launch steps above).
- macOS desktop app: Apple silicon only; records your microphone but not system audio yet.
- Linux: mic only; the recording control bar is visible in recordings.
- Server: password sign-in only (no SSO). Password-reset and confirmation emails need `RESEND_API_KEY`
  (otherwise they're written to the server log).
- Default model is English (`base.en`).

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

## Desktop app internals (`desktop/`)

Electron app that runs the same Recap server in **local mode** (`RECAP_LOCAL_TOKEN`): bound to 127.0.0.1, no
accounts, and every request must carry a per-launch secret (`src/proxy.ts`), so other websites and local programs
can't reach it. `npm run bins` fetches a pinned, checksum-verified static ffmpeg and builds whisper.cpp;
`npm run engine` builds the server; CI (`.github/workflows/desktop.yml`) does both on each OS and runs a packaged
self-test on Linux. See [desktop/THIRD_PARTY.md](desktop/THIRD_PARTY.md) for bundled components and licenses.

`mac/` contains an experimental native Swift recorder (ScreenCaptureKit, records system audio) that uploads to a
Recap server. It isn't part of the release builds.

## Support

Recap is free and open source. If it's useful to you, you can [sponsor it on GitHub](https://github.com/sponsors/Aditya-galaxy).

## License

[MIT](LICENSE)
