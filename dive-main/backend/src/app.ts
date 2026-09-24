import express, { Request } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { httpLogger } from "./middleware/httpLogger";
import mongoose from "mongoose";
import { env } from "./config/env";
import { pingRedis } from "./lib/redisClient";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler";
import authRoutes from "./routes/auth.routes";
import staffAuthRoutes from "./routes/staffAuth.routes";
import holdingsRoutes from "./routes/holdings.routes";
import usageRoutes from "./routes/usage.routes";
import instrumentsRoutes from "./routes/instruments.routes";
import userRoutes from "./routes/user.routes";
import uploadRoutes from "./routes/upload.routes";
import botscanRoutes from "./routes/botscan.routes";
import aaRoutes from "./routes/aa.routes";
import scoreRoutes from "./routes/score.routes";
import contactRoutes from "./routes/contact.routes";
import ticketsRoutes from "./routes/tickets.routes";
import notificationsRoutes from "./routes/notifications.routes";
import subscriptionsRoutes from "./routes/subscriptions.routes";
import meRoutes from "./routes/me.routes";
import extensionRoutes from "./routes/extension.routes";
import shareRoutes from "./routes/share.routes";
import paymentRoutes from "./routes/payment.routes";
import adminRoutes from "./routes/admin.routes";
import * as publicSettingsController from "./controllers/publicSettingsController";
import * as publicLandingPopupsController from "./controllers/publicLandingPopupsController";
import * as unsubscribeController from "./controllers/unsubscribeController";
import { getMaintenanceCached } from "./services/adminSettingService";
import { asyncHandler } from "./utils/asyncHandler";

