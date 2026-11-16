# Deploying to Hetzner Cloud

Production is one Hetzner Cloud server running the compose stack: Caddy, Next.js, the import
worker and Postgres. Media lives on Cloudflare R2. AI runs in two places:
- Replicate, for every image feature (edit, expand, upscale, object removal, background
  removal, generation, the AI tools).
- In-process, for Arabic tashkeel: ichkil, a 21 MB ONNX model on the app server's own CPU. It
  takes a few milliseconds, needs no GPU, and runs nowhere else. How requests are split across the three domains is in
[architecture.md](architecture.md).

```
users ──► Caddy (TLS: nayroz.com, www, admin, api) ──► Next.js (web) ──► Postgres
                                                     └► import worker     └► R2 (media, backups)
Next.js ──► Replicate (image AI)  ·  tashkeel: in-process (ichkil ONNX, CPU)
```

## Why this setup

| Part | Choice | Cost (Nov 2026) |
| --- | --- | --- |
| App server | Hetzner **CX33** (4 vCPU, 8 GB, 80 GB NVMe, 20 TB traffic), Nuremberg or Falkenstein | €8.99/mo incl. IPv4 |
| Server backups | Hetzner Backups (7 daily images) | +20% (≈ €1.70) |
| Database dumps | `deploy/backup-db.sh` nightly, local plus a private R2 bucket | R2 storage only |
| Tashkeel model | ichkil inside the Next server (onnxruntime-node, 2 threads), baked into the image | €0 |
| Images | GitHub Container Registry, built by `.github/workflows/docker.yml` | free |

- **8 GB rather than 4 GB.** The worker runs Chromium for imports and ffmpeg for previews,
  and Postgres shares the box.
- **CX availability.** Hetzner marks the CX line "limited". Create the server early, because
  its hourly price is fixed once it exists. If CX is unavailable, the fallbacks are:
  - **CAX21** (ARM, €10.99). Every native dependency ships linux-arm64. The image workflow
    would need `platforms: linux/arm64`, and that build should be tried once first.
  - **CPX32** in Helsinki (≈ €30.49).
- **Tashkeel runs on this server, on the CPU.**
  - It was Fine-Tashkeel: 2.7 GB of weights, 7–34 s per text on CPU, so it would have
    needed a GPU.
  - It was replaced by ichkil after a benchmark on our own texts (2026-11-16): the same
    accuracy (2.9% diacritic error rate on greetings, du'a and verses), at about 2.5 ms per
    text, with a 21 MB model.
  - The Node port gives byte-identical output to the reference Python package on 88 texts
    (`src/lib/text/tashkeel/ichkil.server.test.ts`).
  - Through the live route it measured ~45 ms per request, including auth and credits,
    after a one-time ~0.7 s model load.

## One-time setup

1. **GitHub (Actions variables).** Set `IOS_TEAM_ID` (Settings → Secrets and variables →
   Actions → Variables). Every push to `main` then builds
   `ghcr.io/khalidabuhayea-95/web-dashboard:<sha>` and `:main`.
2. **Create the server** in Hetzner Cloud Console → Add Server:
   - Location: Nuremberg or Falkenstein.
   - Image: Ubuntu 24.04.
   - Type: CX33.
   - SSH key: yours.
   - Backups: on.
   - Cloud config: paste [`deploy/cloud-init.yml`](../deploy/cloud-init.yml).

   It boots with Docker, a `deploy` user (your key), 4 GB swap, fail2ban, automatic security
   updates and the nightly backup cron. Root and password logins are off.
3. **Firewall.** In Hetzner Cloud → Firewalls, allow inbound TCP 22 (ideally only your IP),
   TCP 80, TCP 443 and UDP 443, and apply it to the server. Use this instead of ufw, because
   Docker's published ports bypass ufw.
4. **DNS.** Point A (and AAAA) records for `nayroz.com`, `www`, `admin` and `api` at the
   server. Do this before the first deploy: Caddy can only get certificates for names that
   already resolve to it.
5. **GHCR access.** If the package is private, create a GitHub token with only
   `read:packages`, then:
   ```bash
   ssh deploy@<server> 'echo <token> | docker login ghcr.io -u <github-user> --password-stdin'
   ```
6. **Secrets.** Copy `.env.production.example` to `/srv/nayroz/.env.production` on the
   server, fill in every value, and `chmod 600` it. This file never leaves the server.
7. **Off-site backups.** Create a private R2 bucket, add a lifecycle rule (delete after 30
   days), and set `BACKUP_R2_BUCKET`.

## Deploy, update, roll back

```bash
deploy/deploy.sh <server-ip>              # deploys the current commit (its image must be built)
deploy/deploy.sh <server-ip> <older-sha>  # rollback
```

The script:
- copies the compose files and Caddyfile;
- pulls the pinned image;
- applies Prisma migrations;
- starts everything;
- checks `https://api.nayroz.com/v1/health` through Caddy.

`/srv/nayroz/DEPLOYED_TAG` records what is running. Wait for the "Docker image" workflow to
finish for that commit before deploying it.

After the first deploy, run the go-live checks in [architecture.md](architecture.md).

## Restore a backup

```bash
ssh deploy@<server>
cd /srv/nayroz
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
$C stop web worker
$C exec -T postgres pg_restore -U nayroz_user -d nayroz_app --clean --if-exists < backups/<file>.dump
$C start web worker
```

Off-site copies are in `s3://$BACKUP_R2_BUCKET/db/`. A whole-server rollback uses the Hetzner
Backups images.

## AI worker (optional)

Production does not need it. Tashkeel runs in-process (`TASHKEEL_PROVIDER` unset = ichkil),
and image AI uses Replicate. The `ai-worker/` image (RunPod Serverless) is only needed if one of
these is switched on:
- `TASHKEEL_PROVIDER=selfhost`, for the old Fine-Tashkeel path;
- the `selfhost/*` object-removal or upscale models.

In that case:
1. Build the lean image (tashkeel + CPU-class weights, no diffusion models):
   ```bash
   docker build --platform linux/amd64 --build-arg BAKE_DIFFUSION=0 -t <registry>/nayroz-ai-worker ai-worker
   ```
2. Create a RunPod Serverless endpoint from it:
   - smallest GPU class;
   - FlashBoot on;
   - 0 active workers;
   - a max-workers cap.
3. Set `SELFHOST_AI_URL` and `SELFHOST_AI_TOKEN`.

## Growing

1. **Vertical:** rescale CX33 → CX43 (8 vCPU, 16 GB, €16.49) in the console. It takes a few
   minutes of downtime.
2. **Database apart:** move Postgres to its own server on a Hetzner private network, and point
   `DATABASE_URL` at it.
3. **Horizontal:**
   - Add a Hetzner Load Balancer (€7.49 with IPv4) and more app servers on the private network.
   - Give the extra ones `NAYROZ_SURFACES=api` to scale the API alone.
   - Caddy moves to the load balancer (TLS), or stays on each node behind it.
