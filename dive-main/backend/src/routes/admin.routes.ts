import { Router, Response } from "express";
import { requireAuth, requireStaff, requirePermission, requireStepUp, requireAdminIpAllowlist, StaffRequest } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import * as dashboardController from "../controllers/admin/dashboardController";
import * as usersController from "../controllers/admin/usersController";
import * as systemController from "../controllers/admin/systemController";
import * as auditController from "../controllers/admin/auditController";
import * as analyticsController from "../controllers/admin/analyticsController";
import * as revenueController from "../controllers/admin/revenueController";
import * as instrumentsController from "../controllers/admin/instrumentsController";
import * as scoringConfigController from "../controllers/admin/scoringConfigController";
import * as contextConfigController from "../controllers/admin/contextConfigController";
import * as suggestionConfigController from "../controllers/admin/suggestionConfigController";
import * as lookthroughConfigController from "../controllers/admin/lookthroughConfigController";
import * as employeesController from "../controllers/admin/employeesController";
import * as rolesController from "../controllers/admin/rolesController";
import * as ticketsController from "../controllers/admin/ticketsController";
import * as ticketCategoriesController from "../controllers/admin/ticketCategoriesController";
import * as cannedResponsesController from "../controllers/admin/cannedResponsesController";
import * as notificationCategoriesController from "../controllers/admin/notificationCategoriesController";
import * as notificationTemplatesController from "../controllers/admin/notificationTemplatesController";
import * as notificationCampaignsController from "../controllers/admin/notificationCampaignsController";
import * as landingPopupsController from "../controllers/admin/landingPopupsController";
import * as externalListsController from "../controllers/admin/externalListsController";
import * as plansController from "../controllers/admin/plansController";
import * as adminSubscriptionsController from "../controllers/admin/subscriptionsController";
import * as couponsController from "../controllers/admin/couponsController";
import * as invoicesController from "../controllers/admin/invoicesController";
import * as featureFlagsController from "../controllers/admin/featureFlagsController";
import * as dataRequestsController from "../controllers/admin/dataRequestsController";

/**
 * Read-only admin API (Phases 1 and 1b of docs/ADMIN_PANEL_PLAN.md). Every
 * route here requires a real staff session (requireAuth + requireStaff —
 * mandatory TOTP already enforced at login, see Phase 0.3) plus, where the
 * resource is sensitive enough to warrant it, a specific granted permission.
 *
 * Mounted at /api/admin — see app.ts.
 */
const router = Router();

// Optional IP allowlist (§12 decision #9) runs first and is a no-op unless
// ADMIN_IP_ALLOWLIST is actually set — rejecting here means a disallowed
// caller never even learns whether its token would otherwise be valid.
router.use(requireAdminIpAllowlist, requireAuth, requireStaff);

// Open to any staff member regardless of granted permissions — a low-
// sensitivity overview every staff role should see (see the controller's
// own comment).
router.get("/dashboard", asyncHandler(dashboardController.getDashboard));

router.get("/users", requirePermission("users.view"), asyncHandler(usersController.listUsers));
router.get("/users/:id", requirePermission("users.view"), asyncHandler(usersController.getUserDetail));
// Phase 7 — read-only impersonation (spec'd since Phase 1's own §5.1, never
// built until now). Step-up since it's exactly as consequential as a role
// change or a refund — it hands out an active session on someone else's
// account, even a read-only one.
router.post("/users/:id/impersonate", requirePermission("users.impersonate"), requireStepUp, asyncHandler(usersController.impersonateUser));
// Suspend/reactivate/force-logout — spec'd since §4.1/§6 but never wired up
// until now. Step-up on all three: each directly controls a real user's
// account access, the same bar as impersonate or a role change.
router.post("/users/:id/suspend", requirePermission("users.suspend"), requireStepUp, asyncHandler(usersController.suspendUser));
router.post("/users/:id/reactivate", requirePermission("users.suspend"), requireStepUp, asyncHandler(usersController.reactivateUser));
router.post("/users/:id/force-logout", requirePermission("users.suspend"), requireStepUp, asyncHandler(usersController.forceLogoutUser));
// Deliberate override of the one-time-ever trial guard — a goodwill/support
// gesture, same step-up bar as the account-access actions just above.
router.post("/users/:id/trial/reset", requirePermission("subscriptions.manage"), requireStepUp, asyncHandler(usersController.resetUserTrial));

