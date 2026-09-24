import cron from "node-cron";
import { runDailyValuationRefresh } from "../services/holdingValuationService";
import { withLock } from "../services/distributedLock";
import { recordJobRun } from "../services/systemJobRun";
import { logger } from "../lib/logger";

// Generous headroom over this job's realistic worst case (every user's
// market-priced holdings, each a live price lookup) — see the matching
// constant's comment in instrumentRefresh.cron.ts for the full reasoning.
const LOCK_TTL_MS = 30 * 60 * 1000;

// 30 minutes after instrumentRefresh.cron.ts's own 6am IST run — no hard
// dependency between the two (holdings link to whatever Instrument doc
// already exists, refreshed or not), just avoiding both daily jobs hitting
// external APIs and the DB at the exact same moment on server startup.
export function startValuationRefreshCron() {
  cron.schedule(
    "30 6 * * *",
    () => {
      // Cross-instance guard (docs/PRODUCTION_READINESS_AUDIT.md #7) — see
      // services/distributedLock.ts. Fails open (still runs) if Redis isn't
      // configured/reachable. recordJobRun (Phase 1 — System Health) is
      // INSIDE the lock so a skipped run is never itself logged as a "run".
      withLock("cron-lock:valuationRefresh", LOCK_TTL_MS, () => recordJobRun("valuationRefresh", runDailyValuationRefresh)).catch((err) => {
        logger.error({ err }, "[valuationRefresh] scheduled run failed");
      });
    },
    { timezone: "Asia/Kolkata" }
  );
}

// Allows `tsx src/jobs/valuationRefresh.cron.ts --once` for manual testing.
if (require.main === module && process.argv.includes("--once")) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { connectDb, disconnectDb } = require("../db/connect");
  connectDb()
    .then(() => runDailyValuationRefresh())
    .then((summary: unknown) => {
      // eslint-disable-next-line no-console
      console.log("[valuationRefresh] one-off run complete", summary);
    })
    .then(() => disconnectDb())
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
