# Single image shared by the web (next start) and the import worker
# (npm run worker). Deliberately not deploy-optimized — no standalone output,
# no non-root user, dev deps kept (next build needs typescript/eslint; the
# worker needs tsx at runtime). Goal: builds + runs locally under compose.
FROM node:22-bookworm

# System libraries:
#  - node-canvas: cairo / pango / jpeg / gif / rsvg / pixman (+ build tools as
#    a source-compile fallback if no prebuilt binary matches)
#  - Freepik import: unzip (hard-coded /usr/bin/unzip in freepikImport.server.js)
#  - fonts for canvas text rendering + Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential pkg-config python3 \
      libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev libpixman-1-dev \
      unzip fontconfig fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for layer caching. Dev deps are intentionally included.
COPY package.json package-lock.json ./
RUN npm ci

# Chromium + its system deps for the Canva import path, matched to the
# project's pinned Playwright version.
RUN npx playwright install --with-deps chromium

# App source (see .dockerignore: excludes node_modules, .next, .venv-rembg, .env*)
COPY . .

# Build-time placeholders ONLY. Some route modules validate env at import time,
# which `next build` triggers during page-data collection — and prisma's schema
# references env("DATABASE_URL"). These are NOT real secrets and are passed
# inline so they never bake into the final image; runtime values come from
# docker-compose. (Auth-gated pages are force-dynamic, so no DB is hit at build.)
ARG AUTH_SECRET=build-time-placeholder
ARG DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder
RUN DATABASE_URL="$DATABASE_URL" npx prisma generate
RUN AUTH_SECRET="$AUTH_SECRET" DATABASE_URL="$DATABASE_URL" npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Web entrypoint by default; the worker service overrides command in compose.
CMD ["npm", "run", "start"]
