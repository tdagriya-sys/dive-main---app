import axios from "axios";
import { env } from "../src/config/env";
import { analyzeOffer, checkOfferForPlans, fetchOffer } from "../src/services/razorpayOfferService";

// Razorpay silently ignores an offer whose rules don't fit the plan, so the
// offer is read back and explained in plain English.

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const NOW = Date.parse("2026-09-26T12:00:00Z");
// The offer exactly as Razorpay returned it for the first live test:
// 99% off, UPI only, Checkout, ₹1–₹100 order range, valid 25–28 Sep.
const offer = (over: Record<string, unknown> = {}) => ({
  id: "offer_TgOy0jx3861qni",
  name: "Test 99 Offer",
  status: "ACTIVE",
  starts_at: "1790368121",
  ends_at: "1790620167",
  applicable_channels: ["RZP_CHECKOUT"],
  rules: {
    items: [
      {
        criteria: { includes: { paymentInstrument: { methods: ["upi"] }, order: { min_amount: "100", max_amount: "10000" } } },
        benefits: { entity: "collection", count: 1, items: [{ unit: "PERCENTAGE", value: "9900", max_benefit_value: "50000" }] },
      },
    ],
  },
  ...over,
});
const PLAN = { name: "Premium (Monthly)", pricePaise: 11900 };

describe("analyzeOffer", () => {
  it("THE REPORTED CASE: max order amount ₹100 on a ₹119 plan → says the offer will NOT apply and how to fix it", () => {
    const a = analyzeOffer(offer(), { plans: [PLAN], couponPercent: 99, now: NOW });
    expect(a.found).toBe(true);
    expect(a.problems).toHaveLength(1);
    expect(a.problems[0]).toContain("MAXIMUM order amount is ₹100");
    expect(a.problems[0]).toContain("Premium (Monthly) costs ₹119");
    expect(a.problems[0]).toContain("at least ₹119");
    expect(a.notes.join(" ")).toContain("Discount: 99%");
    expect(a.notes.join(" ")).toContain("Applies to: upi");
  });

  it("once the maximum is raised above the plan price, nothing is wrong", () => {
    const fixed = offer({ rules: { items: [{ criteria: { includes: { paymentInstrument: { methods: ["upi"] }, order: { min_amount: "100", max_amount: "100000" } } }, benefits: [{ unit: "PERCENTAGE", value: "9900" }] }] } });
    expect(analyzeOffer(fixed, { plans: [PLAN], couponPercent: 99, now: NOW }).problems).toEqual([]);
  });

  it("also accepts the discount details as a plain list (either shape works)", () => {
    const plain = offer({ rules: { items: [{ criteria: { includes: { order: { max_amount: "1000000" } } }, benefits: [{ unit: "PERCENTAGE", value: "9900" }] }] } });
    expect(analyzeOffer(plain, { plans: [PLAN], couponPercent: 99, now: NOW }).notes.join(" ")).toContain("Discount: 99%");
  });

  describe("total-usage limit across all customers", () => {
    const limited = (n: string, on = "OFFER") => offer({ usage_limits: [{ on, limit_type: "COUNT", limit_value: n, frequency_type: "FREQUENCY_TYPE_UNSPECIFIED" }], rules: { items: [{ criteria: { includes: { order: { max_amount: "1000000" } } }, benefits: { items: [{ unit: "PERCENTAGE", value: "9900" }] } }] } });

    it("THE SECOND TEST'S CASE: an offer usable once in total, on a coupon that allows many uses → warns it will stop applying", () => {
      const a = analyzeOffer(limited("1"), { plans: [PLAN], couponPercent: 99, couponMaxRedemptions: 100, now: NOW });
      expect(a.notes.join(" ")).toContain("Total uses allowed across all customers: 1");
      expect(a.problems).toHaveLength(1);
      expect(a.problems[0]).toContain("only be used 1 time IN TOTAL");
      expect(a.problems[0]).toContain("This coupon allows 100 uses");
    });
    it("a coupon with no use limit against a limited offer is also flagged", () => {
      expect(analyzeOffer(limited("50"), { plans: [PLAN], couponPercent: 99, now: NOW }).problems[0]).toContain("This coupon has no use limit");
    });
    it("no warning when the offer allows at least as many uses as the coupon", () => {
      expect(analyzeOffer(limited("100"), { plans: [PLAN], couponPercent: 99, couponMaxRedemptions: 100, now: NOW }).problems).toEqual([]);
      expect(analyzeOffer(limited("1000"), { plans: [PLAN], couponPercent: 99, couponMaxRedemptions: 100, now: NOW }).problems).toEqual([]);
    });
    it("a per-customer limit is not mistaken for the total limit", () => {
      const a = analyzeOffer(limited("1", "CUSTOMER"), { plans: [PLAN], couponPercent: 99, couponMaxRedemptions: 100, now: NOW });
      expect(a.problems).toEqual([]);
      expect(a.notes.join(" ")).not.toContain("Total uses");
    });
    it("an offer with no usage limits says nothing about them", () => {
      expect(analyzeOffer(offer({ rules: { items: [{ criteria: { includes: { order: { max_amount: "1000000" } } } }] } }), { plans: [PLAN], now: NOW }).notes.join(" ")).not.toContain("Total uses");
    });
  });

  it("no order-amount limits at all is fine", () => {
    const open = offer({ rules: { items: [{ criteria: { includes: { paymentInstrument: { methods: ["upi", "card"] } } }, benefits: [{ unit: "PERCENTAGE", value: "9900" }] }] } });
    expect(analyzeOffer(open, { plans: [PLAN], couponPercent: 99, now: NOW }).problems).toEqual([]);
  });

  it("checks EVERY plan the coupon covers — a cheap plan can pass while the dear one fails", () => {
    const a = analyzeOffer(offer(), { plans: [{ name: "Cheap", pricePaise: 5000 }, { name: "Annual", pricePaise: 109900 }], now: NOW });
    expect(a.problems).toHaveLength(1);
    expect(a.problems[0]).toContain("Annual costs ₹1099");
  });

  it("flags a minimum order amount above the plan price", () => {
    const a = analyzeOffer(offer({ rules: { items: [{ criteria: { includes: { order: { min_amount: "50000" } } } }] } }), { plans: [PLAN], now: NOW });
    expect(a.problems[0]).toContain("MINIMUM order amount is ₹500");
  });

  it("flags an inactive, not-yet-started or expired offer", () => {
    expect(analyzeOffer(offer({ status: "INACTIVE" }), { plans: [], now: NOW }).problems[0]).toContain("not ACTIVE");
    expect(analyzeOffer(offer(), { plans: [], now: Date.parse("2026-09-01T00:00:00Z") }).problems[0]).toContain("hasn't started");
    expect(analyzeOffer(offer(), { plans: [], now: Date.parse("2026-12-01T00:00:00Z") }).problems[0]).toContain("expired");
  });

  it("flags an offer that isn't enabled for UPI or for Razorpay Checkout", () => {
    const cardOnly = offer({ rules: { items: [{ criteria: { includes: { paymentInstrument: { methods: ["card"] } } } }] } });
    expect(analyzeOffer(cardOnly, { plans: [], now: NOW }).problems[0]).toContain("isn't enabled for UPI");
    expect(analyzeOffer(offer({ applicable_channels: ["OTHER"] }), { plans: [], now: NOW }).problems[0]).toContain("Razorpay Checkout");
  });

  it("flags a percentage that doesn't match the coupon's own, since the app's shown price would be wrong", () => {
    const a = analyzeOffer(offer({ rules: { items: [{ criteria: { includes: { order: { max_amount: "1000000" } } }, benefits: [{ unit: "PERCENTAGE", value: "5000" }] }] } }), { plans: [PLAN], couponPercent: 99, now: NOW });
    expect(a.problems.join(" ")).toContain("offer gives 50% off but this coupon says 99%");
  });

  it("an offer id Razorpay doesn't know is reported as not found", () => {
    const a = analyzeOffer(null, { plans: [PLAN] });
    expect(a.found).toBe(false);
    expect(a.problems[0]).toContain("wasn't found");
  });
});

