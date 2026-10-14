#!/bin/bash
# Recap on a Compute Engine VM: Docker + Recap + Caddy (automatic HTTPS).
# Runs on every boot; idempotent. Configuration comes from instance metadata:
#   recap-domain       e.g. recap.example.com; several, comma-separated, are all served (the first is canonical)
#   recap-image        e.g. ghcr.io/aditya-galaxy/recap:v0.2.0
#   recap-setup-code   one-time code required to create the first (admin) account
#   recap-mode         "cloud" runs Recap Cloud: open sign-up with email confirmation, founding plan, no server-side
#                      whisper (the desktop app uploads transcripts). Optional extras for cloud mode:
#   recap-contact      contact email shown on the Terms/Privacy pages
#   recap-resend-secret  Secret Manager secret (in this project) holding the Resend API key; read at boot with the
#                      VM's service account, so the key never sits in metadata
set -euo pipefail
exec > >(tee -a /var/log/recap-startup.log) 2>&1
echo "== recap startup $(date -Is)"

meta() { curl -fsS -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1" || true; }
DOMAIN=$(meta recap-domain | tr -d ' ')
PRIMARY=${DOMAIN%%,*}
SITES=${DOMAIN//,/, }   # Caddy site-address list: "a.com, b.com"
IMAGE=$(meta recap-image)
SETUP_CODE=$(meta recap-setup-code)
MODE=$(meta recap-mode)
CONTACT=$(meta recap-contact)
RESEND_SECRET=$(meta recap-resend-secret)

secret() { # latest version of a Secret Manager secret in this project
  local project token
  project=$(curl -fsS -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/project/project-id)
  token=$(curl -fsS -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token | sed -nE 's/.*"access_token":"([^"]+)".*/\1/p')
  curl -fsS -H "Authorization: Bearer $token" "https://secretmanager.googleapis.com/v1/projects/$project/secrets/$1/versions/latest:access" |
    sed -nE 's/.*"data": *"([^"]+)".*/\1/p' | base64 -d
}
RESEND_API_KEY=""
if [ -n "$RESEND_SECRET" ]; then RESEND_API_KEY=$(secret "$RESEND_SECRET") || echo "warning: couldn't read secret $RESEND_SECRET; emails will only be logged"; fi
if [ "$MODE" = cloud ]; then CLOUD=true; TRANSCRIBE=false; SIGNUP=true; else CLOUD=false; TRANSCRIBE=true; SIGNUP=false; fi

# 2 GB swap: whisper + ffmpeg can spike past RAM on long videos (and an e2-micro only has 1 GB).
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v docker >/dev/null; then
  apt-get update -qq && apt-get install -y -qq ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq && apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  # Keep container logs from filling the disk.
  echo '{"log-driver":"json-file","log-opts":{"max-size":"20m","max-file":"5"}}' > /etc/docker/daemon.json
  systemctl restart docker
fi

mkdir -p /opt/recap && cd /opt/recap
umask 077
cat > .env <<EOF
DOMAIN=${DOMAIN}
PRIMARY=${PRIMARY}
SITES=${SITES}
IMAGE=${IMAGE}
SETUP_CODE=${SETUP_CODE}
CLOUD=${CLOUD}
TRANSCRIBE=${TRANSCRIBE}
SIGNUP=${SIGNUP}
CONTACT=${CONTACT}
RESEND_API_KEY=${RESEND_API_KEY}
EOF

cat > Caddyfile <<'EOF'
{$DOMAIN} {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}
	reverse_proxy recap:3000
}
EOF

cat > docker-compose.yml <<'EOF'
services:
  recap:
    image: ${IMAGE}
    restart: unless-stopped
    environment:
      PUBLIC_URL: https://${PRIMARY}
      ALLOW_SIGNUP: ${SIGNUP}
      SETUP_CODE: ${SETUP_CODE}
      MAX_UPLOAD_MB: "4096"
      WHISPER_MODEL_NAME: base.en
      CLOUD_MODE: ${CLOUD}
      SERVER_TRANSCRIBE: ${TRANSCRIBE}
      CONTACT_EMAIL: ${CONTACT}
      RESEND_API_KEY: ${RESEND_API_KEY}
      # Caddy replaces client-sent X-Forwarded-For with the address it saw, so the last hop is the client.
      TRUSTED_PROXY_HOPS: "1"
    volumes:
      - recap-data:/data
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    environment:
      DOMAIN: ${SITES}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on: [recap]
volumes:
  recap-data:
  caddy-data:
  caddy-config:
EOF

# The image may still be publishing right after a release; keep trying.
until docker compose pull; do echo "image not available yet, retrying in 30s"; sleep 30; done
docker compose up -d
docker image prune -f
echo "== recap up at https://${PRIMARY}"
