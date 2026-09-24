// Phase 0.2 of docs/ADMIN_PANEL_PLAN.md — services/distributedLock.ts, the
// cross-instance mutex for the daily crons (docs/PRODUCTION_READINESS_AUDIT.md
// #7). Same jest.isolateModules-per-scenario approach as redisClient.test.ts.

describe("distributedLock.withLock", () => {
  const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

  afterEach(() => {
    process.env.REDIS_URL = ORIGINAL_REDIS_URL;
    jest.dontMock("ioredis");
  });

  it("fails open — runs fn directly, and returns its result — when Redis isn't configured", async () => {
    process.env.REDIS_URL = "";
    let lock!: typeof import("../src/services/distributedLock");
    jest.isolateModules(() => {
      lock = require("../src/services/distributedLock");
    });
    const fn = jest.fn().mockResolvedValue("done");
    await expect(lock.withLock("k", 1000, fn)).resolves.toBe("done");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("acquires the lock, runs fn exactly once, and releases it so a later call can acquire again", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    let lock!: typeof import("../src/services/distributedLock");
    let redisClient!: typeof import("../src/lib/redisClient");
    jest.isolateModules(() => {
      jest.doMock("ioredis", () => require("ioredis-mock"));
      redisClient = require("../src/lib/redisClient");
      lock = require("../src/services/distributedLock");
    });

    const first = jest.fn().mockResolvedValue(42);
    await expect(lock.withLock("lock:test", 5000, first)).resolves.toBe(42);
    expect(first).toHaveBeenCalledTimes(1);

    // If release didn't actually happen, this second call would see the key
    // still held (NX fails) and skip — proving release worked, not just that
    // acquisition once was possible.
    const second = jest.fn().mockResolvedValue(43);
    await expect(lock.withLock("lock:test", 5000, second)).resolves.toBe(43);
    expect(second).toHaveBeenCalledTimes(1);

    redisClient._resetRedisClientForTests();
  });

  it("skips fn (returns undefined) when another holder already has the lock", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    let lock!: typeof import("../src/services/distributedLock");
    let redisClient!: typeof import("../src/lib/redisClient");
    jest.isolateModules(() => {
      jest.doMock("ioredis", () => require("ioredis-mock"));
      redisClient = require("../src/lib/redisClient");
      lock = require("../src/services/distributedLock");
    });

    const client = redisClient.getRedisClient()!;
    await client.set("lock:held", "someone-else-token", "PX", 5000, "NX");

    const fn = jest.fn().mockResolvedValue("should not run");
    await expect(lock.withLock("lock:held", 5000, fn)).resolves.toBeUndefined();
    expect(fn).not.toHaveBeenCalled();

    redisClient._resetRedisClientForTests();
  });

  it("fails open (still runs fn) if acquiring the lock itself throws", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    let lock!: typeof import("../src/services/distributedLock");
    jest.isolateModules(() => {
      jest.doMock("ioredis", () => {
        return class FakeRedis {
          on() {
            /* no-op */
          }
          set() {
            return Promise.reject(new Error("redis down"));
          }
          disconnect() {
            /* no-op */
          }
        };
      });
      lock = require("../src/services/distributedLock");
    });

    const fn = jest.fn().mockResolvedValue("ran anyway");
    await expect(lock.withLock("k", 1000, fn)).resolves.toBe("ran anyway");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("never releases a DIFFERENT holder's lock (compare-and-delete by token)", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    let lock!: typeof import("../src/services/distributedLock");
    let redisClient!: typeof import("../src/lib/redisClient");
    jest.isolateModules(() => {
      jest.doMock("ioredis", () => require("ioredis-mock"));
      redisClient = require("../src/lib/redisClient");
      lock = require("../src/services/distributedLock");
    });

    const client = redisClient.getRedisClient()!;
    // Simulate this run's own lock already having expired and a DIFFERENT
    // instance having since legitimately acquired the same key.
    let releaseAttempted: Promise<void> | null = null;
    const fn = jest.fn().mockImplementation(async () => {
      // While "our" fn is still running, another holder takes the key over.
      await client.set("lock:race", "other-instance-token", "PX", 5000);
      return "ours";
    });
    releaseAttempted = lock.withLock("lock:race", 5000, fn).then(() => undefined);
    await releaseAttempted;

    // The OTHER instance's token must still be intact — our finally-block
    // release must not have deleted a lock it no longer owns.
    expect(await client.get("lock:race")).toBe("other-instance-token");

    redisClient._resetRedisClientForTests();
  });
});
