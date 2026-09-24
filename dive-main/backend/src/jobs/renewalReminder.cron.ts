import cron from "node-cron";
import { runRenewalReminderSweep } from "../services/subscriptionService";
import { withLock } from "../services/distributedLock";
import { recordJobRun } from "../services/systemJobRun";
import { logger } from "../lib/logger";

const LOCK_TTL_MS = 15 * 60 * 1000;

// Runs before the other subscription-lifecycle crons (trial-expiry 6:00,
// this at 6:15, subscription-cancel-notice 6:45, dunning 7:00) so a fresh
// reminder always reflects the subscription's state as of this cycle's own
// run, not a stale one from a sweep later in the same morning.
export function startRenewalReminderCron() {
  cron.schedule(
    "15 6 * * *",
    () => {
      withLock("cron-lock:renewal-reminder", LOCK_TTL_MS, () => recordJobRun("renewal-reminder", runRenewalReminderSweep)).catch((err) => {
        logger.error({ err }, "[renewal-reminder] scheduled run failed");
      });
    },
    { timezone: "Asia/Kolkata" }
  );
}

// Allows `tsx src/jobs/renewalReminder.cron.ts --once` for manual testing.
if (require.main === module && process.argv.includes("--once")) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { connectDb, disconnectDb } = require("../db/connect");
  connectDb()
    .then(() => runRenewalReminderSweep())
    .then((summary: unknown) => {
      // eslint-disable-next-line no-console
      console.log("[renewal-reminder] one-off run complete", summary);
    })
    .then(() => disconnectDb())
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
