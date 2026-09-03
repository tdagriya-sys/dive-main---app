import request from "supertest";
import { createApp } from "../src/app";
import { DIVE_SCORE_V2_WEIGHTS } from "../src/services/diveScoreService";
import { weightTierLabel } from "../src/services/scoreReportPdfService";

const app = createApp();

// Custom binary parser — supertest/superagent has no built-in parser for
// application/pdf, so without this `res.body` would come back empty/wrong
// regardless of what the server actually sent. Same pattern as
// extension.test.ts's zip download test.
function binaryParser(res: any, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}

async function signupAndLogin(email: string, mobile: string) {
  const signup = {
    name: "Report Tester",
    mobile,
    email,
    age: 30,
    password: "Passw0rd!",
    confirmPassword: "Passw0rd!",
  };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return verify.body.accessToken as string;
}

// The PDF is a paid feature (paymentController.test.ts covers the payment
// flow itself in depth) — no real RAZORPAY_KEY_ID/SECRET in the test env, so
// this exercises the same mock-payment path a local dev run without real
// Razorpay keys would use, not a shortcut around the real gate.
async function payForReport(token: string) {
  const order = await request(app).post("/api/payments/report/order").set("Authorization", `Bearer ${token}`).send();
  await request(app)
    .post("/api/payments/report/verify")
    .set("Authorization", `Bearer ${token}`)
    .send({ razorpay_order_id: order.body.orderId, razorpay_payment_id: `mock_payment_${order.body.orderId}`, razorpay_signature: "mock" });
}

// weightTierLabel — the downloadable resilience report shows a qualitative
// tier instead of DIVE_SCORE_V2_WEIGHTS' literal percentages (see that
// function's comment in scoreReportPdfService.ts). Unlike the in-app screen
// or the authenticated /score/breakdown JSON (both fine to show the exact
// number to the account's own owner), a PDF is built to be handed to someone
// else — so the exact composite-score weighting recipe stays internal to
// this report specifically.
describe("weightTierLabel", () => {
  it("buckets every real composite weight into the expected qualitative tier", () => {
    const expected: Record<keyof typeof DIVE_SCORE_V2_WEIGHTS, string> = {
      concentration: "Major factor",
      volatility: "Contributing factor",
      drawdown: "Contributing factor",
      var: "Contributing factor",
      liquidity: "Contributing factor",
      beta: "Contributing factor",
      correlation: "Contributing factor",
      diversificationRatio: "Minor factor",
      contextFit: "Contributing factor",
      stockCountFit: "Contributing factor",
    };
    for (const [key, weight] of Object.entries(DIVE_SCORE_V2_WEIGHTS) as Array<[keyof typeof DIVE_SCORE_V2_WEIGHTS, number]>) {
      expect(weightTierLabel(weight)).toBe(expected[key]);
    }
  });

  it("never returns a label containing a digit or a percent sign — the whole point is to not leak the exact number", () => {
    for (const weight of Object.values(DIVE_SCORE_V2_WEIGHTS)) {
      expect(weightTierLabel(weight)).not.toMatch(/[0-9%]/);
    }
  });

  it("is monotonic — a strictly higher weight never resolves to a lower-ranked tier", () => {
    const rank: Record<string, number> = { "Minor factor": 0, "Contributing factor": 1, "Major factor": 2 };
    const weights = Object.values(DIVE_SCORE_V2_WEIGHTS).slice().sort((a, b) => a - b);
    for (let i = 1; i < weights.length; i++) {
      expect(rank[weightTierLabel(weights[i])]).toBeGreaterThanOrEqual(rank[weightTierLabel(weights[i - 1])]);
    }
  });
});

describe("resilience score PDF report — weight genericization", () => {
  it("blocks the download until the report is paid for", async () => {
    const token = await signupAndLogin("pdfreport0@example.com", "9300000100");
    const res = await request(app).get("/api/score/breakdown/pdf").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(402);
    expect(res.body.error).toBe("PAYMENT_REQUIRED");
  });

  it("still generates a real, well-formed PDF end-to-end after the weights were genericized", async () => {
    const token = await signupAndLogin("pdfreport1@example.com", "9300000101");
    await request(app)
      .post("/api/holdings/manual")
      .set("Authorization", `Bearer ${token}`)
      .send({ assetClass: "EQUITY", name: "Reliance Industries", investedValue: 100000, currentValue: 110000 });
    await payForReport(token);

    const res = await request(app).get("/api/score/breakdown/pdf").set("Authorization", `Bearer ${token}`).buffer(true).parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain('filename="divve-resilience-report.pdf"');

    const body: Buffer = res.body;
    // "%PDF-" magic header — confirms a real, parseable PDF came back, not
    // just a 200 with the right headers and junk (or a thrown/500'd
    // generator) behind them.
    expect(body.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    // Larger than a trivial/empty document — this report has a cover page,
    // a radar chart, 10 sub-score cards, and a methodology section, so a
    // truncated/broken generation would be far smaller than a real one.
    expect(body.length).toBeGreaterThan(5000);
  });

  it("requires auth, same as the JSON breakdown endpoint", async () => {
    const res = await request(app).get("/api/score/breakdown/pdf");
    expect(res.status).toBe(401);
  });
});
