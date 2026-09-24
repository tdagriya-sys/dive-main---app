import { Response } from "express";
import { StaffRequest } from "../../middleware/auth";
import { ApiError } from "../../middleware/errorHandler";
import { importContactsSchema } from "../../validators/externalContact";
import * as externalContactService from "../../services/externalContactService";
import { recordAudit } from "../../services/auditLog";

/**
 * Imported (non-user) marketing contacts and their named lists — the audience
 * behind a campaign's `audience: "external"` (see models/ExternalContact.ts).
 * Gated by `notifications.send`, same as campaigns: importing is what makes an
 * address mailable, and sending itself is step-up-gated. Audit rows record
 * counts only — never the addresses themselves.
 */

function actor(req: StaffRequest) {
  return { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email };
}

export async function listLists(_req: StaffRequest, res: Response) {
  // `marketingSender` tells staff up front whether (and from which address)
  // an email-list campaign can actually send — see MarketingSenderStatus.
  res.status(200).json({ ...(await externalContactService.listSummaries()), marketingSender: externalContactService.marketingSenderStatus() });
}

export async function importList(req: StaffRequest, res: Response) {
  const data = importContactsSchema.parse(req.body);
  const parsed = externalContactService.parseContacts(data.text);
  if (parsed.contacts.length === 0) {
    throw new ApiError(400, "NO_CONTACTS", `No valid email addresses were found${parsed.invalid.length ? ` (${parsed.invalid.length} row(s) were invalid)` : ""}.`);
  }
  const result = await externalContactService.importContacts({
    listName: data.listName,
    source: data.source,
    contacts: parsed.contacts,
    attestedBy: req.staff!.userId,
  });
  await recordAudit(
    { action: "external_list.imported", resourceType: "ExternalContact", resourceId: data.listName, meta: { listName: data.listName, source: data.source, ...result, invalid: parsed.invalid.length } },
    actor(req),
    req
  );
  res.status(200).json({
    result,
    duplicatesInFile: parsed.duplicatesInFile,
    invalidCount: parsed.invalid.length,
    // Enough to spot a formatting problem without echoing back a huge file.
    invalid: parsed.invalid.slice(0, 20),
  });
}

export async function getContacts(req: StaffRequest, res: Response) {
  const list = typeof req.query.list === "string" ? req.query.list : "";
  if (!list) throw new ApiError(400, "LIST_REQUIRED", "Say which list to show.");
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
  res.status(200).json(await externalContactService.listContacts(list, page));
}

export async function deleteList(req: StaffRequest, res: Response) {
  const name = typeof req.query.name === "string" ? req.query.name : "";
  if (!name) throw new ApiError(400, "LIST_REQUIRED", "Say which list to delete.");
  const result = await externalContactService.removeList(name);
  await recordAudit({ action: "external_list.deleted", resourceType: "ExternalContact", resourceId: name, meta: { listName: name, ...result } }, actor(req), req);
  res.status(200).json(result);
}
