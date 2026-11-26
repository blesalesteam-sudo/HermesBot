#!/bin/sh
# Arranque de hermes-core en Railway.
set -e

export HERMES_HOME="${HERMES_HOME:-/opt/data}"

# Configuración opcional del modelo desde variables de Railway (solo si están puestas).
# Así no hace falta entrar a ninguna terminal para elegir el modelo.
set_cfg() { [ -n "$2" ] && hermes config set "$1" "$2" >/dev/null 2>&1 && echo "[hermes-core] $1 configurado" || true; }
set_cfg model.provider "$HERMES_MODEL_PROVIDER"
set_cfg model.default "$HERMES_MODEL"
set_cfg model.base_url "$HERMES_MODEL_BASE_URL"

# 1) El gateway de Hermes (queda supervisado: si se cae, se reinicia solo).
hermes gateway run &

# 2) El puente seguro por el que entra la web. Si el puente se para, el contenedor se
#    reinicia entero, que es lo que queremos.
exec node /opt/hermesbot/bridge/bridge.mjs
