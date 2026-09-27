import { Types } from "mongoose";
import { Instrument } from "../src/models/Instrument";
import { Holding } from "../src/models/Holding";
import { User } from "../src/models/User";
import { LookthroughConfig } from "../src/models/LookthroughConfig";
import {
  ADMIN_UPLOAD_SOURCE,
  parseInstrumentUploadCsv,
  parseUnderlyingHoldings,
  applyInstrumentUpload,
} from "../src/services/instrumentUploadService";

// Manual per-asset-class instrument data upload — the fallback for when a live
// source (AMFI) is blocked from a cloud IP, or for asset classes (REIT/InvIT/
// BOND/ULIP_INSURANCE) that never had a live source at all. The one rule that
// matters most: a missing or bad value in ANY column never drops the row —
// only a missing name does.

function csv(rows: string[]): Buffer {
  return Buffer.from(rows.join("\n"), "utf-8");
}

describe("parseUnderlyingHoldings", () => {
  it("parses a semicolon-separated 'Name:Weight%' list", () => {
    expect(parseUnderlyingHoldings("Reliance Industries:8.5; HDFC Bank:6.2")).toEqual([
      { name: "Reliance Industries", weightPct: 8.5 },
      { name: "HDFC Bank", weightPct: 6.2 },
    ]);
  });

  it("keeps a malformed piece (no colon, or a non-numeric weight) instead of dropping it", () => {
    expect(parseUnderlyingHoldings("Just A Name; Infosys:not-a-number")).toEqual([{ name: "Just A Name" }, { name: "Infosys", weightPct: undefined }]);
  });

  it("tolerates a % sign and stray spaces around the weight", () => {
    expect(parseUnderlyingHoldings("TCS: 12.3 %")).toEqual([{ name: "TCS", weightPct: 12.3 }]);
  });

  it("returns nothing for blank input", () => {
    expect(parseUnderlyingHoldings("")).toEqual([]);
    expect(parseUnderlyingHoldings("  ;  ")).toEqual([]);
  });
});

