#!/bin/sh
# Arranque del nuevo hermesBot en Railway: la app (basada en OpenMausBot) y Hermes
# viven en la misma máquina. Todo lo que se guarda está en /opt/data (el volumen).
set -e

export HERMES_HOME="${HERMES_HOME:-/opt/data}"
export HOME="${HOME:-/opt/data}"
export OMB_DATA_DIR="${OMB_DATA_DIR:-/opt/data/.openmausbot}"
export OMB_STATIC_DIR=/app/dist
export OMB_DUCKDB_DIR=/app/duckdb
export OMB_PORT=8799
export OMB_WEBHOOK_PORT=8800
export OMB_TUNNEL_SOCKET=/tmp/hermesbot/http.sock
export NODE_ENV=production
mkdir -p /tmp/hermesbot "$OMB_DATA_DIR"

# Dirección pública: la que da Railway, salvo que se indique otra.
if [ -z "$OMB_PUBLIC_URL" ] && [ -n "$RAILWAY_PUBLIC_DOMAIN" ]; then
  export OMB_PUBLIC_URL="https://$RAILWAY_PUBLIC_DOMAIN"
fi
export OMB_SERVER_NAME="${OMB_SERVER_NAME:-OpenBot}"

node /opt/hermesbot/edge.mjs &

cd /app
exec node dist-server/server-launcher.js
