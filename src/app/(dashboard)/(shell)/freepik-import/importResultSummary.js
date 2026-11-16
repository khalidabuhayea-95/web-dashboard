/**
 * Breaks an import result into parts that ADD UP to what was requested.
 *
 * The element importer drops perceptual duplicates without counting them as failures, so a run
 * of 95 that reports "imported 46, failed 0" silently loses 49. Anything the known counters do
 * not explain is surfaced as `unaccounted` rather than disappearing — a future skip path then
 * shows up as a number instead of a mystery.
 */
export function summarizeImportResult(result) {
  const imported = Number(result?.imported || 0);
  const duplicates = Number(result?.duplicates || 0);
  const skipped = Number(result?.skipped || 0);
  const failed = Number(result?.failed || 0);
  const requested = Number(result?.totalRequested || 0);
  const unaccounted = Math.max(0, requested - imported - duplicates - skipped - failed);
  return { imported, duplicates, skipped, failed, requested, unaccounted };
}

/** "Imported 46 · Already in library 49 · Requested 95" — zero-valued parts are left out. */
export function formatImportResult(result, separator = " \u00b7 ") {
  const s = summarizeImportResult(result);
  const parts = [`Imported ${s.imported}`];
  if (s.duplicates > 0) parts.push(`Already in library ${s.duplicates}`);
  if (s.skipped > 0) parts.push(`Skipped ${s.skipped}`);
  if (s.unaccounted > 0) parts.push(`Unaccounted ${s.unaccounted}`);
  parts.push(`Failed ${s.failed}`, `Requested ${s.requested}`);
  return parts.join(separator);
}
