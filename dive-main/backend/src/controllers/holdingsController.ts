import { Response } from "express";
import { Holding } from "../models/Holding";
import { AssetClass, Instrument } from "../models/Instrument";
import { parseManualHolding, computeFdValues } from "../validators/holdings";
import { AuthedRequest } from "../middleware/auth";
import { ApiError } from "../middleware/errorHandler";
import { computeHoldingQuality } from "../services/holdingQualityService";
import { fetchInstrumentDetail } from "../services/instrumentDetailService";

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
  return res.status(201).json({ holding });
}

export async function deleteHolding(req: AuthedRequest, res: Response) {
  const holding = await Holding.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  if (!holding) throw new ApiError(404, "HOLDING_NOT_FOUND", "Holding not found.");
  res.json({ message: "Holding deleted." });
}
