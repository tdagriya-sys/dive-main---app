import cron from "node-cron";
import { runDailyValuationRefresh } from "../services/holdingValuationService";

// 30 minutes after instrumentRefresh.cron.ts's own 6am IST run — no hard
// dependency between the two (holdings link to whatever Instrument doc
// already exists, refreshed or not), just avoiding both daily jobs hitting
// external APIs and the DB at the exact same moment on server startup.
export function startValuationRefreshCron() {
  cron.schedule(
    "30 6 * * *",
    () => {
      runDailyValuationRefresh().catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[valuationRefresh] scheduled run failed", err);
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
