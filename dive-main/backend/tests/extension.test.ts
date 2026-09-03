import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

// Custom binary parser — supertest/superagent has no built-in parser for
// application/zip, so without this `res.body` would come back empty/wrong
// regardless of what the server actually sent.
function binaryParser(res: any, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}

describe("extension download", () => {
  it("streams a real zip of the extension/ folder — public, no auth required", async () => {
    const res = await request(app).get("/api/extension/download").buffer(true).parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toContain('filename="divve-bot-extension.zip"');

    const body: Buffer = res.body;
    // ZIP local-file-header magic bytes ("PK\x03\x04") — confirms this is a
    // real archive, not just a 200 with the right headers and junk inside.
    expect(body.subarray(0, 4).toString("hex")).toBe("504b0304");
    // Larger than the smallest of the extension's real files (manifest.json,
    // a few hundred bytes) — guards against an accidentally-empty archive.
    expect(body.length).toBeGreaterThan(2000);

    // Entry names are stored as plain, uncompressed text in a ZIP's local
    // file headers even though file CONTENT is deflated — so these files'
    // names are findable directly in the raw bytes without needing a zip
    // reader library, and this confirms the real extension/ folder (not an
    // empty or wrong directory) was actually archived.
    const asText = body.toString("latin1");
    expect(asText).toContain("divve-bot-extension/manifest.json");
    expect(asText).toContain("divve-bot-extension/popup/popup.html");
    expect(asText).toContain("divve-bot-extension/background/background.js");
  });
});
