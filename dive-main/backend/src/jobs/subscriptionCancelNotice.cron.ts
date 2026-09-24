import cron from "node-cron";
import { runCancelNoticeSweep } from "../services/subscriptionService";
import { withLock } from "../services/distributedLock";
import { recordJobRun } from "../services/systemJobRun";
import { logger } from "../lib/logger";

// Comfortably above a full scan of cancelled-but-still-active subscriptions
// plus one Razorpay cancel call each — same generous-headroom reasoning as
// every other cron's own lock TTL.
const LOCK_TTL_MS = 15 * 60 * 1000;

// Once a day, offset from the other 6/6:30/7/7:30am jobs so they don't all
// contend for the DB/external APIs at the exact same moment.
export function startSubscriptionCancelNoticeCron() {
  cron.schedule(
    "45 6 * * *",
    () => {
      withLock("cron-lock:subscription-cancel-notice", LOCK_TTL_MS, () => recordJobRun("subscription-cancel-notice", runCancelNoticeSweep)).catch((err) => {
        logger.error({ err }, "[subscription-cancel-notice] scheduled run failed");
      });
    },
    { timezone: "Asia/Kolkata" }
  );
}

// Allows `tsx src/jobs/subscriptionCancelNotice.cron.ts --once` for manual testing.
if (require.main === module && process.argv.includes("--once")) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { connectDb, disconnectDb } = require("../db/connect");
  connectDb()
    .then(() => runCancelNoticeSweep())
    .then((summary: unknown) => {
      // eslint-disable-next-line no-console
      console.log("[subscription-cancel-notice] one-off run complete", summary);
    })
    .then(() => disconnectDb())
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
