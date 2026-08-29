# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.10-debian AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN bun run build

FROM oven/bun:1.3.10-debian AS runtime
WORKDIR /app

LABEL org.opencontainers.image.title="KeepIndex" \
      org.opencontainers.image.description="Private, local-first federated search." \
      org.opencontainers.image.source="https://github.com/akougkas/keepindex" \
      org.opencontainers.image.url="https://keepindex.ing" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.licenses="Apache-2.0"

# Local document extraction remains useful in the container: PDF extraction
# uses Poppler and the remaining supported document formats use Pandoc.
RUN DEBIAN_FRONTEND=noninteractive apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates pandoc poppler-utils \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY --from=dependencies /app/node_modules/hono ./node_modules/hono
COPY --from=build /app/dist ./dist
COPY --chown=bun:bun server ./server
COPY --chown=bun:bun cli ./cli

RUN mkdir -p /data /home/keepindex/documents \
  && chown -R bun:bun /data /home/keepindex

ENV NODE_ENV=production \
    PORT=5173 \
    KEEPINDEX_DB_PATH=/data/keepindex.sqlite

USER bun
EXPOSE 5173
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=8s --start-period=15s --retries=5 \
  CMD bun -e "const response = await fetch('http://127.0.0.1:5173/api/health'); if (!response.ok) process.exit(1)"

CMD ["bun", "server/production.ts"]