describe("parseInstrumentUploadCsv", () => {
  it("reads a well-formed mutual fund file: name, sector, NAV and underlying holdings all land correctly", () => {
    const { rows, skipped, warnings } = parseInstrumentUploadCsv(
      csv([
        "Name,AMC,Segment,NAV,Underlying Holdings",
        '"HDFC Flexi Cap Fund",HDFC Mutual Fund,Flexi Cap,145.23,"Reliance Industries:8.5;HDFC Bank:6.2"',
      ])
    );
    expect(skipped).toEqual([]);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "HDFC Flexi Cap Fund",
      issuer: "HDFC Mutual Fund",
      metadata: {
        sector: "Flexi Cap",
        price: 145.23,
        underlyingHoldings: [
          { name: "Reliance Industries", weightPct: 8.5 },
          { name: "HDFC Bank", weightPct: 6.2 },
        ],
      },
    });
  });

  it("matches headers regardless of case, spacing or underscores", () => {
    const { rows } = parseInstrumentUploadCsv(csv(["instrument_name,Class of Bond,ANNUAL RETURN", "NHAI Tax-Free Bond,Tax-Free,7.2"]));
    expect(rows[0]).toMatchObject({ name: "NHAI Tax-Free Bond", metadata: { category: "Tax-Free", annualReturnPct: 7.2 } });
  });

  it("a row missing name entirely is skipped, but every other row is still processed", () => {
    const { rows, skipped } = parseInstrumentUploadCsv(csv(["Name,Sector", "Good Fund,Equity", ",Some Sector", "Also Good Fund,Debt"]));
    expect(rows.map((r) => r.name)).toEqual(["Good Fund", "Also Good Fund"]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ row: 2, message: expect.stringContaining("No name") });
  });

  it("a bad numeric value doesn't drop the row — just that one field, with a warning naming the row", () => {
    const { rows, warnings } = parseInstrumentUploadCsv(csv(["Name,NAV,Sector", "Odd Fund,not-a-number,Debt"]));
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toEqual({ sector: "Debt" });
    expect(rows[0].metadata.price).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ row: 1, message: expect.stringContaining("isn't a number") });
  });

  it("an entirely blank underlying-holdings cell is just omitted, not an error", () => {
    const { rows, warnings } = parseInstrumentUploadCsv(csv(["Name,Underlying Holdings", "No Holdings Fund,"]));
    expect(rows[0].metadata.underlyingHoldings).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it("an unrecognized column is still kept, under its own header, rather than discarded", () => {
    const { rows } = parseInstrumentUploadCsv(csv(["Name,Sum Assured,Free Look Period", "SBI Life Plan,500000,15 days"]));
    expect(rows[0].metadata).toMatchObject({ sum_assured: "500000", free_look_period: "15 days" });
  });

  it("derives a symbol from the name when none is given, and it can never collide with a real live-source code", () => {
    const { rows } = parseInstrumentUploadCsv(csv(["Name", "Embassy Office Parks REIT"]));
    expect(rows[0].symbol).toBe("UPLOAD_EMBASSY_OFFICE_PARKS_REIT");
  });

  it("namespaces even an EXPLICIT symbol/ISIN, so it can't silently collide with a live source's own code either", () => {
    const bySymbol = parseInstrumentUploadCsv(csv(["Name,Symbol", "Some Fund,ABC123"])).rows[0];
    const byIsin = parseInstrumentUploadCsv(csv(["Name,ISIN", "Some Fund,INE123A01011"])).rows[0];
    expect(bySymbol.symbol).toBe("UPLOAD_ABC123");
    expect(byIsin.symbol).toBe("UPLOAD_INE123A01011");
    expect(byIsin.metadata.isin).toBe("INE123A01011");
  });

  it("two rows with the same effective symbol: the LATER row wins, and it's reported, not silently dropped", () => {
    const { rows, skipped } = parseInstrumentUploadCsv(csv(["Name,Symbol,Sector", "Old Version,DUP1,Old Sector", "New Version,DUP1,New Sector"]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "New Version", metadata: { sector: "New Sector" } });
    expect(skipped.some((s) => /appears more than once/.test(s.message))).toBe(true);
  });

  it("strips a UTF-8 BOM (a common Excel export artifact) instead of treating it as part of the first header", () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Name\nBOM Test Fund")]);
    expect(parseInstrumentUploadCsv(withBom).rows[0].name).toBe("BOM Test Fund");
  });

  it("a file that isn't parseable as CSV at all yields a skipped-row explanation, not a crash", () => {
    const result = parseInstrumentUploadCsv(Buffer.from(""));
    expect(result.rows).toEqual([]);
  });
});

