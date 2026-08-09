import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt";
import { env } from "../config/env";
import { User } from "../models/User";

export interface AuthedRequest extends Request {
  userId?: string;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    return res.status(401).json({ error: "UNAUTHENTICATED", message: "Missing access token." });
  }
  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "INVALID_TOKEN", message: "Access token is invalid or expired." });
  }
}

// Must run after requireAuth (needs req.userId already set). Looks the
// user's current email up fresh on every request rather than trusting
// anything from the access token — env.adminEmails can change without
// existing tokens needing to be reissued, and an admin's email address
// itself could change (see updateProfile) without this drifting out of sync.
export async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const user = req.userId ? await User.findById(req.userId).select("email").lean() : null;
  if (!user || !env.adminEmails.includes(user.email.toLowerCase())) {
    return res.status(403).json({ error: "FORBIDDEN", message: "Admin access required." });
  }
  next();
}
