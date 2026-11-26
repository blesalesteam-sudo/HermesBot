# hermes-core: el "cerebro". Es la imagen oficial de Hermes Agent, sin modificar,
# más un pequeño puente seguro para que la web de hermesBot pueda hablar con él.
#
# Todo lo que Hermes aprende y guarda (memoria, sesiones, skills, rutinas, claves)
# vive en /opt/data. En Railway hay que conectar un "Volume" en esa ruta.
#
# Versión fijada: Hermes Agent v0.23.4 (imagen "latest" del 24-nov-2026). Fijarla evita que una
# actualización inesperada rompa la web. Para actualizar Hermes, se cambia esta línea.
ARG HERMES_IMAGE=nousresearch/hermes-agent@sha256:ef0650d523ee1b5ab32c779acabc446d9936869a9932591553688a62bcf0c42f
FROM ${HERMES_IMAGE}

COPY bridge/package.json bridge/package-lock.json /opt/hermesbot/bridge/
RUN cd /opt/hermesbot/bridge && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY bridge/bridge.mjs /opt/hermesbot/bridge/bridge.mjs
COPY start.sh /opt/hermesbot/start.sh
RUN chmod +x /opt/hermesbot/start.sh

ENV BRIDGE_PORT=8080
EXPOSE 8080

# El arranque oficial de la imagen (entrypoint) se mantiene: prepara permisos y carpetas
# y después ejecuta este script con el usuario "hermes".
CMD ["/opt/hermesbot/start.sh"]
