# syntax=docker/dockerfile:1.7

FROM node:22-bookworm AS frontend-build
WORKDIR /app/web
# Vite reads these at build-time and inlines them into the bundle.
# Pass via --build-arg or the docker-compose build.args block.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_BASE=/api
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_API_BASE=$VITE_API_BASE
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-bookworm AS backend-build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install
COPY backend/ ./
RUN npm run build && cp -r data dist/data

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Runtime needs only nginx (static frontend) + ca-certificates (TLS to
# Supabase/OpenAI). Playwright/Chromium were dropped 2026-06-04 — server-side
# scraping is replaced by the browser extension, so the chromium binary +
# xvfb/X11/font deps are no longer needed (saves ~600 MB image size).
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY backend/package*.json ./
# We still install --include=dev because backend ships compiled JS that is
# loaded with tsx-style ESM at runtime via npm scripts. Playwright is a
# regular dep, but no chromium binary is downloaded (we removed
# `npx playwright install`); calls into the scraper module will throw at
# request time, which is fine because the route is no longer mounted in
# server.ts (the extension-based import path is the supported flow).
RUN npm install --include=dev

COPY backend/ ./
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=frontend-build /app/web/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/sites-enabled/default
COPY deploy/start.sh /app/start.sh

RUN chmod +x /app/start.sh
EXPOSE 80
CMD ["/app/start.sh"]
