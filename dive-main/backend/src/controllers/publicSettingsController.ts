import { Request, Response } from "express";
import * as adminSettingService from "../services/adminSettingService";

// Public, no-auth, cacheable (Phase 7 of docs/ADMIN_PANEL_PLAN.md §7 —
// "optional announcement banner") — a logged-out visitor on the landing
// page needs the announcement/maintenance state just as much as a logged-in
// user does, and app.ts's maintenance-mode gate itself reads the cached
// version of this same data (see adminSettingService.ts::getMaintenanceCached).
export async function getAppSettings(_req: Request, res: Response) {
  const [announcement, maintenance] = await Promise.all([adminSettingService.getAnnouncement(), adminSettingService.getMaintenance()]);
  res.setHeader("Cache-Control", "public, max-age=30");
  res.status(200).json({ announcement, maintenance });
}