router.get("/audit", requirePermission("audit.view"), asyncHandler(auditController.listAuditLogs));

router.get("/system/health", requirePermission("system.view"), asyncHandler(systemController.getHealth));
router.get("/system/integrations", requirePermission("system.view"), asyncHandler(systemController.getIntegrations));
router.get("/system/jobs", requirePermission("system.view"), asyncHandler(systemController.getJobs));
router.get("/system/webhooks", requirePermission("system.view"), asyncHandler(systemController.getWebhooks));

// Phase 7 — announcement banner + maintenance mode (§4.6/§5.3/§7).
router.get("/system/settings", requirePermission("system.view"), asyncHandler(systemController.getSettings));
router.patch("/system/settings/announcement", requirePermission("system.manage"), asyncHandler(systemController.updateAnnouncement));
router.patch("/system/settings/maintenance", requirePermission("system.manage"), asyncHandler(systemController.updateMaintenance));

// Phase 7 — feature flags / gradual rollout (§11). No step-up: a flag only
// ever changes what's shown to a cohort, moves no money, deletes nothing.
router.get("/feature-flags", requirePermission("feature_flags.manage"), asyncHandler(featureFlagsController.listFeatureFlags));
router.post("/feature-flags", requirePermission("feature_flags.manage"), asyncHandler(featureFlagsController.createFeatureFlag));
router.patch("/feature-flags/:id", requirePermission("feature_flags.manage"), asyncHandler(featureFlagsController.updateFeatureFlag));

// Phase 7 — DPDP data-subject request queue (§4.6/§5.3/§11). Listing is
// broad `users.view`; fulfilling an export or a deletion each need their own
// specific permission plus step-up — a bulk PII export and an irreversible
// deletion are each exactly as consequential as a refund or a role change.
router.get("/data-requests", requirePermission("users.view"), asyncHandler(dataRequestsController.listDataRequests));
// Logs a request that arrived outside the app (e.g. by email) — fixes a real
// gap where fulfil-delete had no reachable path to ever act on (see
// dataRequestService.ts::createAdminLoggedRequest). No step-up: this only
// queues a record, the same low bar as reject below — the actual export/
// delete still needs its own permission + step-up at fulfil time.
router.post("/data-requests", requirePermission("users.view"), asyncHandler(dataRequestsController.logRequest));
router.post("/data-requests/:id/fulfil-export", requirePermission("users.export"), requireStepUp, asyncHandler(dataRequestsController.fulfilExport));
router.post("/data-requests/:id/fulfil-delete", requirePermission("users.delete"), requireStepUp, asyncHandler(dataRequestsController.fulfilDelete));
router.post("/data-requests/:id/reject", requirePermission("users.view"), asyncHandler(dataRequestsController.rejectRequest));

// Phase 1b
router.get("/analytics/engagement", requirePermission("analytics.view"), asyncHandler(analyticsController.getEngagement));
router.get("/analytics/funnel", requirePermission("analytics.view"), asyncHandler(analyticsController.getFunnel));
router.get("/analytics/feature-usage", requirePermission("analytics.view"), asyncHandler(analyticsController.getFeatureUsage));

router.get("/revenue/summary", requirePermission("revenue.view"), asyncHandler(revenueController.getRevenueSummary));
router.get("/revenue/payments", requirePermission("revenue.view"), asyncHandler(revenueController.listPayments));