export function createApp() {
  const app = express();

  // Without this, Express has no reason to trust the X-Forwarded-For header
  // Nginx sets, and falls back to req.socket.remoteAddress — which, behind a
  // reverse proxy, is always Nginx's own loopback address for every request,
  // from every real client. Every IP-keyed rate limiter below then collapses
  // onto ONE shared bucket for the entire site instead of one per visitor —
  // confirmed live: a handful of admin-testing login calls exhausted the
  // login limiter for every device, new signups included, all sharing that
  // one bucket. `"loopback"` (not `true`) matches this deployment's actual
  // topology exactly — Nginx runs on the same machine, proxying to
  // localhost:8000 (see docs/SERVER_DEPLOYMENT_GUIDE.md Part 9) — so only a
  // connection genuinely arriving via 127.0.0.1/::1 is trusted to set this
  // header, unlike `true`, which would trust it from anywhere (letting a
  // client spoof their own IP if this port were ever reachable directly).
  app.set("trust proxy", "loopback");

  // Belt-and-suspenders alongside the `Cache-Control: no-store` default
  // below: Express generates a weak ETag for every res.json() response by
  // default, which is what made the holdings-caching bug possible in the
  // first place (a stored ETag is what let the browser send If-None-Match on
  // reload at all). `no-store` alone should already forbid the browser from
  // storing anything to revalidate against, but removing the ETag outright
  // leaves no room for a future browser quirk to find a way back into that
  // failure mode. The two explicitly public/cacheable routes
  // (app-settings, score/config) rely on Cache-Control's own max-age for
  // freshness, not ETag-based revalidation, so this doesn't affect them.
  app.set("etag", false);

  // Structured request logging + X-Request-Id (replaces morgan). Mounted first
  // so every request — including ones a later middleware rejects — is logged and
  // carries a correlatable id (echoed in the response header, attached as
  // req.id, and recorded by services/auditLog.ts). Silent under NODE_ENV=test
  // via pino-http's autoLogging flag.
  app.use(httpLogger);

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    })
  );
  app.use(
    express.json({
      limit: "2mb",
      // Stashes the exact raw bytes of every request body onto req.rawBody —
      // needed only by POST /api/payments/webhook (Razorpay signs the raw
      // body, not the parsed-then-reserialized object, which can differ
      // byte-for-byte even for an equivalent JSON value), but cheap enough
      // to capture globally rather than special-casing that one route's
      // body-parsing middleware order.
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

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

  // Every authenticated, per-user response (holdings, score/breakdown, ...)
  // must never be browser-cacheable. Found live: Express generates a weak
  // ETag for every res.json() response by default; on a page reload, the
  // browser re-sends the same GET with If-None-Match, and if the data hasn't
  // changed, the server correctly answers 304 Not Modified — but some
  // browser/environment combinations (confirmed with a real user on Edge)
  // deliver that 304 to the calling JS with a genuinely EMPTY body instead of
  // transparently resolving it from their own HTTP cache, instead of the
  // real cached response. `loadHoldings()` (frontend/src/context/
  // DiveContext.js) then sees a "successful" empty response and renders a
  // real, non-empty portfolio as "No investments yet" — no error, since
  // nothing actually failed from its point of view. `Cache-Control: no-store`
  // forbids the browser from storing the response at all, so there's nothing
  // left to revalidate against and this class of bug can't recur. The two
  // genuinely public, non-personal endpoints that DO want caching
  // (publicSettingsController.getAppSettings, scoreController.getConfig) set
  // their own Cache-Control afterward in their own handlers, which overrides
  // this default before the response is actually sent.
  api.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  api.get("/", (_req, res) => res.json({ message: "DIVVE API" }));
  // Health/readiness check for a load balancer or orchestrator — mounted
  // under /api (not the bare root) specifically so it's reachable through the
  // Nginx reverse-proxy setup in docs/SERVER_DEPLOYMENT_GUIDE.md, which only
  // forwards /api/* to this backend; anything outside that serves the static
  // frontend build instead. Checks real DB connectivity, not just "the
  // process is alive" — a backend that's up but can't reach Mongo should
  // fail its health check so an orchestrator can act on it.
  //
  // Redis is reported but deliberately NEVER fails the check (still 200/503
  // purely on `db`) — nothing user-facing depends on Redis yet (see
  // lib/redisClient.ts's "fails open" convention), so an orchestrator
  // shouldn't restart/drain an otherwise-healthy instance over it. This is
  // also the quickest way to confirm Redis connectivity from outside the app
  // (`curl .../api/health`) without waiting for a cron to fire — the admin
  // System Health screen (Phase 1) will read the same signal.
  api.get("/health", async (_req, res) => {
    const dbConnected = mongoose.connection.readyState === 1;
    const redis = await pingRedis();
    if (!dbConnected) {
      return res.status(503).json({ status: "error", db: "disconnected", redis });
    }
    return res.status(200).json({ status: "ok", db: "connected", redis, uptimeSeconds: Math.round(process.uptime()) });
  });
  // Public, no-auth — the frontend's announcement banner/maintenance gate
  // reads this before anyone is necessarily logged in (Phase 7 of
  // docs/ADMIN_PANEL_PLAN.md §7).
  api.get("/app-settings", asyncHandler(publicSettingsController.getAppSettings));
  // Public, no-auth — the active pop-ups a logged-out visitor sees on the
  // landing page (see models/LandingPopup.ts).
  api.get("/landing-popups", asyncHandler(publicLandingPopupsController.listLandingPopups));
  // Public, no-auth — the unsubscribe link in marketing emails to imported
  // (non-user) contacts. Mounted before the maintenance gate below on
  // purpose: an unsubscribe request must always work, maintenance or not.
  api.get("/unsubscribe/:token", asyncHandler(unsubscribeController.showUnsubscribe));
  api.post("/unsubscribe/:token", asyncHandler(unsubscribeController.performUnsubscribe));

  // Maintenance mode (Phase 7 §4.6/§5.3/§7) — a single global gate rather
  // than touching every route file. Staff keep full access (so they can turn
  // it back off), and auth/health/the settings read itself always pass
  // through — everything else gets a 503 while it's on. Reads a 5s-cached
  // value (adminSettingService.ts::getMaintenanceCached), not a query on
  // every single request.
  api.use(async (req, res, next) => {
    if (req.path.startsWith("/auth") || req.path.startsWith("/admin") || req.path === "/health" || req.path === "/app-settings") {
      return next();
    }
    const maintenance = await getMaintenanceCached();
    if (!maintenance.enabled) return next();
    return res.status(503).json({ error: "MAINTENANCE_MODE", message: maintenance.message || "Divve is temporarily down for maintenance. Please check back shortly." });
  });

  api.use("/auth", authRoutes);
  api.use("/auth/staff", staffAuthRoutes);
  api.use("/holdings", holdingsRoutes);
  api.use("/usage", usageRoutes);
  api.use("/instruments", instrumentsRoutes);
  api.use("/users", userRoutes);
  api.use("/uploads", uploadRoutes);
  api.use("/botscan", botscanRoutes);
  api.use("/aa", aaRoutes);
  api.use("/score", scoreRoutes);
  api.use("/contact", contactRoutes);
  api.use("/tickets", ticketsRoutes);
  api.use("/notifications", notificationsRoutes);
  api.use("/subscriptions", subscriptionsRoutes);
  api.use("/me", meRoutes);
  api.use("/extension", extensionRoutes);
  api.use("/share", shareRoutes);
  api.use("/payments", paymentRoutes);
  // Full admin API (RBAC-gated — see admin.routes.ts). Absorbed the old
  // adminInstrumentsRouter's one route (/instruments/refresh, previously
  // gated by requireAdmin/ADMIN_EMAILS) as part of Phase 1b.
  api.use("/admin", adminRoutes);

  app.use("/api", api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
