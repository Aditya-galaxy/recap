# Performance & reliability

Measured on an Apple M-series MacBook Air (macOS 27) with the packaged v0.3.2 engine and its bundled
ffmpeg + whisper.cpp, unless noted. CI re-runs the functional self-test on macOS, Windows and Linux for
every build.

## Targets and results

| Metric | Target | Result |
| --- | --- | --- |
| Cold start → engine ready | < 3 s | **0.9 s** |
| Cold start → library window loaded | < 3 s | **1.2 s** |
| 10-min recording → watchable + transcribed (H.264, the recorder default) | ≪ real time | **28.7 s (0.048×)**, was 125 s |
| 10-min recording, VP9 fallback (browsers without H.264 encode) | < real time | 107.6 s (0.18×) |
| 60-min recording (2.5 GB) → watchable + transcribed | < 0.1× real time | **92 s (0.026×)** |
| 2.5 GB upload into the local library | streamed, no truncation | **3 s**, memory flat |
| Clean cut, 10 min / 180 cuts | works | **74 s** |
| Clean cut, 60 min / 1,098 cuts | works | **584 s** |
| A/V sync after cutting (1,098 cuts) | < 40 ms (EBU R37) | **5 ms** |
| Peak memory while processing 60 min (engine + ffmpeg + whisper) | bounded | **~900 MB** |
| Library page with 2,000 videos | small, fast | **100 KB, 0.06 s**, 48 lazy thumbnails/page (was 3.5 MB, 2,000 thumbnails) |
| Title search over 2,000 videos | < 50 ms | **9 ms** |

## v0.4.5 re-check (noise filter on)

Same machine, packaged v0.4.5 engine (Silero VAD noise filter enabled). The 60-min recording here is
near-continuous speech (7,277 words, 719 fillers), so it's heavier than the one above.

| Metric | Result |
| --- | --- |
| 10-min recording → watchable + transcribed | **18.6 s (0.031×)**, v0.3.2 was 28.7 s |
| 60-min recording → watchable + transcribed | **123 s (0.034×)**: remux 52 s, transcribe 116 s (in parallel) |
| Noise filter cost on 60 min of speech | none: whisper 115 s with it, 120 s without |
| Clean cut, 60 min / 719 fillers + pauses (3,600 s → 3,106 s) | **664 s** |
| Peak memory, 60 min (engine + ffmpeg + whisper) | **1.1 GB** |
| Soak: 20 × upload → transcribe → clean cut → delete | 20/20 ok, engine memory 110 → 120 MB (flat) |
| 6 concurrent uploads | 6/6 processed, none lost |
| Published Mac build (DMG from the release page) | signature valid, self-test 29/29 |

Known limit: the clean cut misses some fillers in natural, fast speech (around 3 in 5 in our tests); it
never cut a real word in these runs. A precise fix needs forced alignment and is on the roadmap.

## Recording

| Codec (1080p30, 8 Mbps, Electron) | CPU | Frames captured | Notes |
| --- | --- | --- | --- |
| **H.264, hardware (default)** | **0.42 cores** | 407 / 450 | engine remuxes it, no re-encode |
| VP9 (previous default) | 1.02 cores | 363 / 450 (−19%) | software encoder couldn't keep up |
| VP8 | 2.15 cores | 419 / 450 | |

## Quality

| | Result |
| --- | --- |
| Encode quality on scrolling 1080p UI text | 49 dB PSNR / 0.998 SSIM (CRF 20); visually identical to the source at 2× zoom |
| Transcription (whisper.cpp base.en, greedy) | 0% WER on the benchmark script, all 112 fillers detected; 36% faster than 5-wide beam search with no accuracy loss |

## What these measurements found (and fixed)

- **Uploads over 10 MB were silently truncated** (v0.3.0–0.3.1): routing uploads through `proxy.ts` made
  Next.js buffer bodies with a 10 MB cap. Uploads now bypass the proxy and the local secret is re-checked in
  the route. The self-test checks that stored duration matches the source.
- **Clean cut crashed on long recordings**: a flat `between()+between()+…` expression exhausted ffmpeg's
  parser at ~180 cuts. Now built as a balanced tree.
- **A/V drift after cutting** (0.9 s over 180 cuts): cut points now snap to video frames, and audio is cut in
  1 ms chunks.
- **Docker image's clean cut never worked**: Debian's ffmpeg 5.1 lacks options the pipeline uses. The image
  now ships the same pinned static ffmpeg 8.1 as the desktop app, and CI renders a clean cut.

## Reproducing

The desktop self-test (security, record → library → transcription, clean cut, export, recovery, delete,
cold start, memory) runs against any build:

```bash
RECAP_SELFTEST=/tmp/out RECAP_SELFTEST_FILE=sample.mkv RECAP_SELFTEST_EXPECT_CUTS=1 /path/to/Recap
cat /tmp/out/report.json
```

It uses an isolated library under the output folder and never touches your real one.

For the hands-on checks CI can't do (real cameras, permission prompts), see [UAT.md](UAT.md).
