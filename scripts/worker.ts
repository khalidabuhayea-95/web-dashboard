/**
 * Standalone import-jobs worker.
 *
 * Runs the drain loop directly against the import_jobs table via
 * drainImportJobs() — NOT through the HTTP /api/tools/import-jobs/worker
 * endpoint (which stays as a manual recovery trigger). This process is the
 * thing that should execute imports in production; the web app only enqueues.
 *
 * Run with:   npm run worker
 * (uses tsx so the @/* alias + the .ts/.js ESM lib graph resolve without a
 *  separate build. The dependency graph is framework-free — see
 *  src/lib/tools/canvaImport.server.ts.)
 *
 * Shared state is Postgres + R2 only. No local-disk/in-memory state is shared
 * with the web process.
 *
 * Config (env):
 *   IMPORT_JOBS_WORKER_ID            label recorded in import_jobs.locked_by
 *   IMPORT_JOBS_WORKER_BATCH         jobs drained per cycle (default 1)
 *   IMPORT_JOBS_WORKER_POLL_MS       idle poll interval (default 2000)
 *   IMPORT_JOBS_WORKER_BUSY_MS       delay between busy cycles (default 250)
 *   IMPORT_JOBS_WORKER_STALE_SECONDS stale-running requeue threshold (default 300)
 *   IMPORT_JOBS_WORKER_ERROR_MS      backoff after a failed cycle (default 5000)
 */

import { drainImportJobs } from "@/lib/tools/importJobsRunner.server";
import { logger } from "@/lib/logging/logger";

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

const BATCH = intEnv("IMPORT_JOBS_WORKER_BATCH", 1, 1, 20);
const POLL_MS = intEnv("IMPORT_JOBS_WORKER_POLL_MS", 2000, 250, 60_000);
const BUSY_MS = intEnv("IMPORT_JOBS_WORKER_BUSY_MS", 250, 0, 60_000);
const STALE_SECONDS = intEnv("IMPORT_JOBS_WORKER_STALE_SECONDS", 300, 30, 3600);
const ERROR_MS = intEnv("IMPORT_JOBS_WORKER_ERROR_MS", 5000, 250, 120_000);

let shuttingDown = false;
let wakeUp: (() => void) | null = null;

// Sleep that resolves early when a shutdown signal arrives, so an idle worker
// exits promptly instead of waiting out the poll interval.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wakeUp = null;
      resolve();
    }, ms);
    wakeUp = () => {
      clearTimeout(timer);
      wakeUp = null;
      resolve();
    };
  });
}

function requestShutdown(signal: string): void {
  if (shuttingDown) {
    // Second signal: operator wants out now. The in-flight job (if any) will be
    // recovered by the stale-requeue + attempts cap on the next worker start.
    logger.warn("Import worker force exit", { signal });
    process.exit(1);
    return;
  }
  shuttingDown = true;
  logger.info("Import worker shutdown requested; finishing in-flight job", { signal });
  if (wakeUp) wakeUp();
}

async function runLoop(): Promise<void> {
  while (!shuttingDown) {
    let outcome;
    try {
      // BATCH defaults to 1 so we re-check the shutdown flag between jobs and a
      // SIGTERM lets the current job finish before we stop claiming new ones.
      outcome = await drainImportJobs({ limit: BATCH, staleAfterSeconds: STALE_SECONDS });
    } catch (error: any) {
      logger.error("Import worker drain cycle failed", { error: error?.message });
      await sleep(ERROR_MS);
      continue;
    }

    if (outcome.processed > 0 || outcome.recovered > 0) {
      logger.info("Import worker drain cycle", {
        processed: outcome.processed,
        succeeded: outcome.succeeded,
        failed: outcome.failed,
        recovered: outcome.recovered,
        skipped: outcome.skipped,
      });
    }

    if (shuttingDown) break;

    // Work was found → loop again quickly; otherwise idle-poll.
    await sleep(outcome.processed > 0 ? BUSY_MS : POLL_MS);
  }
}

async function main(): Promise<void> {
  if (!process.env.IMPORT_JOBS_WORKER_ID) {
    process.env.IMPORT_JOBS_WORKER_ID = `worker-${process.pid}`;
  }
  process.on("SIGTERM", () => requestShutdown("SIGTERM"));
  process.on("SIGINT", () => requestShutdown("SIGINT"));

  logger.info("Import worker started", {
    workerId: process.env.IMPORT_JOBS_WORKER_ID,
    batch: BATCH,
    pollMs: POLL_MS,
    staleSeconds: STALE_SECONDS,
  });

  await runLoop();

  logger.info("Import worker stopped");
  process.exit(0);
}

main().catch((error: any) => {
  logger.error("Import worker crashed", { error: error?.message, stack: error?.stack });
  process.exit(1);
});
