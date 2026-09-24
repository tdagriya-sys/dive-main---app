import cron from "node-cron";
import { runInstrumentRefresh } from "../services/instrumentService";
import { withLock } from "../services/distributedLock";
import { recordJobRun } from "../services/systemJobRun";
import { logger } from "../lib/logger";

// 20-minute lock TTL — generous headroom over this job's realistic worst case
// (several external sources, each bounded at a 10s axios timeout — see
// instrumentSources.ts) so the lock can never expire mid-run under normal
// conditions, while still self-clearing if a process crashes mid-job instead
// of leaving every future run permanently locked out.
const LOCK_TTL_MS = 20 * 60 * 1000;

export function startInstrumentRefreshCron() {
  cron.schedule(
    "0 6 * * *",
    () => {
      // Cross-instance guard (docs/PRODUCTION_READINESS_AUDIT.md #7) — see
      // services/distributedLock.ts. Fails open (still runs) if Redis isn't
      // configured/reachable, so a single-instance or Redis-less dev setup
      // behaves exactly as before this existed. recordJobRun (Phase 1 —
      // System Health) is INSIDE the lock so a run another instance skipped
      // (lock already held) is never itself logged as a "run".
      withLock("cron-lock:instrumentRefresh", LOCK_TTL_MS, () => recordJobRun("instrumentRefresh", runInstrumentRefresh)).catch((err) => {
        logger.error({ err }, "[instrumentRefresh] scheduled run failed");
      });
    },
    { timezone: "Asia/Kolkata" }
  );
}

// Allows `tsx src/jobs/instrumentRefresh.cron.ts --once` for manual testing.
if (require.main === module && process.argv.includes("--once")) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { connectDb, disconnectDb } = require("../db/connect");
  connectDb()
    .then(() => runInstrumentRefresh())
    .then(() => disconnectDb())
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