// Phase 6b — billing polish
router.get("/revenue/mrr-summary", requirePermission("revenue.view"), asyncHandler(revenueController.getMrrSummary));
router.get("/revenue/plan-performance", requirePermission("revenue.view"), asyncHandler(revenueController.getPlanPerformance));
router.get("/revenue/mrr-movement", requirePermission("revenue.view"), asyncHandler(revenueController.getMrrMovement));
router.get("/revenue/failed-payments", requirePermission("revenue.view"), asyncHandler(revenueController.getFailedPayments));
router.post("/payments/:id/refund", requirePermission("subscriptions.refund"), requireStepUp, asyncHandler(revenueController.refundPayment));
router.get("/revenue/report-pricing", requirePermission("revenue.view"), asyncHandler(revenueController.getReportPricing));
router.patch("/revenue/report-pricing", requirePermission("plans.manage"), asyncHandler(revenueController.updateReportPricing));

router.get("/invoices", requirePermission("revenue.view"), asyncHandler(invoicesController.listInvoices));
router.get("/invoices/:id/pdf", requirePermission("revenue.view"), asyncHandler(invoicesController.downloadInvoicePdf));

router.get("/coupons", requirePermission("plans.manage"), asyncHandler(couponsController.listCoupons));
router.post("/coupons", requirePermission("plans.manage"), asyncHandler(couponsController.createCoupon));
router.patch("/coupons/:id", requirePermission("plans.manage"), asyncHandler(couponsController.updateCoupon));

router.get("/instruments", requirePermission("instruments.manage"), asyncHandler(instrumentsController.listInstruments));
router.post("/instruments/refresh", requirePermission("instruments.manage"), asyncHandler(instrumentsController.triggerRefresh));

// Phase 2 — the three admin-configurable models (Dive Score, Context Engine,
// Suggestion layer) share one lifecycle (view active/draft -> edit draft ->
// validate -> publish -> history/rollback), gated by the single
// "scoring_config.*" permission group (docs/ADMIN_PANEL_PLAN.md §6 treats
// all three as one "Model Configuration" capability). Publish/rollback also
// require step-up re-authentication — see requireStepUp's own comment on why
// a config publish is treated as sensitive as a refund or role change.
// A hand-written shape (not `typeof scoringConfigController`) so adding a
// controller-specific export — like scoringConfigController's own
// `simulate`, which suggestionConfigController deliberately has no
// equivalent of — never forces every other controller to structurally match it.
type ConfigController = Record<
  "getActive" | "getDraft" | "updateDraft" | "validateDraft" | "publish" | "rollback" | "getHistory" | "getVersion",
  (req: StaffRequest, res: Response) => Promise<unknown>
>;
function mountConfigRoutes(base: string, controller: ConfigController) {
  router.get(`${base}/active`, requirePermission("scoring_config.view"), asyncHandler(controller.getActive));
  router.get(`${base}/draft`, requirePermission("scoring_config.view"), asyncHandler(controller.getDraft));
  router.patch(`${base}/draft`, requirePermission("scoring_config.edit"), asyncHandler(controller.updateDraft));
  router.post(`${base}/draft/validate`, requirePermission("scoring_config.edit"), asyncHandler(controller.validateDraft));
  router.post(`${base}/publish`, requirePermission("scoring_config.publish"), requireStepUp, asyncHandler(controller.publish));
  router.post(`${base}/rollback`, requirePermission("scoring_config.publish"), requireStepUp, asyncHandler(controller.rollback));
  router.get(`${base}/history`, requirePermission("scoring_config.view"), asyncHandler(controller.getHistory));
  router.get(`${base}/versions/:version`, requirePermission("scoring_config.view"), asyncHandler(controller.getVersion));
}

mountConfigRoutes("/scoring-config", scoringConfigController);
mountConfigRoutes("/context-config", contextConfigController);
mountConfigRoutes("/suggestion-config", suggestionConfigController);
// Look-Through / Connectedness model (§7 of docs/DIVE_SCORE_MODEL.md) —
// explicitly deferred out of Phase 2 ("a plausible future extension, not yet
// built"), built later as a fourth sibling sharing the same lifecycle and
// permission group as the three above.
mountConfigRoutes("/lookthrough-config", lookthroughConfigController);

