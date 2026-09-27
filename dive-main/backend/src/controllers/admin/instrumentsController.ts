import { Response } from "express";
import { FilterQuery } from "mongoose";
import { Instrument, IInstrument, ASSET_CLASSES, AssetClass } from "../../models/Instrument";
import { runInstrumentRefresh } from "../../services/instrumentService";
import { applyInstrumentUpload } from "../../services/instrumentUploadService";
import { StaffRequest } from "../../middleware/auth";
import { ApiError } from "../../middleware/errorHandler";
import { recordAudit } from "../../services/auditLog";

/**
 * Instrument master browser + manual refresh trigger (Phase 1b of
 * docs/ADMIN_PANEL_PLAN.md). `listInstruments` is a dedicated, PAGINATED admin
 * query — deliberately not reusing `instrumentService.ts::searchInstruments`
 * (the user-facing search), which is capped at 20 results with no offset
 * (docs/PRODUCTION_READINESS_AUDIT.md #31) — fine for a type-ahead, wrong for
 * an admin browse/audit view that needs to reach every row.
 *
 * `triggerRefresh` moves here from the old `/api/admin/instruments/refresh`
 * (instruments.routes.ts's `adminInstrumentsRouter`, gated by the pre-RBAC
 * `requireAdmin`/`ADMIN_EMAILS` check) onto this RBAC-gated router instead —
 * see admin.routes.ts.
 */
export async function listInstruments(req: StaffRequest, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "25"), 10) || 25));
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const assetClass = typeof req.query.assetClass === "string" ? req.query.assetClass : undefined;
  const source = typeof req.query.source === "string" ? req.query.source : undefined;
  const isActive = typeof req.query.isActive === "string" ? req.query.isActive === "true" : undefined;

  const filter: FilterQuery<IInstrument> = {};
  if (assetClass && (ASSET_CLASSES as readonly string[]).includes(assetClass)) filter.assetClass = assetClass as IInstrument["assetClass"];
  if (source) filter.source = source;
  if (isActive !== undefined) filter.isActive = isActive;
  if (q) {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: re }, { symbol: re }, { issuer: re }];
  }

  const [total, instruments, sources] = await Promise.all([
    Instrument.countDocuments(filter),
    Instrument.find(filter).sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Instrument.distinct("source"),
  ]);

  res.status(200).json({
    instruments,
    sources,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

export async function triggerRefresh(_req: StaffRequest, res: Response) {
  const summary = await runInstrumentRefresh();
  res.status(200).json({ message: "Instrument refresh complete.", summary });
}

// Manual data seeding for a single asset class from an uploaded CSV — see
// services/instrumentUploadService.ts's own top comment for the full design
// (only `name` required, missing/bad fields never drop a row, and this never
// touches that class's live-sourced or static-seed rows, only its own prior
// upload). Cap here (not in the service) mirrors botscan.routes.ts's own
// convention of keeping the size limit next to where the file first lands.
export async function uploadInstruments(req: StaffRequest, res: Response) {
  const file = req.file;
  if (!file) throw new ApiError(400, "NO_FILE", "No file was uploaded.");
  const assetClass = String(req.body?.assetClass || "").toUpperCase();
  if (!(ASSET_CLASSES as readonly string[]).includes(assetClass)) {
    throw new ApiError(400, "INVALID_ASSET_CLASS", "Choose which asset class this file is for.");
  }

  const removeMissing = String(req.body?.removeMissing || "").toLowerCase() === "true";
  const summary = await applyInstrumentUpload(assetClass as AssetClass, file.originalname, file.buffer, {
    removeMissing,
    actorId: req.staff!.userId,
  });

  await recordAudit(
    {
      action: "instrument.uploaded",
      resourceType: "Instrument",
      meta: {
        assetClass: summary.assetClass,
        fileName: summary.fileName,
        inserted: summary.inserted,
        updated: summary.updated,
        removeMissingRequested: summary.removeMissingRequested,
        deletedFromPrevious: summary.deletedFromPrevious,
        retiredInsteadOfDeleted: summary.retiredInsteadOfDeleted,
        skippedCount: summary.skipped.length,
        warningCount: summary.warnings.length,
        lookthroughFundsUpdated: summary.lookthrough?.fundsUpdated,
      },
    },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );

  res.status(200).json({ summary });
}