describe("fetching the offer (read-only GET)", () => {
  const realPlaceholder = env.razorpay.isPlaceholder;
  beforeEach(() => {
    env.razorpay.isPlaceholder = false;
    mockedAxios.get.mockReset();
  });
  afterAll(() => {
    env.razorpay.isPlaceholder = realPlaceholder;
  });

  it("finds the offer in Razorpay's list and analyses it against the plan", async () => {
    mockedAxios.get.mockResolvedValue({ data: { items: [offer(), { id: "offer_other" }] } });
    const a = await checkOfferForPlans("offer_TgOy0jx3861qni", [PLAN], 99);
    expect(mockedAxios.get).toHaveBeenCalledWith("https://api.razorpay.com/v1/offers", expect.objectContaining({ params: { count: 100 } }));
    expect(a?.found).toBe(true);
    expect(a?.problems.some((p) => p.includes("MAXIMUM order amount"))).toBe(true);
  });

  it("an id that isn't in the list is 'not found'", async () => {
    mockedAxios.get.mockResolvedValue({ data: { items: [{ id: "offer_other" }] } });
    expect((await checkOfferForPlans("offer_missing", [PLAN]))?.found).toBe(false);
  });

  it("if Razorpay can't be reached it says nothing rather than wrongly claiming the offer is missing", async () => {
    mockedAxios.get.mockRejectedValue(new Error("network"));
    expect(await fetchOffer("offer_x")).toBeUndefined();
    expect(await checkOfferForPlans("offer_x", [PLAN])).toBeUndefined();
  });

  it("in mock/placeholder mode it never makes a request", async () => {
    env.razorpay.isPlaceholder = true;
    expect(await checkOfferForPlans("offer_x", [PLAN])).toBeUndefined();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
