# syntax=docker/dockerfile:1.7

FROM node:20-bookworm AS frontend-build
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

FROM node:20-bookworm AS backend-build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install
COPY backend/ ./
RUN npm run build && cp -r data dist/data

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    ca-certificates \
    wget \
    xvfb \
    x11-utils \
    fonts-liberation \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install --include=dev
RUN npx playwright install --with-deps chromium

COPY backend/ ./
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=frontend-build /app/web/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/sites-enabled/default
COPY deploy/start.sh /app/start.sh

RUN chmod +x /app/start.sh
EXPOSE 80
CMD ["/app/start.sh"]
