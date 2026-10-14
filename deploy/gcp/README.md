# Deploy Recap on Google Cloud (Compute Engine)

One small VM runs Recap + Caddy (automatic HTTPS) with Docker Compose. Everything is configured by
[`startup.sh`](startup.sh), which runs on every boot. Rough cost: e2-small + 30 GB disk + static IP ≈ $18/month.

```bash
P=your-project; R=asia-south1; Z=asia-south1-a
gcloud services enable compute.googleapis.com --project $P
gcloud compute addresses create recap-ip --project $P --region $R
IP=$(gcloud compute addresses describe recap-ip --project $P --region $R --format='value(address)')
gcloud compute firewall-rules create recap-allow-web --project $P --network default \
  --allow tcp:80,tcp:443 --target-tags recap-web
gcloud compute resource-policies create snapshot-schedule recap-daily --project $P --region $R \
  --daily-schedule --start-time 21:30 --max-retention-days 7

gcloud compute instances create recap-1 --project $P --zone $Z --machine-type e2-small \
  --image-family debian-12 --image-project debian-cloud --boot-disk-size 30GB \
  --address $IP --tags recap-web --labels app=recap --shielded-secure-boot \
  --metadata-from-file startup-script=startup.sh \
  --metadata recap-domain=$(echo $IP | tr . -).sslip.io,recap-image=ghcr.io/aditya-galaxy/recap:latest,recap-setup-code=$(openssl rand -hex 8)
gcloud compute disks add-resource-policies recap-1 --project $P --zone $Z --resource-policies recap-daily
```

Then open `https://<ip-with-dashes>.sslip.io` and create the admin account with the setup code
(`gcloud compute instances describe recap-1 --zone $Z --format='value(metadata.items.recap-setup-code)'`).

**Custom domain:** point an A record at the IP, then set the domain (several can be comma-separated; the
first is the canonical share-link address) and restart:
`gcloud compute instances add-metadata recap-1 --zone $Z --metadata recap-domain=recap.example.com,<ip-with-dashes>.sslip.io`
then `gcloud compute instances stop recap-1 --zone $Z && gcloud compute instances start recap-1 --zone $Z`.

**Upgrade:** set `recap-image` to the new tag and reboot, or SSH in and
`cd /opt/recap && sudo docker compose pull && sudo docker compose up -d`.

**Logs:** `sudo tail -f /var/log/recap-startup.log` and `cd /opt/recap && sudo docker compose logs -f`.

## Recap Cloud on the free tier (e2-micro)

Recap Cloud (open sign-up with email confirmation, founding plan, comments and insights) runs on Google's
always-free `e2-micro` (us-west1, us-central1 or us-east1, 30 GB **standard** disk). The server doesn't run
whisper there: the desktop app uploads each shared video with the transcript it made on the user's machine.
Free tier covers the VM and disk; the external IP and outbound traffic past 1 GB/month are billed, so
set a budget alert.

```bash
P=your-project; R=us-central1; Z=us-central1-a
gcloud iam service-accounts create recap-vm --project $P --display-name "Recap VM"
SA=recap-vm@$P.iam.gserviceaccount.com
gcloud secrets add-iam-policy-binding recap-resend-api-key --project $P \
  --member serviceAccount:$SA --role roles/secretmanager.secretAccessor
gcloud compute addresses create recap-cloud-ip --project $P --region $R
IP=$(gcloud compute addresses describe recap-cloud-ip --project $P --region $R --format='value(address)')
gcloud compute instances create recap-cloud --project $P --zone $Z --machine-type e2-micro \
  --image-family debian-12 --image-project debian-cloud --boot-disk-size 30GB --boot-disk-type pd-standard \
  --address $IP --tags recap-web --labels app=recap --shielded-secure-boot \
  --service-account $SA --scopes cloud-platform \
  --metadata-from-file startup-script=startup.sh \
  --metadata recap-mode=cloud,recap-domain=app.example.com,recap-image=ghcr.io/aditya-galaxy/recap:edge,recap-contact=you@example.com,recap-resend-secret=recap-resend-api-key,recap-setup-code=$(openssl rand -hex 8)
```

Point an A record for the domain at `$IP`; Caddy gets the certificate on first request. Create the operator
(admin) account first with the setup code, then sign-up opens for everyone. Reported videos land at `/admin`.
