import cron from "node-cron";
import { runActivityRollup } from "../services/activityRollupService";
import { withLock } from "../services/distributedLock";
import { recordJobRun } from "../services/systemJobRun";
import { logger } from "../lib/logger";

// A full day's ActivityEvent scan across ~20 types is cheap relative to the
// other crons' external-API calls — generous headroom regardless.
const LOCK_TTL_MS = 15 * 60 * 1000;

// Once a day, well after midnight IST so every event from "yesterday" (UTC)
// has already landed — offset from the other 6/6:30/7am jobs so they don't
// all contend for the DB at the same moment.
export function startActivityRollupCron() {
  cron.schedule(
    "30 7 * * *",
    () => {
      withLock("cron-lock:activity-rollup", LOCK_TTL_MS, () => recordJobRun("activityRollup", runActivityRollup)).catch((err) => {
        logger.error({ err }, "[activityRollup] scheduled run failed");
      });
    },
    { timezone: "Asia/Kolkata" }
  );
}

// Allows `tsx src/jobs/activityRollup.cron.ts --once` for manual testing.
if (require.main === module && process.argv.includes("--once")) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { connectDb, disconnectDb } = require("../db/connect");
  connectDb()
    .then(() => runActivityRollup())
    .then((summary: unknown) => {
      // eslint-disable-next-line no-console
      console.log("[activityRollup] one-off run complete", summary);
    })
    .then(() => disconnectDb())
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
