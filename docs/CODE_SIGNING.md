# Code signing

Public policy page: https://recap.kronagent.dev/code-signing.html

## Windows

Windows 11's **Smart App Control** blocks unsigned apps outright (no "Run anyway"), and SmartScreen warns on
them.

- **Microsoft Store** ([9P2Z7WK8FTS7](https://apps.microsoft.com/detail/9P2Z7WK8FTS7), identity
  `Kronagent.RecapRecorder`): CI builds the MSIX (`recap-windows-store` artifact) and test-signs a copy with a
  throwaway certificate to install it and run the self-test inside the package. The package uploaded to
  Partner Center is unsigned; Microsoft signs it. This is what the website offers Windows visitors, and it runs
  with Smart App Control on. Store listing text: [STORE_LISTING.md](STORE_LISTING.md).
- **Installer (`Recap-windows-x64-setup.exe`)**: unsigned, a fallback for PCs without the Store. People confirm
  it once (SmartScreen: "More info → Run anyway"); Smart App Control blocks it.

SignPath Foundation declined Recap's application (2026-10-17), so its CI integration was removed. If the
installer ever needs a signature, the options are an OV certificate for open-source developers (e.g. Certum,
signed by hand per release since the key lives on a smart card) or Azure Trusted Signing, which can sign in CI.
Add a `signtool` step after **Package** on Windows, and sign the app folder before the installer is built so
the installed files are signed too.

## macOS

Ad-hoc signed, not notarized: macOS asks people to confirm the first launch. Notarization needs an Apple
Developer ID (paid membership).
