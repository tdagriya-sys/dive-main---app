import os from "os";
import { SystemJobRun } from "../models/SystemJobRun";
import { logger } from "../lib/logger";

/**
 * Records one execution of a scheduled job (Phase 1 of docs/ADMIN_PANEL_PLAN.md).
 * Wraps `fn` — never swallows its result or error, just observes them — so the
 * admin System screen can show real start/finish/ok/error/stats per run
 * instead of only what's in the process's own stdout logs.
 *
 * The DB write itself is best-effort: a failure to RECORD a run must never be
 * what makes the underlying job (instrument refresh, valuation refresh) fail.
 */
export async function recordJobRun<T>(job: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = new Date();
  try {
    const result = await fn();
    const stats = summarizeStats(result);
    await SystemJobRun.create({ job, startedAt, finishedAt: new Date(), ok: true, stats, host: os.hostname() }).catch((err) =>
      logger.warn({ err, job }, "[systemJobRun] failed to record a successful run")
    );
    return result;
  } catch (err) {
    await SystemJobRun.create({
      job,
      startedAt,
      finishedAt: new Date(),
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      host: os.hostname(),
    }).catch((recordErr) => logger.warn({ err: recordErr, job }, "[systemJobRun] failed to record a failed run"));
    throw err;
  }
}

// Keeps the stored `stats` small and JSON-safe — an array result (e.g.
// instrumentRefresh's RefreshSummary[]) is summarized by length + itself if
// small, rather than risking an unbounded document.
function summarizeStats(result: unknown): Record<string, unknown> | undefined {
  if (result === undefined) return undefined;
  if (Array.isArray(result)) return { count: result.length, items: result.slice(0, 20) };
  if (typeof result === "object" && result !== null) return result as Record<string, unknown>;
  return { value: result };
}
