import PDFDocument from "pdfkit";
import { AssetClass } from "../models/Instrument";
import { DiveScoreBreakdown, DIVE_SCORE_V2_WEIGHTS } from "./diveScoreService";

/**
 * Full multi-page PDF export of the resilience score breakdown that used to
 * live on its own in-app screen (see docs/DIVE_SCORE_MODEL.md) — now a
 * downloadable report from Profile instead of a dashboard destination.
 * Deliberately NOT a one-pager: a downloadable report is exactly the place to
 * carry everything the interactive screen showed (every sub-score's full
 * explanation, the complete correlation matrix, every detected connection,
 * per-holding data quality) rather than a condensed summary. Colors/copy
 * mirror frontend/src/lib/diveEngine.js and frontend/src/screens/
 * ScoreBreakdown.jsx so the report reads as the same product, not a second
 * design written from scratch.
 */

const PAGE = { width: 595.28, height: 841.89 }; // A4
const MARGIN = 44;
const CONTENT_W = PAGE.width - MARGIN * 2;
const FOOTER_RESERVE = 34; // vertical space kept clear at the bottom of every page for the footer

const COLOR = {
  bg: "#0A0A0B",
  card: "#141416",
  cardBorder: "#262629",
  track: "#1C1C20",
  textPrimary: "#FAFAF7",
  textSecondary: "#A1A1AA",
  textTertiary: "#6B6B72",
  gold: "#E3B856",
  goldLight: "#F7DD93",
  goldDark: "#C8912F",
  green: "#34D399",
  amber: "#FBBF24",
  red: "#F87171",
};

// Mirrors frontend/src/lib/diveEngine.js exactly, so a score reads the same
// color/label in the app and in this report.
function scoreColor(score: number): string {
  if (score >= 75) return COLOR.green;
  if (score >= 55) return COLOR.gold;
  if (score >= 40) return COLOR.amber;
  return COLOR.red;
}
function scoreLabel(score: number): string {
  if (score >= 80) return "Excellent";
  if (score >= 65) return "Good";
  if (score >= 50) return "Decent start";
  if (score >= 35) return "Needs work";
  return "Risky";
}
// Mirrors frontend/src/screens/ScoreBreakdown.jsx's correlationColor().
function correlationColor(v: number): string {
  if (v >= 0.6) return COLOR.red;
  if (v >= 0.3) return COLOR.amber;
  if (v >= 0) return COLOR.gold;
  return COLOR.green;
}

const ASSET_CLASS_LABELS: Record<string, string> = {
  EQUITY: "Equity",
  MUTUAL_FUND: "Mutual Funds",
  ETF: "ETF",
  BOND: "Bonds",
  REIT: "REIT/InvIT",
  INVIT: "REIT/InvIT",
  GOLD: "Gold/Silver",
  SILVER: "Gold/Silver",
  ULIP_INSURANCE: "Insurance",
  FD: "FD",
  CRYPTO: "Crypto",
};

// No public Indian currency source uses the ₹ glyph in PDFKit's standard
// Helvetica encoding — it renders as a broken/mismapped character (verified:
// it draws as a superscript "1"), so amounts use "Rs." instead of "₹".
function fmtINR(n: number): string {
  return `Rs. ${Math.round(Math.abs(n)).toLocaleString("en-IN")}`;
}

// contextEngine.ts's persona/corpusTier reasoning strings are authored for
// screen rendering (real ₹ glyphs, fine there) and aren't under this file's
// control — anything sourced from breakdown/context data must be run through
// this before doc.text()/heightOfString() so a future edit to that copy can't
// reintroduce the same broken-glyph bug.
function sanitizePdfText(s: string): string {
  return s.replace(/₹/g, "Rs. ").replace(/≥/g, ">=").replace(/≤/g, "<=");
}

// Same label + explanatory blurb copy as frontend/src/screens/
// ScoreBreakdown.jsx's SUB_SCORE_META, plus a directionNote answering "is a
// high or low raw value good here" — the composite SCORE is always
// higher-is-better (0-100), but the underlying raw quantity's direction
// varies per metric, which is what a reader actually needs explained.
const SUB_SCORE_ORDER = [
  "concentration",
  "volatility",
  "drawdown",
  "var",
  "liquidity",
  "beta",
  "correlation",
  "diversificationRatio",
  "contextFit",
  "stockCountFit",
] as const;

