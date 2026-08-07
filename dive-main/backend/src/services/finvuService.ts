import axios from "axios";
import { randomUUID } from "crypto";
import { env } from "../config/env";
import { AssetClass } from "../models/Instrument";

/**
 * Isolates every Finvu (Account Aggregator) specific call behind this module —
 * base URL, client ID/secret, cert, endpoint shapes — so swapping to another
 * AA (Setu, OneMoney) later only means rewriting this file, not the rest of
 * the app. Shaped after Finvu's published ReBIT AA sandbox API:
 *   1. POST consent request  -> { ConsentHandle, ConsentRedirectionURL }
 *   2. user approves on Finvu's consent UI (redirect/handoff)
 *   3. consent status becomes ACTIVE (via callback or polling)
 *   4. FI data fetch once ACTIVE -> per-FIType records
 *
 * FINVU_CLIENT_ID / FINVU_CLIENT_SECRET are REPLACE_ME placeholders in
 * .env.example (Finvu requires sandbox registration — see /docs/GETTING_API_KEYS.md).
 * While they're placeholders, every method below runs in MOCK_MODE: it
 * exercises the exact same request/response shapes but never calls the real
 * Finvu sandbox, and clearly flags its data as synthetic (`isMock: true`).
 */

export const FI_TYPES = ["DEPOSIT", "MUTUAL_FUNDS", "EQUITIES", "INSURANCE_POLICIES"] as const;
export type FiType = (typeof FI_TYPES)[number];

// Which of the 11 canonical asset classes Finvu-style FI types can realistically
// cover. Physical gold/silver, ETFs, REITs/InvITs, ULIPs (as pure insurance,
// vs the equity-linked component) and crypto are NOT covered by AA today —
// those must come from Manual Entry, File Upload, or Bot Scan instead.
export const FI_TYPE_TO_ASSET_CLASS: Record<FiType, AssetClass> = {
  DEPOSIT: "FD",
  MUTUAL_FUNDS: "MUTUAL_FUND",
  EQUITIES: "EQUITY",
  INSURANCE_POLICIES: "ULIP_INSURANCE",
};

export interface FiRecord {
  fiType: FiType;
  name: string;
  investedValue: number;
  currentValue: number;
  quantity?: number;
  extraFields?: Record<string, unknown>;
}

export interface ConsentRequestResult {
  consentHandle: string;
  approvalUrl: string;
  isMock: boolean;
}

export async function createConsentRequest(userId: string): Promise<ConsentRequestResult> {
  if (env.finvu.isPlaceholder) {
    const consentHandle = `mock-${randomUUID()}`;
    return {
      consentHandle,
      // In real mode this is Finvu's own hosted consent UI URL. In mock mode
      // it points back at our own frontend's AA consent screen, which POSTs
      // to the mock-only /approve endpoint below to simulate the user
      // approving consent on Finvu's UI and being redirected back.
      approvalUrl: `${env.publicBaseUrl.replace(/\/api$/, "")}/mock-aa-consent?handle=${consentHandle}`,
      isMock: true,
    };
  }

  const { data } = await axios.post(
    `${env.finvu.baseUrl}/consent-requests`,
    { userId, fiTypes: FI_TYPES },
    { headers: { "client-id": env.finvu.clientId, "client-secret": env.finvu.clientSecret } }
  );
  return { consentHandle: data.ConsentHandle, approvalUrl: data.ConsentRedirectionURL, isMock: false };
}

export async function fetchFiData(consentHandle: string): Promise<{ records: FiRecord[]; isMock: boolean }> {
  if (env.finvu.isPlaceholder || consentHandle.startsWith("mock-")) {
    return { records: buildSyntheticFiData(), isMock: true };
  }

  const { data } = await axios.get(`${env.finvu.baseUrl}/consent/${consentHandle}/fi-data`, {
    headers: { "client-id": env.finvu.clientId, "client-secret": env.finvu.clientSecret },
  });
  return { records: data.records, isMock: false };
}

/**
 * Synthetic-but-realistically-shaped FI data, clearly labeled as mock. Stands
 * in for a real Finvu sandbox response so the whole consent -> fetch -> Holding
 * pipeline is testable end-to-end without real sandbox credentials.
 */
function buildSyntheticFiData(): FiRecord[] {
  return [
    { fiType: "EQUITIES", name: "Infosys", investedValue: 32000, currentValue: 34500, quantity: 20 },
    { fiType: "MUTUAL_FUNDS", name: "SBI Blue Chip Fund", investedValue: 45000, currentValue: 48200 },
    { fiType: "DEPOSIT", name: "State Bank of India Fixed Deposit", investedValue: 60000, currentValue: 63000,
      extraFields: { bank: "State Bank of India", interestRate: 6.8 } },
    { fiType: "INSURANCE_POLICIES", name: "SBI Life Smart Wealth Builder", investedValue: 15000, currentValue: 15900 },
  ];
}
