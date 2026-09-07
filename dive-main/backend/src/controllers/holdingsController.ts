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
import { resolveHoldingLatestPrice, MARKET_PRICEABLE_CLASSES } from "../services/priceHistoryService";
import { invalidateDiveScoreCache } from "../services/diveScoreService";
import { invalidateReportPurchase } from "../services/paymentService";

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
    const { currentValue, maturityValue, maturityDate, investedToDate } = computeFdValues(input);
    const holding = await Holding.create({
      userId: req.userId,
      assetClass: "FD",
      name: `${input.bank} Fixed Deposit / RD`,
      investedValue: investedToDate,
      currentValue,
      extraFields: {
        bank: input.bank,
        // Stored separately from the top-level investedValue above (which
        // becomes investedToDate — grows with monthlyContribution) so a
        // later edit can recover the original lump sum rather than
        // mistaking an already-grown value for it — same reasoning as PF's
        // own openingBalance living in extraFields, distinct from its own
        // investedValue/investedToDate.
        principal: input.principal,
        tenureMonths: input.tenureMonths,
        startMonth: input.startMonth,
        startYear: input.startYear,
        interestRate: input.interestRate,
        monthlyContribution: input.monthlyContribution ?? 0,
        maturityValue,
        maturityDate,
      },
      source: input.source ?? "MANUAL",
    });
    invalidateDiveScoreCache(req.userId!);
    await invalidateReportPurchase(req.userId!);
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
    await invalidateReportPurchase(req.userId!);
    return res.status(201).json({ holding });
  }

  let instrumentName = input.name;
  let instrument: { name: string; symbol: string; metadata?: Record<string, unknown> } | null = null;
  if (input.instrumentId) {
    instrument = await Instrument.findById(input.instrumentId).lean();
    if (!instrument) throw new ApiError(404, "INSTRUMENT_NOT_FOUND", "Selected instrument was not found.");
    instrumentName = instrument.name;
  }

  const currentValue = input.currentValue ?? input.investedValue;

  // A user who picks a real instrument but doesn't know/enter a share count
  // (or types a value first and lets quantity default) would otherwise never
  // be eligible for holdingValuationService.ts's daily currentValue refresh —
  // that job can only reprice quantity × price, and there'd be no quantity
  // to multiply. Back-solving quantity = value ÷ today's price the moment a
  // real, live-priceable instrument is linked means this holding starts
  // getting real daily updates from day one instead of staying frozen at
  // whatever was typed today until a future manual edit happens to add a
  // quantity. Deliberately NOT rounded to a whole share count — this is a
  // back-solved figure for future revaluation math, not literally "the user
  // owns exactly this many shares," and rounding it would make
  // quantity × today's price drift away from the value just entered.
  let quantity = input.quantity;
  if (quantity === undefined && instrument && MARKET_PRICEABLE_CLASSES.includes(input.assetClass)) {
    const price = await resolveHoldingLatestPrice({
      assetClass: input.assetClass,
      symbol: instrument.symbol,
      coingeckoId: instrument.metadata?.coingeckoId as string | undefined,
    });
    // No real price resolvable right now (network down, unsupported
    // instrument, etc.) — leave quantity unset, exactly today's existing
    // behavior, rather than block saving the holding on an external API.
    if (price && price > 0) quantity = currentValue / price;
  }

  const holding = await Holding.create({
    userId: req.userId,
    assetClass: input.assetClass,
    instrumentId: input.instrumentId,
    name: instrumentName,
    investedValue: input.investedValue,
    currentValue,
    quantity,
    purchaseDate: input.purchaseDate,
    extraFields: {},
    source: input.source ?? "MANUAL",
  });
  invalidateDiveScoreCache(req.userId!);
  await invalidateReportPurchase(req.userId!);
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
      // extraFields.principal first — the pure lump sum, distinct from
      // investedValue once monthlyContribution makes investedValue grow
      // into investedToDate. Falls back to holding.investedValue only for
      // an FD holding created before this field existed, where investedValue
      // genuinely still IS the pure principal (monthlyContribution didn't
      // exist yet, so investedToDate === principal for every such holding).
      principal: input.principal ?? (holding.extraFields.principal as number | undefined) ?? holding.investedValue,
      tenureMonths: input.tenureMonths ?? (holding.extraFields.tenureMonths as number),
      startMonth: input.startMonth ?? (holding.extraFields.startMonth as number),
      startYear: input.startYear ?? (holding.extraFields.startYear as number),
      interestRate: input.interestRate ?? (holding.extraFields.interestRate as number),
      monthlyContribution: input.monthlyContribution ?? (holding.extraFields.monthlyContribution as number | undefined) ?? 0,
    };
    const { currentValue, maturityValue, maturityDate, investedToDate } = computeFdValues(merged);
    holding.name = `${merged.bank} Fixed Deposit / RD`;
    holding.investedValue = investedToDate;
    holding.currentValue = currentValue;
    holding.extraFields = {
      bank: merged.bank,
      principal: merged.principal,
      tenureMonths: merged.tenureMonths,
      startMonth: merged.startMonth,
      startYear: merged.startYear,
      interestRate: merged.interestRate,
      monthlyContribution: merged.monthlyContribution ?? 0,
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
  await invalidateReportPurchase(req.userId!);
  res.json({ holding });
}

export async function deleteHolding(req: AuthedRequest, res: Response) {
  const holding = await Holding.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  if (!holding) throw new ApiError(404, "HOLDING_NOT_FOUND", "Holding not found.");
  invalidateDiveScoreCache(req.userId!);
  await invalidateReportPurchase(req.userId!);
  res.json({ message: "Holding deleted." });
}
