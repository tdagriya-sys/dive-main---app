import { Response } from "express";
import { Types } from "mongoose";
import { Holding } from "../models/Holding";
import { AssetClass, Instrument } from "../models/Instrument";
import {
  parseManualHolding,
  computeFdValues,
  computePfValues,
  parseNonFdHoldingUpdate,
  parseFdHoldingUpdate,
  parsePfHoldingUpdate,
  FdHoldingInput,
  PfHoldingInput,
} from "../validators/holdings";
import { AuthedRequest } from "../middleware/auth";
import { ApiError } from "../middleware/errorHandler";
import { computeHoldingQuality } from "../services/holdingQualityService";
import { fetchInstrumentDetail } from "../services/instrumentDetailService";
import { invalidateDiveScoreCache } from "../services/diveScoreService";

export async function listHoldings(req: AuthedRequest, res: Response) {
  const holdings = await Holding.find({ userId: req.userId })
    .sort({ createdAt: -1 })
    .populate("instrumentId", "metadata")
    .lean();
  // Only the "quality & risk" panel needs the linked Instrument's metadata
  // (NSE sector/market-cap tier, crypto category) — instrumentId is put back
  // to a plain id afterward so the rest of the response shape is unchanged.
  const withQuality = holdings.map((h) => {
    const instrument = h.instrumentId as unknown as { _id: unknown; metadata?: Record<string, unknown> } | null;
    return {
      ...h,
      instrumentId: instrument ? instrument._id : h.instrumentId,
      quality: computeHoldingQuality(h.assetClass, instrument?.metadata),
    };
  });
  res.json({ holdings: withQuality });
}

// On-demand, per-holding enrichment — only worth calling for mutual funds
// (real AMFI scheme category via MFAPI.in). Deliberately NOT part of
// listHoldings: fetching this for every holding on every page load would add
// real network latency to a screen that needs to stay fast; instead the
// frontend calls this lazily when a user actually drills into a specific
// holding's rating detail on X-Ray (fetchInstrumentDetail's own 15-minute
// cache keeps repeat drill-ins fast).
export async function getLiveQuality(req: AuthedRequest, res: Response) {
  const holding = await Holding.findOne({ _id: req.params.id, userId: req.userId }).populate("instrumentId").lean();
  if (!holding) throw new ApiError(404, "HOLDING_NOT_FOUND", "Holding not found.");

  const instrument = holding.instrumentId as unknown as
    | { assetClass: AssetClass; symbol: string; exchange?: string; metadata?: Record<string, unknown> }
    | null;

  if (holding.assetClass !== "MUTUAL_FUND" || !instrument) {
    res.json({ quality: computeHoldingQuality(holding.assetClass, instrument?.metadata) });
    return;
  }

  const detail = await fetchInstrumentDetail(instrument);
  const liveDetail = detail.available
    ? {
        schemeCategory: detail.fields?.schemeCategory as string | undefined,
        return1yPct: detail.fields?.return1yPct as number | undefined,
        fundHouse: detail.fields?.fundHouse as string | undefined,
      }
    : undefined;
  res.json({ quality: computeHoldingQuality(holding.assetClass, instrument.metadata, liveDetail) });
}

export async function createManualHolding(req: AuthedRequest, res: Response) {
  const input = parseManualHolding(req.body);

  if (input.assetClass === "FD") {
    const { currentValue, maturityValue, maturityDate } = computeFdValues(input);
    const holding = await Holding.create({
      userId: req.userId,
      assetClass: "FD",
      name: `${input.bank} Fixed Deposit`,
      investedValue: input.principal,
      currentValue,
      extraFields: {
        bank: input.bank,
        tenureMonths: input.tenureMonths,
        startMonth: input.startMonth,
        startYear: input.startYear,
        interestRate: input.interestRate,
        maturityValue,
        maturityDate,
      },
      source: input.source ?? "MANUAL",
    });
    invalidateDiveScoreCache(req.userId!);
    return res.status(201).json({ holding });
  }

  if (input.assetClass === "PF") {
    const { currentValue, investedToDate } = computePfValues(input);
    const holding = await Holding.create({
      userId: req.userId,
      assetClass: "PF",
      name: `${input.institution} ${input.subType}`,
      investedValue: investedToDate,
      currentValue,
      extraFields: {
        subType: input.subType,
        institution: input.institution,
        openingBalance: input.openingBalance,
        monthlyContribution: input.monthlyContribution ?? 0,
        startMonth: input.startMonth,
        startYear: input.startYear,
        interestRatePercent: input.interestRatePercent,
      },
      source: input.source ?? "MANUAL",
    });
    invalidateDiveScoreCache(req.userId!);
    return res.status(201).json({ holding });
  }

  let instrumentName = input.name;
  if (input.instrumentId) {
    const instrument = await Instrument.findById(input.instrumentId).lean();
    if (!instrument) throw new ApiError(404, "INSTRUMENT_NOT_FOUND", "Selected instrument was not found.");
    instrumentName = instrument.name;
  }

  const holding = await Holding.create({
    userId: req.userId,
    assetClass: input.assetClass,
    instrumentId: input.instrumentId,
    name: instrumentName,
    investedValue: input.investedValue,
    currentValue: input.currentValue ?? input.investedValue,
    quantity: input.quantity,
    purchaseDate: input.purchaseDate,
    extraFields: {},
    source: input.source ?? "MANUAL",
  });
  invalidateDiveScoreCache(req.userId!);
  return res.status(201).json({ holding });
}

