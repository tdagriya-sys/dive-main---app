import { Request, Response } from "express";
import * as landingPopupService from "../services/landingPopupService";

// Public, no-auth — a logged-out visitor on the landing page is exactly who
// this is for (see models/LandingPopup.ts). Returns only what the browser
// needs to render: id, title, pre-rendered HTML, and a version stamp.
// Briefly cacheable (like /app-settings) so a burst of landing-page visits
// doesn't each hit Mongo; a deactivation still takes effect within seconds.
export async function listLandingPopups(_req: Request, res: Response) {
  const popups = await landingPopupService.listPublicLandingPopups();
  res.setHeader("Cache-Control", "public, max-age=15");
  res.status(200).json({ popups });
}