describe("applyInstrumentUpload (DB-touching)", () => {
  let mobileCounter = 9340000000;
  async function makeUser() {
    return User.create({ name: "Holder", mobile: String(mobileCounter++), email: `holder-${mobileCounter}@example.com`, age: 30, passwordHash: "x" });
  }

  it("inserts rows tagged ADMIN_UPLOAD, and refuses an unrecognized asset class", async () => {
    const summary = await applyInstrumentUpload("REIT" as never, "reits.csv", csv(["Name,Exchange", "Embassy Office Parks REIT,NSE"]));
    expect(summary).toMatchObject({ assetClass: "REIT", inserted: 1, updated: 0, deletedFromPrevious: 0, retiredInsteadOfDeleted: 0 });
    const stored = await Instrument.findOne({ assetClass: "REIT", name: "Embassy Office Parks REIT" }).lean();
    expect(stored).toMatchObject({ source: ADMIN_UPLOAD_SOURCE, isActive: true, exchange: "NSE" });
    expect(stored?.metadata).toMatchObject({ uploadedFileName: "reits.csv" });

    await expect(applyInstrumentUpload("NOT_A_CLASS" as never, "x.csv", csv(["Name", "X"]))).rejects.toMatchObject({ status: 400, code: "INVALID_ASSET_CLASS" });
  });

  it("refuses a file with no usable row, and writes nothing", async () => {
    await expect(applyInstrumentUpload("BOND" as never, "empty.csv", csv(["Name,Sector", ",Debt"]))).rejects.toMatchObject({ status: 400, code: "NO_USABLE_ROWS" });
    expect(await Instrument.countDocuments({ assetClass: "BOND" })).toBe(0);
  });

  it("re-uploading with the SAME symbol UPDATES that instrument's price without touching instruments the new file doesn't mention", async () => {
    await applyInstrumentUpload("BOND" as never, "v1.csv", csv(["Name,Symbol,NAV,Sector", "Old Bond A,BONDA,100,Corporate", "Old Bond B,BONDB,100,Corporate"]));
    const before = await Instrument.find({ assetClass: "BOND" }).lean();
    expect(before).toHaveLength(2);

    // v2 only repeats BONDA (with a new price) and adds a brand-new bond — BONDB isn't mentioned at all.
    const summary = await applyInstrumentUpload("BOND" as never, "v2.csv", csv(["Name,Symbol,NAV", "Old Bond A,BONDA,105", "New Bond,BONDC,100"]));
    expect(summary.inserted).toBe(1); // New Bond
    expect(summary.updated).toBe(1); // Old Bond A
    expect(summary.deletedFromPrevious).toBe(0);
    expect(summary.retiredInsteadOfDeleted).toBe(0);

    const after = await Instrument.find({ assetClass: "BOND" }).sort({ name: 1 }).lean();
    expect(after.map((i) => i.name)).toEqual(["New Bond", "Old Bond A", "Old Bond B"]); // Old Bond B untouched, still present

    const updated = after.find((i) => i.name === "Old Bond A")!;
    expect(updated.metadata.price).toBe(105); // price refreshed
    expect(updated.metadata.sector).toBe("Corporate"); // field NOT repeated in v2 — kept from v1, not wiped
  });

  it("a field omitted from a later upload keeps its previously-recorded value (per-field merge, not a wholesale metadata replace)", async () => {
    await applyInstrumentUpload("MUTUAL_FUND" as never, "v1.csv", csv(["Name,Symbol,Sector,NAV", "Some Fund,SCHEME1,Flexi Cap,100"]));
    await applyInstrumentUpload("MUTUAL_FUND" as never, "v2.csv", csv(["Name,Symbol,NAV", "Some Fund,SCHEME1,110"])); // no Sector column this time

    const stored = await Instrument.findOne({ assetClass: "MUTUAL_FUND", symbol: "UPLOAD_SCHEME1" }).lean();
    expect(stored?.metadata.price).toBe(110);
    expect(stored?.metadata.sector).toBe("Flexi Cap"); // survives, wasn't in v2's file
  });

  it("never touches live-sourced or static-seed rows of the SAME asset class", async () => {
    await Instrument.create({ assetClass: "MUTUAL_FUND", symbol: "123456", name: "AMFI Sourced Fund", source: "AMFI", metadata: {} });
    await Instrument.create({ assetClass: "MUTUAL_FUND", symbol: "SBICORPBOND", name: "Static Seed Fund", source: "SEED", metadata: {} });

    await applyInstrumentUpload("MUTUAL_FUND" as never, "mf.csv", csv(["Name", "My Uploaded Fund"]));
    await applyInstrumentUpload("MUTUAL_FUND" as never, "mf2.csv", csv(["Name", "My Second Uploaded Fund"]));

    expect(await Instrument.findOne({ assetClass: "MUTUAL_FUND", symbol: "123456" }).lean()).toMatchObject({ name: "AMFI Sourced Fund", source: "AMFI" });
    expect(await Instrument.findOne({ assetClass: "MUTUAL_FUND", symbol: "SBICORPBOND" }).lean()).toMatchObject({ name: "Static Seed Fund", source: "SEED" });
  });

  it("never touches ADMIN_UPLOAD rows of a DIFFERENT asset class", async () => {
    await applyInstrumentUpload("BOND" as never, "bonds.csv", csv(["Name", "Some Bond"]));
    await applyInstrumentUpload("REIT" as never, "reits.csv", csv(["Name", "Some REIT"]));
    expect(await Instrument.countDocuments({ assetClass: "BOND", source: ADMIN_UPLOAD_SOURCE })).toBe(1);
    expect(await Instrument.countDocuments({ assetClass: "REIT", source: ADMIN_UPLOAD_SOURCE })).toBe(1);
  });

  it("without removeMissing, an instrument absent from the new file is left exactly as-is (default, no pruning)", async () => {
    await applyInstrumentUpload("REIT" as never, "v1.csv", csv(["Name,Symbol", "Old REIT,REITA"]));
    const summary = await applyInstrumentUpload("REIT" as never, "v2.csv", csv(["Name,Symbol", "New REIT,REITB"]));
    expect(summary.deletedFromPrevious).toBe(0);
    expect(summary.retiredInsteadOfDeleted).toBe(0);
    const stillThere = await Instrument.findOne({ assetClass: "REIT", name: "Old REIT" }).lean();
    expect(stillThere).not.toBeNull();
    expect(stillThere?.isActive).toBe(true); // untouched, not even retired
  });

  it("WITH removeMissing:true, a previously-uploaded instrument a user already HOLDS is retired (isActive:false), never hard-deleted, and an unheld one is deleted", async () => {
    const user = await makeUser();
    await applyInstrumentUpload("REIT" as never, "v1.csv", csv(["Name,Symbol", "Held REIT,REITHELD", "Unheld REIT,REITUNHELD"]));
    const held = await Instrument.findOne({ assetClass: "REIT", name: "Held REIT" }).lean();
    await Holding.create({ userId: user._id, assetClass: "REIT", name: "Held REIT", instrumentId: held!._id, investedValue: 1000, currentValue: 1000, quantity: 10, source: "MANUAL" });

    const summary = await applyInstrumentUpload("REIT" as never, "v2.csv", csv(["Name,Symbol", "New REIT,REITNEW"]), { removeMissing: true });
    expect(summary.removeMissingRequested).toBe(true);
    expect(summary.retiredInsteadOfDeleted).toBe(1);
    expect(summary.deletedFromPrevious).toBe(1); // the unheld one

    const stillThere = await Instrument.findById(held!._id).lean();
    expect(stillThere).not.toBeNull(); // never hard-deleted
    expect(stillThere?.isActive).toBe(false); // retired: out of search, but the holding's link still resolves
    expect(await Instrument.findOne({ assetClass: "REIT", name: "Unheld REIT" }).lean()).toBeNull(); // safe to actually delete
    expect(await Instrument.findOne({ assetClass: "REIT", name: "New REIT" }).lean()).toBeTruthy();
  });

  it("row-level issues survive the DB round trip (skipped/warnings are returned to the caller)", async () => {
    const summary = await applyInstrumentUpload(
      "ULIP_INSURANCE" as never,
      "ulip.csv",
      csv(["Name,NAV", "Good Plan,120", ",Bad Row", "Odd Plan,not-a-number"])
    );
    expect(summary.inserted).toBe(2);
    expect(summary.skipped.some((s) => /No name/.test(s.message))).toBe(true);
    expect(summary.warnings.some((w) => /isn't a number/.test(w.message))).toBe(true);
  });

  it("a second upload for a class with nothing previously uploaded reports zero deleted/retired", async () => {
    const summary = await applyInstrumentUpload("INVIT" as never, "first.csv", csv(["Name", "First InvIT"]));
    expect(summary).toMatchObject({ deletedFromPrevious: 0, retiredInsteadOfDeleted: 0 });
  });

  describe("Mutual Fund holdings -> Look-Through Model wiring", () => {
    it("a MUTUAL_FUND upload with usable Underlying Holdings creates a lookthrough draft with that fund's holdings", async () => {
      const summary = await applyInstrumentUpload(
        "MUTUAL_FUND" as never,
        "mf.csv",
        csv(['Name,Symbol,Underlying Holdings', '"HDFC Flexi Cap Fund",SCHEME1,"Reliance Industries:8.5;HDFC Bank:6.2"'])
      );
      expect(summary.lookthrough).toMatchObject({ fundsUpdated: 1, fundsSkippedNoWeight: 0 });

      const draft = await LookthroughConfig.findOne({ status: "draft" }).sort({ version: -1 }).lean();
      expect(draft).not.toBeNull();
      expect(draft!.payload.mutualFundTopHoldings.hdfcflexicap).toEqual([
        { company: "Reliance Industries", weightPct: 8.5 },
        { company: "HDFC Bank", weightPct: 6.2 },
      ]);
    });

    it("only fills gaps: an existing curated/uploaded fund not mentioned in THIS file is left untouched", async () => {
      await applyInstrumentUpload("MUTUAL_FUND" as never, "mf1.csv", csv(['Name,Symbol,Underlying Holdings', '"Alpha Flexi Cap Fund",SCHEME1,"Company A:10"']));
      await applyInstrumentUpload("MUTUAL_FUND" as never, "mf2.csv", csv(['Name,Symbol,Underlying Holdings', '"Beta Large Cap Fund",SCHEME2,"Company B:20"']));

      const draft = await LookthroughConfig.findOne({ status: "draft" }).sort({ version: -1 }).lean();
      expect(draft!.payload.mutualFundTopHoldings.alphaflexicap).toEqual([{ company: "Company A", weightPct: 10 }]);
      expect(draft!.payload.mutualFundTopHoldings.betalargecap).toEqual([{ company: "Company B", weightPct: 20 }]);
    });

    it("re-uploading the SAME fund replaces its holdings entirely (weight/composition changes reflected), still leaving other funds alone", async () => {
      await applyInstrumentUpload("MUTUAL_FUND" as never, "mf1.csv", csv(['Name,Symbol,Underlying Holdings', '"Alpha Flexi Cap Fund",SCHEME1,"Company A:10;Company B:5"']));
      await applyInstrumentUpload("MUTUAL_FUND" as never, "mf2.csv", csv(['Name,Symbol,Underlying Holdings', '"Alpha Flexi Cap Fund",SCHEME1,"Company A:12"']))

      const draft = await LookthroughConfig.findOne({ status: "draft" }).sort({ version: -1 }).lean();
      expect(draft!.payload.mutualFundTopHoldings.alphaflexicap).toEqual([{ company: "Company A", weightPct: 12 }]); // Company B dropped, weight updated
    });

    it("a holding with no parseable weight is skipped from the lookthrough map (but the fund row itself still uploads fine)", async () => {
      const summary = await applyInstrumentUpload("MUTUAL_FUND" as never, "mf.csv", csv(['Name,Symbol,Underlying Holdings', '"No Weight Fund",SCHEME1,"Company A"']));
      expect(summary.inserted).toBe(1); // the instrument still uploaded
      expect(summary.lookthrough).toMatchObject({ fundsUpdated: 0, fundsSkippedNoWeight: 1 });
    });

    it("a non-mutual-fund upload never touches the lookthrough config at all", async () => {
      const summary = await applyInstrumentUpload("BOND" as never, "bonds.csv", csv(["Name", "Some Bond"]));
      expect(summary.lookthrough).toBeUndefined();
      expect(await LookthroughConfig.countDocuments({})).toBe(0);
    });

    it("saves as a DRAFT only — never auto-publishes, so it doesn't affect live scoring until an admin reviews and publishes", async () => {
      await applyInstrumentUpload("MUTUAL_FUND" as never, "mf.csv", csv(['Name,Symbol,Underlying Holdings', '"Fund One",SCHEME1,"Company A:10"']));
      expect(await LookthroughConfig.countDocuments({ status: "active" })).toBe(0);
      expect(await LookthroughConfig.countDocuments({ status: "draft" })).toBe(1);
    });
  });
});
