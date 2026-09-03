import path from "path";
import { Request, Response } from "express";
import archiver from "archiver";

// Zips extension/ (the Divve Bot Chrome extension source — see its own
// README.md) fresh on every request rather than serving a pre-built static
// file, so the download can never silently go stale after the extension's
// code changes. `__dirname`-relative, not `process.cwd()`-relative, so this
// resolves identically whether running compiled `dist/controllers` or
// `tsx watch`'d `src/controllers` — same pattern config/env.ts already uses
// for locating backend/.env. Both sit at controllers/ -> backend/ -> the
// repo root -> extension/.
const EXTENSION_DIR = path.resolve(__dirname, "../../../extension");

export function downloadZip(_req: Request, res: Response) {
  res.status(200);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="divve-bot-extension.zip"');

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    // Headers are already sent by the time archiver can fail mid-stream —
    // nothing more to do than end the response and let it show as a
    // truncated/corrupt download rather than hang.
    res.end();
    throw err;
  });
  archive.pipe(res);
  // Second arg names the top-level folder inside the zip, so unzipping
  // drops a clearly-named "divve-bot-extension/" folder rather than dumping
  // manifest.json etc. loose into whatever directory the user unzips into.
  archive.directory(EXTENSION_DIR, "divve-bot-extension");
  archive.finalize();
}
