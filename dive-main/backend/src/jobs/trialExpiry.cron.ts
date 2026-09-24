import cron from "node-cron";
import { sweepExpiredFreeTrials } from "../services/subscriptionService";
import { withLock } from "../services/distributedLock";
import { recordJobRun } from "../services/systemJobRun";
import { logger } from "../lib/logger";

// Comfortably above a full scan of trialing subscriptions — same
// generous-headroom reasoning as every other cron's own lock TTL.
const LOCK_TTL_MS = 15 * 60 * 1000;

// Once a day, offset from the other 6/7am jobs so they don't all contend
// for the DB at the exact same moment.
export function startTrialExpiryCron() {
  cron.schedule(
    "0 6 * * *",
    () => {
      withLock("cron-lock:trial-expiry", LOCK_TTL_MS, () => recordJobRun("trial-expiry", sweepExpiredFreeTrials)).catch((err) => {
        logger.error({ err }, "[trial-expiry] scheduled run failed");
      });
    },
    { timezone: "Asia/Kolkata" }
  );
}

// Allows `tsx src/jobs/trialExpiry.cron.ts --once` for manual testing.
if (require.main === module && process.argv.includes("--once")) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { connectDb, disconnectDb } = require("../db/connect");
  connectDb()
    .then(() => sweepExpiredFreeTrials())
    .then((summary: unknown) => {
      // eslint-disable-next-line no-console
      console.log("[trial-expiry] one-off run complete", summary);
    })
    .then(() => disconnectDb())
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