// Simulation sandbox (Phase 2 §5.2/§7) — Scoring, Context, and Lookthrough
// only. SuggestionConfig has no simulate route: it doesn't feed the backend
// scoring function at all (see simulationService.ts's own comment), so
// there's nothing here to preview.
router.post("/scoring-config/simulate", requirePermission("scoring_config.edit"), asyncHandler(scoringConfigController.simulate));
router.post("/context-config/simulate", requirePermission("scoring_config.edit"), asyncHandler(contextConfigController.simulate));
router.post("/lookthrough-config/simulate", requirePermission("scoring_config.edit"), asyncHandler(lookthroughConfigController.simulate));

// Phase 3 — employees & roles. Both gated by permissions that are
// superadmin-only (see auth/permissions.ts's SUPERADMIN_ONLY) — an admin
// cannot see or manage other staff accounts at all. Every mutation requires
// step-up, same bar as a role change or a config publish (requireStepUp's
// own comment).
router.get("/employees", requirePermission("employees.manage"), asyncHandler(employeesController.listEmployees));
router.post("/employees/invite", requirePermission("employees.manage"), requireStepUp, asyncHandler(employeesController.inviteEmployee));
router.post("/employees/invites/:id/revoke", requirePermission("employees.manage"), requireStepUp, asyncHandler(employeesController.revokeInvite));
router.patch("/employees/:id", requirePermission("employees.manage"), requireStepUp, asyncHandler(employeesController.updateEmployee));

router.get("/roles", requirePermission("roles.manage"), asyncHandler(rolesController.listRoles));
router.post("/roles", requirePermission("roles.manage"), requireStepUp, asyncHandler(rolesController.createRole));
router.patch("/roles/:id", requirePermission("roles.manage"), requireStepUp, asyncHandler(rolesController.updateRole));
router.delete("/roles/:id", requirePermission("roles.manage"), requireStepUp, asyncHandler(rolesController.deleteRole));

// Phase 4 — the staff ticket console. `tickets.view` covers read access
// (inbox, detail, report, the assignable-staff list a picker needs);
// `tickets.respond` covers replying/internal notes and requester-visible
// status changes; `tickets.assign` covers the assignee field specifically;
// `tickets.manage` covers merging tickets and the category/canned-response
// admin CRUD, all a step above day-to-day ticket work.
router.get("/tickets", requirePermission("tickets.view"), asyncHandler(ticketsController.listTickets));
router.get("/tickets/staff", requirePermission("tickets.view"), asyncHandler(ticketsController.listAssignableStaff));
router.get("/tickets/report", requirePermission("tickets.view"), asyncHandler(ticketsController.getReport));
router.get("/tickets/:id", requirePermission("tickets.view"), asyncHandler(ticketsController.getTicketDetail));
router.post("/tickets/:id/messages", requirePermission("tickets.respond"), asyncHandler(ticketsController.addStaffMessage));
router.patch("/tickets/:id", requirePermission("tickets.respond"), asyncHandler(ticketsController.updateTicket));
router.post("/tickets/:id/callback/done", requirePermission("tickets.respond"), asyncHandler(ticketsController.setCallbackDone));
router.post("/tickets/:id/merge", requirePermission("tickets.manage"), asyncHandler(ticketsController.mergeTickets));

router.get("/ticket-categories", requirePermission("tickets.view"), asyncHandler(ticketCategoriesController.listCategories));
router.post("/ticket-categories", requirePermission("tickets.manage"), asyncHandler(ticketCategoriesController.createCategory));
router.patch("/ticket-categories/:id", requirePermission("tickets.manage"), asyncHandler(ticketCategoriesController.updateCategory));
router.delete("/ticket-categories/:id", requirePermission("tickets.manage"), asyncHandler(ticketCategoriesController.deleteCategory));

router.get("/canned-responses", requirePermission("tickets.view"), asyncHandler(cannedResponsesController.listCannedResponses));
router.post("/canned-responses", requirePermission("tickets.manage"), asyncHandler(cannedResponsesController.createCannedResponse));
router.patch("/canned-responses/:id", requirePermission("tickets.manage"), asyncHandler(cannedResponsesController.updateCannedResponse));
router.delete("/canned-responses/:id", requirePermission("tickets.manage"), asyncHandler(cannedResponsesController.deleteCannedResponse));

