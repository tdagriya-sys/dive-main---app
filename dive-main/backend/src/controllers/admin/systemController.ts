import { Response } from "express";
import mongoose from "mongoose";
import { env } from "../../config/env";
import { pingRedis } from "../../lib/redisClient";
import { SystemJobRun } from "../../models/SystemJobRun";
import { WebhookEvent } from "../../models/WebhookEvent";
import { StaffRequest } from "../../middleware/auth";
import * as adminSettingService from "../../services/adminSettingService";
import { announcementSchema, maintenanceSchema } from "../../validators/adminSetting";
import { recordAudit } from "../../services/auditLog";

/**
 * System health / integration status / job runs / webhook log (Phase 1 of
 * docs/ADMIN_PANEL_PLAN.md). Reuses the same "live vs mock" flags config/env.ts
 * already computes for each integration — never exposes the actual secret
 * values, only whether a real one is configured (see the plan §8: "secrets
 * never rendered in admin").
 */
export async function getHealth(_req: StaffRequest, res: Response) {
  const dbConnected = mongoose.connection.readyState === 1;
  const redis = await pingRedis();
  res.status(200).json({
    status: dbConnected ? "ok" : "error",
    db: dbConnected ? "connected" : "disconnected",
    redis,
    uptimeSeconds: Math.round(process.uptime()),
  });
}

export async function getIntegrations(_req: StaffRequest, res: Response) {
  res.status(200).json({
    email: env.emailApiKeyIsPlaceholder ? "mock" : "live",
    openai: env.openaiApiKeyIsPlaceholder ? "mock" : "live",
    anthropic: env.anthropicApiKeyIsPlaceholder ? "mock" : "live",
    cryptoPrice: env.cryptoPriceApiKeyIsPlaceholder ? "mock" : "live",
    finvu: env.finvu.isPlaceholder ? "mock" : "live",
    razorpay: env.razorpay.isPlaceholder ? "mock" : "live",
    sentry: env.sentryDsn ? "configured" : "not_configured",
    redisConfigured: Boolean(env.redisUrl),
  });
}

// Latest run of each distinct job, newest first — enough for a "last run:
// 6:02am, ok" summary per job without the list growing unbounded as more
// history accumulates.
export async function getJobs(_req: StaffRequest, res: Response) {
  const jobs = await SystemJobRun.distinct("job");
  const latestPerJob = await Promise.all(
    jobs.map((job) => SystemJobRun.findOne({ job }).sort({ startedAt: -1 }).lean())
  );
  const recentRuns = await SystemJobRun.find({}).sort({ startedAt: -1 }).limit(50).lean();
  res.status(200).json({
    latestPerJob: latestPerJob.filter(Boolean),
    recentRuns,
  });
}

// Announcement banner + maintenance mode (Phase 7 of docs/ADMIN_PANEL_PLAN.md
// §4.6/§5.3/§7) — `system.view` for reading (staff-only view here; the
// public-facing GET the frontend banner/gate actually uses is
// systemSettingsController.ts's getPublicAppSettings, unauthenticated),
// `system.manage` + no step-up for editing — a wrong banner/maintenance
// value is instantly reversible by editing it again, unlike the actions
// elsewhere in this app that do require step-up.
export async function getSettings(_req: StaffRequest, res: Response) {
  const [announcement, maintenance] = await Promise.all([adminSettingService.getAnnouncement(), adminSettingService.getMaintenance()]);
  res.status(200).json({ announcement, maintenance });
}

export async function updateAnnouncement(req: StaffRequest, res: Response) {
  const data = announcementSchema.parse(req.body);
  const before = await adminSettingService.getAnnouncement();
  const value = await adminSettingService.setAnnouncement(data, req.staff!.email);
  await recordAudit(
    { action: "admin_setting.announcement_updated", resourceType: "AdminSetting", resourceId: "announcement", before, after: value },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ announcement: value });
}

export async function updateMaintenance(req: StaffRequest, res: Response) {
  const data = maintenanceSchema.parse(req.body);
  const before = await adminSettingService.getMaintenance();
  const value = await adminSettingService.setMaintenance(data, req.staff!.email);
  await recordAudit(
    { action: "admin_setting.maintenance_updated", resourceType: "AdminSetting", resourceId: "maintenance", before, after: value },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ maintenance: value });
}

export async function getWebhooks(req: StaffRequest, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "25"), 10) || 25));
  const [total, events] = await Promise.all([
    WebhookEvent.countDocuments({}),
    WebhookEvent.find({}).sort({ receivedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  res.status(200).json({ events, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
}
