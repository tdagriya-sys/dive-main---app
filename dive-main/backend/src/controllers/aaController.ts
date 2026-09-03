import { Response } from "express";
import { AuthedRequest } from "../middleware/auth";
import { ApiError } from "../middleware/errorHandler";
import { AaConsent } from "../models/AaConsent";
import { Holding } from "../models/Holding";
import { invalidateDiveScoreCache } from "../services/diveScoreService";
import { invalidateReportPurchase } from "../services/paymentService";
import * as finvuService from "../services/finvuService";
import { FI_TYPE_TO_ASSET_CLASS } from "../services/finvuService";

async function findOwnedConsent(handle: string, userId?: string) {
  const consent = await AaConsent.findOne({ consentHandle: handle, userId });
  if (!consent) throw new ApiError(404, "CONSENT_NOT_FOUND", "Consent not found.");
  return consent;
}

export async function requestConsent(req: AuthedRequest, res: Response) {
  const result = await finvuService.createConsentRequest(req.userId!);
  await AaConsent.create({
    userId: req.userId,
    consentHandle: result.consentHandle,
    status: "PENDING",
    fipIds: [],
    rawResponses: [{ event: "consent_requested", isMock: result.isMock, at: new Date() }],
  });
  res.status(201).json(result);
}

// MOCK-ONLY: simulates the user approving consent on Finvu's hosted UI and
// being redirected back. In a real (non-placeholder-credentialed) deployment
// this would not exist — Finvu instead calls a webhook/callback URL when the
// user approves on their own consent UI.
export async function approveMockConsent(req: AuthedRequest, res: Response) {
  const consent = await findOwnedConsent(req.params.handle, req.userId);
  if (!consent.consentHandle.startsWith("mock-")) {
    throw new ApiError(400, "NOT_MOCK_CONSENT", "This consent isn't in mock mode.");
  }
  consent.status = "ACTIVE";
  consent.rawResponses.push({ event: "consent_approved_mock", at: new Date() });
  await consent.save();
  res.json({ status: consent.status });
}

export async function getConsentStatus(req: AuthedRequest, res: Response) {
  const consent = await findOwnedConsent(req.params.handle, req.userId);
  res.json({ status: consent.status });
}

export async function fetchFiDataAndSave(req: AuthedRequest, res: Response) {
  const consent = await findOwnedConsent(req.params.handle, req.userId);
  if (consent.status !== "ACTIVE") {
    throw new ApiError(400, "CONSENT_NOT_ACTIVE", "Consent must be ACTIVE before fetching data.");
  }

  const { records, isMock } = await finvuService.fetchFiData(consent.consentHandle);
  consent.rawResponses.push({ event: "fi_data_fetched", isMock, recordCount: records.length, at: new Date() });
  await consent.save();

  // Re-fetching (a new consent, or the same one again) must not duplicate
  // holdings — an AA data pull is a snapshot of current state, not a new
  // transaction. Upsert on (userId, source=AA, name) so a repeat fetch
  // updates the existing holding's value/quantity instead of adding another.
  const holdings = await Promise.all(
    records.map((r) =>
      Holding.findOneAndUpdate(
        { userId: req.userId, source: "AA", name: r.name },
        {
          $set: {
            assetClass: FI_TYPE_TO_ASSET_CLASS[r.fiType],
            investedValue: r.investedValue,
            currentValue: r.currentValue,
            quantity: r.quantity,
            extraFields: { ...r.extraFields, fiType: r.fiType, isMock },
            sourceRef: consent.consentHandle,
          },
        },
        { upsert: true, new: true }
      )
    )
  );

  invalidateDiveScoreCache(req.userId!);
  await invalidateReportPurchase(req.userId!);
  res.status(200).json({ holdings, isMock });
}