// Phase 5 — Notifications. Categories/templates (structural config) sit
// behind `notifications.manage_templates`; everything campaign-related
// (including the audience-preview helper) sits behind `notifications.send`
// — see notificationCategoriesController.ts's own comment on this split.
// `schedule`/`send` additionally require step-up, same bar as a config
// publish or an employee invite (requireStepUp's own comment) — a campaign
// reaching potentially every user is just as consequential.
router.get("/notification-categories", requirePermission("notifications.manage_templates"), asyncHandler(notificationCategoriesController.listCategories));
router.post("/notification-categories", requirePermission("notifications.manage_templates"), asyncHandler(notificationCategoriesController.createCategory));
router.patch("/notification-categories/:id", requirePermission("notifications.manage_templates"), asyncHandler(notificationCategoriesController.updateCategory));
router.delete("/notification-categories/:id", requirePermission("notifications.manage_templates"), asyncHandler(notificationCategoriesController.deleteCategory));

router.get("/notification-templates", requirePermission("notifications.manage_templates"), asyncHandler(notificationTemplatesController.listTemplates));
router.post("/notification-templates", requirePermission("notifications.manage_templates"), asyncHandler(notificationTemplatesController.createTemplate));
router.patch("/notification-templates/:id", requirePermission("notifications.manage_templates"), asyncHandler(notificationTemplatesController.updateTemplate));
router.delete("/notification-templates/:id", requirePermission("notifications.manage_templates"), asyncHandler(notificationTemplatesController.deleteTemplate));

router.get("/notification-campaigns", requirePermission("notifications.send"), asyncHandler(notificationCampaignsController.listCampaigns));
router.post("/notification-campaigns", requirePermission("notifications.send"), asyncHandler(notificationCampaignsController.createCampaign));
router.get("/notification-campaigns/:id", requirePermission("notifications.send"), asyncHandler(notificationCampaignsController.getCampaign));
router.patch("/notification-campaigns/:id", requirePermission("notifications.send"), asyncHandler(notificationCampaignsController.updateCampaign));
router.get("/notification-campaigns/:id/preview", requirePermission("notifications.send"), asyncHandler(notificationCampaignsController.previewCampaignAudience));
router.get("/notification-campaigns/:id/sender", requirePermission("notifications.send"), asyncHandler(notificationCampaignsController.getCampaignSender));
router.get("/notification-campaigns/:id/stats",requirePermission("notifications.send"), asyncHandler(notificationCampaignsController.getStats));
router.post("/notification-campaigns/:id/test-send", requirePermission("notifications.send"), asyncHandler(notificationCampaignsController.testSend));
router.post("/notification-campaigns/:id/schedule", requirePermission("notifications.send"), requireStepUp, asyncHandler(notificationCampaignsController.schedule));
router.post("/notification-campaigns/:id/send", requirePermission("notifications.send"), requireStepUp, asyncHandler(notificationCampaignsController.send));
router.post("/notification-campaigns/:id/cancel", requirePermission("notifications.send"), asyncHandler(notificationCampaignsController.cancel));
router.post("/notification-audience/preview", requirePermission("notifications.send"), asyncHandler(notificationCampaignsController.previewAudienceAdHoc));

// Imported (non-user) email lists — the audience of an `external` campaign.
// Importing only makes addresses mailable; actually SENDING to a list is the
// existing step-up-gated campaign send.
router.get("/external-lists", requirePermission("notifications.send"), asyncHandler(externalListsController.listLists));
router.post("/external-lists/import", requirePermission("notifications.send"), asyncHandler(externalListsController.importList));
router.get("/external-lists/contacts", requirePermission("notifications.send"), asyncHandler(externalListsController.getContacts));
router.delete("/external-lists", requirePermission("notifications.send"), asyncHandler(externalListsController.deleteList));

