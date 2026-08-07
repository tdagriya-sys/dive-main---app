import request from "supertest";
import { createApp } from "../src/app";
import { Instrument } from "../src/models/Instrument";

const app = createApp();

async function signupAndLogin(mobile: string, email: string) {
  const signup = { name: "Upload Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return verify.body.accessToken as string;
}

describe("uploads", () => {
  beforeAll(async () => {
    await Instrument.create({ assetClass: "EQUITY", symbol: "RELIANCE", name: "Reliance Industries", isActive: true, source: "SEED" });
  });

  it("parses a CSV file into candidate holdings", async () => {
    const token = await signupAndLogin("9111111111", "csv@example.com");
    const csv = "Name,Invested,Current\nReliance Industries,10000,11000\nHDFC Bank Fixed Deposit,5000,5000\n";
    const res = await request(app)
      .post("/api/uploads")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), { filename: "holdings.csv", contentType: "text/csv" });
    expect(res.status).toBe(200);
    expect(res.body.candidates.length).toBe(2);
    const reliance = res.body.candidates.find((c: { name: string }) => c.name === "Reliance Industries");
    expect(reliance.assetClass).toBe("EQUITY");
    expect(reliance.investedValue).toBe(10000);
  });

  it("parses a JSON export into candidate holdings", async () => {
    const token = await signupAndLogin("9222222222", "json@example.com");
    const json = JSON.stringify({ holdings: [{ name: "Bitcoin", investedValue: 20000, currentValue: 25000 }] });
    const res = await request(app)
      .post("/api/uploads")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(json), { filename: "export.json", contentType: "application/json" });
    expect(res.status).toBe(200);
    expect(res.body.candidates[0].assetClass).toBe("CRYPTO");
  });

  it("rejects an unsupported file type", async () => {
    const token = await signupAndLogin("9333333333", "exe@example.com");
    const res = await request(app)
      .post("/api/uploads")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from("not a real exe"), { filename: "virus.exe", contentType: "application/x-msdownload" });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app).post("/api/uploads").attach("file", Buffer.from("a,b\n1,2"), { filename: "x.csv", contentType: "text/csv" });
    expect(res.status).toBe(401);
  });

  it("returns a clear AI_NOT_CONFIGURED error for image uploads when no real ANTHROPIC_API_KEY is set", async () => {
    const token = await signupAndLogin("9444444444", "img@example.com");
    // A 1x1 PNG — content doesn't matter, since without a real key the request
    // should be rejected before any AI call is attempted.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );
    const res = await request(app)
      .post("/api/uploads")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", png, { filename: "screenshot.png", contentType: "image/png" });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("AI_NOT_CONFIGURED");
  });
});
