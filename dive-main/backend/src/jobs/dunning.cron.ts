import cron from "node-cron";
import { runDunningSweep } from "../services/dunningService";
import { withLock } from "../services/distributedLock";
import { recordJobRun } from "../services/systemJobRun";
import { logger } from "../lib/logger";

// Comfortably above this job's realistic worst case (a full scan of
// past_due subscriptions plus one Razorpay cancel call each) — same
// generous-headroom reasoning as every other cron's own lock TTL.
const LOCK_TTL_MS = 15 * 60 * 1000;

// Once a day, offset from the other two 6am/6:30am jobs so all three don't
// contend for the DB/external APIs at the exact same moment.
export function startDunningCron() {
  cron.schedule(
    "0 7 * * *",
    () => {
      withLock("cron-lock:dunning", LOCK_TTL_MS, () => recordJobRun("dunning", runDunningSweep)).catch((err) => {
        logger.error({ err }, "[dunning] scheduled run failed");
      });
    },
    { timezone: "Asia/Kolkata" }
  );
}

// Allows `tsx src/jobs/dunning.cron.ts --once` for manual testing.
if (require.main === module && process.argv.includes("--once")) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { connectDb, disconnectDb } = require("../db/connect");
  connectDb()
    .then(() => runDunningSweep())
    .then((summary: unknown) => {
      // eslint-disable-next-line no-console
      console.log("[dunning] one-off run complete", summary);
    })
    .then(() => disconnectDb())
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
