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

# Idioma: español, salvo que ya se haya elegido otro en Ajustes. Sin esto la app sigue el idioma
# del sistema, que en Railway es inglés, y los bots escriben en inglés (por ejemplo el resumen diario).
OMB_DEFAULT_LANGUAGE="${OMB_DEFAULT_LANGUAGE:-es}" node -e '
const fs = require("node:fs"), path = require("node:path");
const file = path.join(process.env.OMB_DATA_DIR, "config.json");
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") process.exit(0); }
if (!cfg.language) { cfg.language = process.env.OMB_DEFAULT_LANGUAGE; fs.writeFileSync(file, JSON.stringify(cfg, null, 2)); }
'

node /opt/hermesbot/edge.mjs &

cd /app
exec node dist-server/server-launcher.js
