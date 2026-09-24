import { api } from "../../lib/api";
import { getStepUpToken, setStepUpToken, isStepUpRequiredError, requestStepUp } from "./stepUp";

jest.mock("../../lib/api", () => ({ api: { post: jest.fn() } }));

describe("stepUp token storage", () => {
  afterEach(() => setStepUpToken(null));

  it("get/set round-trips", () => {
    setStepUpToken("tok-abc");
    expect(getStepUpToken()).toBe("tok-abc");
  });
});

describe("isStepUpRequiredError", () => {
  it("recognizes a 401 STEP_UP_REQUIRED error shape", () => {
    expect(isStepUpRequiredError({ response: { status: 401, data: { error: "STEP_UP_REQUIRED" } } })).toBe(true);
  });

  it("is false for an ordinary 401", () => {
    expect(isStepUpRequiredError({ response: { status: 401, data: { error: "UNAUTHORIZED" } } })).toBe(false);
  });

  it("is false for a non-401 error", () => {
    expect(isStepUpRequiredError({ response: { status: 500, data: { error: "STEP_UP_REQUIRED" } } })).toBe(false);
  });

  it("is false for a plain Error with no response", () => {
    expect(isStepUpRequiredError(new Error("network down"))).toBe(false);
  });
});

describe("requestStepUp", () => {
  afterEach(() => {
    setStepUpToken(null);
    jest.clearAllMocks();
  });

  it("calls the step-up endpoint with the password and caches the returned token", async () => {
    api.post.mockResolvedValue({ data: { stepUpToken: "fresh-token" } });
    const token = await requestStepUp("Passw0rd!");
    expect(api.post).toHaveBeenCalledWith("/auth/staff/step-up", { password: "Passw0rd!" });
    expect(token).toBe("fresh-token");
    expect(getStepUpToken()).toBe("fresh-token");
  });

  it("propagates a wrong-password rejection without caching anything", async () => {
    api.post.mockRejectedValue({ response: { status: 401, data: { message: "Incorrect password." } } });
    await expect(requestStepUp("wrong")).rejects.toBeTruthy();
    expect(getStepUpToken()).toBeNull();
  });
});
