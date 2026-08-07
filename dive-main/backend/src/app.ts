import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import { env } from "./config/env";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler";
import authRoutes from "./routes/auth.routes";
import holdingsRoutes from "./routes/holdings.routes";
import instrumentsRoutes, { adminInstrumentsRouter } from "./routes/instruments.routes";
import userRoutes from "./routes/user.routes";
import uploadRoutes from "./routes/upload.routes";
import botscanRoutes from "./routes/botscan.routes";
import aaRoutes from "./routes/aa.routes";
import scoreRoutes from "./routes/score.routes";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  if (env.nodeEnv !== "test") {
    app.use(morgan(env.nodeEnv === "development" ? "dev" : "combined"));
  }

  // General-purpose defense-in-depth limit on top of the tighter auth/OTP
  // limiters — generous enough not to interfere with normal use (including
  // the bot scanner's ~1 frame every 1.6s).
  app.use(
    "/api",
    rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
      skip: () => env.nodeEnv === "test",
    })
  );

  const api = express.Router();
  api.get("/", (_req, res) => res.json({ message: "DIVVE API" }));
  // Health/readiness check for a load balancer or orchestrator — mounted
  // under /api (not the bare root) specifically so it's reachable through the
  // Nginx reverse-proxy setup in docs/SERVER_DEPLOYMENT_GUIDE.md, which only
  // forwards /api/* to this backend; anything outside that serves the static
  // frontend build instead. Checks real DB connectivity, not just "the
  // process is alive" — a backend that's up but can't reach Mongo should
  // fail its health check so an orchestrator can act on it.
  api.get("/health", (_req, res) => {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) {
      return res.status(503).json({ status: "error", db: "disconnected" });
    }
    return res.status(200).json({ status: "ok", db: "connected", uptimeSeconds: Math.round(process.uptime()) });
  });
  api.use("/auth", authRoutes);
  api.use("/holdings", holdingsRoutes);
  api.use("/instruments", instrumentsRoutes);
  api.use("/users", userRoutes);
  api.use("/uploads", uploadRoutes);
  api.use("/botscan", botscanRoutes);
  api.use("/aa", aaRoutes);
  api.use("/score", scoreRoutes);
  api.use("/admin", adminInstrumentsRouter);

  app.use("/api", api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