// Edits an existing holding in place — assetClass itself can't change (a
// different field set entirely; that's closer to delete-and-recreate), but
// everything else can, and anything not sent (purchaseDate, source,
// sourceRef, needsReview, and — for FD — whichever extraFields weren't part
// of this request) is preserved rather than wiped, unlike the old
// delete-and-recreate workaround.
export async function updateHolding(req: AuthedRequest, res: Response) {
  const holding = await Holding.findOne({ _id: req.params.id, userId: req.userId });
  if (!holding) throw new ApiError(404, "HOLDING_NOT_FOUND", "Holding not found.");

  if (holding.assetClass === "FD") {
    const input = parseFdHoldingUpdate(req.body);
    const merged: FdHoldingInput = {
      assetClass: "FD",
      bank: input.bank ?? (holding.extraFields.bank as string),
      principal: input.principal ?? holding.investedValue,
      tenureMonths: input.tenureMonths ?? (holding.extraFields.tenureMonths as number),
      startMonth: input.startMonth ?? (holding.extraFields.startMonth as number),
      startYear: input.startYear ?? (holding.extraFields.startYear as number),
      interestRate: input.interestRate ?? (holding.extraFields.interestRate as number),
    };
    const { currentValue, maturityValue, maturityDate } = computeFdValues(merged);
    holding.name = `${merged.bank} Fixed Deposit`;
    holding.investedValue = merged.principal;
    holding.currentValue = currentValue;
    holding.extraFields = {
      bank: merged.bank,
      tenureMonths: merged.tenureMonths,
      startMonth: merged.startMonth,
      startYear: merged.startYear,
      interestRate: merged.interestRate,
      maturityValue,
      maturityDate,
    };
  } else if (holding.assetClass === "PF") {
    const input = parsePfHoldingUpdate(req.body);
    const merged: PfHoldingInput = {
      assetClass: "PF",
      subType: input.subType ?? (holding.extraFields.subType as PfHoldingInput["subType"]),
      institution: input.institution ?? (holding.extraFields.institution as string),
      openingBalance: input.openingBalance ?? (holding.extraFields.openingBalance as number),
      monthlyContribution: input.monthlyContribution ?? (holding.extraFields.monthlyContribution as number),
      startMonth: input.startMonth ?? (holding.extraFields.startMonth as number),
      startYear: input.startYear ?? (holding.extraFields.startYear as number),
      interestRatePercent: input.interestRatePercent ?? (holding.extraFields.interestRatePercent as number),
    };
    const { currentValue, investedToDate } = computePfValues(merged);
    holding.name = `${merged.institution} ${merged.subType}`;
    holding.investedValue = investedToDate;
    holding.currentValue = currentValue;
    holding.extraFields = {
      subType: merged.subType,
      institution: merged.institution,
      openingBalance: merged.openingBalance,
      monthlyContribution: merged.monthlyContribution ?? 0,
      startMonth: merged.startMonth,
      startYear: merged.startYear,
      interestRatePercent: merged.interestRatePercent,
    };
  } else {
    const input = parseNonFdHoldingUpdate(req.body);
    if (input.instrumentId) {
      const instrument = await Instrument.findById(input.instrumentId).lean();
      if (!instrument) throw new ApiError(404, "INSTRUMENT_NOT_FOUND", "Selected instrument was not found.");
      holding.instrumentId = new Types.ObjectId(input.instrumentId);
      holding.name = instrument.name;
    } else if (input.name !== undefined) {
      holding.name = input.name;
    }
    if (input.investedValue !== undefined) holding.investedValue = input.investedValue;
    if (input.currentValue !== undefined) holding.currentValue = input.currentValue;
    if (input.quantity !== undefined) holding.quantity = input.quantity;
    if (input.purchaseDate !== undefined) holding.purchaseDate = input.purchaseDate;
  }

  await holding.save();
  invalidateDiveScoreCache(req.userId!);
  res.json({ holding });
}

export async function deleteHolding(req: AuthedRequest, res: Response) {
  const holding = await Holding.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  if (!holding) throw new ApiError(404, "HOLDING_NOT_FOUND", "Holding not found.");
  invalidateDiveScoreCache(req.userId!);
  res.json({ message: "Holding deleted." });
}
