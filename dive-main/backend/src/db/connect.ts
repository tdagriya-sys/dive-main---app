import mongoose from "mongoose";
import { env } from "../config/env";

// mongodb-memory-server is a devDependency — a production install (e.g. `npm
// ci --omit=dev`) won't have it in node_modules. It's imported dynamically,
// only inside the in-memory branch below, so a real deployment (real MONGO_URL
// set, useInMemoryMongo false) never triggers module resolution for it and
// never crashes on startup looking for a package it doesn't need.
let memoryServer: import("mongodb-memory-server").MongoMemoryServer | null = null;

export async function connectDb(): Promise<void> {
  let uri = env.mongoUrl;

  if (env.useInMemoryMongo) {
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    memoryServer = await MongoMemoryServer.create({ instance: { dbName: env.dbName } });
    uri = memoryServer.getUri();
    // eslint-disable-next-line no-console
    console.log(
      "[db] MONGO_URL not set to a real database — using an in-memory MongoDB for this session. " +
        "Data will NOT persist across restarts. Set MONGO_URL in backend/.env to a real MongoDB instance to change this."
    );
  }

  await mongoose.connect(uri, { dbName: env.dbName });
  // eslint-disable-next-line no-console
  console.log(`[db] connected to MongoDB (${env.useInMemoryMongo ? "in-memory" : "persistent"})`);
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}
