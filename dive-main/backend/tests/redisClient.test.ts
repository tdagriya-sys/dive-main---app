// Phase 0.2 of docs/ADMIN_PANEL_PLAN.md — lib/redisClient.ts. Each scenario
// needs a fresh module registry (env.ts and redisClient.ts both cache
// module-level state read from process.env.REDIS_URL at import time), so
// every test runs inside jest.isolateModules with REDIS_URL set beforehand.

describe("redisClient", () => {
  const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

  afterEach(() => {
    process.env.REDIS_URL = ORIGINAL_REDIS_URL;
    jest.dontMock("ioredis");
  });

  it("getRedisClient returns null and pingRedis reports not_configured when REDIS_URL is unset", async () => {
    process.env.REDIS_URL = "";
    let redisClient!: typeof import("../src/lib/redisClient");
    jest.isolateModules(() => {
      redisClient = require("../src/lib/redisClient");
    });
    expect(redisClient.getRedisClient()).toBeNull();
    await expect(redisClient.pingRedis()).resolves.toBe("not_configured");
  });

  it("pingRedis reports connected against a working Redis", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    let redisClient!: typeof import("../src/lib/redisClient");
    jest.isolateModules(() => {
      jest.doMock("ioredis", () => require("ioredis-mock"));
      redisClient = require("../src/lib/redisClient");
    });
    await expect(redisClient.pingRedis()).resolves.toBe("connected");
    redisClient._resetRedisClientForTests();
  });

  it("pingRedis reports error when the client's ping rejects", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    let redisClient!: typeof import("../src/lib/redisClient");
    jest.isolateModules(() => {
      jest.doMock("ioredis", () => {
        return class FakeRedis {
          on() {
            /* no-op */
          }
          ping() {
            return Promise.reject(new Error("boom"));
          }
          disconnect() {
            /* no-op */
          }
        };
      });
      redisClient = require("../src/lib/redisClient");
    });
    await expect(redisClient.pingRedis()).resolves.toBe("error");
    redisClient._resetRedisClientForTests();
  });

  it("pingRedis reports error when the client hangs past the timeout", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    let redisClient!: typeof import("../src/lib/redisClient");
    jest.isolateModules(() => {
      jest.doMock("ioredis", () => {
        return class FakeRedis {
          on() {
            /* no-op */
          }
          ping() {
            return new Promise(() => {
              /* never resolves */
            });
          }
          disconnect() {
            /* no-op */
          }
        };
      });
      redisClient = require("../src/lib/redisClient");
    });
    await expect(redisClient.pingRedis(50)).resolves.toBe("error");
    redisClient._resetRedisClientForTests();
  });

  it("caches the client across repeated getRedisClient() calls", () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    let redisClient!: typeof import("../src/lib/redisClient");
    jest.isolateModules(() => {
      jest.doMock("ioredis", () => require("ioredis-mock"));
      redisClient = require("../src/lib/redisClient");
    });
    const a = redisClient.getRedisClient();
    const b = redisClient.getRedisClient();
    expect(a).toBe(b);
    redisClient._resetRedisClientForTests();
  });
});
