# Windows code signing

Windows 11's **Smart App Control** blocks unsigned apps outright (no "Run anyway"), and SmartScreen warns on
them. Recap's Windows builds are signed through [SignPath Foundation](https://signpath.org), which signs open-source
projects for free. Public policy page: https://recap.kronagent.dev/code-signing.html

## How it works

CI (`.github/workflows/desktop.yml`, Windows job) makes three signing requests per build, each through the official
SignPath GitHub action, so every signed file provably comes from this repository's CI:

1. **The app folder** (`windows-app`): Recap.exe, its helpers, the bundled ffmpeg / whisper-cli / llama-completion,
   and every DLL.
2. **The uninstaller** (`windows-file`), which electron-builder generates mid-build.
3. **The installer** (`windows-file`).

electron-builder runs in the background with `desktop/scripts/signpath-bridge.cjs` as its sign hook: the hook stages
each file and waits while a workflow step submits it, then puts the signed file back. After the self-test installs
the signed installer, CI checks that every installed `.exe` and `.dll` is signed.

Tag builds use the `release-signing` policy (each request is approved by hand in SignPath). Other builds use
`test-signing`.

Signing is **off** until the settings below exist; until then the Windows job builds unsigned, as before.

## Setting it up (once)

1. Apply at https://signpath.org/apply (project: Recap, repository: github.com/Aditya-galaxy/recap, license: MIT).
   Point them to the policy page above.
2. In SignPath, create the project `recap` with:
   - the GitHub connector for this repository (trusted build system),
   - artifact configurations `windows-app` and `windows-file` from [`.signpath/`](../.signpath),
   - signing policies `test-signing` and `release-signing`.
3. In GitHub → Settings → Secrets and variables → Actions:
   - variable `SIGNPATH_ORGANIZATION_ID` (from SignPath),
   - variable `SIGNPATH_PROJECT_SLUG` (only if it isn't `recap`),
   - secret `SIGNPATH_API_TOKEN` (a SignPath CI user's token).
4. Run the "desktop apps" workflow on a branch. The Windows job should log "every .exe and .dll ... is signed".

## Open questions for SignPath's review

- The app bundles FFmpeg (an LGPL/GPL static build downloaded pinned by `desktop/scripts/fetch-ffmpeg.mjs`, not built
  in this CI). Confirm signing it is fine, or we build it from source in CI like whisper.cpp and llama.cpp.
- Electron ships two DLLs already signed by Microsoft (`d3dcompiler_47.dll`, `dxil.dll`); `windows-app` excludes them.
  Everything else in the v0.6.0 app folder was unsigned: Recap.exe, elevate.exe, ffmpeg.exe, whisper-cli.exe,
  llama-completion.exe, ffmpeg.dll, dxcompiler.dll, vk_swiftshader.dll, vulkan-1.dll and sharp's `.node` module.

## Moving to your own certificate later

Replace the three SignPath steps with a `signtool` step using the new certificate (or point
`win.signtoolOptions` at it). Releases already signed keep their timestamped signatures; the publisher name and
SmartScreen reputation start fresh with the new certificate.
