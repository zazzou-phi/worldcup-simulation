FROM node:22-bookworm-slim

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
COPY docker/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
  && cd engine && npm run build \
  && cd ../web && npm run build:shared && npx vite build --base /

ENV NODE_ENV=production
EXPOSE 2026

ENTRYPOINT ["/entrypoint.sh"]
