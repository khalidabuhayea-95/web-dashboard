/**
 * Limits for the transactions that write a template row and its revision snapshot (create, save,
 * publish, rollback, Canva import).
 *
 * Prisma's interactive-transaction defaults are 2 s to get a connection and 5 s for the whole
 * transaction. Each of these writes the full design JSON twice (the row, then the snapshot), and
 * the dev database sits on another Mac across Tailscale with round trips that swing from 90 ms to
 * well over a second: publishing failed with P2028 ("timeout was 5000 ms, however 12252 ms
 * passed"), which the API reports as "The service is temporarily unavailable". A slow write is
 * still a good write, so give it room; a truly dead database still fails on the connection.
 */
export const TEMPLATE_WRITE_TRANSACTION_OPTIONS = Object.freeze({
  maxWait: 10_000,
  timeout: 30_000,
});
