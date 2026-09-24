import { Types } from "mongoose";
import { Holding } from "../src/models/Holding";
import { User } from "../src/models/User";
import { findBrokenFdPfHoldings } from "../src/scripts/listBrokenFdPfHoldings";

// The read-only audit of FD/PF holdings the daily valuation job can't reprice.

const thisYear = new Date().getFullYear();
let mobileCounter = 9400000000;

async function makeUser(email: string) {
  return User.create({ name: "Audit Tester", mobile: String(mobileCounter++), email, age: 30, passwordHash: "x" });
}
type Extra = Record<string, unknown>;
async function makeFd(userId: Types.ObjectId, name: string, extraFields: Extra = {}, investedValue = 100000) {
  return Holding.create({
    userId,
    assetClass: "FD",
    name,
    investedValue,
    currentValue: 105000,
    source: "MANUAL",
    extraFields: { bank: name, principal: 100000, tenureMonths: 24, startMonth: 1, startYear: thisYear - 1, interestRate: 7, ...extraFields },
  });
}
async function makePf(userId: Types.ObjectId, name: string, extraFields: Extra = {}) {
  return Holding.create({
    userId,
    assetClass: "PF",
    name,
    investedValue: 150000,
    currentValue: 160000,
    source: "MANUAL",
    extraFields: { subType: "EPF", institution: name, openingBalance: 150000, monthlyContribution: 5000, startMonth: 1, startYear: thisYear - 1, interestRatePercent: 8.25, ...extraFields },
  });
}

describe("findBrokenFdPfHoldings", () => {
  it("lists only holdings the job can't reprice, says which field is wrong, and names the user", async () => {
    const user = await makeUser("owner-of-broken@example.com");
    await makeFd(user._id, "Healthy FD");
    await makePf(user._id, "Healthy PF");
    const missingMonth = await makeFd(user._id, "FD no month", { startMonth: undefined });
    const badYear = await makeFd(user._id, "FD bad year", { startYear: "not-a-year" });
    const missingRate = await makePf(user._id, "PF no rate", { interestRatePercent: undefined });

    const { scanned, broken } = await findBrokenFdPfHoldings();

    expect(scanned).toBe(5);
    expect(broken.map((b) => b.name).sort()).toEqual(["FD bad year", "FD no month", "PF no rate"]);
    const byId = Object.fromEntries(broken.map((b) => [b.holdingId, b]));
    expect(byId[String(missingMonth._id)]).toMatchObject({ assetClass: "FD", userEmail: "owner-of-broken@example.com", userId: String(user._id) });
    expect(byId[String(missingMonth._id)].problems).toEqual(["startMonth is missing"]);
    expect(byId[String(badYear._id)].problems).toEqual(['startYear is not a valid number ("not-a-year")']);
    expect(byId[String(missingRate._id)].problems).toEqual(["interestRatePercent is missing"]);
  });

  it("an older FD with no stored principal falls back to its invested value — same as the job — so it is NOT flagged", async () => {
    const user = await makeUser("old-fd@example.com");
    await makeFd(user._id, "Old FD", { principal: undefined }, 80000);
    const { broken } = await findBrokenFdPfHoldings();
    expect(broken).toHaveLength(0);
  });

  it("an optional monthlyContribution missing is not a problem", async () => {
    const user = await makeUser("no-contribution@example.com");
    await makePf(user._id, "PF no contribution", { monthlyContribution: undefined });
    await makeFd(user._id, "FD no contribution", { monthlyContribution: undefined });
    expect((await findBrokenFdPfHoldings()).broken).toHaveLength(0);
  });

  it("covers every user, not just Premium ones", async () => {
    const a = await makeUser("free-user@example.com"); // no subscription = Freemium
    const b = await makeUser("other-user@example.com");
    await makeFd(a._id, "Free FD broken", { tenureMonths: undefined });
    await makeFd(b._id, "Other FD broken", { interestRate: undefined });
    const { broken } = await findBrokenFdPfHoldings();
    expect(broken.map((x) => x.userEmail).sort()).toEqual(["free-user@example.com", "other-user@example.com"]);
  });

  it("ignores non-FD/PF holdings entirely", async () => {
    const user = await makeUser("equity-only@example.com");
    await Holding.create({ userId: user._id, assetClass: "EQUITY", name: "Some Equity", investedValue: 1000, currentValue: 1200, source: "MANUAL", extraFields: {} });
    expect(await findBrokenFdPfHoldings()).toEqual({ scanned: 0, broken: [] });
  });

  it("is strictly read-only — nothing about any holding changes", async () => {
    const user = await makeUser("read-only@example.com");
    const broken = await makeFd(user._id, "FD no month", { startMonth: undefined });
    const healthy = await makePf(user._id, "Healthy PF");
    const before = JSON.stringify(await Holding.find({}).sort({ _id: 1 }).lean());

    await findBrokenFdPfHoldings();

    expect(JSON.stringify(await Holding.find({}).sort({ _id: 1 }).lean())).toBe(before);
    expect((await Holding.findById(broken._id).lean())?.currentValue).toBe(105000);
    expect((await Holding.findById(healthy._id).lean())?.currentValue).toBe(160000);
  });

  it("reports a broken holding whose user no longer exists without crashing", async () => {
    await makeFd(new Types.ObjectId(), "Orphan FD", { startMonth: undefined });
    const { broken } = await findBrokenFdPfHoldings();
    expect(broken).toHaveLength(1);
    expect(broken[0].userEmail).toBeNull();
  });
});
