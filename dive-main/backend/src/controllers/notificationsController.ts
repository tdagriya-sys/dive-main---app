import { Response } from "express";
import { AuthedRequest } from "../middleware/auth";
import { updateNotificationPrefSchema } from "../validators/notification";
import * as notificationService from "../services/notificationService";

/**
 * The logged-in user's own notification surface (Phase 5 of
 * docs/ADMIN_PANEL_PLAN.md). Mounted at /api/notifications, behind
 * requireAuth — every handler scopes to req.userId.
 */

export async function listMyNotifications(req: AuthedRequest, res: Response) {
  const [notifications, unreadCount] = await Promise.all([
    notificationService.listMyNotifications(req.userId!),
    notificationService.getUnreadCount(req.userId!),
  ]);
  res.status(200).json({
    notifications: notifications.map((n) => ({
      id: String(n._id),
      categoryKey: n.categoryKey,
      title: n.title,
      body: n.body,
      // Falls back to the plain (unformatted) body for any row created
      // before this field existed — see this phase's own changelog entry.
      bodyHtml: n.bodyHtml || n.body,
      link: n.link,
      linkLabel: n.linkLabel,
      deliveredAt: n.deliveredAt,
      readAt: n.readAt,
    })),
    unreadCount,
  });
}

export async function listMyPopupNotifications(req: AuthedRequest, res: Response) {
  const popups = await notificationService.listMyPopupNotifications(req.userId!);
  res.status(200).json({
    popups: popups.map((n) => ({
      id: String(n._id),
      categoryKey: n.categoryKey,
      title: n.title,
      bodyHtml: n.bodyHtml || n.body,
      link: n.link,
      linkLabel: n.linkLabel,
      deliveredAt: n.deliveredAt,
    })),
  });
}

export async function markRead(req: AuthedRequest, res: Response) {
  await notificationService.markRead(req.userId!, req.params.id);
  res.status(200).json({ ok: true });
}

export async function markAllRead(req: AuthedRequest, res: Response) {
  await notificationService.markAllRead(req.userId!);
  res.status(200).json({ ok: true });
}

export async function getPreferences(req: AuthedRequest, res: Response) {
  const preferences = await notificationService.getPreferences(req.userId!);
  res.status(200).json({ preferences });
}

export async function updatePreference(req: AuthedRequest, res: Response) {
  const data = updateNotificationPrefSchema.parse(req.body);
  await notificationService.updatePreference(req.userId!, data.categoryKey, data.channel, data.enabled);
  res.status(200).json({ ok: true });
}