// Public landing-page pop-ups. Activating one makes it live for every
// anonymous visitor, so it needs step-up like sending a campaign; taking
// one down doesn't. An active one can't be edited/deleted (see the service).
router.get("/landing-popups", requirePermission("notifications.send"), asyncHandler(landingPopupsController.listLandingPopups));
router.post("/landing-popups", requirePermission("notifications.send"), asyncHandler(landingPopupsController.createLandingPopup));
router.patch("/landing-popups/:id", requirePermission("notifications.send"), asyncHandler(landingPopupsController.updateLandingPopup));
router.post("/landing-popups/:id/activate", requirePermission("notifications.send"), requireStepUp, asyncHandler(landingPopupsController.activateLandingPopup));
router.post("/landing-popups/:id/deactivate", requirePermission("notifications.send"), asyncHandler(landingPopupsController.deactivateLandingPopup));
router.delete("/landing-popups/:id", requirePermission("notifications.send"), asyncHandler(landingPopupsController.deleteLandingPopup));

// Phase 6a — Plans + Subscriptions. `plans.manage` covers the plan catalog
// (including publish-to-razorpay, which mints real recurring-billing
// config); `subscriptions.manage` covers real users' live subscriptions —
// cancel/change-plan/grant are all step-up gated, same bar as a refund or a
// config publish (requireStepUp's own comment): each one directly changes
// what a real user is billed or granted.
router.get("/plans", requirePermission("plans.manage"), asyncHandler(plansController.listPlans));
router.post("/plans", requirePermission("plans.manage"), asyncHandler(plansController.createPlan));
router.patch("/plans/:id", requirePermission("plans.manage"), asyncHandler(plansController.updatePlan));
router.post("/plans/:id/publish-to-razorpay", requirePermission("plans.manage"), requireStepUp, asyncHandler(plansController.publishToRazorpay));
router.post("/plans/:id/archive", requirePermission("plans.manage"), asyncHandler(plansController.archivePlan));

router.get("/subscriptions", requirePermission("subscriptions.manage"), asyncHandler(adminSubscriptionsController.listSubscriptions));
// Both mounted ahead of the generic "/subscriptions/:id" below — that
// param route would otherwise greedily match "trials"/"by-user" as an id.
router.get("/subscriptions/trials", requirePermission("subscriptions.manage"), asyncHandler(adminSubscriptionsController.listTrialUsers));
router.get("/subscriptions/by-user/:userId", requirePermission("subscriptions.manage"), asyncHandler(adminSubscriptionsController.getSubscriptionHistoryForUser));
router.get("/subscriptions/renewal-reminder-settings", requirePermission("subscriptions.manage"), asyncHandler(adminSubscriptionsController.getRenewalReminderSettings));
router.patch("/subscriptions/renewal-reminder-settings", requirePermission("subscriptions.manage"), asyncHandler(adminSubscriptionsController.updateRenewalReminderSettings));
router.get("/subscriptions/:id", requirePermission("subscriptions.manage"), asyncHandler(adminSubscriptionsController.getSubscription));
router.post("/subscriptions/:id/cancel", requirePermission("subscriptions.manage"), requireStepUp, asyncHandler(adminSubscriptionsController.cancelSubscriptionAdmin));
router.post("/subscriptions/:id/change-plan", requirePermission("subscriptions.manage"), requireStepUp, asyncHandler(adminSubscriptionsController.changePlan));
router.post("/subscriptions/grant", requirePermission("subscriptions.manage"), requireStepUp, asyncHandler(adminSubscriptionsController.grant));
// Standing extra allowance for one metered key, on top of whatever the
// user's plan already grants (Freemium or Premium) — see UsageGrant.ts's
// own comment. userIdOrEmail in the body (not the URL), same convention as
// /subscriptions/grant just above, to accept either an id or an email
// without URL-encoding concerns.
router.post("/subscriptions/usage-grants", requirePermission("subscriptions.manage"), requireStepUp, asyncHandler(adminSubscriptionsController.grantUsageBonus));

export default router;
