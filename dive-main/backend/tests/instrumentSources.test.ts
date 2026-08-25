import axios from "axios";
import { fetchAmfiMutualFunds } from "../src/services/instrumentSources";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Real sample lines from AMFI's live NAVAll.txt for one underlying fund
// published under 4 Plan x Option combinations, all sharing the identical
// Scheme Name (index 3) — Plan (index 4) and Option (index 5) are the only
// columns that actually distinguish them. This is the exact "4 SBI
// Automotive fund, same name" user report.
const SAMPLE_NAVALL = [
  "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date",
  "",
  "Open Ended Schemes(Equity Scheme - Sectoral/ Thematic)",
  "152657;INF200KB1183;-;SBI Automotive Opportunities Fund;Direct Plan;Growth;13.9615;24-Aug-2026",
  "152655;INF200KB1191;INF200KB1209;SBI Automotive Opportunities Fund;Direct Plan;IDCW;13.9611;24-Aug-2026",
  "152658;INF200KB1159;-;SBI Automotive Opportunities Fund;Regular Plan;Growth;13.6224;24-Aug-2026",
  "152656;INF200KB1167;INF200KB1175;SBI Automotive Opportunities Fund;Regular Plan;IDCW;13.6226;24-Aug-2026",
].join("\n");

describe("fetchAmfiMutualFunds", () => {
  beforeEach(() => jest.clearAllMocks());

  it("folds Plan and Option into the stored name so same-name variants become distinguishable", async () => {
    mockedAxios.get.mockResolvedValue({ data: SAMPLE_NAVALL });

    const rows = await fetchAmfiMutualFunds();

    expect(rows).toHaveLength(4);
    const names = rows.map((r) => r.name);
    // No two rows may share an identical name — that's the exact bug.
    expect(new Set(names).size).toBe(4);

    expect(names).toContain("SBI Automotive Opportunities Fund - Direct Plan - Growth");
    expect(names).toContain("SBI Automotive Opportunities Fund - Direct Plan - IDCW");
    expect(names).toContain("SBI Automotive Opportunities Fund - Regular Plan - Growth");
    expect(names).toContain("SBI Automotive Opportunities Fund - Regular Plan - IDCW");
  });

  it("keeps the AMFI scheme code as symbol, and stores plan/option as structured metadata", async () => {
    mockedAxios.get.mockResolvedValue({ data: SAMPLE_NAVALL });

    const rows = await fetchAmfiMutualFunds();
    const directGrowth = rows.find((r) => r.symbol === "152657");

    expect(directGrowth).toBeDefined();
    expect(directGrowth?.name).toBe("SBI Automotive Opportunities Fund - Direct Plan - Growth");
    expect(directGrowth?.metadata).toEqual({ plan: "Direct Plan", option: "Growth" });
  });

  it("falls back to the bare scheme name when a line has no real Plan/Option (defensive, in case AMFI ever omits them)", async () => {
    const noSuffix = [
      "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date",
      "999999;INF000A0000;-;Some Fund With No Plan Info;-;-;10.00;24-Aug-2026",
    ].join("\n");
    mockedAxios.get.mockResolvedValue({ data: noSuffix });

    const rows = await fetchAmfiMutualFunds();

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Some Fund With No Plan Info");
    expect(rows[0].metadata).toEqual({});
  });
});
