import cron from "node-cron";
import { dispatchDueCampaigns } from "../services/notificationCampaignService";
import { withLock } from "../services/distributedLock";
import { recordJobRun } from "../services/systemJobRun";
import { logger } from "../lib/logger";

// A scheduled campaign send is bounded work (one bulk audience resolve +
// send per due campaign — see notificationCampaignService.ts's own comment
// on why this is synchronous, no BullMQ), so a short lock TTL is enough;
// generous headroom is still given since audience size varies.
const LOCK_TTL_MS = 10 * 60 * 1000;

// Every 5 minutes — frequent enough that a scheduled campaign goes out
// close to its requested time without needing a real job queue.
export function startNotificationDispatchCron() {
  cron.schedule("*/5 * * * *", () => {
    withLock("cron-lock:notificationDispatch", LOCK_TTL_MS, () => recordJobRun("notificationDispatch", dispatchDueCampaigns)).catch((err) => {
      logger.error({ err }, "[notificationDispatch] scheduled run failed");
    });
  });
}

// Allows `tsx src/jobs/notificationDispatch.cron.ts --once` for manual testing.
if (require.main === module && process.argv.includes("--once")) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { connectDb, disconnectDb } = require("../db/connect");
  connectDb()
    .then(() => dispatchDueCampaigns())
    .then((summary: unknown) => {
      // eslint-disable-next-line no-console
      console.log("[notificationDispatch] one-off run complete", summary);
    })
    .then(() => disconnectDb())
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
