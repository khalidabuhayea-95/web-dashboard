# Nayroz web

One Next.js project that serves three surfaces, each on its own subdomain:

| Surface   | Domain             | Code                                    |
| --------- | ------------------ | --------------------------------------- |
| Website   | `nayroz.com`       | `public/website/`, `src/app/(website)/` |
| Dashboard | `admin.nayroz.com` | `src/app/(dashboard)/`                  |
| API       | `api.nayroz.com`   | `src/app/api/` (public contract `/v1`)  |

Shared code lives in `src/lib/`, `src/components/` and `src/store/`. How requests are split, the
folder rules (`npm run lint` enforces them), API versioning and the go-live checklist are all in
**[docs/architecture.md](docs/architecture.md)**.

## Develop

```bash
npm install
npm run dev
```

The dev server mirrors production by hostname:

- http://localhost:3000 is the website.
- http://admin.localhost:3000 is the dashboard.
- http://api.localhost:3000/v1/health is the API.

Phones and simulators reach the API by IP (`127.0.0.1`, `10.0.2.2` or your LAN IP).

The database is Postgres, configured by `DATABASE_URL` in `.env.local`. Copy `.env.example` to
start, and apply schema changes with Prisma migrations.

## Checks

```bash
npm test               # every unit test (src/**/*.test.*) + the Canva importer's tests
npm run lint           # ESLint (incl. section boundaries) + mobile OpenAPI coverage gate
npx tsc --noEmit       # types
```

CI (`.github/workflows/ci.yml`) runs all three, plus the build, on every push and PR.

A few tests need a real Postgres: credit reservations, search and taxonomy counts. Locally
they skip unless `NAYROZ_TEST_DATABASE_URL` points at a throwaway database with migrations
applied (never the dev database). CI provides one. The `smoke:*` scripts exercise a running
setup against real services.

## Deploy

`docker compose -f docker-compose.yml -f docker-compose.prod.yml …`: Caddy (TLS for the four
names) in front of the Next server and the import worker. Secrets go in `.env.production`
(template: `.env.production.example`). The steps are in
[docs/architecture.md](docs/architecture.md#go-live-checklist-when-the-server-exists).

## Other folders

- `extensions/canva-importer/`: Chrome extension that imports Canva and CapCut designs.
- `ai-worker/`: self-hosted AI worker (Python, its own Docker image).
- `docs/`: specs, handoffs and audits (`docs/audits/`).
- `scripts/`: maintenance and smoke scripts run with `npm run …`.
