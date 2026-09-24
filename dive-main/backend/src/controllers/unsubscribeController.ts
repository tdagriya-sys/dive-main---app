import { Request, Response } from "express";
import { verifyUnsubscribeToken, lookupForConfirmation, unsubscribeContact } from "../services/unsubscribeService";

/**
 * The public unsubscribe page for marketing emails to imported contacts (see
 * services/unsubscribeService.ts). No login — a stranger's mail client opens
 * this. Two deliberate choices:
 *
 * - GET only SHOWS a confirmation page; it never unsubscribes. Email security
 *   scanners and link-preview bots fetch every link in a message, and would
 *   otherwise unsubscribe everyone the moment a mail is delivered.
 * - POST unsubscribes, and is also what Gmail/Yahoo/Outlook's native
 *   "Unsubscribe" button calls (RFC 8058 one-click, `List-Unsubscribe=One-Click`)
 *   — so it must work with no confirmation step and no cookies.
 *
 * Every page is self-contained HTML (no scripts, no external assets) so it
 * renders anywhere and the app's CSP has nothing to object to.
 */

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(heading)} — Divve</title>
<style>
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#0b0b0d;color:#f2f2f2;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
  .card{max-width:420px;width:100%;background:#151517;border:1px solid #2a2a2e;border-radius:20px;padding:32px;text-align:center}
  .brand{font-weight:800;font-size:22px;color:#D4AF37;margin-bottom:20px}
  h1{font-size:20px;margin:0 0 10px}
  p{color:#b5b5ba;line-height:1.55;margin:0 0 20px;font-size:15px}
  button{background:#D4AF37;color:#111;border:0;border-radius:999px;padding:12px 28px;font-weight:700;font-size:15px;cursor:pointer}
</style>
</head>
<body><div class="card"><div class="brand">Divve</div><h1>${escapeHtml(heading)}</h1>${bodyHtml}</div></body>
</html>`;
}

function send(res: Response, status: number, html: string) {
  res.status(status).type("html").send(html);
}

const INVALID = page("This link isn't valid", "<p>The unsubscribe link looks incomplete or has been changed. Please use the link from the email exactly as it was sent.</p>");
const DONE = page("You're unsubscribed", "<p>You won't get any more marketing emails from Divve at this address. Sorry to see you go.</p>");

export async function showUnsubscribe(req: Request, res: Response) {
  const contactId = verifyUnsubscribeToken(req.params.token);
  if (!contactId) return send(res, 400, INVALID);
  const info = await lookupForConfirmation(contactId);
  // A contact that no longer exists has nothing left to mail — same outcome
  // the person wanted, so say so rather than showing an error.
  if (!info || info.alreadyUnsubscribed) return send(res, 200, DONE);
  return send(
    res,
    200,
    page(
      "Unsubscribe from Divve emails?",
      `<p>Stop marketing emails from Divve to <b>${escapeHtml(info.email)}</b>?</p><form method="post"><button type="submit">Yes, unsubscribe me</button></form>`
    )
  );
}

export async function performUnsubscribe(req: Request, res: Response) {
  const contactId = verifyUnsubscribeToken(req.params.token);
  if (!contactId) return send(res, 400, INVALID);
  await unsubscribeContact(contactId);
  return send(res, 200, DONE);
}
