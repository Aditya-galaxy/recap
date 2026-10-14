#!/bin/bash
# Recap on a Compute Engine VM: Docker + Recap + Caddy (automatic HTTPS).
# Runs on every boot; idempotent. Configuration comes from instance metadata:
#   recap-domain       e.g. 35-200-238-141.sslip.io or recap.example.com
#   recap-image        e.g. ghcr.io/aditya-galaxy/recap:v0.2.0
#   recap-setup-code   one-time code required to create the first (admin) account
set -euo pipefail
exec > >(tee -a /var/log/recap-startup.log) 2>&1
echo "== recap startup $(date -Is)"

meta() { curl -fsS -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1" || true; }
DOMAIN=$(meta recap-domain)
IMAGE=$(meta recap-image)
SETUP_CODE=$(meta recap-setup-code)

# 2 GB swap: whisper + ffmpeg on a 2 GB VM can spike past RAM on long videos.
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
IMAGE=${IMAGE}
SETUP_CODE=${SETUP_CODE}
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
      PUBLIC_URL: https://${DOMAIN}
      ALLOW_SIGNUP: "false"
      SETUP_CODE: ${SETUP_CODE}
      MAX_UPLOAD_MB: "4096"
      WHISPER_MODEL_NAME: base.en
    volumes:
      - recap-data:/data
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    environment:
      DOMAIN: ${DOMAIN}
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
echo "== recap up at https://${DOMAIN}"
