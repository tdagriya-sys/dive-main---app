import cron from "node-cron";
import { runInstrumentRefresh } from "../services/instrumentService";

export function startInstrumentRefreshCron() {
  cron.schedule(
    "0 6 * * *",
    () => {
      runInstrumentRefresh().catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[instrumentRefresh] scheduled run failed", err);
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
