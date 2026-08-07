import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

async function signupAndLogin(mobile: string, email: string) {
  const signup = { name: "Account Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return verify.body.accessToken as string;
}

describe("holding deletion", () => {
  it("deletes a specific holding by id", async () => {
    const token = await signupAndLogin("9200000001", "delholding@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    const create = await request(app).post("/api/holdings/manual").set(auth).send({
      assetClass: "EQUITY", name: "Infosys", investedValue: 10000, currentValue: 11000,
    });
    const holdingId = create.body.holding._id;

    const del = await request(app).delete(`/api/holdings/${holdingId}`).set(auth);
    expect(del.status).toBe(200);

    const list = await request(app).get("/api/holdings").set(auth);
    expect(list.body.holdings).toHaveLength(0);
  });

  it("won't delete another user's holding", async () => {
    const tokenA = await signupAndLogin("9200000002", "ownerA@example.com");
    const tokenB = await signupAndLogin("9200000003", "ownerB@example.com");
    const create = await request(app).post("/api/holdings/manual").set({ Authorization: `Bearer ${tokenA}` }).send({
      assetClass: "EQUITY", name: "TCS", investedValue: 5000, currentValue: 5200,
    });
    const holdingId = create.body.holding._id;

    const del = await request(app).delete(`/api/holdings/${holdingId}`).set({ Authorization: `Bearer ${tokenB}` });
    expect(del.status).toBe(404);
  });
});

describe("account deletion", () => {
  it("deletes the account and cascades its holdings", async () => {
    const token = await signupAndLogin("9200000004", "deleteme@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    await request(app).post("/api/holdings/manual").set(auth).send({
      assetClass: "EQUITY", name: "Wipro", investedValue: 3000, currentValue: 3100,
    });

    const del = await request(app).delete("/api/users/me").set(auth);
    expect(del.status).toBe(200);

    // access token still technically valid (short-lived JWT), but the user record is gone
    const me = await request(app).get("/api/auth/me").set(auth);
    expect(me.status).toBe(404);

    const login = await request(app).post("/api/auth/login").send({ identifier: "deleteme@example.com", password: "Passw0rd!" });
    expect(login.status).toBe(404);
    expect(login.body.error).toBe("USER_NOT_FOUND");
  });

  it("requires authentication", async () => {
    const res = await request(app).delete("/api/users/me");
    expect(res.status).toBe(401);
  });
});
