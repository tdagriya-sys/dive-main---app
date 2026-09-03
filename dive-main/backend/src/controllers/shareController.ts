import { Request, Response } from "express";
import { env } from "../config/env";

/**
 * Public, unauthenticated share-card page — the actual destination behind
 * the "Share" / "Copy link" buttons on Insights.jsx's ShareCard (see
 * frontend/src/components/dive/ShareCard.jsx). This route never existed
 * before this fix: `ShareCard.jsx` built a link to `/api/share/:score`, but
 * nothing on the backend ever answered it, so every shared/copied link
 * 404'd (Express's generic `notFoundHandler`) whether opened by the user
 * themselves or a friend they'd sent it to.
 *
 * `score`/`u`/`top` all come from an unauthenticated, unsigned URL a user
 * builds client-side from their OWN already-visible score — nothing secret
 * is being disclosed here (same trust level as, say, posting a stats
 * screenshot), so no auth/signature is required to render this page. What
 * DOES matter: `u` (the sharer's own display name) is arbitrary,
 * attacker-controlled text that ends up inside an HTML response, so it's
 * HTML-escaped before being interpolated anywhere — skipping that would be a
 * plain reflected-XSS hole (e.g. a crafted `?u=<script>...` link).
 *
 * No per-score OG/Twitter preview IMAGE yet — generating one dynamically
 * would need a native image-rendering dependency (sharp/@napi-rs/canvas/
 * resvg) this backend doesn't currently have (see PDF generation elsewhere
 * in this codebase, which deliberately uses pdfkit — pure JS, no native
 * binary — for the same reason), and this app has no existing raster brand
 * asset to fall back to as a static image either. Deferred rather than
 * guessed at silently; flagged to the user as a follow-up. What IS fully
 * dynamic and real: the OG/Twitter TEXT (title + description, which is what
 * every major link-unfurler — WhatsApp, iMessage, Telegram, Slack, X —
 * renders regardless of image support) and the actual page a person lands
 * on when they open the link, which shows their real score.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Mirrors frontend/src/lib/diveEngine.js's scoreLabel() — already duplicated
// once more in scoreReportPdfService.ts for the same reason (a tiny, stable,
// pure function is cheaper to keep in sync via a comment than to extract
// into a shared module three call sites deep across two runtimes).
function scoreLabel(score: number): string {
  if (score >= 80) return "Excellent";
  if (score >= 65) return "Good";
  if (score >= 50) return "Decent start";
  if (score >= 35) return "Needs work";
  return "Risky";
}
// Mirrors scoreReportPdfService.ts's scoreColor() (itself mirroring
// frontend/src/lib/diveEngine.js) — same score-to-color mapping used
// everywhere else in the app.
function scoreColor(score: number): string {
  if (score >= 75) return "#34D399";
  if (score >= 55) return "#E3B856";
  if (score >= 40) return "#FBBF24";
  return "#F87171";
}

// CORS_ORIGINS already holds the frontend's real, public URL in every real
// deployment (see docs/SERVER_DEPLOYMENT_GUIDE.md's setup instructions) —
// reused here as "where the actual app lives" for the page's CTA link,
// rather than introducing a second, redundant env var for the same value.
// finvuService.ts makes the same kind of reuse for env.publicBaseUrl.
const APP_URL = env.corsOrigins[0];

export function renderShareCard(req: Request, res: Response) {
  // Malformed/garbage input (a hand-edited or truncated URL) degrades
  // gracefully to a 0/blank card rather than a crash or a 400 — this is a
  // public, best-effort preview page, not an API contract; matching this
  // codebase's general fallback style (e.g. diveScoreService's `user?.age ??
  // 30`) rather than rejecting the request outright.
  const scoreRaw = parseInt(req.params.score, 10);
  const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, scoreRaw)) : 0;
  const topRaw = parseFloat(String(req.query.top ?? "0"));
  const top = Number.isFinite(topRaw) ? Math.max(0, Math.min(100, Math.round(topRaw))) : 0;
  const rawName = (typeof req.query.u === "string" ? req.query.u : "").slice(0, 60) || "A DIVVE user";
  const safeName = escapeHtml(rawName);

  const label = scoreLabel(score);
  const ringColor = scoreColor(score);
  const ringDeg = Math.max(0, Math.min(360, Math.round((score / 100) * 360)));

  const title = `${safeName}'s DIVVE Score: ${score}/100 (${label})`;
  const description =
    top > 0
      ? `DIVVE looked through their whole portfolio and found ${top}% was secretly tied to one company. Check your real diversification.`
      : "DIVVE looks through your whole portfolio to find hidden concentration risk other apps miss. Check your real diversification.";
  const pageUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<meta name="description" content="${description}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="DIVVE" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:url" content="${escapeHtml(pageUrl)}" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${description}" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;
    background: #0A0A0B; color: #FAFAF7;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .card {
    width: 100%; max-width: 420px; border-radius: 28px; padding: 28px;
    background: radial-gradient(120% 120% at 80% 0%, #1C1608 0%, #0B0B0C 55%);
    border: 1px solid rgba(227, 184, 86, 0.25);
    box-shadow: 0 0 0 1px rgba(227, 184, 86, 0.08), 0 20px 60px rgba(0,0,0,0.5);
  }
  .wordmark { font-weight: 800; font-size: 20px; background: linear-gradient(90deg, #F7DD93, #E3B856, #C8912F); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .row { display: flex; align-items: center; gap: 20px; margin-top: 20px; }
  .ring {
    width: 108px; height: 108px; border-radius: 50%; flex: none;
    background: conic-gradient(${ringColor} ${ringDeg}deg, #1C1C20 0deg);
    display: flex; align-items: center; justify-content: center;
  }
  .ring-inner { width: 84px; height: 84px; border-radius: 50%; background: #0B0B0C; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .ring-score { font-weight: 800; font-size: 26px; line-height: 1; color: ${ringColor}; }
  .ring-max { font-size: 10px; color: #6B6B72; margin-top: 2px; }
  .label-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #A1A1AA; }
  .name { font-weight: 800; font-size: 17px; margin: 2px 0 8px; }
  .pill { display: inline-flex; align-items: center; gap: 6px; background: rgba(227,184,86,0.15); border: 1px solid rgba(227,184,86,0.3); border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 700; color: ${ringColor}; }
  .desc { font-size: 14px; line-height: 1.5; color: #D4D4D8; margin-top: 18px; }
  .tagline { font-size: 12px; font-weight: 700; margin-top: 16px; background: linear-gradient(90deg, #F7DD93, #E3B856, #C8912F); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .cta { display: block; text-align: center; margin-top: 22px; padding: 14px 20px; border-radius: 999px; font-weight: 800; font-size: 14px; text-decoration: none; color: #0A0A0B; background: linear-gradient(90deg, #F7DD93, #E3B856, #C8912F); }
</style>
</head>
<body>
  <div class="card">
    <span class="wordmark">DIVVE</span>
    <div class="row">
      <div class="ring"><div class="ring-inner"><div class="ring-score">${score}</div><div class="ring-max">/100</div></div></div>
      <div>
        <p class="label-eyebrow">${safeName}'s DIVVE Score</p>
        <p class="name">${label}</p>
        <span class="pill">🏆 ${label}</span>
      </div>
    </div>
    <p class="desc">${description}</p>
    <p class="tagline">Divve deeper. Invest smarter.</p>
    <a class="cta" href="${escapeHtml(APP_URL)}">Check your own DIVVE Score →</a>
  </div>
</body>
</html>`;

  res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(html);
}