const SUB_SCORE_META: Record<(typeof SUB_SCORE_ORDER)[number], { label: string; blurb: string; direction: string }> = {
  concentration: {
    label: "Concentration",
    blurb: "How spread out your money is across distinct holdings (name-level, not fund look-through).",
    direction: "A lower Herfindahl (HHI) value is better — it means your money isn't piled into a few names or one asset class.",
  },
  volatility: {
    label: "Volatility",
    blurb: "How much your portfolio's daily value swings, annualized.",
    direction: "Lower annualized volatility is better — smaller day-to-day swings in value.",
  },
  drawdown: {
    label: "Drawdown resilience",
    blurb: "The worst peak-to-trough drop this mix would have taken, and how fast it recovers.",
    direction: "A smaller worst-drop (closer to 0%) is better, and recovering faster is better.",
  },
  var: {
    label: "Value at Risk",
    blurb: "A 1-in-20 day's worth of potential loss, in Rs.",
    direction: "A smaller potential loss (closer to 0) is better.",
  },
  liquidity: {
    label: "Liquidity",
    blurb: "How easily this mix could be converted to cash without a discount.",
    direction: "Higher is better — easier to exit at close to fair value when you need to.",
  },
  beta: {
    label: "Market sensitivity",
    blurb: "How much your portfolio tends to move with the Nifty 50 — lower means more resilient in a market-wide selloff.",
    direction: "A beta below 1 dampens market moves (more resilient); above 1 amplifies them (more exposed in a broad selloff).",
  },
  correlation: {
    label: "Diversification (correlation)",
    blurb: "How independently your asset classes move from each other — lower average correlation is better.",
    direction: "Lower, or even negative, average correlation is better — your asset classes cushion each other instead of moving together.",
  },
  diversificationRatio: {
    label: "Diversification ratio",
    blurb: "How much smoother your portfolio's ride is versus holding each piece alone.",
    direction: "Higher is better — a ratio above 1x means diversification is genuinely smoothing your returns.",
  },
  contextFit: {
    label: "Fit for your situation",
    blurb:
      "How well your mix covers what actually makes sense right now, given your corpus size and life stage — not a demand to hold all 11 asset classes.",
    direction: "Higher is better — fuller coverage of the asset classes that are actually expected at your current stage.",
  },
  stockCountFit: {
    label: "Stock-count band",
    blurb:
      'Too few equity stocks (under ~10-12) is real concentration risk; too many (past ~30-40) brings diminishing returns and unmanageable overlap — this rewards a healthy middle band, not "more names is always better".',
    direction: "Neither extreme is good — the score peaks in a ~15-30 stock band and tapers on both sides.",
  },
};

function rawValueText(key: (typeof SUB_SCORE_ORDER)[number], sub: { value: number }, breakdown: DiveScoreBreakdown): string {
  switch (key) {
    case "concentration":
      return `Herfindahl index: ${sub.value.toFixed(2)} (0 = perfectly spread, 1 = fully concentrated)`;
    case "volatility":
      return `Annualized volatility: ${(sub.value * 100).toFixed(1)}%`;
    case "drawdown":
      return `Max drawdown observed: ${(sub.value * 100).toFixed(1)}%`;
    case "var":
      return `1-day 95% VaR: ${(sub.value * 100).toFixed(1)}%`;
    case "liquidity":
      return `Weighted liquidity tier: ${Math.round(sub.value)}/100`;
    case "beta":
      return `Portfolio beta vs Nifty 50: ${sub.value.toFixed(2)}`;
    case "correlation":
      return `Avg. value-weighted cross-class correlation: ${sub.value.toFixed(2)}`;
    case "diversificationRatio":
      return `Diversification ratio: ${sub.value.toFixed(2)}x`;
    case "contextFit":
      return `Coverage of expected classes: ${Math.round(sub.value * 100)}% (${breakdown.context.expectedAssetClasses.length} expected for your stage)`;
    case "stockCountFit":
      return `Distinct equity stocks held: ${Math.round(sub.value)}`;
  }
}

type Cursor = { y: number; page: number };

function fillPageBg(doc: PDFKit.PDFDocument) {
  doc.rect(0, 0, PAGE.width, PAGE.height).fill(COLOR.bg);
}

function runningHeader(doc: PDFKit.PDFDocument) {
  doc.fillColor(COLOR.textTertiary).font("Helvetica-Bold").fontSize(8).text("DIVVE — RESILIENCE SCORE REPORT", MARGIN, MARGIN, { characterSpacing: 0.5 });
  doc.moveTo(MARGIN, MARGIN + 14).lineTo(PAGE.width - MARGIN, MARGIN + 14).lineWidth(0.75).strokeColor(COLOR.cardBorder).stroke();
}

function goldGradient(doc: PDFKit.PDFDocument, x1: number, y1: number, x2: number, y2: number) {
  const g = doc.linearGradient(x1, y1, x2, y2);
  g.stop(0, COLOR.goldLight).stop(0.5, COLOR.gold).stop(1, COLOR.goldDark);
  return g;
}

function drawBar(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, pct: number, color: string | PDFKit.PDFGradient) {
  const clamped = Math.max(0, Math.min(100, pct));
  const r = h / 2;
  doc.roundedRect(x, y, w, h, r).fill(COLOR.track);
  const fillW = (w * clamped) / 100;
  if (fillW > 1) {
    doc.roundedRect(x, y, fillW, h, Math.min(r, fillW / 2)).fill(color as any);
  }
}

function cardBg(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number) {
  doc.roundedRect(x, y, w, h, 12).fillAndStroke(COLOR.card, COLOR.cardBorder);
}

