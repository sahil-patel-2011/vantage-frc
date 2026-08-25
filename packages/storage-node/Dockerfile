# Vantage storage node — container image for NAS / Docker hosts.
# The service is a single stdlib-only file; the image is just Node + that file.
#
#   docker build -t vantage-storage-node packages/storage-node
#   docker run --rm -it -v /volume1/vantage-storage:/data vantage-storage-node \
#     --setup --cloud https://your-vantage-host --name shop-nas --quota-gb 500
#   docker run -d --restart unless-stopped -p 8788:8788 \
#     -v /volume1/vantage-storage:/data vantage-storage-node
#
# NAS share permissions: the process runs as PUID:PGID (default 1000:1000 — the
# image's "node" user). Rebuild with --build-arg PUID/PGID, or override at run
# time with docker's --user, to match the owner of the mounted data folder.
# Full per-platform walkthroughs: docs/NAS_HOSTING.md.

FROM node:22-alpine

ARG PUID=1000
ARG PGID=1000
RUN set -eu; \
    if ! getent group "${PGID}" >/dev/null; then addgroup -g "${PGID}" vantage; fi; \
    if ! getent passwd "${PUID}" >/dev/null; then \
      adduser -D -H -u "${PUID}" -G "$(getent group "${PGID}" | cut -d: -f1)" vantage; \
    fi

WORKDIR /app
COPY server.mjs /app/server.mjs

# All state (config.json, items/, uploads/) lives under the mounted volume.
ENV VANTAGE_STORAGE_DIR=/data
VOLUME ["/data"]
EXPOSE 8788

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8788/health >/dev/null 2>&1 || exit 1

USER ${PUID}:${PGID}
ENTRYPOINT ["node", "/app/server.mjs"]
