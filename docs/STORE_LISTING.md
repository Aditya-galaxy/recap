# Microsoft Store listing (Recap Recorder)

Paste these into Partner Center → Recap Recorder → Store listings → English.

**Product name:** Recap Recorder (reserved). **Publisher:** Kronagent.

## Category

Productivity (secondary, if offered: Photo & video)

## Short description (one line)

Record your screen and camera, then get a step-by-step guide, a bug report or a finished video. Everything stays on your PC.

## Description

Show it once. Never explain it again.

Recap is a free screen and camera recorder that turns what you record into something people can actually use:

• Step-by-step guides: do a task once and say what you're doing. Recap writes each step and takes a screenshot at every click. Export to Notion, Google Docs, Confluence or PDF.
• Bug reports: reproduce a bug while describing it. Recap writes the steps to reproduce with screenshots, what should happen, what happened instead, and your setup. Copy it into GitHub, Linear or Jira.
• Transcripts: every recording is transcribed on your computer, with search across everything you've said.
• Clean cuts and trim: remove the "um"s and long pauses in one click, and cut the ends. Your original stays untouched.
• Make it a video: a finished video in wide, square or vertical, with captions, intro and end cards, joined clips, voice-over, blurred areas and auto-zoom.
• Import any video to get all of this, or draw on your screen and highlight your clicks while recording.

Private by design: recording, transcription and editing happen on your PC. No account, and your recordings are never uploaded. Optional on-device AI can polish guides and reports without sending anything anywhere.

Free and open source (MIT): github.com/Aditya-galaxy/recap

## Features (one per line, up to 20)

Screen, camera, or screen + camera recording with a movable camera bubble
Transcripts made on your computer
Step-by-step guides with a screenshot of every step
Bug reports with steps to reproduce, expected vs actual, and screenshots
Search titles and everything you said
Remove ums and long pauses in one click
Trim, and join clips with intro and end cards
Burned-in captions in wide, square or vertical
Voice-over, blurred areas and auto-zoom on clicks
Draw on screen and highlight clicks while recording
Import any video
Export guides to Notion, Google Docs, Confluence or PDF
Optional on-device AI polish (nothing is uploaded)
Global shortcut to start and stop recording
No account, no upload, free and open source

## Search terms (up to 7)

screen recorder, screen recording, step by step guide, bug report, transcription, loom alternative, how-to guide

## URLs

- Privacy policy: https://recap.kronagent.dev/code-signing.html (its "Privacy" section)
- Website: https://recap.kronagent.dev
- Support: https://github.com/Aditya-galaxy/recap/issues

## Store logos

From `promo-assets/store-0.9.1/logos/` (Partner Center → Store listings → Store logos):

| Partner Center field | File |
| --- | --- |
| 1:1 App tile icon (300 × 300) | `store-logo-300.png` (transparent background) |
| 1:1 Box art (1080 × 1080, or 2160 × 2160) | `box-art-1080.png`, `box-art-2160.png` |
| 9:16 Poster art (720 × 1080, or 1440 × 2160) | `poster-art-720x1080.png`, `poster-art-1440x2160.png` |

## Screenshots

From `promo-assets/store-0.9.1/screenshots/` (2048 × 1152 PNG, in this order), with captions:

1. `1-step-by-step-guide.png`: Do a task once while talking. Recap writes the steps, with a screenshot of each click.
2. `2-bug-report.png`: Reproduce a bug out loud and get steps to reproduce, expected and actual, and screenshots.
3. `3-make-it-a-video.png`: Make a finished video in wide, square or vertical, with captions and an end card.
4. `4-editor.png`: Trim the ends and remove the "um"s and long pauses in one click. Your original stays untouched.
5. `5-search-what-was-said.png`: Search everything you said and jump straight to that moment.
6. `6-transcript.png`: Every recording is transcribed on your PC. Nothing is uploaded.
7. `7-editor-dark.png`: Light and dark, to match Windows.

## What's new in this version (v0.9.1)

A cleaner look throughout, and new ways to make a finished video: import any video, then add captions, intro and end cards, joined clips, voice-over, blurred areas and auto-zoom. Draw on screen and highlight clicks while recording.

## Age rating questionnaire (IARC)

The app has no violence, sexual content, gambling or user-to-user communication, doesn't share location, and
doesn't collect personal data. Answer "No" throughout. Expected rating: 3+ / Everyone.

## Notes for certification (Submission options → Notes for certification)

Recap is a desktop (full-trust) app. It records the screen, camera and microphone when the user presses Record,
transcribes locally with a bundled speech model (downloaded once on first run from Hugging Face), and can optionally
download a local language model when the user chooses "polish". No account or sign-in is needed to test. The optional "highlight my clicks" setting (off by default) uses a system-wide mouse hook to detect mouse presses during a recording, only to show a ring at the click and zoom to it later. It does not listen to the keyboard, and nothing leaves the PC.