export async function generateScoreReportPdf(
  breakdown: DiveScoreBreakdown,
  user: { name: string; email: string }
): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", bufferPages: true, margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const cursor: Cursor = { y: 0, page: 1 };
  let onContinuationPage = false;

  doc.on("pageAdded", () => {
    fillPageBg(doc);
    runningHeader(doc);
    cursor.y = MARGIN + 26;
    onContinuationPage = true;
  });

  // ensureSpace: the single guard against ever repeating the earlier one-page
  // bug (a text block quietly overflowing the bottom margin and bleeding onto
  // a blank next page) — every block asks for its own real, measured height
  // before drawing, and gets a fresh page proactively instead of discovering
  // the overflow after the fact.
  function ensureSpace(height: number) {
    if (cursor.y + height > PAGE.height - MARGIN - FOOTER_RESERVE) {
      doc.addPage();
    }
  }

  function sectionTitle(text: string, opts?: { gap?: number }) {
    ensureSpace(20);
    doc.fillColor(COLOR.textPrimary).font("Helvetica-Bold").fontSize(13).text(text, MARGIN, cursor.y);
    cursor.y += 13 + (opts?.gap ?? 8);
  }

  function paragraph(text: string, opts?: { size?: number; color?: string; width?: number; gap?: number; font?: string }) {
    const size = opts?.size ?? 9;
    const width = opts?.width ?? CONTENT_W;
    const h = doc.font(opts?.font ?? "Helvetica").fontSize(size).heightOfString(text, { width });
    ensureSpace(h);
    doc
      .fillColor(opts?.color ?? COLOR.textSecondary)
      .font(opts?.font ?? "Helvetica")
      .fontSize(size)
      .text(text, MARGIN, cursor.y, { width });
    cursor.y += h + (opts?.gap ?? 10);
  }

  fillPageBg(doc);

  // ==================== COVER / SUMMARY ====================
  doc.fillColor(COLOR.gold).font("Helvetica-Bold").fontSize(28).text("DIVVE", MARGIN, MARGIN);
  doc.fillColor(COLOR.textSecondary).font("Helvetica").fontSize(10).text("Resilience Score Report", MARGIN, MARGIN + 30);

  const generatedOn = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  doc.fillColor(COLOR.textPrimary).font("Helvetica-Bold").fontSize(11).text(user.name, MARGIN, MARGIN, { width: CONTENT_W, align: "right" });
  doc.fillColor(COLOR.textSecondary).font("Helvetica").fontSize(9).text(user.email, MARGIN, MARGIN + 14, { width: CONTENT_W, align: "right" });
  doc.fillColor(COLOR.textTertiary).fontSize(8).text(`Generated ${generatedOn}`, MARGIN, MARGIN + 28, { width: CONTENT_W, align: "right" });
  doc.moveTo(MARGIN, MARGIN + 58).lineTo(PAGE.width - MARGIN, MARGIN + 58).lineWidth(1).strokeColor(COLOR.cardBorder).stroke();
  cursor.y = MARGIN + 74;

  if (!breakdown.hasHoldings) {
    doc
      .fillColor(COLOR.textSecondary)
      .font("Helvetica")
      .fontSize(13)
      .text("No holdings yet — add your portfolio in the DIVVE app to generate a resilience report.", MARGIN, 380, {
        width: CONTENT_W,
        align: "center",
      });
    finishWithFooters();
    return done;
  }

  paragraph(
    "This is the same DIVVE Score shown on your Home screen, with the full math behind it — concentration, volatility, historical drawdown, " +
      'value-at-risk, liquidity, market sensitivity, and diversification benefit. Only the "simulate this change" preview on Suggestions uses a ' +
      "faster, same-methodology estimate, since it needs to react instantly while you drag a slider.",
    { gap: 16 }
  );

  // Composite score
  doc.fillColor(COLOR.textTertiary).font("Helvetica-Bold").fontSize(9).text("DIVVE RESILIENCE SCORE", MARGIN, cursor.y, { characterSpacing: 1 });
  cursor.y += 16;
  doc
    .fillColor(scoreColor(breakdown.compositeScore))
    .font("Helvetica-Bold")
    .fontSize(52)
    .text(String(Math.round(breakdown.compositeScore)), MARGIN, cursor.y);
  doc.fillColor(COLOR.textTertiary).font("Helvetica").fontSize(16).text("/100", MARGIN + 95, cursor.y + 30);
  doc
    .fillColor(scoreColor(breakdown.compositeScore))
    .font("Helvetica-Bold")
    .fontSize(14)
    .text(scoreLabel(breakdown.compositeScore), MARGIN, cursor.y, { width: CONTENT_W, align: "right" });
  cursor.y += 62;
  drawBar(doc, MARGIN, cursor.y, CONTENT_W, 10, breakdown.compositeScore, goldGradient(doc, MARGIN, cursor.y, MARGIN + CONTENT_W, cursor.y));
  cursor.y += 28;

  // Apparent vs real diversification
  const boxW = (CONTENT_W - 16) / 2;
  const boxH = 70;
  ensureSpace(boxH);
  cardBg(doc, MARGIN, cursor.y, boxW, boxH);
  cardBg(doc, MARGIN + boxW + 16, cursor.y, boxW, boxH);
  doc.fillColor(COLOR.red).font("Helvetica-Bold").fontSize(8).text("APPARENT DIVERSIFICATION", MARGIN + 16, cursor.y + 14, { characterSpacing: 0.5 });
  doc.fillColor(COLOR.red).font("Helvetica-Bold").fontSize(28).text(`${Math.round(breakdown.apparentDiversificationPct)}%`, MARGIN + 16, cursor.y + 28);
  doc
    .fillColor(COLOR.green)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("REAL DIVERSIFICATION", MARGIN + boxW + 32, cursor.y + 14, { characterSpacing: 0.5 });
  doc
    .fillColor(COLOR.green)
    .font("Helvetica-Bold")
    .fontSize(28)
    .text(`${Math.round(breakdown.realDiversificationPct)}%`, MARGIN + boxW + 32, cursor.y + 28);
  cursor.y += boxH + 10;
  paragraph(
    "Apparent diversification counts spread across asset classes at face value. Real diversification looks through to hidden overlaps — the " +
      "same issuer or sector showing up under more than one holding — see \"Why real is below apparent\" later in this report for the specifics.",
    { size: 8.5, gap: 16 }
  );

  // Context / persona
  const corpusReasoning = sanitizePdfText(breakdown.context.corpusTier.reasoning);
  const personaReasoning = sanitizePdfText(breakdown.context.persona.reasoning);
  const corpusReasoningH = doc.font("Helvetica").fontSize(8.5).heightOfString(corpusReasoning, { width: CONTENT_W - 32 });
  const personaReasoningH = doc.font("Helvetica").fontSize(8.5).heightOfString(personaReasoning, { width: CONTENT_W - 32 });
  const missing = breakdown.context.missingExpectedAssetClasses.map((c) => ASSET_CLASS_LABELS[c] || c);
  const contextNote =
    missing.length === 0
      ? `At this stage — a ${breakdown.context.corpusTier.label.toLowerCase()} portfolio, ${breakdown.context.persona.label} — your current mix is a solid, complete starting point.`
      : `Given your ${breakdown.context.corpusTier.label.toLowerCase()} portfolio and ${breakdown.context.persona.label} stage, ${missing.join(", ")} would be worth adding next.`;
  const contextNoteH = doc.font("Helvetica-Bold").fontSize(8.5).heightOfString(contextNote, { width: CONTENT_W - 32 });
  const ctxH = 26 + corpusReasoningH + 8 + personaReasoningH + 10 + contextNoteH + 16;
  ensureSpace(ctxH);
  cardBg(doc, MARGIN, cursor.y, CONTENT_W, ctxH);
  let cy = cursor.y + 12;
  doc.fillColor(COLOR.textTertiary).font("Helvetica-Bold").fontSize(8).text("YOUR CONTEXT", MARGIN + 16, cy, { characterSpacing: 0.5 });
  cy += 12;
  doc
    .fillColor(COLOR.gold)
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(`${breakdown.context.corpusTier.label} portfolio · ${breakdown.context.persona.label}`, MARGIN + 16, cy);
  cy += 16;
  doc.fillColor(COLOR.textSecondary).font("Helvetica").fontSize(8.5).text(corpusReasoning, MARGIN + 16, cy, { width: CONTENT_W - 32 });
  cy += corpusReasoningH + 8;
  doc.fillColor(COLOR.textSecondary).font("Helvetica").fontSize(8.5).text(personaReasoning, MARGIN + 16, cy, { width: CONTENT_W - 32 });
  cy += personaReasoningH + 10;
  doc.fillColor(COLOR.textPrimary).font("Helvetica-Bold").fontSize(8.5).text(contextNote, MARGIN + 16, cy, { width: CONTENT_W - 32 });
  cursor.y += ctxH + 20;

  // ==================== RADAR CHART ====================
  // The one visual the interactive screen had that a plain list of bars can't
  // replicate: the overall SHAPE across all 10 dimensions at a glance (where
  // is this portfolio uniformly strong vs. lopsided), not just each one's
  // individual magnitude — that's covered separately by the per-score cards
  // right after this.
  {
    const chartH = 250;
    ensureSpace(chartH);
    const n = SUB_SCORE_ORDER.length;
    const cx = MARGIN + CONTENT_W / 2;
    const cy = cursor.y + 108;
    const R = 82;
    const angleFor = (i: number) => ((-90 + i * (360 / n)) * Math.PI) / 180;
    const pointAt = (i: number, radius: number): [number, number] => {
      const a = angleFor(i);
      return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
    };

    doc.fillColor(COLOR.textPrimary).font("Helvetica-Bold").fontSize(13).text("Resilience Shape", MARGIN, cursor.y);
    cardBg(doc, MARGIN, cursor.y + 20, CONTENT_W, chartH - 20);

    // Grid rings at 25/50/75/100, each an n-sided polygon (not a circle) —
    // matches how a radar chart's axes are straight spokes, not curves.
    for (const ringPct of [25, 50, 75, 100]) {
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) pts.push(pointAt(i, (R * ringPct) / 100));
      doc
        .polygon(...pts)
        .lineWidth(0.5)
        .strokeColor(COLOR.cardBorder)
        .stroke();
    }
    // Axis spokes from center to each dimension's 100% vertex.
    for (let i = 0; i < n; i++) {
      const [x, y] = pointAt(i, R);
      doc.moveTo(cx, cy).lineTo(x, y).lineWidth(0.5).strokeColor(COLOR.cardBorder).stroke();
    }
    // The actual score polygon, translucent gold fill (fillOpacity is a
    // document-wide setting in pdfkit, so it MUST be reset to 1 right after —
    // otherwise every later card/bar in the report would render translucent).
    const dataPts: [number, number][] = SUB_SCORE_ORDER.map((key, i) => pointAt(i, (R * Math.max(0, Math.min(100, breakdown.subScores[key].score))) / 100));
    doc.polygon(...dataPts).fillOpacity(0.35).fillColor(COLOR.gold).fill();
    doc.fillOpacity(1);
    doc.polygon(...dataPts).lineWidth(1.5).strokeColor(COLOR.gold).stroke();

    // Category labels around the outside, aligned toward/away from center
    // depending on which side of the circle they land on.
    for (let i = 0; i < n; i++) {
      const [lx, ly] = pointAt(i, R + 12);
      const label = SUB_SCORE_META[SUB_SCORE_ORDER[i]].label;
      const cosA = Math.cos(angleFor(i));
      const labelW = 92;
      let textX: number;
      let align: "left" | "right" | "center";
      if (cosA > 0.3) {
        align = "left";
        textX = lx;
      } else if (cosA < -0.3) {
        align = "right";
        textX = lx - labelW;
      } else {
        align = "center";
        textX = lx - labelW / 2;
      }
      doc.fillColor(COLOR.textTertiary).font("Helvetica").fontSize(7).text(label, textX, ly - 4, { width: labelW, align });
    }
    cursor.y += chartH + 20;
  }

  // ==================== RESILIENCE BREAKDOWN ====================
  sectionTitle("Resilience Breakdown", { gap: 4 });
  paragraph("Each dimension below is scored 0-100 (higher is always better) and weighted into your composite score as shown.", { size: 8.5, gap: 14 });

  for (const key of SUB_SCORE_ORDER) {
    const sub = breakdown.subScores[key];
    const meta = SUB_SCORE_META[key];
    const weightPct = Math.round(DIVE_SCORE_V2_WEIGHTS[key] * 100);
    const blurbH = doc.font("Helvetica").fontSize(8.5).heightOfString(meta.blurb, { width: CONTENT_W - 32 });
    const directionH = doc.font("Helvetica-Oblique").fontSize(8).heightOfString(meta.direction, { width: CONTENT_W - 32 });
    const rawH = doc.font("Helvetica").fontSize(8).heightOfString(rawValueText(key, sub, breakdown), { width: CONTENT_W - 32 });
    const cardH = 22 + 14 + blurbH + 6 + directionH + 6 + rawH + 14;
    ensureSpace(cardH);
    cardBg(doc, MARGIN, cursor.y, CONTENT_W, cardH);
    let iy = cursor.y + 14;
    doc.fillColor(COLOR.textPrimary).font("Helvetica-Bold").fontSize(11).text(meta.label, MARGIN + 16, iy);
    doc.fillColor(COLOR.textTertiary).font("Helvetica").fontSize(8).text(`${weightPct}% of composite`, MARGIN + 16, iy + 14);
    doc
      .fillColor(scoreColor(sub.score))
      .font("Helvetica-Bold")
      .fontSize(20)
      .text(String(Math.round(sub.score)), MARGIN, iy - 2, { width: CONTENT_W - 16, align: "right" });
    iy += 26;
    drawBar(doc, MARGIN + 16, iy, CONTENT_W - 32, 7, sub.score, scoreColor(sub.score));
    iy += 15;
    doc.fillColor(COLOR.textSecondary).font("Helvetica").fontSize(8.5).text(meta.blurb, MARGIN + 16, iy, { width: CONTENT_W - 32 });
    iy += blurbH + 6;
    doc.fillColor(COLOR.textTertiary).font("Helvetica-Oblique").fontSize(8).text(meta.direction, MARGIN + 16, iy, { width: CONTENT_W - 32 });
    iy += directionH + 6;
    doc.fillColor(COLOR.gold).font("Helvetica").fontSize(8).text(rawValueText(key, sub, breakdown), MARGIN + 16, iy, { width: CONTENT_W - 32 });
    cursor.y += cardH + 10;
  }

  // ==================== DRAWDOWN & VALUE AT RISK ====================
  cursor.y += 6;
  sectionTitle("Drawdown & Value at Risk", { gap: 4 });

  const dd = breakdown.drawdownDetail;
  const ddText = `Worst historical drop: ${Math.abs(dd.maxDrawdownPct * 100).toFixed(1)}%${
    dd.recovered ? (dd.recoveryDays ? ` — recovered in ~${dd.recoveryDays} trading days.` : " (no drawdown observed).") : " — this mix hadn't recovered by the end of the observed period."
  }`;
  const ddExplain =
    "Drawdown measures the worst peak-to-trough drop your current mix would have taken over the observed history. A smaller drop, and a faster recovery, both mean the portfolio is more resilient to a bad stretch.";
  const ddExplainH = doc.font("Helvetica").fontSize(8.5).heightOfString(ddExplain, { width: CONTENT_W - 32 });
  const ddTextH = doc.font("Helvetica-Bold").fontSize(9.5).heightOfString(ddText, { width: CONTENT_W - 32 });
  const ddCardH = 20 + ddExplainH + 8 + ddTextH + 16;
  ensureSpace(ddCardH);
  cardBg(doc, MARGIN, cursor.y, CONTENT_W, ddCardH);
  doc.fillColor(COLOR.textPrimary).font("Helvetica-Bold").fontSize(10).text("Drawdown resilience", MARGIN + 16, cursor.y + 12);
  doc.fillColor(COLOR.textSecondary).font("Helvetica").fontSize(8.5).text(ddExplain, MARGIN + 16, cursor.y + 26, { width: CONTENT_W - 32 });
  doc.fillColor(COLOR.textPrimary).font("Helvetica-Bold").fontSize(9.5).text(ddText, MARGIN + 16, cursor.y + 26 + ddExplainH + 8, { width: CONTENT_W - 32 });
  cursor.y += ddCardH + 14;

  const varD = breakdown.varDetail;
  const varExplain =
    "Value at Risk (VaR) estimates a 1-in-20 day's worth of potential loss for this portfolio, based on its historical return distribution — a smaller potential loss is better. The 1-month figure scales the daily estimate rather than simulating a full month directly.";
  const varExplainH = doc.font("Helvetica").fontSize(8.5).heightOfString(varExplain, { width: CONTENT_W - 32 });
  const varCardH = 20 + varExplainH + 8 + 20 + 20 + 16;
  ensureSpace(varCardH);
  cardBg(doc, MARGIN, cursor.y, CONTENT_W, varCardH);
  doc.fillColor(COLOR.textPrimary).font("Helvetica-Bold").fontSize(10).text("Value at Risk (95% confidence)", MARGIN + 16, cursor.y + 12);
  doc.fillColor(COLOR.textSecondary).font("Helvetica").fontSize(8.5).text(varExplain, MARGIN + 16, cursor.y + 26, { width: CONTENT_W - 32 });
  let vy = cursor.y + 26 + varExplainH + 10;
  doc.fillColor(COLOR.textSecondary).font("Helvetica").fontSize(9).text("1-day", MARGIN + 16, vy);
  doc
    .fillColor(COLOR.textPrimary)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(`${fmtINR(varD.oneDayINR)}  (${(varD.oneDayPct * 100).toFixed(1)}%)`, MARGIN, vy, { width: CONTENT_W - 16, align: "right" });
  vy += 18;
  doc.fillColor(COLOR.textSecondary).font("Helvetica").fontSize(9).text("1-month (approx.)", MARGIN + 16, vy);
  doc
    .fillColor(COLOR.textPrimary)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(`${fmtINR(varD.oneMonthINR)}  (${(varD.oneMonthPct * 100).toFixed(1)}%)`, MARGIN, vy, { width: CONTENT_W - 16, align: "right" });
  cursor.y += varCardH + 14;

  // ==================== CORRELATION MATRIX ====================
  if (breakdown.correlationMatrix.labels.length > 1) {
    sectionTitle("Correlation Across Your Asset Classes", { gap: 4 });
    paragraph(
      "How independently each asset class you hold moves relative to the others. Lower, or negative, values are better — they mean a shock to one class is less likely to hit the others at the same time.",
      { size: 8.5, gap: 12 }
    );
    const labels = breakdown.correlationMatrix.labels.map((l) => ASSET_CLASS_LABELS[l] || l);
    const labelColW = 78;
    const cellW = Math.min(48, (CONTENT_W - labelColW) / labels.length);
    const rowH = 20;
    const tableH = rowH * (labels.length + 1) + 30;
    ensureSpace(tableH);
    let ty = cursor.y;
    doc.fillColor(COLOR.textTertiary).font("Helvetica-Bold").fontSize(7.5);
    labels.forEach((l, j) => {
      doc.text(l, MARGIN + labelColW + j * cellW, ty, { width: cellW, align: "center" });
    });
    ty += 16;
    breakdown.correlationMatrix.matrix.forEach((row, i) => {
      doc.fillColor(COLOR.textTertiary).font("Helvetica-Bold").fontSize(7.5).text(labels[i], MARGIN, ty + 5, { width: labelColW - 6 });
      row.forEach((v, j) => {
        const cx = MARGIN + labelColW + j * cellW;
        doc.roundedRect(cx + 2, ty, cellW - 4, rowH - 3, 3).fill(`${correlationColor(v)}33`);
        doc.fillColor(correlationColor(v)).font("Helvetica-Bold").fontSize(8).text(v.toFixed(2), cx, ty + 6, { width: cellW, align: "center" });
      });
      ty += rowH;
    });
    cursor.y = ty + 10;
    const legendY = cursor.y;
    const legend: Array<[string, string]> = [
      [COLOR.red, ">= 0.6 — moves together"],
      [COLOR.amber, "0.3 - 0.6 — moderate"],
      [COLOR.gold, "0 - 0.3 — mild"],
      [COLOR.green, "< 0 — diversifying"],
    ];
    let lx = MARGIN;
    for (const [color, text] of legend) {
      doc.roundedRect(lx, legendY + 2, 8, 8, 2).fill(color);
      doc.fillColor(COLOR.textTertiary).font("Helvetica").fontSize(7.5).text(text, lx + 12, legendY);
      lx += doc.widthOfString(text) + 30;
    }
    cursor.y = legendY + 20;
  }

  // ==================== WHY REAL IS BELOW APPARENT ====================
  // Only CROSS-CLASS connections actually move realDiversificationPct below
  // apparentDiversificationPct (see lookthroughService.ts's overlapShare vs
  // sameClassOverlapShare) — a same-class connection (e.g. two bank stocks,
  // both EQUITY) discounts a different sub-score entirely and left this gap
  // untouched, so it must NOT appear under this heading or it reads as "this
  // is why" when it demonstrably isn't.
  cursor.y += 6;
  sectionTitle("Why Real Is Below Apparent", { gap: 4 });
  const crossClassConnections = breakdown.connections.filter((c) => c.strength > 0 && c.scope === "cross-class");
  if (crossClassConnections.length > 0) {
    paragraph("These holdings look independent on the surface, but share some exposure to the same underlying risk:", { size: 8.5, gap: 12 });
    for (const c of crossClassConnections) {
      const text = `${c.reason}. ~${Math.round(c.strength * 100)}% shared exposure.`;
      const h = doc.font("Helvetica").fontSize(8.5).heightOfString(text, { width: CONTENT_W - 24 });
      const rowCardH = h + 16;
      ensureSpace(rowCardH);
      cardBg(doc, MARGIN, cursor.y, CONTENT_W, rowCardH);
      doc.fillColor(COLOR.textSecondary).font("Helvetica").fontSize(8.5).text(text, MARGIN + 12, cursor.y + 8, { width: CONTENT_W - 24 });
      cursor.y += rowCardH + 8;
    }
  } else {
    paragraph("No hidden cross-asset-class overlaps were detected — apparent and real diversification match.", { color: COLOR.green, size: 9.5, gap: 10 });
  }

  // ==================== CONCENTRATION WITHIN AN ASSET CLASS ====================
  // Same-class connections (same-sector, different company, e.g. two bank
  // stocks) are real and worth showing, but they work through a different
  // lever — discounting the concentration sub-score's per-name spread term,
  // capped at that class's own weight in the portfolio — not the apparent-vs-
  // real gap above.
  const sameClassConnections = breakdown.connections.filter((c) => c.strength > 0 && c.scope === "same-class");
  if (sameClassConnections.length > 0) {
    cursor.y += 6;
    sectionTitle("Concentration Within an Asset Class", { gap: 4 });
    paragraph(
      "These don't affect apparent vs. real diversification (that's a cross-asset-class measure) — instead, they discount how well-spread your Concentration sub-score thinks this asset class is, since a sector-wide shock would hit both:",
      { size: 8.5, gap: 12 }
    );
    for (const c of sameClassConnections) {
      const text = `${c.reason}. ~${Math.round(c.strength * 100)}% shared exposure.`;
      const h = doc.font("Helvetica").fontSize(8.5).heightOfString(text, { width: CONTENT_W - 24 });
      const rowCardH = h + 16;
      ensureSpace(rowCardH);
      cardBg(doc, MARGIN, cursor.y, CONTENT_W, rowCardH);
      doc.fillColor(COLOR.textSecondary).font("Helvetica").fontSize(8.5).text(text, MARGIN + 12, cursor.y + 8, { width: CONTENT_W - 24 });
      cursor.y += rowCardH + 8;
    }
  }

  // ==================== DATA QUALITY ====================
  cursor.y += 6;
  sectionTitle("Data Quality", { gap: 4 });
  const dq = breakdown.dataQuality;
  const dqExplain =
    "The rest (mutual funds, bonds, REIT/InvIT units not separately listed, ULIP, FD) uses clearly-labeled, illustrative synthetic return assumptions — there's no cheap public daily-price source for those in India yet.";
  const dqHeadline = `${dq.realPriceCoveragePct}% of your portfolio's value is backed by real historical price data`;
  const dqExplainH = doc.font("Helvetica").fontSize(8.5).heightOfString(dqExplain, { width: CONTENT_W - 32 });
  const marketNote = dq.marketFactorIsSynthetic
    ? "The Nifty 50 benchmark used for beta and correlation is also a synthetic estimate for this report."
    : null;
  const marketNoteH = marketNote ? doc.font("Helvetica").fontSize(8).heightOfString(marketNote, { width: CONTENT_W - 32 }) : 0;
  const dqCardH = 16 + 14 + dqExplainH + (marketNote ? 6 + marketNoteH : 0) + 14;
  ensureSpace(dqCardH);
  cardBg(doc, MARGIN, cursor.y, CONTENT_W, dqCardH);
  doc.fillColor(COLOR.gold).font("Helvetica-Bold").fontSize(9.5).text(dqHeadline, MARGIN + 16, cursor.y + 14, { width: CONTENT_W - 32 });
  doc.fillColor(COLOR.textSecondary).font("Helvetica").fontSize(8.5).text(dqExplain, MARGIN + 16, cursor.y + 30, { width: CONTENT_W - 32 });
  if (marketNote) {
    doc.fillColor(COLOR.textTertiary).font("Helvetica").fontSize(8).text(marketNote, MARGIN + 16, cursor.y + 30 + dqExplainH + 6, { width: CONTENT_W - 32 });
  }
  cursor.y += dqCardH + 14;

  // Per-holding data source table
  const tableRowH = 16;
  const nameColW = CONTENT_W * 0.4;
  const classColW = CONTENT_W * 0.22;
  const sourceColW = CONTENT_W - nameColW - classColW;
  function drawHoldingsTableHeader() {
    ensureSpace(tableRowH + 4);
    doc.fillColor(COLOR.textTertiary).font("Helvetica-Bold").fontSize(7.5);
    doc.text("HOLDING", MARGIN, cursor.y, { width: nameColW });
    doc.text("ASSET CLASS", MARGIN + nameColW, cursor.y, { width: classColW });
    doc.text("DATA SOURCE", MARGIN + nameColW + classColW, cursor.y, { width: sourceColW });
    cursor.y += tableRowH;
    doc.moveTo(MARGIN, cursor.y - 4).lineTo(PAGE.width - MARGIN, cursor.y - 4).lineWidth(0.5).strokeColor(COLOR.cardBorder).stroke();
  }
  drawHoldingsTableHeader();
  for (const h of dq.holdings) {
    if (cursor.y + tableRowH > PAGE.height - MARGIN - FOOTER_RESERVE) {
      doc.addPage();
      drawHoldingsTableHeader();
    }
    doc.fillColor(COLOR.textPrimary).font("Helvetica").fontSize(8).text(h.name, MARGIN, cursor.y, { width: nameColW - 8, ellipsis: true });
    doc.fillColor(COLOR.textSecondary).font("Helvetica").fontSize(8).text(ASSET_CLASS_LABELS[h.assetClass] || h.assetClass, MARGIN + nameColW, cursor.y, { width: classColW - 8 });
    doc
      .fillColor(h.isSynthetic ? COLOR.amber : COLOR.green)
      .font("Helvetica")
      .fontSize(8)
      .text(h.label, MARGIN + nameColW + classColW, cursor.y, { width: sourceColW - 4, ellipsis: true });
    cursor.y += tableRowH;
  }
  cursor.y += 16;

  // ==================== METHODOLOGY / WEIGHTS ====================
  sectionTitle("How Your Composite Score Is Built", { gap: 4 });
  paragraph("Each dimension above contributes this share of your final 0-100 composite score:", { size: 8.5, gap: 10 });
  const weightRowH = 15;
  ensureSpace(weightRowH * SUB_SCORE_ORDER.length + 10);
  for (const key of SUB_SCORE_ORDER) {
    const pct = Math.round(DIVE_SCORE_V2_WEIGHTS[key] * 100);
    doc.fillColor(COLOR.textSecondary).font("Helvetica").fontSize(8.5).text(SUB_SCORE_META[key].label, MARGIN, cursor.y, { width: 200 });
    drawBar(doc, MARGIN + 210, cursor.y + 2, CONTENT_W - 250, 6, pct * 2, COLOR.gold);
    doc.fillColor(COLOR.textPrimary).font("Helvetica-Bold").fontSize(8.5).text(`${pct}%`, MARGIN, cursor.y, { width: CONTENT_W, align: "right" });
    cursor.y += weightRowH;
  }

  finishWithFooters();
  return done;

  function finishWithFooters() {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const footerY = PAGE.height - MARGIN - 26;
      doc.moveTo(MARGIN, footerY).lineTo(PAGE.width - MARGIN, footerY).lineWidth(1).strokeColor(COLOR.cardBorder).stroke();
      doc
        .fillColor(COLOR.textTertiary)
        .font("Helvetica")
        .fontSize(7)
        .text("Generated by DIVVE for informational purposes only — not investment advice.", MARGIN, footerY + 8, {
          width: CONTENT_W - 90,
          height: 12,
          ellipsis: true,
        });
      doc
        .fillColor(COLOR.textTertiary)
        .fontSize(7)
        .text(`Page ${i - range.start + 1} of ${range.count}`, MARGIN, footerY + 8, { width: CONTENT_W, height: 12, align: "right" });
    }
    doc.end();
  }
}
