FROM node:22-bookworm-slim AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY engine/package.json engine/package-lock.json ./engine/
COPY web/package.json web/package-lock.json ./web/

RUN cd engine && npm ci \
  && cd ../web && npm ci

COPY engine ./engine
COPY web ./web
COPY data ./data

RUN cd engine && npm run build \
  && cd ../web && npm run build:shared && npx vite build --base /

FROM node:22-bookworm-slim AS runner

WORKDIR /app

COPY --from=builder /app/engine/package.json /app/engine/package-lock.json ./engine/
COPY --from=builder /app/web/package.json /app/web/package-lock.json ./web/
COPY --from=builder /app/engine/node_modules ./engine/node_modules
COPY --from=builder /app/web/node_modules ./web/node_modules
COPY --from=builder /app/engine/dist ./engine/dist
COPY --from=builder /app/engine/src ./engine/src
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/web/server.ts ./web/server.ts
COPY --from=builder /app/data ./data
COPY docker/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
EXPOSE 2026

ENTRYPOINT ["/entrypoint.sh"]
