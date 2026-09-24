import { User } from "../src/models/User";
import { Holding } from "../src/models/Holding";
import { DataRequest } from "../src/models/DataRequest";
import * as dataRequestService from "../src/services/dataRequestService";

// Phase 7 of docs/ADMIN_PANEL_PLAN.md §4.6/§5.3/§11 — DPDP request queue.

let mobileCounter = 9990000000;
async function makeUser() {
  return User.create({ name: "DPDP User", mobile: String(mobileCounter++), email: `dpdp-${mobileCounter}@example.com`, age: 30, passwordHash: "x" });
}

describe("createExportRequest", () => {
  it("queues a pending export request", async () => {
    const user = await makeUser();
    const request = await dataRequestService.createExportRequest(String(user._id));
    expect(request.type).toBe("export");
    expect(request.status).toBe("pending");
    expect(request.userEmailSnapshot).toBe(user.email);
  });

  it("refuses a second pending export request for the same user", async () => {
    const user = await makeUser();
    await dataRequestService.createExportRequest(String(user._id));
    await expect(dataRequestService.createExportRequest(String(user._id))).rejects.toMatchObject({ status: 409 });
  });
});

describe("logSelfServeDeletion", () => {
  it("creates an already-fulfilled delete record", async () => {
    const user = await makeUser();
    await dataRequestService.logSelfServeDeletion(String(user._id), user.email);
    const logged = await DataRequest.findOne({ userId: user._id, type: "delete" }).lean();
    expect(logged?.status).toBe("fulfilled");
    expect(logged?.fulfilledAt).toBeTruthy();
    expect(logged?.handledBy).toBeUndefined(); // self-serve, no staff involved
  });
});

describe("buildExportBundle", () => {
  it("gathers the user's own data, excluding the password hash", async () => {
    const user = await makeUser();
    await Holding.create({ userId: user._id, assetClass: "EQUITY", name: "Reliance", investedValue: 10000, currentValue: 11000, source: "MANUAL" });
    const bundle = await dataRequestService.buildExportBundle(String(user._id));
    expect(bundle.profile).toEqual(expect.objectContaining({ email: user.email }));
    expect((bundle.profile as unknown as { passwordHash?: string }).passwordHash).toBeUndefined();
    expect(bundle.holdings).toHaveLength(1);
    expect(bundle.tickets).toEqual([]);
  });

  it("throws for an unknown user", async () => {
    await expect(dataRequestService.buildExportBundle("64b000000000000000000000")).rejects.toMatchObject({ status: 404 });
  });
});

describe("fulfilExportRequest", () => {
  it("marks the request fulfilled and returns the export bundle", async () => {
    const user = await makeUser();
    const request = await dataRequestService.createExportRequest(String(user._id));
    const bundle = await dataRequestService.fulfilExportRequest(String(request._id), "staff@example.com");
    expect(bundle.profile).toEqual(expect.objectContaining({ email: user.email }));

    const reloaded = await DataRequest.findById(request._id).lean();
    expect(reloaded?.status).toBe("fulfilled");
    expect(reloaded?.handledBy).toBe("staff@example.com");
  });

  it("refuses to fulfil a delete request as an export", async () => {
    const user = await makeUser();
    await dataRequestService.logSelfServeDeletion(String(user._id), user.email);
    const deleteReq = await DataRequest.findOne({ userId: user._id, type: "delete" });
    await expect(dataRequestService.fulfilExportRequest(String(deleteReq!._id), "staff@example.com")).rejects.toMatchObject({ status: 400 });
  });
});

describe("fulfilDeleteRequest", () => {
  it("performs the actual account deletion and marks the request fulfilled", async () => {
    const user = await makeUser();
    const request = await DataRequest.create({ userId: user._id, userEmailSnapshot: user.email, type: "delete", status: "pending" });

    const fulfilled = await dataRequestService.fulfilDeleteRequest(String(request._id), "staff@example.com");
    expect(fulfilled.status).toBe("fulfilled");
    expect(fulfilled.handledBy).toBe("staff@example.com");
    expect(await User.findById(user._id)).toBeNull();
  });

  it("refuses to re-fulfil an already-fulfilled request", async () => {
    const user = await makeUser();
    const request = await DataRequest.create({ userId: user._id, userEmailSnapshot: user.email, type: "delete", status: "pending" });
    await dataRequestService.fulfilDeleteRequest(String(request._id), "staff@example.com");
    await expect(dataRequestService.fulfilDeleteRequest(String(request._id), "staff@example.com")).rejects.toMatchObject({ status: 400 });
  });
});

describe("rejectDataRequest", () => {
  it("rejects a pending request with a reason", async () => {
    const user = await makeUser();
    const request = await dataRequestService.createExportRequest(String(user._id));
    const rejected = await dataRequestService.rejectDataRequest(String(request._id), "Insufficient identity verification", "staff@example.com");
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toBe("Insufficient identity verification");
  });

  it("refuses to reject an already-fulfilled request", async () => {
    const user = await makeUser();
    const request = await dataRequestService.createExportRequest(String(user._id));
    await dataRequestService.fulfilExportRequest(String(request._id), "staff@example.com");
    await expect(dataRequestService.rejectDataRequest(String(request._id), "too late", "staff@example.com")).rejects.toMatchObject({ status: 400 });
  });
});

describe("listDataRequests", () => {
  it("filters by status when given, newest first", async () => {
    const user = await makeUser();
    await dataRequestService.createExportRequest(String(user._id));
    const pending = await dataRequestService.listDataRequests("pending");
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending.every((r) => r.status === "pending")).toBe(true);
  });
});
