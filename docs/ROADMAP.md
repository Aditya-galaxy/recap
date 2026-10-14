# Recap: road to a production app

## Who it's for and why they'd switch

People leave Loom over **per-seat pricing**, **free-tier caps** (25 videos, 5 minutes), **cloud-only storage**,
**videos public by default**, and **failed uploads**. The leading open-source alternative (Cap) is capable, but
reviewers report recordings that don't start, Windows crashes, and a heavy self-hosting setup (an email provider
just to log in).

**Recap's promise:** one `docker compose up` on any $5 VPS or home server, with no outside services (no email
provider, no cloud AI, no API keys), unlimited videos, **never public by default** (link-only, not indexed), and **uploads that never lose a
recording**. On top of that, AI clean-up (filler words and dead air) that runs locally for free.

Success looks like this: a small team can self-host in under 10 minutes, record from Mac, Windows, Linux or the
browser, and send a link a colleague can watch without signing in.

## Phases

### Phase 1: Production foundation *(done in v0.2)*
- [x] **Database**: SQLite through Node's built-in `node:sqlite` (zero native dependencies, one file to back up).
      Users, sessions, API tokens, videos, jobs, views. Imports the existing JSON-stored videos.
- [x] **Accounts**: email + password (scrypt) with httpOnly session cookies. No email provider required. The first
      account becomes admin; `ALLOW_SIGNUP=false` locks registration (admins can still add users).
- [x] **Ownership & visibility**: you only see and manage your own library. Each video is **unlisted** (anyone with
      the link can watch, never indexed) or **private** (only you). Viewers get a read-only page.
- [x] **API tokens** for the desktop apps (created in Settings, stored hashed, revocable).
- [x] **Durable job queue**: processing and renders are rows in SQLite, run by a single in-process worker.
      Interrupted jobs resume after a restart. Failures are retried with backoff.
- [x] **Upload hardening**: size cap (`MAX_UPLOAD_MB`), ffprobe validation, per-user rate limits on auth and upload.
- [x] **Ops**: `/api/health`, structured logs, `output: "standalone"`, multi-stage **Dockerfile** (ffmpeg +
      whisper.cpp built from source + model download) and **docker-compose.yml** with a single data volume.

### Phase 2: Clients *(done in v0.2)*
- [x] macOS + Windows/Linux apps: server URL + API token setting, auth header on upload, clear "not connected" state.
- [x] Web recorder: uses the browser session.

### Phase 3: Sharing that works in the real world *(mostly done)*
- [x] Link previews (Open Graph title + thumbnail) for Slack, X, iMessage, with `noindex` on every video page.
- [x] View counts for the owner.
- [ ] Copy-paste embed snippet.

### Later
- S3/R2 storage driver for larger deployments; scheduled backups of `data/`.
- Resumable uploads (tus) for long recordings on flaky networks.
- Optional AI summaries, titles and chapters (bring your own Claude API key).
- Comments and reactions; workspaces/teams; SSO.
- Signed + notarized desktop builds (needs paid Apple/Microsoft certificates).

## Non-goals (for now)
- A hosted SaaS. Recap is self-hosted first.
- A video editor beyond trimming fillers and pauses.
