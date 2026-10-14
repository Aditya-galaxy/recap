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

**Custom domain:** point an A record at the IP, then
`gcloud compute instances add-metadata recap-1 --zone $Z --metadata recap-domain=recap.example.com`
and reboot (or re-run the startup script).

**Upgrade:** set `recap-image` to the new tag and reboot, or SSH in and
`cd /opt/recap && sudo docker compose pull && sudo docker compose up -d`.

**Logs:** `sudo tail -f /var/log/recap-startup.log` and `cd /opt/recap && sudo docker compose logs -f`.
