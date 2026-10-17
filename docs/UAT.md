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
| 8 | Open **clean up**, cut fillers + pauses | Most "um"s and long pauses are gone; no real words cut; audio stays in sync |
| 9 | Share → copy file, paste into a chat app | The video file pastes |
| 10 | Record with the mic muted and nothing playing | Recording keeps its full length; transcript is empty, not made up |
| 11 | Quit and relaunch | Library still there; no keychain or password prompt |
| 12 | Unplug the network, record again | Everything works offline (after the first model download) |
| 13 | Uninstall | App removed; library stays in your user folder unless deleted |

Note anything that's confusing, slow or shows technical text (paths, `$` signs, error codes).
