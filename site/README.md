# recap.kronagent.dev

The public landing page: what Recap is, self-hosting instructions, and an early-access email signup.
A single dependency-free Node server (`server.js`) plus static files in `public/`, on Cloud Run.

- Signups go to Firestore, in a dedicated database `recap`, collection `signups`. There is one document per
  email (keyed by its SHA-256), so repeat signups only update `lastSeenAt` and `signups`.
- Abuse protection: email validation, a honeypot field, a per-IP rate limit, and the same response whether or
  not the address was already on the list.
- The service runs as `recap-site@kronagent.iam.gserviceaccount.com`, which can only access the `recap` database.

```bash
# local preview without touching Firestore
DRY_RUN=1 node server.js            # → http://localhost:8080

# deploy
gcloud run deploy recap-site --project kronagent --region us-central1 --source . \
  --service-account recap-site@kronagent.iam.gserviceaccount.com --allow-unauthenticated \
  --min-instances 0 --max-instances 3 --memory 256Mi --labels app=recap

# export signups as CSV (uses your gcloud login)
node export-signups.mjs > signups.csv
```
