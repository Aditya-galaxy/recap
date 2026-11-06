# User acceptance test

A 15-minute pass on a real machine before each release. CI's packaged self-test covers the engine,
library, transcription, clean cut, export, recovery and delete on every OS. This list covers what CI
can't: real cameras, microphones, OS permission prompts and how it feels to use.

Use a fresh install (uninstall first, and on macOS run `tccutil reset All dev.recap.desktop`).

| # | Step | Expected |
| --- | --- | --- |
| 1 | Install from the website download | Installer runs; first launch shows the welcome screen within a few seconds |
| 2 | Click record, choose **screen + cam** | OS asks for camera, mic and (macOS) screen permission once; nothing opens Settings repeatedly |
| 3 | Deny the camera, record again | Recording still works without the camera bubble; a plain notice says the camera is off |
| 4 | Allow everything, record 30 s while talking with a few "um"s | Camera bubble shows; the bar's ◯ cycles small → medium → large |
| 5 | Pause for 5 s, resume, stop | Video opens; the pause isn't in the recording |
| 6 | Wait for the transcript | Words match what you said; no invented words during silence or background noise |
| 7 | Search for a word you said in a recording | That recording shows with the matching words; clicking it opens the video at that moment |
| 8 | Under the video, drag the trim handles in from both ends, leave **Clean up** on, **save edit** | The ends are gone, and so are most "um"s and long pauses; no real words cut; audio stays in sync |
| 9 | Share → copy file, paste into a chat app | The video file pastes |
| 10 | Record with the mic muted and nothing playing | Recording keeps its full length; transcript is empty, not made up |
| 11 | Quit and relaunch | Library still there; no keychain or password prompt |
| 12 | Unplug the network, record again | Everything works offline (after the first model download) |
| 13 | Play a video with sound, then click **library** | The sound stops |
| 14 | Record, then quit from the tray and choose **Quit without saving** | Recap closes with no error; reopening works, and that recording doesn't come back |
| 15 | Screen + camera on a colored background | Camera is a clean circle with no faint square around it; ◯/▭ and the corner drag work |
| 16 | Drop a phone video (or any .mov/.mp4) on the window, then a few at once | One file opens as a video; several appear in the library and finish on their own. Upright, plays, gets a transcript |
| 17 | Drop a picture or a text file | A plain message says why; nothing else breaks |
| 18 | Open **Make it a video**, choose **Vertical**, keep captions and end card, **make video**, play it | Whole picture visible over a blurred backdrop; captions readable and in time; ends on your end card; **export mp4** saves it. Your recording is unchanged |
| 19 | In Make it a video: add an intro card and join a second clip | Plays intro, video, clip, end card in order, in sync |
| 20 | Voice-over: pause partway, record a few seconds, **Voice-over only**, make | Mic prompt appears once; your voice starts at that point, in time with the picture; captions follow what you said |
| 21 | Blur areas: drag over some text, make | That text is unreadable in the finished video for the chosen time; the recording itself is unchanged |
| 22 | Turn on **highlight my clicks**, record, click around | A ring shows at each click, on screen and in the video. macOS asks for Accessibility first. Typing is unaffected |
| 23 | During a recording, **draw**, sketch over the screen, **done** | The sketch shows in the video and disappears on **done**; camera and bar stay clickable; apps work normally once done |
| 24 | Make it a video with **Auto-zoom** on | Zooms smoothly to where you clicked (or where the cursor settled), then back out. Picture stays sharp and steady |
| 25 | Make it a video → choose **Reels, Shorts or TikTok**, add your link, **Make it for me** | A vertical video with captions, your title at the start and your link at the end, cleaned up; the line above it says what it did. Blurred areas you'd set are still blurred |
| 26 | Uninstall | App removed; library stays in your user folder unless deleted |

Note anything that's confusing, slow or shows technical text (paths, `$` signs, error codes).
