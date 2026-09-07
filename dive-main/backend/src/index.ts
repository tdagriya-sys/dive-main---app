import { createApp } from "./app";
import { connectDb, disconnectDb } from "./db/connect";
import { env } from "./config/env";
import { startInstrumentRefreshCron } from "./jobs/instrumentRefresh.cron";
import { startValuationRefreshCron } from "./jobs/valuationRefresh.cron";
import { Instrument } from "./models/Instrument";
import { runInstrumentRefresh } from "./services/instrumentService";

function checkProductionSafety() {
  if (env.nodeEnv !== "production") return;
  if (env.jwtAccessSecretIsWeak || env.jwtRefreshSecretIsWeak) {
    throw new Error(
      "Refusing to start with NODE_ENV=production and a missing/placeholder/too-short JWT secret. Set JWT_ACCESS_SECRET / JWT_REFRESH_SECRET to real random values, at least 32 characters long (e.g. via `openssl rand -base64 48`)."
    );
  }
  if (env.useInMemoryMongo) {
    throw new Error("Refusing to start with NODE_ENV=production and no real MONGO_URL configured — data would not persist.");
  }
}

async function main() {
  checkProductionSafety();
  await connectDb();

  // Instrument search/verification (manual entry, file upload, bot scan) is
  // useless on an empty collection — the daily cron alone would leave a fresh
  // database (very likely with the default in-memory dev DB, which resets on
  // every restart) empty until 6am IST. Seed it once immediately if empty.
  const instrumentCount = await Instrument.countDocuments();
  if (instrumentCount === 0) {
    // eslint-disable-next-line no-console
    console.log("[dive-backend] Instrument collection is empty — running an initial seed/refresh before accepting traffic...");
    await runInstrumentRefresh();
  }

  const app = createApp();
  startInstrumentRefreshCron();
  startValuationRefreshCron();
  const server = app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[dive-backend] listening on http://localhost:${env.port}`);
  });

  // Graceful shutdown — without this, a rolling deploy or orchestrator
  // restart (which sends SIGTERM) kills in-flight requests mid-flight and
  // tears down the Mongo connection uncleanly instead of draining first.
  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return; // ignore a second SIGTERM/SIGINT while already stopping
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[dive-backend] received ${signal}, shutting down gracefully...`);

    // server.close()'s callback only fires once every open connection closes
    // on its own — with HTTP keep-alive that can hang indefinitely if a
    // client never disconnects, so force-exit as a last resort rather than
    // let a stuck shutdown block a deploy/restart forever.
    const forceExitTimer = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.error("[dive-backend] graceful shutdown timed out after 15s — forcing exit");
      process.exit(1);
    }, 15000);
    forceExitTimer.unref();

    server.close(async (closeErr) => {
      if (closeErr) {
        // eslint-disable-next-line no-console
        console.error("[dive-backend] error while closing HTTP server", closeErr);
      }
      try {
        await disconnectDb();
        // eslint-disable-next-line no-console
        console.log("[dive-backend] shutdown complete");
        clearTimeout(forceExitTimer);
        process.exit(0);
      } catch (dbErr) {
        // eslint-disable-next-line no-console
        console.error("[dive-backend] error while disconnecting from MongoDB", dbErr);
        process.exit(1);
      }
    });
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[dive-backend] fatal startup error", err);
  process.exit(1);
});
