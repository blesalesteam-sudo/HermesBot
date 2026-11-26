# hermesbot-next: el nuevo hermesBot. Parte de OpenMausBot (Apache-2.0) en una versión
# fijada, sin su carpeta de funciones de pago, con nuestros cambios aplicados encima
# (carpeta patches/), y con Hermes Agent en la misma máquina como motor de los bots.
#
# Para subir de versión de OpenMausBot se cambia OMB_COMMIT. Para cambiar la app se
# añade un parche en patches/. Así nunca se reescribe: solo se quita y se añade.
ARG HERMES_IMAGE=nousresearch/hermes-agent@sha256:ef0650d523ee1b5ab32c779acabc446d9936869a9932591553688a62bcf0c42f

FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git patch \
  && rm -rf /var/lib/apt/lists/* && npm install -g pnpm@10.33.0
ARG OMB_REPO=https://github.com/milind-soni/OpenMausBot.git
ARG OMB_COMMIT=83d18e3af95960a9791aacd662c0d6e38a929934
WORKDIR /src
RUN git init -q . && git remote add origin "$OMB_REPO" \
  && git fetch -q --depth 1 origin "$OMB_COMMIT" && git checkout -q FETCH_HEAD \
  && rm -rf enterprise .git
# Lo que casi nunca cambia va primero, para que Railway lo guarde y no lo repita:
# descargar dependencias y el motor de datos solo depende de la versión de la base.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
# Solo la app principal y solo para procesadores x64: no se bajan la web de
# documentación, el panel de Cloudflare ni las piezas para ARM (unos 1,2 GB menos).
RUN sed -i '/^supportedArchitectures:/,/^allowBuilds:/{/- arm64/d}' pnpm-workspace.yaml \
  && pnpm install --frozen-lockfile --filter openmausbot
RUN OMB_DUCKDB_ARCH=x64 node scripts/prepare-duckdb.mjs && mv dist-native/duckdb/linux-x64 dist-native/duckdb/target
# Lo que cambia a menudo (nuestros parches e imágenes) va después.
COPY patches/ /patches/
RUN for p in /patches/*.patch; do [ -e "$p" ] || continue; echo "aplicando $p"; patch -p1 < "$p"; done
# Archivos que un parche de texto no puede llevar (imágenes, iconos), con las mismas rutas que la base.
COPY overlay/ /src/
RUN pnpm build:server && NODE_OPTIONS=--max-old-space-size=6144 pnpm exec vite build

FROM ${HERMES_IMAGE}
COPY --from=build /src/dist-native/duckdb/target /app/duckdb
COPY --from=build /src/dist-server /app/dist-server
COPY --from=build /src/dist /app/dist
COPY --from=build /src/skills /app/skills
# Avisos de licencia de OpenMausBot, que hay que conservar.
COPY --from=build /src/LICENSE /src/NOTICE /app/
COPY edge.mjs start.sh /opt/hermesbot/
RUN chmod +x /opt/hermesbot/start.sh \
  && printf '#!/bin/sh\nexec node /app/dist-server/openmausbot.js "$@"\n' > /usr/local/bin/hermesbot \
  && chmod 0755 /usr/local/bin/hermesbot

# El arranque oficial de la imagen de Hermes se mantiene: prepara permisos y carpetas
# de /opt/data y después ejecuta este script con el usuario "hermes".
CMD ["/opt/hermesbot/start.sh"]
